/**
 * reportClientError.test.ts — 앱 오류 보고 (2026-11-23)
 *
 * 고정하는 계약:
 *   - 이메일·전화번호·긴 ID는 지우고 길이를 자른다
 *   - 숫자만 다른 같은 오류는 한 문서로 묶는다
 *   - 기관은 로그인 토큰에서만 읽는다(요청에 넣어도 무시)
 *   - 한도를 넘거나 저장이 실패해도 앱에 오류를 돌려주지 않는다
 *   - 저장은 트랜잭션 없이 update → (없으면) create → (먼저 만들어졌으면) update (2026-11-24)
 */
const mockIpLimited = jest.fn().mockResolvedValue(false);
const mockBudgetOut = jest.fn().mockResolvedValue(false);
jest.mock('../utils/rateLimit', () => ({ checkRateLimitByIp: mockIpLimited, checkGlobalBudget: mockBudgetOut }));
jest.mock('../utils/clientIp', () => ({ resolveClientIp: () => '1.2.3.4' }));

const grpcError = (code: number) => Object.assign(new Error(`grpc ${code}`), { code });
let existing = false;
const docUpdate = jest.fn(async () => { if (!existing) throw grpcError(5); });
const docCreate = jest.fn(async () => { if (existing) throw grpcError(6); existing = true; });
const mockRunTx = jest.fn();
const mockDoc = jest.fn((id: string) => ({ id, update: docUpdate, create: docCreate }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: () => ({ doc: mockDoc }), runTransaction: mockRunTx }),
    FieldValue: {
        serverTimestamp: () => 'TS',
        increment: (n: number) => `INC${n}`,
        arrayUnion: (...v: unknown[]) => ({ union: v }),
    },
    Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
}));

import { reportClientError } from '../handlers/callable/reportClientError';
import { sanitizeReport, scrubText, groupKey } from '../services/clientErrors/clientErrorReport';

const handler = reportClientError as unknown as (req: Record<string, unknown>) => Promise<{ ok: boolean }>;

beforeEach(() => {
    jest.clearAllMocks();
    existing = false;
});

describe('거르기', () => {
    it('이메일·전화번호·긴 ID를 지운다', () => {
        expect(scrubText('kim@test.kr 님 010-1234-5678 문서 aB3dE5fG7hI9jK1lM3nO5 없음'))
            .toBe('[이메일] 님 [숫자] 문서 [ID] 없음');
    });

    it('문구가 없으면 기록하지 않고, 길이를 자르며 경로의 쿼리를 뗀다', () => {
        expect(sanitizeReport({ message: '  ' })).toBeNull();
        const r = sanitizeReport({ message: 'x'.repeat(500), path: '/admin/assets?q=홍길동', stack: Array(10).fill('at f (a.js:1:2)').join('\n') })!;
        expect(r.message).toHaveLength(300);
        expect(r.path).toBe('/admin/assets');
        expect(r.stack.split('\n')).toHaveLength(6);
        expect(r.name).toBe('Error');
    });

    it('숫자만 다른 같은 오류는 한 묶음이다', () => {
        const a = sanitizeReport({ name: 'TypeError', message: 'index 3 out of range', where: 'getAssets' })!;
        const b = sanitizeReport({ name: 'TypeError', message: 'index 12 out of range', where: 'getAssets' })!;
        const c = sanitizeReport({ name: 'TypeError', message: 'index 3 out of range', where: 'getSpaces' })!;
        expect(groupKey(a)).toBe(groupKey(b));
        expect(groupKey(a)).not.toBe(groupKey(c));
    });
});

describe('reportClientError', () => {
    it('처음 난 오류는 새로 만들고, 기관은 토큰에서만 읽는다', async () => {
        const res = await handler({
            auth: { uid: 'u1', token: { orgId: 'org-A', role: 'admin' } },
            data: { message: 'boom', where: 'getAssets', orgId: 'org-B', path: '/admin/assets' },
            rawRequest: {},
        });
        expect(res).toEqual({ ok: true });
        expect(docCreate).toHaveBeenCalledTimes(1);
        const saved = (docCreate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect(saved).toMatchObject({ message: 'boom', where: 'getAssets', firstAt: 'TS', orgIds: { union: ['org-A'] }, lastRole: 'admin', count: 'INC1', lastPath: '/admin/assets' });
        expect(JSON.stringify(saved)).not.toContain('org-B');
        expect(JSON.stringify(saved)).not.toContain('u1');
    });

    it('이미 있는 오류는 횟수만 늘리고, 로그인 전이면 기관 없이 guest로 남긴다', async () => {
        existing = true;
        await handler({ data: { message: 'boom' }, rawRequest: {} });
        expect(docUpdate).toHaveBeenCalledTimes(1);
        expect(docCreate).not.toHaveBeenCalled();
        const saved = (docUpdate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect(saved).toMatchObject({ count: 'INC1', lastRole: 'guest' });
        expect(saved.orgIds).toBeUndefined();
        // 처음 시각과 오류 정체는 다시 쓰지 않는다
        expect(saved.firstAt).toBeUndefined();
        expect(saved.message).toBeUndefined();
    });

    it('한도를 넘거나 저장이 실패해도 오류를 던지지 않는다', async () => {
        mockIpLimited.mockResolvedValueOnce(true);
        expect(await handler({ data: { message: 'boom' }, rawRequest: {} })).toEqual({ ok: false });
        docUpdate.mockRejectedValueOnce(grpcError(14)); // UNAVAILABLE — 없음(5)이 아닌 실패는 그대로 실패
        expect(await handler({ data: { message: 'boom' }, rawRequest: {} })).toEqual({ ok: false });
        expect(await handler({ data: {}, rawRequest: {} })).toEqual({ ok: false });
    });

    it('트랜잭션을 쓰지 않는다 — 같은 오류가 몰려도 서로 막지 않는다', async () => {
        await handler({ data: { message: 'boom' }, rawRequest: {} });
        existing = true;
        await handler({ data: { message: 'boom' }, rawRequest: {} });
        expect(mockRunTx).not.toHaveBeenCalled();
        expect(docCreate).toHaveBeenCalledTimes(1);
        expect(docUpdate).toHaveBeenCalledTimes(2); // 첫 번째는 없음(5)으로 실패한 시도
    });

    it('다른 기기가 먼저 만들었으면(ALREADY_EXISTS) 다시 update로 합친다', async () => {
        // update 때는 없었는데 create 직전에 다른 기기가 만든 경우
        docUpdate.mockImplementationOnce(async () => { throw grpcError(5); });
        docCreate.mockImplementationOnce(async () => { throw grpcError(6); });
        existing = true;
        const res = await handler({ data: { message: 'boom' }, rawRequest: {} });
        expect(res).toEqual({ ok: true });
        expect(docCreate).toHaveBeenCalledTimes(1);
        expect(docUpdate).toHaveBeenCalledTimes(2);
    });
});
