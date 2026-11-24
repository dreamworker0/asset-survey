import { Component, ReactNode, ErrorInfo } from 'react';
import { isChunkLoadError, isOffline, updateAndReload } from '../../lib/appUpdate';
import { captureError } from '../../lib/monitoring';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    /** DOM NotFoundError(code 8)인지 확인 — 브라우저별 메시지가 다르므로 이름+코드로 판별 */
    private static isDomNotFoundError(error: Error): boolean {
        return (
            error.name === 'NotFoundError' ||
            ('code' in error && (error as DOMException).code === 8)
        );
    }

    static getDerivedStateFromError(error: Error): State {
        // DOM NotFoundError는 렌더링에 영향 없으므로 에러 페이지를 보여줄 필요 없음
        if (ErrorBoundary.isDomNotFoundError(error)) {
            return { hasError: false, error: null };
        }
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // DOM NotFoundError는 오류 보고로도 보내지 않는다(브라우저 확장·번역기가 DOM을 건드린 소음)
        if (ErrorBoundary.isDomNotFoundError(error)) return;
        captureError(error, { componentStack: errorInfo?.componentStack });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    render() {
        // 옛 앱 파일을 못 받은 경우(대개 새 버전 배포 직후)는 오류가 아니라 새 버전 안내로 보여 준다 (2026-11-22)
        if (this.state.hasError && isChunkLoadError(this.state.error) && !isOffline()) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
                    <div className="text-center max-w-md">
                        <div className="text-6xl mb-4" aria-hidden="true">🎉</div>
                        <h2 className="text-xl font-bold text-surface-800 dark:text-surface-100 mb-2">새 버전이 나왔어요</h2>
                        <p className="text-surface-600 dark:text-surface-400 mb-6 text-sm">더 나아진 재물조사로 바꿀게요. 아래 버튼을 누르면 바로 업데이트됩니다.</p>
                        <button
                            type="button"
                            onClick={() => void updateAndReload()}
                            className="btn-primary min-h-[48px] px-6"
                        >
                            지금 업데이트
                        </button>
                    </div>
                </div>
            );
        }
        if (this.state.hasError) {
            return (
                <div role="alert" className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
                    <div className="text-center max-w-md">
                        <div className="text-6xl mb-4" aria-hidden="true">😥</div>
                        <h2 className="text-xl font-bold text-surface-800 dark:text-surface-100 mb-2">
                            문제가 발생했습니다
                        </h2>
                        <p className="text-surface-600 dark:text-surface-400 mb-6 text-sm">
                            {isOffline()
                                ? '인터넷 연결이 끊겨 화면을 불러오지 못했습니다. 연결을 확인한 뒤 아래 버튼을 눌러 주세요.'
                                : '일시적인 오류가 발생했습니다. 아래 버튼을 누르면 다시 불러옵니다. 계속되면 앱을 닫았다 다시 열어 주세요.'}
                        </p>
                        <button
                            type="button"
                            onClick={this.handleReset}
                            className="btn-primary min-h-[48px] px-6"
                        >
                            다시 불러오기
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
