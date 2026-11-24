import { z } from 'zod';
import { timestampSchema } from './common';
import { surveyModeSchema } from './organization';

/** 회차 이름 길이 상한 — firestore.rules와 같은 값 */
export const SURVEY_NAME_MAX = 60;
/** 스캔 메모 길이 상한 — firestore.rules와 같은 값 */
export const SCAN_MEMO_MAX = 200;
/** 공간이 정해지지 않은 재물 묶음의 키(조사 대상 문서 ID 끝). 관리자만 조사한다 */
export const NO_SPACE_KEY = '_none';

/** 사유 길이 상한(반려·대신 승인·본인 승인) — firestore.rules와 같은 값 */
export const REASON_MAX = 200;

/**
 * 조사 회차 (surveys/{id}) — 기획서 F10
 *
 * 시작할 때 대상 목록을 `surveyTargets`에 고정한다(시작 뒤 다시 가져오기를 해도 이 회차의 대상은 그대로).
 * - `mode`: 시작 시점의 조사 방식. 회차 도중 설정을 바꿔도 이 회차는 시작한 방식대로 간다.
 *   '혼자 조사'면 관리자만 스캔한다(Rules).
 * - `spaceIds`: 대상 공간. 공간 미지정 재물을 넣었으면 `includesUnassigned`.
 * - 마감(`closed`)은 관리자가 한다(5단계). '나눠서 조사'는 모든 공간이 승인된 뒤에만(화면이 막음).
 *   마감하면 스캔·제출이 모두 막힌다(Rules).
 * - 마감 중(`closing`, 2026-11-24): 마감을 누르면 먼저 이 상태로 바꿔 스캔·제출·승인을 멈추고(Rules는 `open`에서만
 *   허락한다), 서버에서 새로 읽어 결과·반영 목록을 만든 뒤 `closed`로 닫는다. 확인창을 연 사이 들어온 스캔이나
 *   중간에 실패한 마감을 다시 할 때도 요약·반영 목록·다시 연 보고서가 같은 시점의 결과가 된다.
 */
export const surveyStatusSchema = z.enum(['open', 'closing', 'closed']);
export const surveySchema = z.object({
    organizationId: z.string().catch(''),
    name: z.string().catch(''),
    /** 기간 — 'YYYY-MM-DD' */
    startDate: z.string().catch(''),
    endDate: z.string().catch(''),
    spaceIds: z.array(z.string()).catch([]),
    includesUnassigned: z.boolean().catch(false),
    mode: surveyModeSchema.catch('delegated'),
    status: surveyStatusSchema.catch('open'),
    /** 시작할 때 고정한 대상 수 */
    targetCount: z.number().catch(0),
    lastEditedByUid: z.string().catch(''),
    createdAt: timestampSchema.optional().catch(undefined),
    /** 마감 (기획서 F15) — 마감한 사람·시각과, 보고서가 나중에도 마감 시점 그대로 나오도록 남긴 공간 이름 */
    closedAt: timestampSchema.optional().catch(undefined),
    closedByUid: z.string().optional().catch(undefined),
    spaceNames: z.record(z.string(), z.string()).optional().catch(undefined),
    /**
     * 마감 시점 공간 위치(공간 ID → "본관 2층", 건물이 없으면 빈 글자) — 2026-11-22 건물·층.
     * 보고서가 나중에 공간을 옮겨도 마감 시점 위치로 묶이게 남긴다. 그 전에 마감한 회차에는 없다.
     */
    spaceLocations: z.record(z.string(), z.string()).optional().catch(undefined),
    /**
     * 마감 시점 보고서 머리 — 2026-11-24(사용자 결정). 결재 문서라 나중에 다시 출력해도 마감 당시 기관명·결재선 칸과
     * 제출·승인·이력에 나온 사람 이름(uid → 이름)으로 나오게 남긴다. 이름은 그 회차에 나온 사람만 담는다.
     * 그 전에 마감한 회차에는 없어 지금 값을 쓴다.
     */
    reportSnapshot: z.object({
        orgName: z.string().catch(''),
        approvalLine: z.array(z.object({ title: z.string().catch('') })).catch([]),
        personNames: z.record(z.string(), z.string()).catch({}),
    }).optional().catch(undefined),
    /** 마감 시점 요약 숫자(목록 화면용) */
    summary: z.object({
        target: z.number().catch(0),
        found: z.number().catch(0),
        missing: z.number().catch(0),
        otherSpace: z.number().catch(0),
        unregistered: z.number().catch(0),
        outOfScope: z.number().catch(0),
        damaged: z.number().catch(0),
        labelDamaged: z.number().catch(0),
        manual: z.number().catch(0),
    }).optional().catch(undefined),
});

/** 조사 대상 한 건 — 시작 시점의 재물 값 */
export const surveyTargetItemSchema = z.object({
    id: z.string().catch(''),
    code: z.string().catch(''),
    name: z.string().nullable().catch(null),
    tagId: z.string().nullable().catch(null),
    // 내용연수가 있는 재물만 시작 때 함께 남긴다(2026-11-22) — 결과 보고서의 '내용연수 지난 재물' 표.
    // 예전 회차·내용연수가 없는 재물에는 없다
    acquiredAt: z.string().nullable().optional().catch(null),
    usefulLife: z.number().nullable().optional().catch(null),
});

/**
 * 조사 대상 (surveyTargets/{surveyId}__{spaceId 또는 _none}) — 공간별 묶음 문서 (기획서 7장·10장)
 * 재물 1건당 문서 1개로 만들지 않아 1,000건 기관도 문서 수십 개로 끝난다. 만든 뒤 바꾸지 않는다.
 */
export const surveyTargetSchema = z.object({
    organizationId: z.string().catch(''),
    surveyId: z.string().catch(''),
    /** 공간 미지정 묶음이면 null */
    spaceId: z.string().nullable().catch(null),
    items: z.array(surveyTargetItemSchema).catch([]),
    lastEditedByUid: z.string().catch(''),
    createdAt: timestampSchema.optional().catch(undefined),
});

/**
 * 판정 (기획서 F11) — 저장하는 것은 4가지. '중복'은 저장하지 않고(수가 늘지 않게) 화면에만 알린다.
 * '직접 입력'은 판정과 따로 `method: 'manual'`로 남겨 재확인 대상이 된다.
 */
export const scanResultSchema = z.enum(['ok', 'otherSpace', 'unregistered', 'outOfScope']);
export const scanMethodSchema = z.enum(['qr', 'manual']);
/** 물건 상태 (기획서 F12) */
export const scanConditionSchema = z.enum(['normal', 'damaged', 'labelDamaged']);

/**
 * 스캔 (scans/{surveyId}__{재물 문서 ID} · 미등록은 {surveyId}__u__{코드}) — 기획서 F11·F12
 *
 * 문서 ID를 회차+재물로 정해 **같은 물건을 몇 번 찍어도 문서는 하나**다(중복 스캔이 수를 늘리지 않음).
 * 두 번째 저장은 Rules가 막는다(핵심 값 수정 금지). 물건 상태·메모만 나중에 고칠 수 있다.
 */
export const scanSchema = z.object({
    organizationId: z.string().catch(''),
    surveyId: z.string().catch(''),
    /** 등록 재물이면 재물 문서 ID, 미등록이면 null */
    assetId: z.string().nullable().catch(null),
    /** 찍힌 자산코드(미등록이면 읽힌 글자) */
    code: z.string().catch(''),
    name: z.string().nullable().catch(null),
    /** 찍은 곳 */
    spaceId: z.string().catch(''),
    /** 대상 목록상 있어야 할 곳 — 공간 미지정이면 null, 대상이 아니면(범위 밖·미등록) null */
    expectedSpaceId: z.string().nullable().catch(null),
    result: scanResultSchema.catch('ok'),
    method: scanMethodSchema.catch('qr'),
    condition: scanConditionSchema.catch('normal'),
    memo: z.string().catch(''),
    /** 현장 사진(2026-11-22) — 내려받기 주소·Storage 경로. 없으면 null. 올리기는 lib/firestore/scanPhotos.ts */
    photoUrl: z.string().nullable().optional().catch(null),
    photoThumbUrl: z.string().nullable().optional().catch(null),
    photoPath: z.string().nullable().optional().catch(null),
    photoThumbPath: z.string().nullable().optional().catch(null),
    scannedByUid: z.string().catch(''),
    scannedAt: timestampSchema.optional().catch(undefined),
    lastEditedByUid: z.string().catch(''),
    updatedAt: timestampSchema.optional().catch(undefined),
});

/**
 * 공간 제출·승인 (surveySubmissions/{surveyId}__{spaceId}) — 기획서 F13, '나눠서 조사' 회차만
 *
 * 흐름: 공간 담당 제출(submitted) → 관리자 승인(approved)·반려(rejected, 사유 필수) → 반려면 다시 제출.
 * 제출·승인된 공간은 스캔이 막힌다(Rules). 반려되면 다시 열린다.
 * - `selfApproved`: 제출한 사람이 승인 — 사유 필수, 보고서에 '본인 승인'.
 * - `proxyApproved`: 제출 없이 관리자가 대신 승인(담당자 부재 등) — 사유 필수, 보고서에 '대신 승인'.
 */
export const submissionStateSchema = z.enum(['submitted', 'approved', 'rejected']);
export const surveySubmissionSchema = z.object({
    organizationId: z.string().catch(''),
    surveyId: z.string().catch(''),
    spaceId: z.string().catch(''),
    state: submissionStateSchema.catch('submitted'),
    submittedByUid: z.string().nullable().catch(null),
    submittedAt: timestampSchema.nullable().optional().catch(null),
    reviewedByUid: z.string().nullable().catch(null),
    reviewedAt: timestampSchema.nullable().optional().catch(null),
    /** 반려 사유 또는 본인·대신 승인 사유 */
    reason: z.string().catch(''),
    selfApproved: z.boolean().catch(false),
    proxyApproved: z.boolean().catch(false),
    lastEditedByUid: z.string().catch(''),
    updatedAt: timestampSchema.optional().catch(undefined),
});

/**
 * 조사 이력 (surveyEvents/{id}) — 기획서 F17. 생성만 한다.
 * 누가 언제 조사를 시작·제출·승인·반려·마감하고 반영 목록을 처리했는지(사유 포함).
 */
export const surveyEventTypeSchema = z.enum(['start', 'submit', 'approve', 'reject', 'close', 'sync-done', 'sync-undone']);
export const surveyEventSchema = z.object({
    organizationId: z.string().catch(''),
    surveyId: z.string().catch(''),
    spaceId: z.string().nullable().catch(null),
    type: surveyEventTypeSchema.catch('start'),
    reason: z.string().catch(''),
    /** 반영 목록 항목 등 대상 ID */
    targetId: z.string().nullable().catch(null),
    byUid: z.string().catch(''),
    at: timestampSchema.optional().catch(undefined),
});

/**
 * 희망이음 반영 목록 (syncTasks/{surveyId}__{kind}__{재물 또는 코드}) — 기획서 F16
 * 마감할 때 조사 결과에서 만든다. "희망이음에 옮겨 적을 일"과 라벨 다시 붙이기. 처리 완료만 체크한다.
 */
export const syncTaskKindSchema = z.enum(['move', 'dispose', 'missing', 'register', 'relabel']);
export const syncTaskSchema = z.object({
    organizationId: z.string().catch(''),
    surveyId: z.string().catch(''),
    kind: syncTaskKindSchema.catch('move'),
    assetId: z.string().nullable().catch(null),
    code: z.string().catch(''),
    name: z.string().nullable().catch(null),
    /** 위치 변경: 목록상 공간 → 찾은 공간 (공간 ID, 미지정은 null) */
    fromSpaceId: z.string().nullable().catch(null),
    toSpaceId: z.string().nullable().catch(null),
    memo: z.string().catch(''),
    done: z.boolean().catch(false),
    doneByUid: z.string().nullable().catch(null),
    doneAt: timestampSchema.nullable().optional().catch(null),
});

export type SurveySchemaType = z.infer<typeof surveySchema>;
