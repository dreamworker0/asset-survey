/**
 * monitoring — 화면 오류 보고 입구 (2026-11-24 Sentry 제거 뒤)
 *
 * 고정하는 계약:
 *   - captureError는 자체 보고로 보내고 콘솔에도 남긴다
 *   - captureWarning은 콘솔에만 남긴다([오류 기록]에 쌓지 않는다)
 *   - initMonitoring은 처리하지 못한 오류 듣기를 건다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reportClientError, listenForUncaughtErrors } = vi.hoisted(() => ({
    reportClientError: vi.fn(),
    listenForUncaughtErrors: vi.fn(),
}));
vi.mock('../../lib/errorReport', () => ({ reportClientError, listenForUncaughtErrors }));

import { captureError, captureWarning, initMonitoring } from '../../lib/monitoring';

describe('monitoring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('captureError는 자체 보고로 보내고 콘솔에도 남긴다', () => {
        const err = new Error('boom');
        captureError(err, { context: 'getAssets' });
        expect(reportClientError).toHaveBeenCalledWith(err, { context: 'getAssets' });
        expect(console.error).toHaveBeenCalledWith(err);
    });

    it('captureWarning은 보고하지 않고 콘솔에만 남긴다', () => {
        captureWarning('[Auth] 세션 종료', { uid: 'u1' });
        expect(reportClientError).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith('[Auth] 세션 종료', { uid: 'u1' });
    });

    it('initMonitoring은 처리하지 못한 오류 듣기를 건다', () => {
        initMonitoring();
        expect(listenForUncaughtErrors).toHaveBeenCalledTimes(1);
    });
});
