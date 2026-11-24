/**
 * errorReport — 화면 오류를 운영자에게 알리는 최소 보고 (2026-11-23)
 *
 * Sentry를 쓰지 않기로 해(2026-11-21 처리방침에서 빼고 2026-11-24 코드도 걷어냄) 사용자가 겪은 오류를 알 길이 없었다.
 * `captureError`와 처리하지 못한 오류(window error·unhandledrejection)를 `reportClientError` 함수로
 * 보내면, 서버가 같은 오류끼리 묶어 슈퍼관리자 [오류 기록]에 보여 준다(30일 뒤 저절로 지움).
 *
 * 보내는 것은 오류 이름·문구·어느 기능(context)·오류 코드·스택 앞부분·화면 경로·앱 버전뿐이다.
 * 사용자 정보·입력값(context의 나머지)은 보내지 않고, 문구의 이메일·전화번호·긴 ID는 여기와 서버에서 지운다.
 *
 * - 운영 빌드의 실제 주소에서만 보낸다(개발 서버·CI가 띄운 localhost 제외).
 * - 한 화면에서 같은 오류는 한 번, 모두 합쳐 15건까지만 보낸다. 오프라인이면 보내지 않는다.
 * - 보내다 실패해도 조용히 넘어간다 — 오류 보고가 다시 오류를 낳지 않게.
 */

const MAX_REPORTS = 15;
const sentKeys = new Set<string>();
let sentCount = 0;

/** 앱 버전 — 배포 워크플로가 빌드 때 넣는 커밋 SHA 앞 7자리 */
const VERSION = ((import.meta.env.VITE_APP_VERSION as string | undefined) ?? '').slice(0, 7);

/** 보고해도 소용없는 환경 소음(브라우저 확장·네트워크·App Check 지연) */
const NOISE = [
    /ResizeObserver loop/,
    /chrome-extension:|moz-extension:|safari-extension:/,
    /AppCheck:.*(throttled|initial-throttle|fetch-network-error|failed to connect)/i,
    /reCAPTCHA/i,
    /analytics\/config-fetch-failed|Dynamic config fetch failed/,
    /Blocked a frame with origin/,
    /hasPasswordField_/,
    /has already been defined/,
    /violates the .* Content Security Policy/,
];

function enabled(): boolean {
    if (!import.meta.env.PROD) return false;
    if (typeof location === 'undefined' || typeof navigator === 'undefined') return false;
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return false;
    return navigator.onLine !== false;
}

/** 화면 경로에서 ID처럼 보이는 조각을 가린다 — /admin/assets/org1__2026-001 → /admin/assets/:id */
export function maskPath(pathname: string): string {
    return pathname
        .split('/')
        .map((seg, i, all) => {
            if (!seg) return seg;
            if (all[i - 1] === 't') return ':tag';
            return seg.length >= 12 || seg.includes('__') || /\d{3,}/.test(seg) ? ':id' : seg;
        })
        .join('/');
}

interface Payload {
    name: string;
    message: string;
    where: string;
    code: string;
    stack: string;
    path: string;
    version: string;
}

/** 보낼 내용을 만든다. 보내지 않을 오류면 null */
export function buildPayload(error: unknown, context: Record<string, unknown> = {}): Payload | null {
    const e = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown } | null | undefined;
    const message = typeof e?.message === 'string' ? e.message : typeof error === 'string' ? error : '';
    if (!message.trim()) return null;
    const stack = typeof e?.stack === 'string' ? e.stack : '';
    if (NOISE.some((re) => re.test(message) || re.test(stack))) return null;
    return {
        name: typeof e?.name === 'string' ? e.name : 'Error',
        message: message.slice(0, 500),
        where: typeof context.context === 'string' ? context.context.slice(0, 80) : '',
        code: typeof e?.code === 'string' ? e.code.slice(0, 60) : '',
        stack: stack.split('\n').slice(0, 6).join('\n').slice(0, 1500),
        path: typeof location !== 'undefined' ? maskPath(location.pathname) : '',
        version: VERSION,
    };
}

/** 오류 하나를 보낸다(조건이 맞을 때만, 실패는 조용히) */
export function reportClientError(error: unknown, context: Record<string, unknown> = {}): void {
    if (!enabled() || sentCount >= MAX_REPORTS) return;
    const payload = buildPayload(error, context);
    if (!payload) return;
    const key = `${payload.name}|${payload.message}|${payload.where}`;
    if (sentKeys.has(key)) return;
    sentKeys.add(key);
    sentCount++;
    void (async () => {
        try {
            const [{ httpsCallable }, { firebaseFunctions }] = await Promise.all([
                import('firebase/functions'),
                import('./firebase'),
            ]);
            await httpsCallable(firebaseFunctions, 'reportClientError')(payload);
        } catch (err) {
            console.warn('[errorReport] 오류 보고 실패:', err);
        }
    })();
}

let listening = false;

/** 처리하지 못한 오류도 보낸다 — 앱 진입 때 한 번 */
export function listenForUncaughtErrors(): void {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('error', (ev) => {
        reportClientError(ev.error ?? ev.message, { context: 'window.error' });
    });
    window.addEventListener('unhandledrejection', (ev) => {
        reportClientError(ev.reason, { context: 'unhandledrejection' });
    });
}

/** 테스트용 — 보낸 기록 비우기 */
export function resetErrorReportForTest(): void {
    sentKeys.clear();
    sentCount = 0;
}
