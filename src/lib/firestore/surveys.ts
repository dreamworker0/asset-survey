/**
 * Firestore — 조사 회차(surveys)·조사 대상(surveyTargets)·스캔(scans) — 기획서 F10~F12
 *
 * - 회차 시작은 관리자만, 회차 문서와 공간별 대상 묶음을 한 배치로 쓴다(대상이 없는 회차가 생기지 않게).
 * - 스캔은 담당 공간에서만 쓴다(firestore.rules). 문서 ID가 회차+재물이라 같은 물건은 문서 하나.
 * - 스캔 저장은 기다리지 않는다 — 지하·창고처럼 전파가 약한 곳에서는 오프라인 캐시에 남았다가
 *   연결되면 전송된다. 서버가 거절하면(이미 다른 곳에서 찍힘 등) `onRejected`로 알린다.
 * - 현장 쓰기(스캔·상태·제출)는 쓰기 장부(`trackWrite`)에 적는다 — "미전송 N건" 배너, 로그아웃 전
 *   경고(미전송이 있으면 확인), 앱이 닫힌 뒤 반영되지 않은 쓰기의 유실 안내가 여기서 나온다
 *   (6단계 리허설에서 빠진 것을 발견: 오프라인으로 찍고 로그아웃하면 경고 없이 사라질 수 있었다).
 */
import {
    collection, doc, query, where, getDoc, getDocs, getDocsFromServer, writeBatch, setDoc, updateDoc, deleteDoc,
    serverTimestamp, orderBy, limit, onSnapshot,
    type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    createZodConverter, surveySchema, surveyTargetSchema, scanSchema, surveySubmissionSchema, surveyEventSchema, syncTaskSchema,
    NO_SPACE_KEY,
} from '../../schemas';
import { captureError } from '../sentry';
import { actorStamp } from './actorStamp';
import { trackWrite } from '../offline/syncQueue';
import { recordAssetCheck } from './assetChecks';
import type { Asset } from '../../types/asset';
import type {
    Survey, SurveyTarget, SurveyTargetItem, Scan, ScanCondition, ScanMethod, SurveySubmission, SurveyEvent,
    SurveyEventType, SyncTask, SurveySummary,
} from '../../types/survey';
import type { SyncTaskDraft } from '../survey/report';
import type { SurveyMode } from '../../types';
import type { ScanDraft } from '../survey/judge';

const surveyConverter = createZodConverter(surveySchema);
const targetConverter = createZodConverter(surveyTargetSchema);
const scanConverter = createZodConverter(scanSchema);
const submissionConverter = createZodConverter(surveySubmissionSchema);
const eventConverter = createZodConverter(surveyEventSchema);
const syncConverter = createZodConverter(syncTaskSchema);

/** 조사 이력 한 건(배치에 넣을 내용) — 기획서 F17 */
function eventData(orgId: string, surveyId: string, type: SurveyEventType, extra: { spaceId?: string | null; reason?: string; targetId?: string | null } = {}) {
    return {
        organizationId: orgId, surveyId, spaceId: extra.spaceId ?? null, type, reason: extra.reason ?? '',
        targetId: extra.targetId ?? null, byUid: actorStamp().lastEditedByUid ?? '', at: serverTimestamp(),
    };
}

/** 기관의 회차(최근 순) */
export const getSurveys = async (orgId: string, max = 20): Promise<Survey[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'surveys').withConverter(surveyConverter),
            where('organizationId', '==', orgId),
            orderBy('createdAt', 'desc'),
            limit(max),
        ));
        return snap.docs.map((d) => d.data() as Survey);
    } catch (error) {
        captureError(error, { context: 'getSurveys', orgId });
        throw error;
    }
};

/** 회차 한 건 — 없으면 null */
export const getSurvey = async (surveyId: string): Promise<Survey | null> => {
    try {
        const snap = await getDoc(doc(db, 'surveys', surveyId).withConverter(surveyConverter));
        return snap.exists() ? (snap.data() as Survey) : null;
    } catch (error) {
        captureError(error, { context: 'getSurvey', surveyId });
        throw error;
    }
};

/**
 * 진행 중인 회차 — 한 기관에 하나만 연다(화면이 막는다). 없으면 null.
 * '마감 중'(closing)도 돌려준다 — 직원 화면이 "마감 중"을 알리고 입력을 잠가야 한다(2026-11-24).
 * 'open'만 찾으면 마감을 멈춘 사이 들어온 직원은 "조사 없음"을 보고, 이미 열어 둔 화면은 계속 찍다가 거부된다.
 */
export const getOpenSurvey = async (orgId: string): Promise<Survey | null> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'surveys').withConverter(surveyConverter),
            where('organizationId', '==', orgId),
            where('status', 'in', ['open', 'closing']),
            limit(1),
        ));
        return snap.empty ? null : (snap.docs[0].data() as Survey);
    } catch (error) {
        captureError(error, { context: 'getOpenSurvey', orgId });
        throw error;
    }
};

/**
 * 회차 상태를 실시간으로(직원 스캔 화면) — 재물 담당자가 마감을 시작하면 바로 입력을 잠근다.
 * 문서 1건 구독이라 읽기 비용은 상태가 바뀔 때만 든다.
 */
export function subscribeSurveyStatus(surveyId: string, onChange: (status: Survey['status'] | null) => void): Unsubscribe {
    return onSnapshot(
        doc(db, 'surveys', surveyId).withConverter(surveyConverter),
        (snap) => onChange(snap.exists() ? (snap.data() as Survey).status : null),
        (error) => captureError(error, { context: 'subscribeSurveyStatus', surveyId }),
    );
}

/** 회차의 대상 묶음 전부(공간 수만큼, 문서 수십 개) */
export const getSurveyTargets = async (orgId: string, surveyId: string): Promise<SurveyTarget[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'surveyTargets').withConverter(targetConverter),
            where('organizationId', '==', orgId),
            where('surveyId', '==', surveyId),
        ));
        return snap.docs.map((d) => d.data() as SurveyTarget);
    } catch (error) {
        captureError(error, { context: 'getSurveyTargets', orgId, surveyId });
        throw error;
    }
};

export interface StartSurveyInput {
    orgId: string;
    name: string;
    startDate: string;
    endDate: string;
    spaceIds: string[];
    includesUnassigned: boolean;
    mode: SurveyMode;
    /** 기관 재물 전부 — 이 중 운영 재물을 대상 공간별로 묶어 고정한다 */
    assets: Asset[];
}

/** 대상 묶기 — 운영 재물만, 고른 공간(+미지정)만. 공간 키 → 대상 목록 */
export function groupTargets(assets: Asset[], spaceIds: string[], includesUnassigned: boolean): Map<string, SurveyTargetItem[]> {
    const groups = new Map<string, SurveyTargetItem[]>(spaceIds.map((id) => [id, []]));
    if (includesUnassigned) groups.set(NO_SPACE_KEY, []);
    for (const a of assets) {
        if (a.status !== 'active') continue;
        const key = a.spaceId ?? NO_SPACE_KEY;
        groups.get(key)?.push({
            id: a.id, code: a.code, name: a.name, tagId: a.tagId,
            // 내용연수가 있을 때만 — 대상 묶음 문서(최대 3,000건)를 쓸데없이 키우지 않는다
            ...(a.usefulLife != null ? { acquiredAt: a.acquiredAt, usefulLife: a.usefulLife } : {}),
        });
    }
    return groups;
}

/** 대상 묶음 한 문서에 담을 수 있는 최대 건수 — firestore.rules의 surveyTargets items.size()와 같다 */
export const MAX_TARGETS_PER_SPACE = 3000;
/**
 * 대상 묶음 한 문서의 안전 상한(바이트). Firestore 문서 상한은 1MiB인데, 품명이 긴 재물이 한 공간에
 * 몰리면 3,000건 안에서도 넘을 수 있다. 필드 이름·색인 여유를 두고 900KB로 막는다.
 */
export const MAX_TARGET_DOC_BYTES = 900_000;

/**
 * 한 문서에 담기지 않는 공간 묶음을 찾는다 — 없으면 null.
 * 회차 시작은 한 배치라 하나만 넘어도 통째로 거부되고, 그때 오류만으로는 어느 공간을 나눠야 하는지 모른다.
 */
export function findOversizedTarget(groups: Map<string, SurveyTargetItem[]>, keys: string[]): { key: string; count: number; reason: 'count' | 'bytes' } | null {
    const encoder = new TextEncoder();
    for (const key of keys) {
        const items = groups.get(key) ?? [];
        if (items.length > MAX_TARGETS_PER_SPACE) return { key, count: items.length, reason: 'count' };
        if (encoder.encode(JSON.stringify(items)).length > MAX_TARGET_DOC_BYTES) return { key, count: items.length, reason: 'bytes' };
    }
    return null;
}

/** 회차 시작 — 회차 문서와 공간별 대상 묶음을 한 배치로. @returns 회차 ID */
export const startSurvey = async (input: StartSurveyInput): Promise<string> => {
    const stamp = actorStamp();
    const now = serverTimestamp();
    const ref = doc(collection(db, 'surveys'));
    const groups = groupTargets(input.assets, input.spaceIds, input.includesUnassigned);
    const targetCount = [...groups.values()].reduce((n, list) => n + list.length, 0);
    const batch = writeBatch(db);
    batch.set(ref, {
        organizationId: input.orgId, name: input.name.trim(), startDate: input.startDate, endDate: input.endDate,
        spaceIds: input.spaceIds, includesUnassigned: input.includesUnassigned, mode: input.mode, status: 'open',
        targetCount, lastEditedByUid: stamp.lastEditedByUid ?? '', createdAt: now,
    });
    batch.set(doc(collection(db, 'surveyEvents')), eventData(input.orgId, ref.id, 'start', { reason: `대상 ${targetCount}건` }));
    for (const [key, items] of groups) {
        batch.set(doc(db, 'surveyTargets', `${ref.id}__${key}`), {
            organizationId: input.orgId, surveyId: ref.id, spaceId: key === NO_SPACE_KEY ? null : key, items,
            lastEditedByUid: stamp.lastEditedByUid ?? '', createdAt: now,
        });
    }
    try {
        await batch.commit();
        return ref.id;
    } catch (error) {
        captureError(error, { context: 'startSurvey', orgId: input.orgId, spaces: input.spaceIds.length, targetCount });
        throw error;
    }
};

/** 스캔 한 건(중복 확인용) — 없으면 null. 오프라인이라 확인하지 못하면 undefined */
export const peekScan = async (scanId: string): Promise<Scan | null | undefined> => {
    try {
        const snap = await getDoc(doc(db, 'scans', scanId).withConverter(scanConverter));
        return snap.exists() ? (snap.data() as Scan) : null;
    } catch {
        return undefined;
    }
};

export interface SaveScanInput {
    orgId: string;
    surveyId: string;
    spaceId: string;
    method: ScanMethod;
    draft: ScanDraft;
    /** 서버가 저장을 거절했을 때(오프라인이었다가 연결된 뒤일 수 있다) */
    onRejected?: (error: unknown) => void;
}

/** 스캔 저장 — 기다리지 않고 바로 돌아온다(오프라인 캐시). 거절되면 onRejected */
export function saveScan({ orgId, surveyId, spaceId, method, draft, onRejected }: SaveScanInput): void {
    const stamp = actorStamp();
    const now = serverTimestamp();
    const data = {
        organizationId: orgId, surveyId, assetId: draft.assetId, code: draft.code, name: draft.name,
        spaceId, expectedSpaceId: draft.expectedSpaceId, result: draft.result, method,
        condition: 'normal', memo: '', scannedByUid: stamp.lastEditedByUid ?? '', scannedAt: now,
        updatedAt: now, ...stamp,
    };
    const write = setDoc(doc(db, 'scans', draft.scanId), data);
    void trackWrite('CREATE', 'scans', draft.scanId, data, write, { callerAwaits: false });
    // 조사에서 찍은 재물도 '마지막 확인'을 갱신한다(상시 확인 기록, 2026-11-22). 미등록은 재물이 없어 남기지 않는다
    if (draft.assetId) recordAssetCheck({ orgId, assetId: draft.assetId, via: 'survey', spaceId, surveyId });
    write.catch((error) => {
        captureError(error, { context: 'saveScan', orgId, surveyId, result: draft.result });
        onRejected?.(error);
    });
}

/** 물건 상태·메모 고치기 (기획서 F12) */
export function updateScanCondition(scanId: string, condition: ScanCondition, memo: string, onRejected?: (e: unknown) => void): void {
    const data = { condition, memo: memo.slice(0, 200), updatedAt: serverTimestamp(), ...actorStamp() };
    const write = updateDoc(doc(db, 'scans', scanId), data);
    void trackWrite('UPDATE', 'scans', scanId, data, write, { callerAwaits: false });
    write.catch((error) => {
        captureError(error, { context: 'updateScanCondition' });
        onRejected?.(error);
    });
}

/** 잘못 찍은 스캔 지우기 — 열린 회차에서 관리자 또는 찍은 사람 */
export const deleteScan = async (scanId: string): Promise<void> => {
    try {
        await deleteDoc(doc(db, 'scans', scanId));
    } catch (error) {
        captureError(error, { context: 'deleteScan' });
        throw error;
    }
};

/** 회차의 스캔 전부(관리자 진행 확인) */
export const getScans = async (orgId: string, surveyId: string, opts: { fromServer?: boolean } = {}): Promise<Scan[]> => {
    try {
        // 마감 계산은 캐시가 아니라 서버 값으로 — 인터넷이 없으면 실패해 마감을 진행하지 않는다
        const snap = await (opts.fromServer ? getDocsFromServer : getDocs)(query(
            collection(db, 'scans').withConverter(scanConverter),
            where('organizationId', '==', orgId),
            where('surveyId', '==', surveyId),
        ));
        return snap.docs.map((d) => d.data() as Scan);
    } catch (error) {
        captureError(error, { context: 'getScans', orgId, surveyId });
        throw error;
    }
};

/**
 * 한 공간에 관한 스캔을 실시간으로 받는다 — 이 공간에서 찍은 것(`spaceId`)과 이 공간 대상이 어디서든
 * 찍힌 것(`expectedSpaceId`) 두 갈래. 회차 전체를 받지 않아 읽기가 공간 크기만큼만 든다.
 */
export function subscribeSpaceScans(
    orgId: string, surveyId: string, spaceId: string,
    onChange: (scans: Scan[]) => void, onError?: (e: unknown) => void,
): Unsubscribe {
    const here = new Map<string, Scan>();
    const mine = new Map<string, Scan>();
    const emit = () => onChange([...new Map([...mine, ...here]).values()]);
    const sub = (field: 'spaceId' | 'expectedSpaceId', bucket: Map<string, Scan>) => onSnapshot(
        query(
            collection(db, 'scans').withConverter(scanConverter),
            where('organizationId', '==', orgId),
            where('surveyId', '==', surveyId),
            where(field, '==', spaceId),
        ),
        (snap) => {
            bucket.clear();
            for (const d of snap.docs) bucket.set(d.id, d.data() as Scan);
            emit();
        },
        (error) => {
            captureError(error, { context: 'subscribeSpaceScans', field });
            onError?.(error);
        },
    );
    const a = sub('spaceId', here);
    const b = sub('expectedSpaceId', mine);
    return () => { a(); b(); };
}

/** 회차의 스캔 전부를 실시간으로(관리자 현황판, 기획서 F14) */
export function subscribeSurveyScans(orgId: string, surveyId: string, onChange: (scans: Scan[]) => void, onError?: (e: unknown) => void): Unsubscribe {
    return onSnapshot(
        query(collection(db, 'scans').withConverter(scanConverter), where('organizationId', '==', orgId), where('surveyId', '==', surveyId)),
        (snap) => onChange(snap.docs.map((d) => d.data() as Scan)),
        (error) => { captureError(error, { context: 'subscribeSurveyScans' }); onError?.(error); },
    );
}

// ── 공간 제출·승인 (기획서 F13) ──

export const submissionId = (surveyId: string, spaceId: string) => `${surveyId}__${spaceId}`;

/** 회차의 제출 상태 전부를 실시간으로 */
export function subscribeSubmissions(orgId: string, surveyId: string, onChange: (list: SurveySubmission[]) => void, onError?: (e: unknown) => void): Unsubscribe {
    return onSnapshot(
        query(collection(db, 'surveySubmissions').withConverter(submissionConverter), where('organizationId', '==', orgId), where('surveyId', '==', surveyId)),
        (snap) => onChange(snap.docs.map((d) => d.data() as SurveySubmission)),
        (error) => { captureError(error, { context: 'subscribeSubmissions' }); onError?.(error); },
    );
}

export const getSubmissions = async (orgId: string, surveyId: string, opts: { fromServer?: boolean } = {}): Promise<SurveySubmission[]> => {
    try {
        const snap = await (opts.fromServer ? getDocsFromServer : getDocs)(query(
            collection(db, 'surveySubmissions').withConverter(submissionConverter),
            where('organizationId', '==', orgId), where('surveyId', '==', surveyId),
        ));
        return snap.docs.map((d) => d.data() as SurveySubmission);
    } catch (error) {
        captureError(error, { context: 'getSubmissions', orgId, surveyId });
        throw error;
    }
};

/** 공간 제출(처음·반려 뒤 다시) — 공간 담당자 또는 관리자 */
export const submitSpace = async (orgId: string, surveyId: string, spaceId: string): Promise<void> => {
    const uid = actorStamp().lastEditedByUid ?? '';
    const now = serverTimestamp();
    const batch = writeBatch(db);
    batch.set(doc(db, 'surveySubmissions', submissionId(surveyId, spaceId)), {
        organizationId: orgId, surveyId, spaceId, state: 'submitted',
        submittedByUid: uid, submittedAt: now, reviewedByUid: null, reviewedAt: null,
        reason: '', selfApproved: false, proxyApproved: false, lastEditedByUid: uid, updatedAt: now,
    });
    batch.set(doc(collection(db, 'surveyEvents')), eventData(orgId, surveyId, 'submit', { spaceId }));
    const commit = batch.commit();
    void trackWrite('CREATE', 'surveySubmissions', submissionId(surveyId, spaceId), { spaceId }, commit, { callerAwaits: true });
    try {
        await commit;
    } catch (error) {
        captureError(error, { context: 'submitSpace', orgId, surveyId });
        throw error;
    }
};

/**
 * 제출 검토 — 승인 또는 반려(사유 필수). 자기가 제출한 것을 승인하면 본인 승인(사유 필수).
 * 제출이 없는 공간(`current`가 null)은 관리자가 대신 승인한다(사유 필수).
 */
export const reviewSpace = async (input: {
    orgId: string; surveyId: string; spaceId: string; decision: 'approved' | 'rejected'; reason: string;
    current: SurveySubmission | null;
}): Promise<void> => {
    const { orgId, surveyId, spaceId, decision, current } = input;
    const reason = input.reason.trim().slice(0, 200);
    const uid = actorStamp().lastEditedByUid ?? '';
    const now = serverTimestamp();
    const ref = doc(db, 'surveySubmissions', submissionId(surveyId, spaceId));
    const batch = writeBatch(db);
    if (!current) {
        batch.set(ref, {
            organizationId: orgId, surveyId, spaceId, state: 'approved', submittedByUid: null, submittedAt: null,
            reviewedByUid: uid, reviewedAt: now, reason, selfApproved: false, proxyApproved: true,
            lastEditedByUid: uid, updatedAt: now,
        });
    } else {
        batch.update(ref, {
            state: decision, reviewedByUid: uid, reviewedAt: now, reason,
            selfApproved: decision === 'approved' && current.submittedByUid === uid, proxyApproved: false,
            lastEditedByUid: uid, updatedAt: now,
        });
    }
    batch.set(doc(collection(db, 'surveyEvents')), eventData(orgId, surveyId, decision === 'approved' ? 'approve' : 'reject', { spaceId, reason }));
    try {
        await batch.commit();
    } catch (error) {
        captureError(error, { context: 'reviewSpace', orgId, surveyId, decision });
        throw error;
    }
};

/**
 * 한 공간의 제출 상태를 실시간으로(직원 스캔 화면).
 * `pending`: 이 기기에서 제출했지만 아직 서버에 닿지 않음(인터넷이 끊긴 곳에서 제출).
 */
export function subscribeSubmission(surveyId: string, spaceId: string, onChange: (s: SurveySubmission | null, pending: boolean) => void): Unsubscribe {
    return onSnapshot(
        doc(db, 'surveySubmissions', submissionId(surveyId, spaceId)).withConverter(submissionConverter),
        { includeMetadataChanges: true },
        (snap) => onChange(snap.exists() ? (snap.data() as SurveySubmission) : null, snap.metadata.hasPendingWrites),
        (error) => captureError(error, { context: 'subscribeSubmission' }),
    );
}

// ── 마감·반영 목록·이력 (기획서 F15~F17) ──

/**
 * 마감 멈추기 — 회차를 '마감 중'으로 바꿔 스캔·제출·승인을 막는다(2026-11-24). 이 뒤에 서버에서 새로 읽어
 * 결과를 계산하므로 확인창을 연 사이 들어온 스캔도 요약·반영 목록에 들어간다.
 */
export const beginClosing = async (surveyId: string): Promise<void> => {
    try {
        await updateDoc(doc(db, 'surveys', surveyId), { status: 'closing', lastEditedByUid: actorStamp().lastEditedByUid ?? '' });
    } catch (error) {
        captureError(error, { context: 'beginClosing', surveyId });
        throw error;
    }
};

/** 마감 취소 — '마감 중' 회차를 다시 열어 찍고 승인할 수 있게 한다 */
export const cancelClosing = async (surveyId: string): Promise<void> => {
    try {
        await updateDoc(doc(db, 'surveys', surveyId), { status: 'open', lastEditedByUid: actorStamp().lastEditedByUid ?? '' });
    } catch (error) {
        captureError(error, { context: 'cancelClosing', surveyId });
        throw error;
    }
};

/**
 * 마감 — '마감 중'(beginClosing 뒤)인 회차만 닫는다(Rules). 반영 목록을 먼저 쓰고(400건씩), 마지막 배치에서 회차를 닫고 이력을 남긴다.
 * 중간에 실패해도 다시 마감하면 같은 ID라 반영 목록이 겹치지 않는다. 멈춘 뒤라 결과가 같아 이미 있는 항목도
 * 같은 값으로 덮인다(내용이 달라지면 Rules가 막아 재시도가 끝나지 않던 문제가 없어진다).
 */
export const closeSurvey = async (input: {
    orgId: string; surveyId: string; tasks: SyncTaskDraft[]; spaceNames: Record<string, string>; summary: SurveySummary;
    /** 마감 시점 공간 위치("본관 2층") — 건물을 등록하지 않은 기관은 빈 글자뿐이라 남기지 않는다 */
    spaceLocations?: Record<string, string>;
    /** 마감 시점 보고서 머리 — 기관명·결재선·나온 사람 이름(2026-11-24) */
    reportSnapshot?: NonNullable<Survey['reportSnapshot']>;
}): Promise<void> => {
    const { orgId, surveyId, tasks } = input;
    const uid = actorStamp().lastEditedByUid ?? '';
    const BATCH = 400;
    try {
        for (let i = 0; i < tasks.length; i += BATCH) {
            const batch = writeBatch(db);
            for (const t of tasks.slice(i, i + BATCH)) {
                const { id, ...rest } = t;
                batch.set(doc(db, 'syncTasks', id), { organizationId: orgId, surveyId, ...rest, done: false, doneByUid: null, doneAt: null });
            }
            await batch.commit();
        }
        const batch = writeBatch(db);
        batch.update(doc(db, 'surveys', surveyId), {
            status: 'closed', closedAt: serverTimestamp(), closedByUid: uid, spaceNames: input.spaceNames, summary: input.summary,
            ...(input.spaceLocations && Object.values(input.spaceLocations).some(Boolean) ? { spaceLocations: input.spaceLocations } : {}),
            ...(input.reportSnapshot ? { reportSnapshot: input.reportSnapshot } : {}),
            lastEditedByUid: uid,
        });
        batch.set(doc(collection(db, 'surveyEvents')), eventData(orgId, surveyId, 'close', {
            reason: `확인 ${input.summary.found}/${input.summary.target}, 미발견 ${input.summary.missing}`,
        }));
        await batch.commit();
    } catch (error) {
        captureError(error, { context: 'closeSurvey', orgId, surveyId, tasks: tasks.length });
        throw error;
    }
};

export const getSyncTasks = async (orgId: string, surveyId: string): Promise<SyncTask[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'syncTasks').withConverter(syncConverter),
            where('organizationId', '==', orgId), where('surveyId', '==', surveyId),
        ));
        return snap.docs.map((d) => d.data() as SyncTask);
    } catch (error) {
        captureError(error, { context: 'getSyncTasks', orgId, surveyId });
        throw error;
    }
};

/** 반영 완료 체크·해제 — 이력도 남긴다 */
export const setSyncTaskDone = async (task: SyncTask, done: boolean): Promise<void> => {
    const uid = actorStamp().lastEditedByUid ?? '';
    const batch = writeBatch(db);
    batch.update(doc(db, 'syncTasks', task.id), done
        ? { done: true, doneByUid: uid, doneAt: serverTimestamp() }
        : { done: false, doneByUid: null, doneAt: null });
    batch.set(doc(collection(db, 'surveyEvents')), eventData(task.organizationId, task.surveyId, done ? 'sync-done' : 'sync-undone', { targetId: task.id }));
    try {
        await batch.commit();
    } catch (error) {
        captureError(error, { context: 'setSyncTaskDone' });
        throw error;
    }
};

/** 회차 이력(최근 순) */
export const getSurveyEvents = async (orgId: string, surveyId: string, max = 200): Promise<SurveyEvent[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'surveyEvents').withConverter(eventConverter),
            where('organizationId', '==', orgId), where('surveyId', '==', surveyId), orderBy('at', 'desc'), limit(max),
        ));
        return snap.docs.map((d) => d.data() as SurveyEvent);
    } catch (error) {
        captureError(error, { context: 'getSurveyEvents', orgId, surveyId });
        throw error;
    }
};
