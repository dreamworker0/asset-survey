/**
 * batchStep.test.ts — 야간·주간 배치가 공유하는 스텝 래퍼 단위 테스트
 *
 * 세 배치(dailyNightlyBatch·nightlyStatsBatch·weeklyMaintenanceBatch)가 같은 실패 처리 규약을
 * 여기에 의존한다. 지키려는 것은 둘이다:
 *   1. 스텝이 실패해도 배치가 멈추지 않되 **조용히 넘어가지 않는다**(captureError로 승격)
 *   2. 실패·경고가 운영자 메일로 **실제로 전송된다**(종료 시 기다림)
 */

const mockCaptureError = jest.fn();
jest.mock('../core/monitoring', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

const mockSendAdminAlertMail = jest.fn();
jest.mock('../core/adminAlertMail', () => ({
    sendAdminAlertMail: (...args: unknown[]) => mockSendAdminAlertMail(...args),
}));

import { runStep, logBatchResult, noteBatchAlert, resetBatchAlerts } from '../utils/batchStep';

describe('batchStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn();
        console.log = jest.fn();
        mockSendAdminAlertMail.mockResolvedValue(true);
        resetBatchAlerts();
    });

    describe('runStep()', () => {
        it('성공하면 실패 목록을 건드리지 않고 보고도 하지 않는다', async () => {
            const failed: string[] = [];

            await runStep(failed, 'nightly', 'backupFirestore', async () => undefined);

            expect(failed).toEqual([]);
            expect(mockCaptureError).not.toHaveBeenCalled();
        });

        it('실패하면 삼키지 않고 captureError로 올린 뒤 실패 목록에 담는다', async () => {
            const failed: string[] = [];
            const err = new Error('백업 버킷 접근 거부');

            await runStep(failed, 'nightly', 'backupFirestore', async () => { throw err; });

            expect(failed).toEqual(['backupFirestore']);
            expect(mockCaptureError).toHaveBeenCalledWith(err, { context: 'nightly', step: 'backupFirestore' });
        });

        it('실패해도 던지지 않는다 — 다음 스텝이 계속 돌아야 한다', async () => {
            const failed: string[] = [];

            await expect(
                runStep(failed, 'nightly', 'checkInsuranceExpiry', async () => { throw new Error('boom'); })
            ).resolves.toBeUndefined();
        });
    });

    describe('logBatchResult()', () => {
        it('실패가 없으면 완료 로그만 남긴다', async () => {
            await logBatchResult('nightly', []);

            expect(console.log).toHaveBeenCalledWith('[Batch] nightly completed.');
        });

        it('실패가 있으면 error 로그를 남긴다', async () => {
            await logBatchResult('nightly', ['backupFirestore', 'checkInsuranceExpiry']);

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('2 failed step(s): backupFirestore, checkInsuranceExpiry')
            );
        });
    });

    // Discord를 비워 둔 운영(OPERATIONS.md)에서는 captureError가 아무 데도 닿지 않는다.
    // 메일이 유일한 경보 경로이므로 "실패가 있으면 반드시 1통, 없으면 0통"을 고정한다.
    describe('운영 경보 메일', () => {
        it('실패가 없고 경고도 없으면 메일을 보내지 않는다', async () => {
            await runStep([], 'nightly', 'backupFirestore', async () => undefined);
            await logBatchResult('nightly', []);

            expect(mockSendAdminAlertMail).not.toHaveBeenCalled();
        });

        it('스텝이 실패하면 실패 메시지를 담아 메일 1통을 보낸다', async () => {
            const failed: string[] = [];
            await runStep(failed, 'nightly', 'backupFirestore', async () => { throw new Error('버킷 권한 거부\n조치: gcloud ...'); });
            await runStep(failed, 'nightly', 'verifyPreviousBackup', async () => { throw new Error('어제 백업 없음'); });
            await logBatchResult('nightly', failed);

            expect(mockSendAdminAlertMail).toHaveBeenCalledTimes(1);
            const mail = mockSendAdminAlertMail.mock.calls[0][0];
            expect(mail.subject).toBe('nightly 실패 2건 (backupFirestore, verifyPreviousBackup)');
            const text = mail.lines.join('\n');
            expect(text).toContain('[실패] backupFirestore\n버킷 권한 거부\n조치: gcloud ...');
            expect(text).toContain('[실패] verifyPreviousBackup\n어제 백업 없음');
        });

        it('스텝 안의 경고(noteBatchAlert)만 있어도 메일을 보낸다', async () => {
            noteBatchAlert('[경고] 기관 파기 실패 — org1');
            await logBatchResult('weekly', []);

            expect(mockSendAdminAlertMail).toHaveBeenCalledTimes(1);
            expect(mockSendAdminAlertMail.mock.calls[0][0].subject).toBe('weekly 확인 필요 1건');
        });

        it('보낸 경보는 비워서 다음 실행에 섞이지 않는다', async () => {
            noteBatchAlert('[경고] 첫 실행');
            await logBatchResult('weekly', []);
            await logBatchResult('weekly', []);

            expect(mockSendAdminAlertMail).toHaveBeenCalledTimes(1);
        });

        it('메일 전송을 기다린 뒤 반환한다', async () => {
            let sent = false;
            mockSendAdminAlertMail.mockImplementation(
                () => new Promise<boolean>(resolve => setTimeout(() => { sent = true; resolve(true); }, 10))
            );
            noteBatchAlert('[경고] 기다림');
            await logBatchResult('weekly', []);

            expect(sent).toBe(true);
        });
    });
});
