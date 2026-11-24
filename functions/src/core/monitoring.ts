/**
 * monitoring — Cloud Functions 오류·경고 보고
 *
 * 2026-11-21 Sentry를 쓰지 않기로 하고(처리방침 수탁자 목록에서 뺌) 2026-11-24 코드도 걷어냈다.
 * 남은 경로:
 *   1. 함수 로그 — 호출부가 남긴다(utils/helpers의 log("ERROR")가 이 함수를 부르므로 여기서 또 찍으면 두 줄이 된다).
 *   2. Discord — `DISCORD_WEBHOOK_URL`이 있을 때만(지금은 비워 둔다. 처리방침에 없는 곳이라).
 *   3. 운영자 메일 — 배치 실패·보안 경보처럼 "사람이 꼭 알아야 하는 것"은 호출부가
 *      adminAlertMail / utils/batchStep의 noteBatchAlert로 따로 보낸다. 여기서 모든 오류를 메일로
 *      보내지 않는 것은 콜러블 오류마다 메일이 쌓여 진짜 경보가 묻히기 때문이다.
 *
 * 테스트 환경(NODE_ENV=test)에서는 Discord로 보내지 않는다.
 */
import { sendDiscordAlert } from "./discord";

const IS_TEST = process.env.NODE_ENV === "test";

/** 함수 로그에 맥락을 함께 남긴다 — 순환 참조 등으로 직렬화가 실패해도 보고는 계속한다 */
function describeContext(context: Record<string, unknown>): string {
    try {
        return JSON.stringify(context, null, 2);
    } catch {
        return "(context 직렬화 실패)";
    }
}

/** 오류 보고 — Discord가 설정돼 있으면 보낸다(로그는 호출부 몫) */
export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
    if (IS_TEST) return;
    const message = error instanceof Error ? error.message : String(error);
    const ctx = describeContext(context);
    sendDiscordAlert({
        title: "🚨 Cloud Functions Exception",
        description: `**Error:** ${message}\n\n**Context:**\n\`\`\`json\n${ctx}\n\`\`\``.substring(0, 3999),
        color: 16711680,
    }).catch(() => {});
}

/**
 * 경고 보고 — "사람이 알아야 하지만 실패는 아닌 것"에만 쓴다.
 * 색과 제목으로 오류와 구분한다(장애가 아닌 것이 빨간 Exception으로 뜨면 진짜 장애 알림이 무뎌진다).
 */
export function captureWarning(message: string, context: Record<string, unknown> = {}): void {
    if (IS_TEST) return;
    const ctx = describeContext(context);
    // 경고는 호출부가 로그를 남기지 않는 경우가 있어(같은 날 재실행 등) 여기서 한 줄 남긴다
    console.warn(`[captureWarning] ${message}`, ctx);
    sendDiscordAlert({
        title: "⚠️ Cloud Functions Warning",
        description: `**Warning:** ${message}\n\n**Context:**\n\`\`\`json\n${ctx}\n\`\`\``.substring(0, 3999),
        color: 16753920, // 주황(0xFFA500) — 빨강(Exception)과 한눈에 구분된다
    }).catch(() => {});
}
