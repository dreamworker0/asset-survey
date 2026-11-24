/**
 * Firestore — 재물(assets)·금액(assetAccounting)·가져오기 기록(imports)·변경 이력(history)
 *
 * 쓰기는 기관 관리자만 한다(firestore.rules). 모든 쓰기에 행위자 스탬프를 심는다.
 * 재물은 지우지 않는다 — 대장에서 빠지면 `missingFromSource`로 표시만 한다.
 *
 * 파일 나눔(2026-11-24) — 이 파일은 읽기와 재물 목록 기억(캐시)·라벨 태그 발급을 맡고,
 *   - 가져오기 확정·기록: ./assetImport
 *   - 직접 등록·수정·공간 옮기기: ./assetEdit
 * 를 아래에서 그대로 다시 내보낸다. 부르는 쪽은 지금처럼 './assets'(또는 index)에서 가져오면 된다.
 */
import {
    collection, doc, query, where, getDoc, getDocs, getCountFromServer, writeBatch,
    serverTimestamp, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Asset, AssetAccounting, AssetStatus, HistoryEntry } from '../../types/asset';
import { newTagId } from '../labels/tag';
import { assetConverter, accountingConverter, historyConverter, BATCH_SIZE } from './assetShared';

export * from './assetImport';
export * from './assetEdit';

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
