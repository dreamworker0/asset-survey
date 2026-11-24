/**
 * adminAlertMail.test.ts — 운영 경보 메일
 *
 * Discord·Sentry를 비워 둔 운영에서 백업 실패·권한 승격을 알리는 유일한 경로다.
 * 지키려는 것: 받는 사람 결정, 값 escape(오류 메시지에 태그가 섞여도 깨지지 않음), 실패해도 던지지 않음.
 */
const mockSendMail = jest.fn();
let mockConfigured = true;
jest.mock('../core/mailer', () => ({
    isGmailConfigured: () => mockConfigured,
    createGmailTransporter: () => ({ sendMail: (...args: unknown[]) => mockSendMail(...args) }),
    systemMailFrom: () => '"재물조사 시스템" <sys@example.com>',
}));

import { sendAdminAlertMail, buildAdminAlertHtml, adminAlertRecipient } from '../core/adminAlertMail';

describe('adminAlertMail', () => {
    const env = { ...process.env };
    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigured = true;
        mockSendMail.mockResolvedValue({});
        process.env = { ...env, GMAIL_USER: 'sys@example.com', ADMIN_NOTIFICATION_EMAIL: 'ops@example.com' };
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterAll(() => { process.env = env; });

    it('ADMIN_NOTIFICATION_EMAIL로 보내고, 없으면 발신 계정으로 보낸다', () => {
        expect(adminAlertRecipient()).toBe('ops@example.com');
        delete process.env.ADMIN_NOTIFICATION_EMAIL;
        expect(adminAlertRecipient()).toBe('sys@example.com');
    });

    it('제목 앞에 [재물조사]를 붙여 보낸다', async () => {
        await expect(sendAdminAlertMail({ subject: '백업 실패', lines: ['x'] })).resolves.toBe(true);
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'ops@example.com',
            subject: '[재물조사] 백업 실패',
        }));
    });

    it('본문 값을 escape한다', () => {
        const html = buildAdminAlertHtml({ subject: '<b>', lines: ['<script>alert(1)</script>'], link: { href: 'https://a/"x', label: '열기' } });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&lt;b&gt;');
        expect(html).toContain('https://a/&quot;x');
    });

    it('Gmail 설정이 없으면 보내지 않고 false', async () => {
        mockConfigured = false;
        await expect(sendAdminAlertMail({ subject: 's', lines: [] })).resolves.toBe(false);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('발송이 실패해도 던지지 않는다 — 배치·트리거를 깨면 안 된다', async () => {
        mockSendMail.mockRejectedValueOnce(new Error('SMTP down'));
        await expect(sendAdminAlertMail({ subject: 's', lines: [] })).resolves.toBe(false);
    });
});
