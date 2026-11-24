/**
 * constants — Cloud Functions 공통 상수
 *
 * Rate Limit 값은 Firebase Remote Config에서 실시간으로 가져온다.
 * Remote Config 미설정/오류 시 DEFAULT_RATE_LIMITS를 fallback으로 사용.
 */
import { getRemoteConfig } from "firebase-admin/remote-config";
import { log } from "../utils/helpers";

// === Rate Limit 기본값 (Remote Config fallback) ===
// 키는 IP가 아니라 uid로 센다 — `req.ip`는 X-Forwarded-For 맨 앞 값이라 헤더 한 줄로
// 매번 새 버킷을 만들 수 있다(차량운행일지 2026-08-14 감사 발견 2).
export const DEFAULT_RATE_LIMITS = {
    ocrDocument: { max: 3, windowSec: 60 },          // uid당 분당 3회
    ocrDailyUser: { max: 20, windowSec: 86400 },     // OCR(증빙서류) 사용자당 일일 누적 (ocr-cost-security §1.1)
    ocrDailyOrg: { max: 50, windowSec: 86400 },      // OCR 조직당 일일 누적
    joinOrganization: { max: 5, windowSec: 3600 },   // uid당 시간당 5회
    sendApprovalEmail: { max: 10, windowSec: 3600 },  // uid당 시간당 10회
    // 초대 코드 재발급 — 정상 사용은 기관당 몇 달에 한 번. 상한은 코드를 계속 돌려
    // 직원 가입을 방해하는 남용만 막으면 된다.
    regenerateInviteCode: { max: 5, windowSec: 3600 },        // uid당 시간당 5회
    // 초대 메일(2026-11-23) — 한 번에 100명까지 보내므로 호출 수는 적다. 메일 폭탄 남용만 막는다.
    sendInviteEmails: { max: 10, windowSec: 3600 },           // uid당 시간당 10회
    // 도움말 AI에게 묻기(2026-11-24) — 질문 1건이 Gemini 호출 1회다. 연타는 분 단위로,
    // 하루 종일 반복하는 비용 증폭은 일일 누적으로 막는다. 둘 다 fail-closed(askAI.ts).
    askAI: { max: 5, windowSec: 60 },                // uid당 분당 5회
    askAIDaily: { max: 20, windowSec: 86400 },       // uid당 일일 20회
} as const;

export type RateLimitKey = keyof typeof DEFAULT_RATE_LIMITS;

/**
 * === 전역 예산 (ocr-cost-security §1.4) ===
 *
 * 주체 키(IP·이메일·uid)로 나누지 않는 **단일 카운터**다. 비인증이거나 주체를 무한히
 * 회전시킬 수 있는 경로에서, 주체별 상한이 뚫려도 남는 마지막 비용 상한선이다.
 * 값은 곧 "그 경로가 낼 수 있는 시간당(또는 일일) 최대 청구액"이므로, 정상 사용량의
 * 10배 이상으로 넉넉히 잡되 무한대는 아니게 둔다. 전부 fail-closed.
 *
 * Remote Config로 조율하지 않는다 — 조율 경로 자체가 장애나면 상한이 사라지기 때문에,
 * 이 값만은 배포된 코드에 고정한다.
 */
export const GLOBAL_BUDGETS = {
    /** 기관 신청 접수 — 요청 1건당 Gemini 프리스크린 1회. 실사용은 하루 몇 건 수준이다. */
    submitOrgApplication: { max: 40, windowSec: 3600 },
    /** 랜딩 공개 문의 — 접수마다 notifyNewFeedback(Discord 알림)이 뒤따른다. */
    submitPublicFeedback: { max: 60, windowSec: 3600 },
    /** 의견 등록 알림(트리거) — 전 사용자 합산 일일 상한 */
    feedbackAlert: { max: 200, windowSec: 86400 },
    /** 의견 등록 알림 — 작성자 1인당 일일 상한 */
    feedbackAlertPerAuthor: { max: 20, windowSec: 86400 },
    /** 앱 오류 보고(2026-11-23) — 보고마다 Firestore 쓰기 1~3회. 정상은 시간당 몇 건이다. */
    reportClientError: { max: 600, windowSec: 3600 },
} as const;
type RateLimitConfig = { max: number; windowSec: number };

// === 인메모리 캐시 (5분 TTL) ===
let cachedLimits: Record<string, RateLimitConfig> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Remote Config에서 Rate Limit 값을 가져온다.
 * 캐시 유효 시 캐시 반환, 만료 시 새로 fetch.
 * 실패 시 DEFAULT_RATE_LIMITS fallback.
 */
export async function getRateLimits(name: RateLimitKey): Promise<RateLimitConfig> {
    // 캐시 유효 → 즉시 반환
    if (cachedLimits && Date.now() < cacheExpiry) {
        return cachedLimits[name] || DEFAULT_RATE_LIMITS[name];
    }

    try {
        const rc = getRemoteConfig();
        const template = await rc.getServerTemplate();
        const config = template.evaluate();
        const raw = config.getString("rate_limits");

        if (raw) {
            const parsed = JSON.parse(raw) as Record<string, RateLimitConfig>;
            cachedLimits = parsed;
            cacheExpiry = Date.now() + CACHE_TTL_MS;
            return parsed[name] || DEFAULT_RATE_LIMITS[name];
        }
    } catch (err) {
        const errorMsg = (err as Error).message;
        // Remote Config 템플릿 미설정은 정상적인 fallback 경로 → DEBUG
        const level = errorMsg.includes("NOT_FOUND") ? "DEBUG" : "WARNING";
        log(level, "constants", "Remote Config fetch failed, using defaults", {
            error: errorMsg,
        });
    }

    // fallback
    return DEFAULT_RATE_LIMITS[name];
}

// === 하위 호환성: 동기 접근이 필요한 곳에서 사용 ===
export const RATE_LIMITS = DEFAULT_RATE_LIMITS;

// === 파일 크기 제한 ===
/** base64 인코딩 최대 크기 (원본 ~5MB → base64 ~6.67MB, 여유분 포함 7MB) */
export const MAX_BASE64_SIZE = 7 * 1024 * 1024;

