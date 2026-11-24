/**
 * reportClientError — 앱 화면에서 난 오류를 받아 같은 오류끼리 묶어 센다 (2026-11-23)
 *
 * 받은 요약은 services/clientErrors/clientErrorReport에서 한 번 더 거른 뒤 `clientErrors/{묶음 열쇠}`에
 * 횟수·처음/마지막 시각·마지막 화면 경로·앱 버전·브라우저 종류·겪은 기관을 남긴다. 30일 동안 다시
 * 나지 않으면 TTL(expiresAt)로 저절로 지워진다. 슈퍼관리자만 읽는다(firestore.rules).
 *
 * 로그인 전 화면(로그인·기관 신청)의 오류도 받아야 해서 로그인을 요구하지 않고 App Check도 끈다
 * (인앱 브라우저에서는 App Check가 뜨지 않는다 — submitPublicFeedback과 같다). 방어선은 IP당 시간당 60회와
 * 전역 시간당 예산이다. 한도를 넘거나 저장이 실패해도 앱에 오류를 돌려주지 않는다 — 오류 보고가
 * 다시 오류를 낳지 않게.
 *
 * 저장은 트랜잭션 없이 update → (없으면) create로 한다 — services/clientErrors의 upsertGroup 참고(2026-11-24).
 */
import { onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { checkRateLimitByIp, checkGlobalBudget } from "../../utils/rateLimit";
import { resolveClientIp } from "../../utils/clientIp";
import { summarizeUserAgent } from "../../utils/userAgent";
import { GLOBAL_BUDGETS } from "../../utils/constants";
import { sanitizeReport, groupKey, upsertGroup, CLIENT_ERROR_TTL_DAYS, type ClientErrorInput } from "../../services/clientErrors/clientErrorReport";

export const reportClientError = onCall(
    { region: "asia-northeast3", timeoutSeconds: 15, enforceAppCheck: false },
    async (request): Promise<{ ok: boolean }> => {
        const report = sanitizeReport(request.data as ClientErrorInput | undefined);
        if (!report) return { ok: false };

        try {
            const ip = resolveClientIp(request.rawRequest);
            if (await checkRateLimitByIp("reportClientError", ip, 60, 3600, "closed")) return { ok: false };
            const budget = GLOBAL_BUDGETS.reportClientError;
            if (await checkGlobalBudget("reportClientError", budget.max, budget.windowSec)) return { ok: false };

            const token = request.auth?.token as { orgId?: unknown; role?: unknown } | undefined;
            const orgId = typeof token?.orgId === "string" && token.orgId ? token.orgId : null;
            const role = typeof token?.role === "string" ? token.role : "guest";
            const ref = getFirestore().collection("clientErrors").doc(groupKey(report));
            const expiresAt = Timestamp.fromMillis(Date.now() + CLIENT_ERROR_TTL_DAYS * 86_400_000);

            // 처음 받은 시각(firstAt)·오류 정체(이름·문구·기능·코드)는 문서를 처음 만들 때만 쓰고, 나머지는 매번 덮는다
            const common = {
                lastAt: FieldValue.serverTimestamp(),
                lastPath: report.path,
                lastVersion: report.version,
                // 브라우저는 앱이 보낸 값이 아니라 요청 머리글에서 종류만 뽑는다(접속기록과 같은 방식)
                lastBrowser: summarizeUserAgent(request.rawRequest?.headers?.["user-agent"]),
                lastRole: role,
                stack: report.stack,
                expiresAt,
                count: FieldValue.increment(1),
                // 겪은 기관 — 기관 수만큼만 자란다(서비스 전체 기관 수가 상한이라 문서 크기 걱정은 없다)
                ...(orgId ? { orgIds: FieldValue.arrayUnion(orgId) } : {}),
            };
            await upsertGroup(ref, common, () => ({
                name: report.name, message: report.message, where: report.where, code: report.code,
                firstAt: FieldValue.serverTimestamp(), orgIds: [] as string[],
                ...common,
            }));
            return { ok: true };
        } catch (err) {
            console.error("reportClientError 저장 실패:", (err as Error).message);
            return { ok: false };
        }
    },
);
