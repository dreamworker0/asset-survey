/**
 * clientErrorReport — 앱(브라우저) 오류 보고를 다듬는 순수 함수 (2026-11-23)
 *
 * Sentry를 쓰지 않기로 해(2026-11-21, 처리방침에서 뺌) 사용자 화면의 오류를 알 길이 없었다.
 * 앱이 오류 요약을 `reportClientError`로 보내면 같은 오류끼리 묶어 `clientErrors`에 센다.
 *
 * 개인정보를 남기지 않는다 — 앱이 먼저 거르고, 여기서 한 번 더 거른다:
 *   - 이메일 → [이메일], 7자리 이상 숫자(전화번호 등) → [숫자], 긴 무작위 ID → [ID]
 *   - 길이를 잘라 자유 입력이 통째로 실리지 않게 한다
 *   - 사용자 uid·이름은 받지 않는다. 기관은 서버가 로그인 토큰에서만 읽는다(호출자가 고를 수 없다)
 */
import { createHash } from "crypto";

export const CLIENT_ERROR_TTL_DAYS = 30;

export interface ClientErrorInput {
    name?: unknown;
    message?: unknown;
    where?: unknown;
    code?: unknown;
    stack?: unknown;
    path?: unknown;
    version?: unknown;
}

export interface ClientErrorReport {
    name: string;
    message: string;
    where: string;
    code: string;
    stack: string;
    path: string;
    version: string;
}

/** 개인정보가 될 만한 조각을 지운다 */
export function scrubText(text: string): string {
    return text
        .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[이메일]")
        .replace(/\d[\d\- ]{5,}\d/g, "[숫자]")
        // Firestore 문서 ID·uid처럼 숫자가 섞인 20자 이상 무작위 글자
        .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g, "[ID]");
}

const str = (v: unknown, max: number): string =>
    typeof v === "string" ? scrubText(v.replace(/\s+/g, " ").trim()).slice(0, max) : "";

/** 요청 값을 다듬는다. 오류 문구가 없으면 null(기록하지 않음) */
export function sanitizeReport(data: ClientErrorInput | undefined): ClientErrorReport | null {
    const d = data ?? {};
    const message = str(d.message, 300);
    if (!message) return null;
    const stack = typeof d.stack === "string"
        ? d.stack.split("\n").slice(0, 6).map((l) => scrubText(l.trim()).slice(0, 200)).join("\n")
        : "";
    return {
        name: str(d.name, 60) || "Error",
        message,
        where: str(d.where, 80),
        code: str(d.code, 60),
        stack,
        path: str(d.path, 120).replace(/[?#].*$/, ""),
        version: str(d.version, 40),
    };
}

/** 같은 오류를 한 문서로 묶는 열쇠 — 숫자만 다른 문구는 같은 오류로 본다 */
export function groupKey(r: ClientErrorReport): string {
    const norm = `${r.name}|${r.message.replace(/\d+/g, "#")}|${r.where}|${r.code}`;
    return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** gRPC 상태 코드 — Admin SDK 오류의 code(숫자). 5 = NOT_FOUND, 6 = ALREADY_EXISTS */
const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;
const grpcCode = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

/**
 * 같은 오류 묶음 문서 하나를 올린다 — **트랜잭션 없이** 보통 쓰기 1번(2026-11-24).
 *
 * 예전에는 runTransaction(읽기 → 있으면 update, 없으면 set)이었다. 배포 직후 같은 오류가 여러 기기에서
 * 한꺼번에 나면 모두 **같은 문서**를 두고 트랜잭션끼리 경합해 재시도·중단이 쌓이고(문서당 초당 쓰기 한도도
 * 함께 깎는다), 그만큼 보고가 사라졌다. 횟수는 increment, 기관은 arrayUnion이라 읽지 않아도 합쳐지므로
 * 읽기가 필요 없다:
 *   1. update — 대부분은 이미 있는 오류라 여기서 끝난다(쓰기 1번, 읽기 0번)
 *   2. 없으면(NOT_FOUND) create — 처음 시각(firstAt)·오류 정체는 이때만 쓴다
 *   3. 그 사이 다른 기기가 먼저 만들었으면(ALREADY_EXISTS) 다시 update
 */
export async function upsertGroup(
    ref: FirebaseFirestore.DocumentReference,
    patch: Record<string, unknown>,
    initial: () => Record<string, unknown>,
): Promise<void> {
    try {
        await ref.update(patch);
        return;
    } catch (e) {
        if (grpcCode(e) !== NOT_FOUND) throw e;
    }
    try {
        await ref.create(initial());
    } catch (e) {
        if (grpcCode(e) !== ALREADY_EXISTS) throw e;
        await ref.update(patch);
    }
}
