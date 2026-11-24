/**
 * sendInviteEmails.test.ts — 가입 대기 직원 초대 메일 (2026-11-23)
 *
 * 고정하는 계약:
 *   - 해당 기관 admin 또는 superAdmin만. 다른 기관 admin·employee는 거부
 *   - 받는 주소는 요청이 아니라 사전 등록 문서에서 읽는다
 *   - 10분 안에 보낸 사람·없는 문서는 건너뛰고, 보낸 사람에겐 invitedAt·inviteCount를 남긴다
 *   - 한 번에 100명까지, 승인된 기관·초대 코드가 있을 때만
 */
const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/rateLimit', () => ({ checkRateLimitByUid: mockCheckRateLimit }));
jest.mock('../utils/constants', () => ({ getRateLimits: jest.fn().mockResolvedValue({ max: 10, windowSec: 3600 }) }));
jest.mock('../core/monitoring', () => ({ captureError: jest.fn() }));
jest.mock('../core/params', () => ({ GMAIL_APP_PASSWORD: {} }));

const mockSendMail = jest.fn().mockResolvedValue(undefined);
let mockGmailOn = true;
jest.mock('../core/mailer', () => ({
    createGmailTransporter: () => ({ sendMail: mockSendMail }),
    isGmailConfigured: () => mockGmailOn,
    systemMailFrom: () => '"재물조사" <noreply@test>',
}));

const mockOrgGet = jest.fn();
const mockGetAll = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: mockOrgGet,
                collection: jest.fn(() => ({ doc: jest.fn((id: string) => ({ id })) })),
            })),
        })),
        getAll: mockGetAll,
    }),
    FieldValue: { serverTimestamp: () => 'TS', increment: (n: number) => `INC${n}` },
}));

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) { super(message); this.code = code; }
    },
}));

import { sendInviteEmails, parseInviteRequest, INVITE_MAX } from '../handlers/callable/sendInviteEmails';
import { inviteMailOptions } from '../services/organization/inviteMail';

type Res = { sent: number; skipped: number; failed: number };
const handler = sendInviteEmails as unknown as (req: Record<string, unknown>) => Promise<Res>;

const adminOfOrg1 = { uid: 'admin1', token: { role: 'admin', orgId: 'org1' } };
const approvedOrg = { exists: true, data: () => ({ status: 'approved', inviteCode: 'ABC123', name: '행복복지관' }) };

function preSnap(id: string, data: Record<string, unknown> | null) {
    const update = jest.fn().mockResolvedValue(undefined);
    return { id, exists: data !== null, data: () => data ?? undefined, ref: { update } };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGmailOn = true;
    mockOrgGet.mockResolvedValue(approvedOrg);
});

describe('parseInviteRequest', () => {
    it('겹친 ID는 하나로, 빈 목록·100명 초과는 거부', () => {
        expect(parseInviteRequest({ organizationId: 'org1', preRegIds: ['a', 'a', 'b'] }).ids).toEqual(['a', 'b']);
        expect(() => parseInviteRequest({ organizationId: 'org1', preRegIds: [] })).toThrow('골라');
        const many = Array.from({ length: INVITE_MAX + 1 }, (_, i) => `p${i}`);
        expect(() => parseInviteRequest({ organizationId: 'org1', preRegIds: many })).toThrow(`${INVITE_MAX}명`);
        expect(() => parseInviteRequest({ preRegIds: ['a'] })).toThrow('organizationId');
    });
});

describe('sendInviteEmails', () => {
    it('다른 기관 관리자와 직원은 거부한다', async () => {
        const data = { organizationId: 'org1', preRegIds: ['p1'] };
        await expect(handler({ auth: { uid: 'x', token: { role: 'admin', orgId: 'org2' } }, data })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(handler({ auth: { uid: 'x', token: { role: 'employee', orgId: 'org1' } }, data })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('메일 설정이 없거나 승인 전 기관이면 보내지 않는다', async () => {
        const data = { organizationId: 'org1', preRegIds: ['p1'] };
        mockGmailOn = false;
        await expect(handler({ auth: adminOfOrg1, data })).rejects.toMatchObject({ code: 'failed-precondition' });
        mockGmailOn = true;
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'pending', inviteCode: 'ABC123' }) });
        await expect(handler({ auth: adminOfOrg1, data })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('사전 등록 문서의 주소로 보내고, 최근에 보낸 사람·없는 문서는 건너뛰고, 실패는 따로 센다', async () => {
        const fresh = preSnap('p1', { email: 'kim@test.kr', name: '김철수' });
        const recent = preSnap('p2', { email: 'lee@test.kr', name: '이영희', invitedAt: { toMillis: () => Date.now() - 60_000 } });
        const old = preSnap('p3', { email: 'park@test.kr', name: '박민수', invitedAt: { toMillis: () => Date.now() - 60 * 60_000 } });
        const gone = preSnap('p4', null);
        const bad = preSnap('p5', { email: 'fail@test.kr', name: '최실패' });
        mockGetAll.mockResolvedValue([fresh, recent, old, gone, bad]);
        mockSendMail.mockImplementation(async (opts: { to: string }) => {
            if (opts.to === 'fail@test.kr') throw new Error('smtp');
        });

        const res = await handler({ auth: adminOfOrg1, data: { organizationId: 'org1', preRegIds: ['p1', 'p2', 'p3', 'p4', 'p5'] } });

        expect(res).toEqual({ sent: 2, skipped: 2, failed: 1 });
        expect(mockSendMail.mock.calls.map((c) => c[0].to)).toEqual(['kim@test.kr', 'park@test.kr', 'fail@test.kr']);
        expect(fresh.ref.update).toHaveBeenCalledWith({ invitedAt: 'TS', inviteCount: 'INC1' });
        expect(recent.ref.update).not.toHaveBeenCalled();
        expect(bad.ref.update).not.toHaveBeenCalled();
    });
});

describe('inviteMailOptions', () => {
    it('기관 코드가 든 가입 링크와 받는 주소를 담고, 이름은 이스케이프한다', () => {
        const m = inviteMailOptions('kim@test.kr', '<김>', '행복&복지관', 'ABC123');
        expect(m.to).toBe('kim@test.kr');
        expect(m.subject).toContain('행복&복지관');
        expect(m.html).toContain('?code=ABC123');
        expect(m.html).toContain('&lt;김&gt;');
        expect(m.html).toContain('kim@test.kr');
        expect(m.html).not.toContain('<김>');
    });
});
