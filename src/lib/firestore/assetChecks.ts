/**
 * Firestore — 재물 마지막 확인(assetChecks) 도메인 함수 (2026-11-22, 상시 확인 기록)
 *
 * 쓰기는 같은 기관 구성원이면 누구나(관리자·직원), 본인 이름·서버 시각으로만(firestore.rules `assetChecks`).
 * 확인 기록은 화면 흐름을 막으면 안 되므로 기다리지 않고 보낸다 — 실패해도 사용자에게 알리지 않고 Sentry에만 남긴다
 * (재물 화면은 그대로 열려야 한다). 오프라인이면 Firestore가 들고 있다가 연결되면 보낸다.
 */
import { collection, doc, getDoc, getDocs, query, setDoc, where, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { createZodConverter, assetCheckSchema } from '../../schemas';
import { captureError } from '../sentry';
import { actorStamp } from './actorStamp';
import type { AssetCheck, AssetCheckVia } from '../../types/assetCheck';

const converter = createZodConverter(assetCheckSchema);

export interface RecordAssetCheckInput {
    orgId: string;
    assetId: string;
    via: AssetCheckVia;
    spaceId?: string | null;
    surveyId?: string | null;
}

/** 확인 기록 남기기 — 기다리지 않는다 */
export function recordAssetCheck({ orgId, assetId, via, spaceId = null, surveyId = null }: RecordAssetCheckInput): void {
    const uid = actorStamp().lastEditedByUid;
    if (!uid || !assetId.startsWith(`${orgId}__`)) return;
    setDoc(doc(db, 'assetChecks', assetId), {
        organizationId: orgId, assetId, checkedAt: serverTimestamp(), checkedByUid: uid, via, spaceId, surveyId,
    }).catch((error) => captureError(error, { context: 'recordAssetCheck', orgId, via }));
}

/** 재물 한 건의 마지막 확인 — 없으면 null */
export const getAssetCheck = async (assetId: string): Promise<AssetCheck | null> => {
    try {
        const snap = await getDoc(doc(db, 'assetChecks', assetId).withConverter(converter));
        return snap.exists() ? (snap.data() as AssetCheck) : null;
    } catch (error) {
        captureError(error, { context: 'getAssetCheck' });
        throw error;
    }
};

/**
 * 확인 기록 기억 — 한 번 전부 읽은 뒤에는 바뀐 것만 읽는다(2026-11-24, 재물 목록과 같은 방식).
 *
 * 2,000건 기관 측정에서 재물 목록을 같은 탭에서 다시 열면 읽기 1,265회 중 1,200회가 확인 기록이었다
 * (재물은 이미 바뀐 것만 읽는다 — assets.ts `getAssets`). 확인 기록은 ① 지우지 않고(allow delete: if false)
 * ② 모든 쓰기에 서버 시각 `checkedAt == request.time`이 찍히므로(firestore.rules `assetChecks`),
 * 기억해 둔 기록에 `checkedAt >= 마지막으로 본 시각`인 문서만 더하면 서버와 같아진다.
 *
 * - 기억은 탭 메모리에만 둔다(새로 고침하면 다시 전부 읽는다). 사용자·기관별로 따로 둔다.
 * - 시각은 기기 시계가 아니라 받은 문서 checkedAt의 최댓값을 쓰고, 2분을 겹쳐 읽어 경계에서 빠지지 않게 한다.
 * - 30분마다 한 번은 전부 다시 읽는다. 바뀐 것만 읽기가 실패하면(인덱스 생성 중 등) 전부 읽기로 돌아간다.
 */
interface CheckSnapshot {
    byId: Map<string, AssetCheck>;
    /** 받은 문서 checkedAt의 최댓값(ms) */
    maxCheckedMs: number;
    /** 마지막으로 전부 읽은 때(기기 시각 ms) */
    fullAt: number;
}
const checkSnapshots = new Map<string, CheckSnapshot>();
const checkLoads = new Map<string, Promise<Map<string, AssetCheck>>>();
export const CHECK_FULL_REFRESH_MS = 30 * 60 * 1000;
const CHECK_DELTA_OVERLAP_MS = 2 * 60 * 1000;

const checkedMs = (c: AssetCheck): number => {
    const t = c.checkedAt as { toMillis?: () => number } | undefined;
    return typeof t?.toMillis === 'function' ? t.toMillis() : 0;
};

/** 기억한 확인 기록 비우기 — 테스트·강제 새로 고침용 */
export function clearAssetCheckSnapshots(): void {
    checkSnapshots.clear();
    checkLoads.clear();
}

async function loadChecks(orgId: string, key: string): Promise<Map<string, AssetCheck>> {
    const checksOf = (extra: ReturnType<typeof where>[] = []) => getDocs(query(
        collection(db, 'assetChecks').withConverter(converter),
        where('organizationId', '==', orgId),
        ...extra,
    ));
    const prev = checkSnapshots.get(key);
    let snap: CheckSnapshot | null = null;
    if (prev && Date.now() - prev.fullAt < CHECK_FULL_REFRESH_MS) {
        try {
            const since = Timestamp.fromMillis(Math.max(0, prev.maxCheckedMs - CHECK_DELTA_OVERLAP_MS));
            const changed = await checksOf([where('checkedAt', '>=', since)]);
            for (const d of changed.docs) {
                const c = d.data() as AssetCheck;
                prev.byId.set(d.id, c);
                prev.maxCheckedMs = Math.max(prev.maxCheckedMs, checkedMs(c));
            }
            snap = prev;
        } catch (error) {
            // 바뀐 것만 읽기가 안 되면 전부 읽는다 — 화면은 멈추지 않는다
            captureError(error, { context: 'getAssetChecks:delta', orgId });
        }
    }
    if (!snap) {
        const all = await checksOf();
        const byId = new Map<string, AssetCheck>();
        let maxCheckedMs = 0;
        for (const d of all.docs) {
            const c = d.data() as AssetCheck;
            byId.set(d.id, c);
            maxCheckedMs = Math.max(maxCheckedMs, checkedMs(c));
        }
        snap = { byId, maxCheckedMs, fullAt: Date.now() };
        checkSnapshots.set(key, snap);
    }
    // 화면이 바뀐 줄 알도록 매번 새 Map으로 돌려준다(기억한 Map을 그대로 내주면 상태가 갱신되지 않는다)
    return new Map(snap.byId);
}

/** 기관 전체의 마지막 확인 — 재물 ID → 기록. 한 번도 확인하지 않은 재물은 없다. 두 번째부터는 바뀐 것만 읽는다(위 설명) */
export const getAssetChecks = async (orgId: string): Promise<Map<string, AssetCheck>> => {
    const key = `${auth.currentUser?.uid ?? ''}|${orgId}`;
    // 같은 때 여러 번 부르면 한 번만 읽는다
    const running = checkLoads.get(key);
    if (running) return running;
    const load = loadChecks(orgId, key)
        .catch((error) => {
            captureError(error, { context: 'getAssetChecks', orgId });
            throw error;
        })
        .finally(() => checkLoads.delete(key));
    checkLoads.set(key, load);
    return load;
};
