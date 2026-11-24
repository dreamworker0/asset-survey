/**
 * smallTriggers.test.ts — 커버리지 0%였던 작은 트리거 둘
 * - notifyRoleChange: superAdmin **승격**일 때만 보안 알림(이미 superAdmin·다른 역할 변경·삭제는 조용히).
 *   Discord를 비워 둔 운영에서도 닿도록 운영자 메일을 함께 보낸다
 * - onUserDelete: Auth 계정 삭제 시 users 문서 익명화, 문서가 없으면(NOT_FOUND) 정보 로그만
 */

const mockSendDiscordAlert = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn((_id: string) => ({ update: mockUpdate, set: mockSet }));
const mockCollection = jest.fn((_name: string) => ({ doc: mockDoc }));
const mockLog = jest.fn();

jest.mock('../core/discord', () => ({ sendDiscordAlert: (...args: unknown[]) => mockSendDiscordAlert(...args) }));
const mockSendAdminAlertMail = jest.fn().mockResolvedValue(true);
jest.mock('../core/adminAlertMail', () => ({ sendAdminAlertMail: (...args: unknown[]) => mockSendAdminAlertMail(...args) }));
jest.mock('../core/params', () => ({ GMAIL_APP_PASSWORD: 'GMAIL_APP_PASSWORD' }));
jest.mock('../utils/serviceUrl', () => ({ serviceUrl: () => 'https://app.example' }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'), delete: jest.fn(() => 'FIELD_DELETE') },
}));
jest.mock('../utils/helpers', () => ({ log: (...args: unknown[]) => mockLog(...args) }));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
// v1 auth 트리거: region().auth.user().onDelete(handler) → handler
jest.mock('firebase-functions/v1', () => ({
    region: () => ({ auth: { user: () => ({ onDelete: (handler: unknown) => handler }) } }),
}));
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

import { notifyRoleChange } from '../handlers/triggers/notifyRoleChange';
import { onUserDelete } from '../handlers/triggers/onUserDelete';

beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockSet.mockResolvedValue(undefined);
});

describe('notifyRoleChange — superAdmin 승격 경보', () => {
    type Doc = Record<string, unknown> | null;
    const run = (before: Doc, after: Doc) => (notifyRoleChange as unknown as (e: unknown) => Promise<void>)({
        params: { uid: 'u1' },
        data: { before: { data: () => before ?? undefined }, after: { data: () => after ?? undefined } },
    });

    it.each([
        ['직원 → superAdmin', { role: 'employee' }],
        ['관리자 → superAdmin', { role: 'admin' }],
        ['새 문서가 곧바로 superAdmin', null],
    ])('%s이면 경보를 보낸다', async (_label, before) => {
        await run(before, { role: 'superAdmin', name: '홍길동', email: 'h@x.kr', organizationId: 'org1' });
        expect(mockSendDiscordAlert).toHaveBeenCalledTimes(1);
        const alert = mockSendDiscordAlert.mock.calls[0][0];
        expect(alert.title).toContain('권한 변경 경고');
        expect(alert.fields).toEqual([
            { name: '사용자명', value: '홍길동', inline: true },
            { name: '이메일', value: 'h@x.kr', inline: true },
            { name: '추정 소속(Org ID)', value: 'org1', inline: false },
        ]);
        // Discord가 꺼져 있어도 닿는 경로 — 메일 1통
        expect(mockSendAdminAlertMail).toHaveBeenCalledTimes(1);
        const mail = mockSendAdminAlertMail.mock.calls[0][0];
        expect(mail.subject).toContain('superAdmin');
        expect(mail.lines).toEqual(expect.arrayContaining(['사용자: 홍길동', '소속 기관 ID: org1', '사용자 UID: u1']));
        expect(mail.link.href).toBe('https://app.example/super-admin/admins');
    });

    it.each([
        ['이미 superAdmin(프로필만 수정)', { role: 'superAdmin' }, { role: 'superAdmin', name: '새 이름' }],
        ['superAdmin 강등', { role: 'superAdmin' }, { role: 'admin' }],
        ['직원 → 관리자', { role: 'employee' }, { role: 'admin' }],
        ['문서 삭제', { role: 'employee' }, null],
    ])('%s은 알리지 않는다', async (_label, before, after) => {
        await run(before, after);
        expect(mockSendDiscordAlert).not.toHaveBeenCalled();
        expect(mockSendAdminAlertMail).not.toHaveBeenCalled();
    });

    it('빈 정보는 대체 문구로 채우고, 알림 실패는 트리거를 실패시키지 않는다', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockSendDiscordAlert.mockRejectedValueOnce(new Error('webhook down'));
        await expect(run({ role: 'employee' }, { role: 'superAdmin' })).resolves.toBeUndefined();
        expect(mockSendDiscordAlert.mock.calls[0][0].fields.map((f: { value: string }) => f.value))
            .toEqual(['이름 없음', '이메일 없음', '기관 없음']);
        jest.restoreAllMocks();
    });
});

describe('onUserDelete — 탈퇴 계정 익명화', () => {
    const run = (uid: string) => (onUserDelete as unknown as (u: { uid: string }) => Promise<void>)({ uid });

    it('users 문서의 이름·이메일·전화·사진을 지우고 비활성으로 표시한다', async () => {
        await run('u1');
        expect(mockCollection).toHaveBeenCalledWith('users');
        expect(mockDoc).toHaveBeenCalledWith('u1');
        expect(mockUpdate).toHaveBeenCalledWith({
            name: '*** (탈퇴된 사용자)',
            email: 'deleted-user-u1@example.com',
            phone: '***-****-****',
            status: 'disabled',
            photoURL: '',
            deletedAt: 'SERVER_TIMESTAMP',
            // 시스템 쓰기라 이전 행위자 스탬프를 지운다 — 남기면 익명화가 마지막 수정자에게 귀속된다
            lastEditedByUid: 'FIELD_DELETE',
        });
        expect(mockLog).toHaveBeenCalledWith('INFO', 'onUserDelete', expect.any(String), { uid: 'u1' });
    });

    it('문서가 없으면(NOT_FOUND) 오류가 아니라 정보로 남긴다', async () => {
        mockUpdate.mockRejectedValueOnce({ code: 5, message: 'NOT_FOUND' });
        await expect(run('u2')).resolves.toBeUndefined();
        expect(mockLog).toHaveBeenCalledWith('INFO', 'onUserDelete', expect.stringContaining('존재하지 않아'), { uid: 'u2' });
    });

    it.each([
        ['다른 오류 객체', new Error('unavailable'), 'unavailable'],
        ['원시값으로 던진 오류', 'boom', 'boom'],
        ['null', null, 'null'],
    ])('%s는 ERROR로 남기고 트리거는 끝낸다', async (_label, thrown, message) => {
        mockUpdate.mockRejectedValueOnce(thrown);
        await expect(run('u3')).resolves.toBeUndefined();
        expect(mockLog).toHaveBeenCalledWith('ERROR', 'onUserDelete', expect.any(String), { uid: 'u3', error: message });
    });
});
