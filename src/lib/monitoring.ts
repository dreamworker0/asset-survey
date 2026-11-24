/**
 * monitoring — 화면 오류를 운영자에게 알리는 입구
 *
 * 2026-11-21 Sentry를 쓰지 않기로 하고(처리방침 수탁자 목록에서 뺌) 2026-11-24 코드도 걷어냈다.
 * 오류는 자체 보고(errorReport → reportClientError 함수 → 슈퍼관리자 [오류 기록])로만 간다.
 * 외부 서비스로 나가는 것이 없으므로 처리방침을 고칠 일도, 실수로 켜져 개인정보가 나갈 일도 없다.
 *
 * - captureError: 오류 요약을 자체 보고로 보내고 콘솔에도 남긴다. context는 기능 이름(`context`)만
 *   보내고 나머지(저장하려던 문서 등)는 보내지 않는다 — errorReport.buildPayload 참고.
 * - captureWarning: 원인이 설명되는 사건(의도된 세션 종료 등). 콘솔에만 남긴다 — 운영자가 할 일이
 *   없는 사건을 [오류 기록]에 쌓으면 진짜 결함이 묻힌다.
 */
import { reportClientError, listenForUncaughtErrors } from './errorReport';

/** 앱 진입 때 한 번 — 처리하지 못한 오류(window error·unhandledrejection)도 보낸다 */
export function initMonitoring(): void {
    listenForUncaughtErrors();
}

export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
    reportClientError(error, context);
    console.error(error);
}

export function captureWarning(message: string, context: Record<string, unknown> = {}): void {
    console.warn(message, context);
}
