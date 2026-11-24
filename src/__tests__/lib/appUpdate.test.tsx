/**
 * 새 버전 안내 (2026-11-22) — 옛 앱 파일을 못 받으면 오류 대신 "새 버전이 나왔어요"
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { isChunkLoadError } from '../../lib/appUpdate';

vi.mock('../../lib/monitoring', () => ({ captureError: vi.fn() }));
import ErrorBoundary from '../../components/common/ErrorBoundary';

function Boom({ error }: { error: Error }): never { throw error; }

describe('isChunkLoadError', () => {
    it('브라우저별 청크 실패 문구를 알아본다', () => {
        expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true);
        expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
        expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
        expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
    });
});

describe('ErrorBoundary', () => {
    afterEach(() => vi.restoreAllMocks());

    it('청크 실패는 새 버전 안내와 [지금 업데이트]를 보인다', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        render(<ErrorBoundary><Boom error={new TypeError('Failed to fetch dynamically imported module: a.js')} /></ErrorBoundary>);
        expect(screen.getByText('새 버전이 나왔어요')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '지금 업데이트' })).toBeInTheDocument();
    });

    it('다른 오류는 예전처럼 문제 안내를 보인다', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        render(<ErrorBoundary><Boom error={new Error('x')} /></ErrorBoundary>);
        expect(screen.getByText('문제가 발생했습니다')).toBeInTheDocument();
    });

    it('인터넷이 끊겼으면 새 버전이라고 하지 않는다', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        render(<ErrorBoundary><Boom error={new TypeError('Failed to fetch dynamically imported module: a.js')} /></ErrorBoundary>);
        expect(screen.queryByText('새 버전이 나왔어요')).not.toBeInTheDocument();
    });
});
