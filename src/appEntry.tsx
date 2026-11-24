/**
 * appEntry — 인증된 사용자용 전체 앱 엔트리포인트
 *
 * main.tsx에서 Firebase Auth 상태 확인 후 인증 사용자일 때 동적 import됨.
 * AuthProvider, 전체 라우팅, 오류 보고, HelmetProvider 등 포함.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './hooks/useAuth';
import { ToastProviderWrapper } from './hooks/ToastProvider';
import ErrorBoundary from './components/common/ErrorBoundary';
import OfflineBanner from './components/common/OfflineBanner';
import App from './App';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';
import { takePendingSessionLoss } from './lib/sessionBoot';
import { auth } from './lib/firebaseAuth';

// 본 웹 폰트는 이 엔트리에서만 붙인다 (공개 랜딩은 폴백 서체로 빠르게 — 근거는 webFont.ts)
import { loadWebFont } from './lib/webFont';
loadWebFont();

// 오류 보고 지연 초기화
import('./lib/monitoring').then((m) => {
    m.initMonitoring();
    // 지난 부팅에서 "세션이 없는 채로" 열렸다면(껐다 켰더니 로그인 화면) 그 증거를 지금 남긴다.
    // 그 시점은 경량 진입점이라 오류 보고 모듈이 없었다 — 미뤄 두는 이유는 sessionBoot.ts에 적어 뒀다.
    const evidence = takePendingSessionLoss();
    if (evidence) {
        // uid가 있어야 같은 기기에서 반복되는 건지 여러 기관에 퍼진 건지 가릴 수 있다(콘솔에만 남는다).
        m.captureWarning('[Auth] 부팅 시 세션 없음 — 다시 로그인해 복귀', {
            uid: auth.currentUser?.uid ?? null,
            ...evidence,
        });
    }
}).catch(() => { });

// 오프라인·지연 쓰기 장부 확인 (저장은 Firestore SDK가 하고, 앱은 서버 반영만 확인한다)
import { registerLedgerReconcile } from './lib/offline/syncQueue';
registerLedgerReconcile();

// 서버에 반영되지 못한 쓰기를 사용자에게 알린다
import { registerSyncFailureNotice } from './lib/offline/syncFailureNotice';
registerSyncFailureNotice();

export function renderFullApp() {
    const root = document.getElementById('root')!;
    createRoot(root).render(
        <StrictMode>
            <HelmetProvider>
                <BrowserRouter>
                    <ErrorBoundary>
                        <ToastProviderWrapper>
                            <AuthProvider>
                                <OfflineBanner />
                                <App />
                                <UpdatePrompt />
                                <InstallPrompt />
                            </AuthProvider>
                        </ToastProviderWrapper>
                    </ErrorBoundary>
                </BrowserRouter>
            </HelmetProvider>
        </StrictMode>,
    );
}
