/**
 * Firestore — 재물(assets)·금액(assetAccounting)·가져오기 기록(imports)·변경 이력(history)
 *
 * 쓰기는 기관 관리자만 한다(firestore.rules). 모든 쓰기에 행위자 스탬프를 심는다.
 * 재물은 지우지 않는다 — 대장에서 빠지면 `missingFromSource`로 표시만 한다.
 */
import {
    collection, doc, query, where, getDoc, getDocs, getCountFromServer, writeBatch,
    serverTimestamp, orderBy, limit, Timestamp,
    type DocumentReference,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
    createZodConverter, assetSchema, assetAccountingSchema, importRecordSchema, historySchema,
} from '../../schemas';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Asset, AssetAccounting, ImportRecord, AssetStatus, HistoryEntry } from '../../types/asset';
import { newTagId } from '../labels/tag';
import { assetDocId, type ImportDiff, type LocationSpaceMap } from '../import/diff';
import type { ColumnMap } from '../import/columns';
import type { ParseResult } from '../import/parseSheet';

const assetConverter = createZodConverter(assetSchema);
const accountingConverter = createZodConverter(assetAccountingSchema);
const importConverter = createZodConverter(importRecordSchema);
const historyConverter = createZodConverter(historySchema);

/** 한 배치에 넣는 쓰기 수 — Firestore 상한(500)보다 여유를 둔다 */
const BATCH_SIZE = 400;

/**
 * 재물 목록 기억 — 한 번 전부 읽은 뒤에는 바뀐 것만 읽는다(2026-11-23).
 *
 * 재물 목록·등록·가져오기·조사 열기가 모두 기관의 재물 전부를 읽었다. 시범 기관(2,942건)은 화면을
 * 열 때마다 약 3천 회를 읽었다. 재물은 ① 지우지 않고(allow delete: if false) ② 모든 쓰기에 서버 시각
 * `updatedAt == request.time`이 찍히므로(firestore.rules `assetDataValid`), 기억해 둔 목록에
 * `updatedAt >= 마지막으로 본 시각`인 문서만 더하면 서버와 같아진다.
 *
 * - 기억은 탭 메모리에만 둔다(새로 고침하면 다시 전부 읽는다). 사용자·기관별로 따로 둔다.
 * - 시각은 기기 시계가 아니라 받은 문서의 updatedAt 최댓값을 쓰고, 2분을 겹쳐 읽어 경계에서 빠지지 않게 한다.
 * - 30분마다 한 번은 전부 다시 읽는다(혹시 모를 어긋남을 스스로 바로잡는다).
 * - 바뀐 것만 읽기가 실패하면(새 인덱스가 아직 만들어지는 중 등) 전부 읽기로 돌아간다.
 */
interface AssetSnapshot {
    byId: Map<string, Asset>;
    /** 받은 문서 updatedAt의 최댓값(ms) */
    maxUpdatedMs: number;
    /** 마지막으로 전부 읽은 때(기기 시각 ms) */
    fullAt: number;
}
const assetSnapshots = new Map<string, AssetSnapshot>();
const assetLoads = new Map<string, Promise<Asset[]>>();
export const ASSET_FULL_REFRESH_MS = 30 * 60 * 1000;
const ASSET_DELTA_OVERLAP_MS = 2 * 60 * 1000;

const updatedMs = (a: Asset): number => {
    const t = a.updatedAt as { toMillis?: () => number } | undefined;
    return typeof t?.toMillis === 'function' ? t.toMillis() : 0;
};

/** 기억한 재물 목록 비우기 — 테스트·강제 새로 고침용 */
export function clearAssetSnapshots(): void {
    assetSnapshots.clear();
    assetLoads.clear();
}

async function loadAssets(orgId: string, key: string): Promise<Asset[]> {
    const assetsOf = (extra: ReturnType<typeof where>[] = []) => getDocs(query(
        collection(db, 'assets').withConverter(assetConverter),
        where('organizationId', '==', orgId),
        ...extra,
    ));
    const prev = assetSnapshots.get(key);
    let snap: AssetSnapshot | null = null;
    if (prev && Date.now() - prev.fullAt < ASSET_FULL_REFRESH_MS) {
        try {
            const since = Timestamp.fromMillis(Math.max(0, prev.maxUpdatedMs - ASSET_DELTA_OVERLAP_MS));
            const changed = await assetsOf([where('updatedAt', '>=', since)]);
            for (const d of changed.docs) {
                const a = d.data() as Asset;
                prev.byId.set(a.id, a);
                prev.maxUpdatedMs = Math.max(prev.maxUpdatedMs, updatedMs(a));
            }
            snap = prev;
        } catch (error) {
            // 바뀐 것만 읽기가 안 되면 전부 읽는다 — 화면은 멈추지 않는다
            captureError(error, { context: 'getAssets:delta', orgId });
        }
    }
    if (!snap) {
        const all = await assetsOf();
        const byId = new Map<string, Asset>();
        let maxUpdatedMs = 0;
        for (const d of all.docs) {
            const a = d.data() as Asset;
            byId.set(a.id, a);
            maxUpdatedMs = Math.max(maxUpdatedMs, updatedMs(a));
        }
        snap = { byId, maxUpdatedMs, fullAt: Date.now() };
        assetSnapshots.set(key, snap);
    }
    // 예전처럼 문서 ID 순서로 돌려준다(바뀐 문서를 더해도 순서가 흔들리지 않게)
    return [...snap.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 기관의 재물 전부 — 두 번째부터는 바뀐 것만 서버에서 읽는다(위 설명) */
export const getAssets = async (orgId: string): Promise<Asset[]> => {
    const key = `${auth.currentUser?.uid ?? ''}|${orgId}`;
    // 같은 때 여러 화면·훅이 부르면 한 번만 읽는다
    const running = assetLoads.get(key);
    if (running) return running;
    const load = loadAssets(orgId, key)
        .catch((error) => {
            captureError(error, { context: 'getAssets', orgId });
            throw error;
        })
        .finally(() => assetLoads.delete(key));
    assetLoads.set(key, load);
    return load;
};

/** 기관의 금액 문서 전부 — 재물 문서 ID → 금액 (관리자만 읽을 수 있다) */
export const getAccountingMap = async (orgId: string): Promise<Map<string, AssetAccounting>> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'assetAccounting').withConverter(accountingConverter),
            where('organizationId', '==', orgId),
        ));
        return new Map(snap.docs.map((d) => [d.id, d.data() as AssetAccounting]));
    } catch (error) {
        captureError(error, { context: 'getAccountingMap', orgId });
        throw error;
    }
};

/** 재물 한 건 — 없으면 null. 같은 기관 구성원만 읽힌다(Rules) */
export const getAsset = async (assetId: string): Promise<Asset | null> => {
    try {
        const snap = await getDoc(doc(db, 'assets', assetId).withConverter(assetConverter));
        return snap.exists() ? (snap.data() as Asset) : null;
    } catch (error) {
        captureError(error, { context: 'getAsset', assetId });
        throw error;
    }
};

/** 재물 한 건의 금액 — 관리자만 읽힌다. 금액 문서가 없으면 null */
export const getAssetAccounting = async (assetId: string): Promise<AssetAccounting | null> => {
    try {
        const snap = await getDoc(doc(db, 'assetAccounting', assetId).withConverter(accountingConverter));
        return snap.exists() ? (snap.data() as AssetAccounting) : null;
    } catch (error) {
        captureError(error, { context: 'getAssetAccounting', assetId });
        throw error;
    }
};

/** 재물 한 건의 변경 이력(최근 순) — 관리자만 읽힌다 */
export const getAssetHistory = async (orgId: string, assetId: string, max = 20): Promise<HistoryEntry[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'history').withConverter(historyConverter),
            where('organizationId', '==', orgId),
            where('assetId', '==', assetId),
            orderBy('at', 'desc'),
            limit(max),
        ));
        return snap.docs.map((d) => d.data() as HistoryEntry);
    } catch (error) {
        captureError(error, { context: 'getAssetHistory', orgId, assetId });
        throw error;
    }
};

/** `in` 조건 한 번에 넣을 수 있는 값 수(Firestore 상한 30) */
const IN_LIMIT = 30;

/** 여러 공간의 재물 — 직원의 '내 공간 재물' 목록 */
export const getAssetsBySpaces = async (orgId: string, spaceIds: string[]): Promise<Asset[]> => {
    if (spaceIds.length === 0) return [];
    try {
        const chunks: string[][] = [];
        for (let i = 0; i < spaceIds.length; i += IN_LIMIT) chunks.push(spaceIds.slice(i, i + IN_LIMIT));
        const snaps = await Promise.all(chunks.map((ids) => getDocs(query(
            collection(db, 'assets').withConverter(assetConverter),
            where('organizationId', '==', orgId),
            where('spaceId', 'in', ids),
        ))));
        return snaps.flatMap((snap) => snap.docs.map((d) => d.data() as Asset));
    } catch (error) {
        captureError(error, { context: 'getAssetsBySpaces', orgId, spaces: spaceIds.length });
        throw error;
    }
};

/** 라벨 태그로 재물 찾기 — 내 기관 안에서만 찾는다(다른 기관 라벨이면 null) */
export const findAssetByTag = async (orgId: string, tagId: string): Promise<Asset | null> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'assets').withConverter(assetConverter),
            where('organizationId', '==', orgId),
            where('tagId', '==', tagId),
            limit(1),
        ));
        return snap.empty ? null : (snap.docs[0].data() as Asset);
    } catch (error) {
        captureError(error, { context: 'findAssetByTag', orgId });
        throw error;
    }
};

/**
 * 자산코드로 재물 찾기 — 내 기관 안에서만. 코드는 엑셀에 적힌 그대로 저장돼 있어 그대로 먼저 찾고,
 * 없으면 띄어쓰기를 뺀 대문자로 한 번 더 찾는다(직접 입력·옛 QR).
 */
export const findAssetByCode = async (orgId: string, code: string): Promise<Asset | null> => {
    const tries = [...new Set([code.trim(), code.replace(/\s+/g, '').toUpperCase()])].filter(Boolean);
    try {
        for (const c of tries) {
            const snap = await getDocs(query(
                collection(db, 'assets').withConverter(assetConverter),
                where('organizationId', '==', orgId),
                where('code', '==', c),
                limit(1),
            ));
            if (!snap.empty) return snap.docs[0].data() as Asset;
        }
        return null;
    } catch (error) {
        captureError(error, { context: 'findAssetByCode', orgId });
        throw error;
    }
};

/**
 * 라벨 태그 발급 — 태그가 없는 재물에만 새로 만들어 저장한다(기획서 F09).
 * 이미 있는 태그는 그대로 둔다(붙인 라벨을 다시 뽑아도 같은 QR이 나오게). Rules가 바꾸기를 막는다.
 *
 * @returns 재물 문서 ID → 태그 ID (이미 있던 것 포함, 넘긴 재물 전부)
 */
export const issueTags = async (
    assets: Array<Pick<Asset, 'id' | 'tagId'>>,
    onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> => {
    const result = new Map<string, string>();
    const missing: Array<{ id: string; tagId: string }> = [];
    for (const a of assets) {
        if (a.tagId) result.set(a.id, a.tagId);
        else missing.push({ id: a.id, tagId: newTagId() });
    }
    if (missing.length === 0) return result;

    const stamp = actorStamp();
    const now = serverTimestamp();
    let done = 0;
    try {
        for (let i = 0; i < missing.length; i += BATCH_SIZE) {
            const chunk = missing.slice(i, i + BATCH_SIZE);
            const batch = writeBatch(db);
            for (const m of chunk) batch.update(doc(db, 'assets', m.id), { tagId: m.tagId, updatedAt: now, ...stamp });
            await batch.commit();
            for (const m of chunk) result.set(m.id, m.tagId);
            done += chunk.length;
            onProgress?.(done, missing.length);
        }
        return result;
    } catch (error) {
        captureError(error, { context: 'issueTags', done, total: missing.length });
        throw error;
    }
};

/** 상태별 재물 수 — 집계 쿼리라 1,000건당 읽기 1회 */
export const getAssetCounts = async (orgId: string): Promise<Record<AssetStatus, number>> => {
    try {
        const statuses: AssetStatus[] = ['active', 'inactive', 'disposed'];
        const counts = await Promise.all(statuses.map(async (status) => {
            const snap = await getCountFromServer(query(
                collection(db, 'assets'),
                where('organizationId', '==', orgId),
                where('status', '==', status),
            ));
            return [status, snap.data().count] as const;
        }));
        return Object.fromEntries(counts) as Record<AssetStatus, number>;
    } catch (error) {
        captureError(error, { context: 'getAssetCounts', orgId });
        throw error;
    }
};

/** 최근 가져오기 기록 */
export const getRecentImports = async (orgId: string, max = 5): Promise<ImportRecord[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'imports').withConverter(importConverter),
            where('organizationId', '==', orgId),
            orderBy('confirmedAt', 'desc'),
            limit(max),
        ));
        return snap.docs.map((d) => d.data() as ImportRecord);
    } catch (error) {
        captureError(error, { context: 'getRecentImports', orgId });
        throw error;
    }
};

export interface CommitImportInput {
    orgId: string;
    fileName: string;
    sheetName: string;
    columnMap: ColumnMap;
    locationMap: LocationSpaceMap;
    parsed: ParseResult;
    diff: ImportDiff;
    /** 대장 합계 줄 금액(있으면) */
    reportedTotal: number | null;
    /**
     * 가져오기 기록 ID — 멈춘 가져오기를 다시 확정할 때 처음 ID를 넘긴다(2026-11-24). 두 번에 나눠 저장된 재물·이력이
     * 같은 기록을 가리키게 한다. 없으면 새로 만든다.
     */
    importId?: string;
    /**
     * 기록에 남길 비교 건수 — 다시 확정할 때는 남은 것만 비교되므로 처음 확정한 건수를 넘긴다. 없으면 `diff`의 건수.
     */
    recordDiff?: ImportDiffCounts;
    onProgress?: (done: number, total: number) => void;
}

/** 가져오기 기록의 비교 건수 */
export interface ImportDiffCounts { added: number; changed: number; missing: number; unchanged: number }

/** 가져오기 기록 ID를 미리 정한다(다시 확정할 때 같은 ID를 쓰려고) */
export const newImportId = (): string => doc(collection(db, 'imports')).id;

/**
 * 가져오기 기록이 이미 있는가 — 마지막 배치가 서버에 저장됐는데 응답만 못 받은 경우를 가린다.
 * 기록은 수정이 막혀 있어(Rules) 같은 ID로 다시 쓰면 거부되므로, 있으면 다시 쓰지 않는다.
 */
export const importRecordExists = async (importId: string): Promise<boolean> => {
    try {
        return (await getDoc(doc(db, 'imports', importId))).exists();
    } catch (error) {
        captureError(error, { context: 'importRecordExists', importId });
        throw error;
    }
};

type Op = { ref: DocumentReference; kind: 'set' | 'update'; data: Record<string, unknown> };

/**
 * 가져오기 확정 — 신규·바뀜·사라짐을 저장하고 가져오기 기록을 남긴다.
 *
 * 400건씩 나눠 배치로 쓴다. 중간 배치가 실패해도 **다시 확정하면 이어진다** — 문서 ID가
 * 자산코드로 정해져 있어 이미 쓴 재물은 '그대로'로 비교되기 때문이다. 가져오기 기록과 열·위치
 * 연결은 마지막 배치에 넣어, 기록이 있으면 전부 저장됐다는 뜻이 되게 한다.
 *
 * 한 재물의 재물·금액·이력 문서는 **같은 배치**에 넣는다(2026-11-24) — 나뉘면 멈춘 뒤 다시 비교할 때
 * 방금 새로 넣은 재물이 '금액 바뀜'으로 잡혀 이력이 하나 더 생겼다. 다시 확정할 때는 처음 기록 ID(`importId`)와
 * 처음 건수(`recordDiff`)를 넘겨, 두 번에 걸쳐 쓴 재물·이력·기록이 한 가져오기로 이어지게 한다.
 *
 * @returns 가져오기 기록 ID
 */
export const commitImport = async (input: CommitImportInput): Promise<string> => {
    const { orgId, diff, parsed } = input;
    const stamp = actorStamp();
    const importRef = input.importId ? doc(db, 'imports', input.importId) : doc(collection(db, 'imports'));
    const now = serverTimestamp();
    // 재물 하나에 딸린 문서 묶음 — 묶음은 배치 사이로 나누지 않는다
    const groups: Op[][] = [];
    let ops: Op[] = [];
    const endGroup = () => { if (ops.length > 0) groups.push(ops); ops = []; };

    const assetRef = (id: string) => doc(db, 'assets', id);
    const accRef = (id: string) => doc(db, 'assetAccounting', id);
    const historyOp = (assetId: string, code: string, type: 'import-change' | 'import-missing', changes: Record<string, unknown>) =>
        ops.push({ ref: doc(collection(db, 'history')), kind: 'set', data: {
            organizationId: orgId, assetId, code, type, changes, importId: importRef.id, at: now, ...stamp,
        } });

    for (const d of diff.added) {
        endGroup();
        ops.push({ ref: assetRef(d.id), kind: 'set', data: {
            organizationId: orgId, ...d.fields, missingFromSource: false, lastImportId: importRef.id,
            createdAt: now, updatedAt: now, ...stamp,
        } });
        if (d.accounting.amount != null || d.accounting.depreciation != null || d.accounting.residual != null) {
            ops.push({ ref: accRef(d.id), kind: 'set', data: { organizationId: orgId, ...d.accounting, updatedAt: now, ...stamp } });
        }
    }
    for (const c of diff.changed) {
        endGroup();
        if (c.assetChanged) {
            // 직접 등록한 재물이 대장에 나타났으면 이제 대장이 관리한다(manual: false)
            ops.push({ ref: assetRef(c.draft.id), kind: 'update', data: {
                ...c.draft.fields, missingFromSource: false, manual: false, lastImportId: importRef.id, updatedAt: now, ...stamp,
            } });
        }
        if (c.accountingChanged) {
            // 금액 문서가 아직 없을 수 있어 전체를 set으로 쓴다
            ops.push({ ref: accRef(c.draft.id), kind: 'set', data: { organizationId: orgId, ...c.draft.accounting, updatedAt: now, ...stamp } });
        }
        historyOp(c.draft.id, c.draft.fields.code, 'import-change', c.changes);
    }
    for (const a of diff.missing) {
        endGroup();
        ops.push({ ref: assetRef(a.id), kind: 'update', data: { missingFromSource: true, lastImportId: importRef.id, updatedAt: now, ...stamp } });
        historyOp(a.id, a.code, 'import-missing', { missingFromSource: { before: false, after: true } });
    }
    endGroup();

    const columnMap = Object.fromEntries(Object.entries(input.columnMap).filter(([, v]) => !!v)) as Record<string, string>;
    const finalOps: Op[] = [
        { ref: doc(db, 'organizations', orgId), kind: 'update', data: { importColumnMap: columnMap, locationSpaceMap: input.locationMap } },
        { ref: importRef, kind: 'set', data: {
            organizationId: orgId, fileName: input.fileName, sheetName: input.sheetName, columnMap,
            counts: parsed.counts,
            diff: input.recordDiff ?? { added: diff.added.length, changed: diff.changed.length, missing: diff.missing.length, unchanged: diff.unchanged },
            amountTotal: parsed.amountTotals.all,
            reportedTotal: input.reportedTotal,
            confirmedAt: now,
            lastEditedByUid: stamp.lastEditedByUid ?? '',
        } },
    ];

    const chunks: Op[][] = [];
    for (const g of groups) {
        const last = chunks[chunks.length - 1];
        if (last && last.length + g.length <= BATCH_SIZE) last.push(...g);
        else chunks.push([...g]);
    }
    // 마지막 배치에 기록을 붙인다 (자리가 없으면 따로 한 배치)
    if (chunks.length > 0 && chunks[chunks.length - 1].length + finalOps.length <= BATCH_SIZE) chunks[chunks.length - 1].push(...finalOps);
    else chunks.push(finalOps);

    const total = groups.reduce((n, g) => n + g.length, 0);
    let done = 0;
    try {
        for (const chunk of chunks) {
            const batch = writeBatch(db);
            for (const op of chunk) {
                if (op.kind === 'set') batch.set(op.ref, op.data);
                else batch.update(op.ref, op.data);
            }
            await batch.commit();
            done = Math.min(total, done + chunk.length);
            input.onProgress?.(done, total);
        }
        return importRef.id;
    } catch (error) {
        captureError(error, { context: 'commitImport', orgId, done, total });
        throw error;
    }
};

// ── 직접 등록·수정 (2026-11-22) ──

/** 화면에서 직접 고치는 재물 값 — 자산코드는 등록 때만 정한다(문서 ID라 바꾸지 않는다) */
export type ManualAssetFields = Pick<Asset,
    'name' | 'category' | 'spec' | 'acquiredAt' | 'quantity' | 'usefulLife' | 'status' | 'spaceId' | 'department' | 'usage'>;

/** 비교·이력에 쓰는 직접 수정 필드 */
export const MANUAL_EDIT_FIELDS = [
    'name', 'category', 'spec', 'acquiredAt', 'quantity', 'usefulLife', 'status', 'spaceId', 'department', 'usage',
] as const satisfies ReadonlyArray<keyof ManualAssetFields>;

/**
 * 자동 자산코드 — "올해-순번"(2026-001). 이미 있는 같은 해 코드의 가장 큰 순번 다음을 준다.
 * 기관 관리번호 체계가 있으면 사람이 직접 적는 것이 우선이고, 이것은 번호가 없는 기관을 위한 기본값이다.
 */
export function nextAssetCode(existingCodes: string[], now = new Date()): string {
    const year = now.getFullYear();
    const re = new RegExp(`^${year}-(\\d+)$`);
    let max = 0;
    for (const c of existingCodes) {
        const m = re.exec(c.trim());
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `${year}-${String(max + 1).padStart(3, '0')}`;
}

export class AssetCodeTakenError extends Error {
    constructor(code: string) {
        super(`이미 있는 자산코드: ${code}`);
        this.name = 'AssetCodeTakenError';
    }
}

/**
 * 재물 한 건 직접 등록 — 재물·금액(있으면)·이력을 한 배치로 쓴다.
 * 같은 자산코드가 이미 있으면 AssetCodeTakenError (Rules도 기존 문서를 create로 덮어쓰지 못한다).
 * @returns 재물 문서 ID
 */
export const createAssetManually = async (input: {
    orgId: string; code: string; fields: ManualAssetFields; amount: number | null;
}): Promise<string> => {
    const { orgId, fields } = input;
    const code = input.code.trim();
    const id = assetDocId(orgId, code);
    const stamp = actorStamp();
    const now = serverTimestamp();
    try {
        const existing = await getDoc(doc(db, 'assets', id));
        if (existing.exists()) throw new AssetCodeTakenError(code);
        const batch = writeBatch(db);
        batch.set(doc(db, 'assets', id), {
            organizationId: orgId, code, ...fields, acquiredQuantity: null, statusRaw: null, locationRaw: null,
            missingFromSource: false, manual: true, lastImportId: null, tagId: null,
            createdAt: now, updatedAt: now, ...stamp,
        });
        if (input.amount != null) {
            batch.set(doc(db, 'assetAccounting', id), {
                organizationId: orgId, amount: input.amount, depreciation: null, residual: null, updatedAt: now, ...stamp,
            });
        }
        batch.set(doc(collection(db, 'history')), {
            organizationId: orgId, assetId: id, code, type: 'manual-create', changes: {}, importId: null, at: now, ...stamp,
        });
        await batch.commit();
        return id;
    } catch (error) {
        if (!(error instanceof AssetCodeTakenError)) captureError(error, { context: 'createAssetManually', orgId });
        throw error;
    }
};

/**
 * 재물 직접 수정 — 바뀐 값만 쓰고 전·후 값을 이력에 남긴다. 바뀐 것이 없으면 아무것도 쓰지 않는다.
 * 금액은 자산금액만 고친다(감가상각·잔존가액은 대장 값 그대로 둔다).
 * @returns 바뀐 필드 수
 */
export const updateAssetManually = async (input: {
    asset: Asset; fields: ManualAssetFields; amount: number | null; accounting: AssetAccounting | null;
}): Promise<number> => {
    const { asset, fields } = input;
    const stamp = actorStamp();
    const now = serverTimestamp();
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const assetPatch: Record<string, unknown> = {};
    for (const f of MANUAL_EDIT_FIELDS) {
        const before = asset[f] ?? null;
        const after = fields[f] ?? null;
        if (before !== after) { changes[f] = { before, after }; assetPatch[f] = after; }
    }
    const amountBefore = input.accounting?.amount ?? null;
    const amountChanged = amountBefore !== input.amount;
    if (amountChanged) changes.amount = { before: amountBefore, after: input.amount };
    const count = Object.keys(changes).length;
    if (count === 0) return 0;
    try {
        const batch = writeBatch(db);
        if (Object.keys(assetPatch).length > 0) {
            batch.update(doc(db, 'assets', asset.id), { ...assetPatch, updatedAt: now, ...stamp });
        }
        if (amountChanged) {
            // 금액 문서가 아직 없을 수 있어 전체를 set으로 쓴다
            batch.set(doc(db, 'assetAccounting', asset.id), {
                organizationId: asset.organizationId, amount: input.amount,
                depreciation: input.accounting?.depreciation ?? null, residual: input.accounting?.residual ?? null,
                updatedAt: now, ...stamp,
            });
        }
        batch.set(doc(collection(db, 'history')), {
            organizationId: asset.organizationId, assetId: asset.id, code: asset.code, type: 'manual-edit',
            changes, importId: null, at: now, ...stamp,
        });
        await batch.commit();
        return count;
    } catch (error) {
        captureError(error, { context: 'updateAssetManually', assetId: asset.id });
        throw error;
    }
};

/**
 * 여러 재물을 한 공간으로 옮긴다(2026-11-23) — 재물 목록의 '공간 옮기기'와 '공간 미지정 정리'가 쓴다.
 * 재물마다 바뀐 공간을 변경 이력(manual-edit)에 남긴다. 이미 그 공간인 재물은 건너뛴다.
 * locationLinks가 있으면 기관의 '대장 위치 → 공간' 연결에 더한다 — 다음에 대장을 다시 가져와도
 * 같은 위치가 그 공간으로 들어가 이번 정리가 되돌아가지 않게.
 * @returns 실제로 옮긴 재물 수
 */
export const moveAssetsToSpace = async (input: {
    orgId: string;
    assets: Asset[];
    spaceId: string | null;
    locationLinks?: LocationSpaceMap;
    onProgress?: (done: number, total: number) => void;
}): Promise<number> => {
    const { orgId, spaceId } = input;
    const moving = input.assets.filter((a) => (a.spaceId ?? null) !== spaceId);
    const stamp = actorStamp();
    const now = serverTimestamp();
    try {
        // 재물 1건 = 쓰기 2번(재물·이력)이라 200건씩
        const per = Math.floor(BATCH_SIZE / 2);
        for (let i = 0; i < moving.length; i += per) {
            const batch = writeBatch(db);
            for (const a of moving.slice(i, i + per)) {
                batch.update(doc(db, 'assets', a.id), { spaceId, updatedAt: now, ...stamp });
                batch.set(doc(collection(db, 'history')), {
                    organizationId: orgId, assetId: a.id, code: a.code, type: 'manual-edit',
                    changes: { spaceId: { before: a.spaceId ?? null, after: spaceId } }, importId: null, at: now, ...stamp,
                });
            }
            await batch.commit();
            input.onProgress?.(Math.min(moving.length, i + per), moving.length);
        }
        if (input.locationLinks && Object.keys(input.locationLinks).length > 0) {
            const orgRef = doc(db, 'organizations', orgId);
            const current = ((await getDoc(orgRef)).data()?.locationSpaceMap ?? {}) as LocationSpaceMap;
            const batch = writeBatch(db);
            batch.update(orgRef, { locationSpaceMap: { ...current, ...input.locationLinks } });
            await batch.commit();
        }
        return moving.length;
    } catch (error) {
        captureError(error, { context: 'moveAssetsToSpace', orgId, count: moving.length });
        throw error;
    }
};
