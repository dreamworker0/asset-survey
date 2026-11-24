/**
 * batchStep — 배치 스텝 하나를 실행하는 공용 래퍼
 *
 * 야간 배치를 성격별로 셋(집계·백업·주간 유지보수)으로 쪼개면서, 세 배치가 같은 실패 처리
 * 규약을 공유하도록 dailyNightlyBatch에 있던 runStep을 여기로 옮겼다. `context`만 배치별로
 * 다르게 넘긴다.
 */
import { captureError } from "../core/monitoring";
import { sendAdminAlertMail } from "../core/adminAlertMail";

/**
 * 이번 배치에서 운영자가 알아야 할 것 — 끝날 때 메일 1통으로 묶어 보낸다.
 *
 * Discord를 비워 둔 운영(OPERATIONS.md)에서는 captureError·captureWarning이 아무 데도
 * 닿지 않는다. 스텝 실패와 스텝 안의 중요한 경고(기관 파기 실패 등)를 여기에 모아 두었다가
 * logBatchResult가 Gmail로 보낸다. 배치 하나에 메일 1통이라 기관 루프가 길어도 쏟아지지 않는다.
 *
 * 모듈 상태다. 스케줄 함수는 인스턴스 하나가 한 번에 한 배치만 돌리고, logBatchResult가 보낸 뒤
 * 비우므로 다음 실행에 섞이지 않는다.
 */
const pendingAlerts: string[] = [];

/** 배치 종료 메일에 실을 줄 하나를 남긴다 — captureWarning과 함께 부른다 */
export function noteBatchAlert(line: string): void {
    pendingAlerts.push(line);
}

/** 테스트용 — 남은 경보 비우기 */
export function resetBatchAlerts(): void {
    pendingAlerts.length = 0;
}

/**
 * 배치 스텝 하나를 실행한다. 실패해도 다음 스텝으로 넘어가되, **조용히 넘어가지는 않는다.**
 *
 * 각 스텝의 catch가 console.error만 남기면 어디로도 알림이 가지 않아, 특히 Firestore 백업
 * 실패가 "매일 눈으로 확인"(OPERATIONS.md)에만 의존하게 된다 — 백업은 실패한 사실 자체를
 * 놓치면 복구 시점에야 알게 되는 항목이다. captureError로 승격하고 종료 메일에도 싣는다.
 *
 * 스텝 단위로만 승격하는 것이 요점이다. 기관별 루프 내부(purgeOrgs 등)의 개별 실패까지
 * 올리면 한 번의 배치가 알림 수십 건을 쏟아낸다 — 그쪽은 console.error로 남긴다.
 */
export async function runStep(
    failed: string[],
    context: string,
    name: string,
    fn: () => Promise<unknown>,
): Promise<void> {
    try {
        await fn();
    } catch (e: unknown) {
        const message = (e as Error)?.message ?? String(e);
        console.error(`Error in ${name}:`, message);
        captureError(e, { context, step: name });
        failed.push(name);
        // 백업 실패 메시지는 조치 명령까지 담고 있다(describeExportFailure) — 그대로 싣는다
        noteBatchAlert(`[실패] ${name}\n${message}`);
    }
}

/**
 * 배치 종료 처리 — 결과를 한 줄로 남기고, 모은 경보를 메일로 보낸다.
 * 실패 스텝이 있으면 error로 올린다.
 *
 * **메일을 여기서 기다리는 이유**: 핸들러가 반환하면 Cloud Run 인스턴스가 동결·종료되면서
 * 보내던 메일이 사라질 수 있다. 세 배치가 모두 마지막에 이 함수를 부르므로 여기가 공통 경계다 —
 * 호출부는 반드시 await 한다. 이 함수를 부르는 배치는 `secrets: [GMAIL_APP_PASSWORD]`가 필요하다.
 */
export async function logBatchResult(context: string, failed: string[]): Promise<void> {
    if (failed.length > 0) {
        console.error(`[Batch] ${context} completed with ${failed.length} failed step(s): ${failed.join(", ")}`);
    } else {
        console.log(`[Batch] ${context} completed.`);
    }
    if (pendingAlerts.length > 0) {
        const lines = pendingAlerts.splice(0);
        const subject = failed.length > 0
            ? `${context} 실패 ${failed.length}건 (${failed.join(", ")})`
            : `${context} 확인 필요 ${lines.length}건`;
        await sendAdminAlertMail({
            subject,
            lines: [
                `${context}가 끝났지만 확인할 것이 있습니다.`,
                "",
                ...lines.flatMap((l) => [l, ""]),
                "함수 로그: Google Cloud 콘솔 > Cloud Run > 함수 이름 > 로그",
            ],
        });
    }
}
