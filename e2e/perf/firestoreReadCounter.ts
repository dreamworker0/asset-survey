/**
 * 성능 측정 빌드 전용 `firebase/firestore` 대체 모듈 — 앱이 서버에서 받은 문서 수를 센다.
 *
 * e2e/perf/vite.perf.config.ts가 `firebase/firestore`를 이 파일로 돌린다. 나머지는 원본 그대로 다시 내보내고,
 * 읽기 함수만 감싸 받은 문서 수를 `window.__PERF_READS__`에 컬렉션별로 더한다. 제품 코드·프로덕션 빌드는 이 파일을
 * 모른다(vite.config.js에는 별칭이 없다).
 *
 * 세는 규칙 — Firestore 과금 규칙에 맞춘 클라이언트 쪽 근사치다:
 * - getDocs / getDocsFromServer: 서버에서 온 결과면 문서 수(0건이어도 1)
 * - getDoc / getDocFromServer: 서버에서 온 결과면 1(문서가 없어도 1)
 * - onSnapshot(쿼리): 서버에서 온 첫 스냅샷의 문서 수(0건이어도 1), 그 뒤로는 추가·변경된 문서 수
 * - onSnapshot(문서): 서버에서 온 스냅샷마다 1
 * - getCountFromServer / getAggregateFromServer: 결과 1,000건당 1(최소 1)
 * 캐시에서 온 결과(metadata.fromCache)와 내 쓰기의 로컬 반영(hasPendingWrites)은 세지 않는다.
 * 세지 못하는 것: 보안 규칙의 get()/exists(), 트랜잭션 안의 읽기, Cloud Functions의 읽기, 리스너 재연결 때 서버가 다시 보낸 문서.
 */
import * as real from '@firebase/firestore';
import { PERF_FIRESTORE_PORT } from './ports';

export * from '@firebase/firestore';

interface ReadLogEntry { at: number; kind: string; collection: string; docs: number }
interface ReadStore {
    total: number;
    byCollection: Record<string, number>;
    log: ReadLogEntry[];
}

const g = globalThis as unknown as { __PERF_READS__?: ReadStore; __PERF_READS_RESET__?: () => void };
const store: ReadStore = g.__PERF_READS__ ?? { total: 0, byCollection: {}, log: [] };
g.__PERF_READS__ = store;
// 측정 사이에 비운다 — 같은 객체를 비워야 이 모듈이 계속 같은 곳에 더한다
g.__PERF_READS_RESET__ = () => {
    store.total = 0;
    store.byCollection = {};
    store.log = [];
};

function add(kind: string, collection: string, docs: number): void {
    store.total += docs;
    store.byCollection[collection] = (store.byCollection[collection] ?? 0) + docs;
    store.log.push({ at: performance.now(), kind, collection, docs });
}

// 쿼리 → 컬렉션 이름. 내부 필드에 기대지 않으려고 collection()/collectionGroup()/query()가 만든 객체를 기억한다.
const queryCollection = new WeakMap<object, string>();

function collectionOf(target: unknown): string {
    if (!target || typeof target !== 'object') return 'unknown';
    const t = target as { type?: string; id?: string; parent?: { id?: string } };
    if (t.type === 'document') return t.parent?.id ?? 'unknown';
    if (t.type === 'collection' && t.id) return t.id;
    return queryCollection.get(target) ?? 'unknown';
}

export const collection = ((...args: Parameters<typeof real.collection>) => {
    const ref = (real.collection as (...a: unknown[]) => real.CollectionReference)(...args);
    queryCollection.set(ref, ref.id);
    return ref;
}) as typeof real.collection;

export const collectionGroup: typeof real.collectionGroup = (firestore, collectionId) => {
    const q = real.collectionGroup(firestore, collectionId);
    queryCollection.set(q, collectionId);
    return q;
};

export const query = ((base: real.Query, ...constraints: unknown[]) => {
    const q = (real.query as (...a: unknown[]) => real.Query)(base, ...constraints);
    queryCollection.set(q, collectionOf(base));
    return q;
}) as typeof real.query;

export const getDocs: typeof real.getDocs = async (q) => {
    const snap = await real.getDocs(q);
    if (!snap.metadata.fromCache) add('getDocs', collectionOf(q), Math.max(1, snap.size));
    return snap;
};

export const getDocsFromServer: typeof real.getDocsFromServer = async (q) => {
    const snap = await real.getDocsFromServer(q);
    add('getDocsFromServer', collectionOf(q), Math.max(1, snap.size));
    return snap;
};

export const getDoc: typeof real.getDoc = async (ref) => {
    const snap = await real.getDoc(ref);
    if (!snap.metadata.fromCache) add('getDoc', collectionOf(ref), 1);
    return snap;
};

export const getDocFromServer: typeof real.getDocFromServer = async (ref) => {
    const snap = await real.getDocFromServer(ref);
    add('getDocFromServer', collectionOf(ref), 1);
    return snap;
};

const aggregateReads = (data: Record<string, unknown>): number => {
    const count = Object.values(data).find((v): v is number => typeof v === 'number') ?? 0;
    return Math.max(1, Math.ceil(count / 1000));
};

export const getCountFromServer: typeof real.getCountFromServer = async (q) => {
    const snap = await real.getCountFromServer(q);
    add('count', collectionOf(q), aggregateReads(snap.data()));
    return snap;
};

export const getAggregateFromServer = (async (q: real.Query, spec: real.AggregateSpec) => {
    const snap = await real.getAggregateFromServer(q, spec);
    add('aggregate', collectionOf(q), aggregateReads(snap.data() as Record<string, unknown>));
    return snap;
}) as typeof real.getAggregateFromServer;

type AnySnap = real.QuerySnapshot | real.DocumentSnapshot;

/** onSnapshot — 콜백(또는 observer.next)을 감싸 서버에서 온 스냅샷만 센다. 인자 모양은 원본 그대로 넘긴다 */
export const onSnapshot = ((target: real.Query | real.DocumentReference, ...rest: unknown[]) => {
    const col = collectionOf(target);
    const isDoc = (target as { type?: string }).type === 'document';
    let counted = false;
    const count = (snap: AnySnap) => {
        if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        if (isDoc) { add('onSnapshot(doc)', col, 1); return; }
        const qs = snap as real.QuerySnapshot;
        if (!counted) {
            counted = true;
            add('onSnapshot', col, Math.max(1, qs.size));
            return;
        }
        const changed = qs.docChanges().filter((c) => c.type !== 'removed').length;
        if (changed > 0) add('onSnapshot+', col, changed);
    };
    const args = [...rest];
    const i = args.findIndex((a) => typeof a === 'function' || (!!a && typeof (a as { next?: unknown }).next === 'function'));
    if (i >= 0) {
        const a = args[i];
        if (typeof a === 'function') {
            const fn = a as (s: AnySnap) => void;
            args[i] = (s: AnySnap) => { count(s); fn(s); };
        } else {
            const obs = a as { next: (s: AnySnap) => void; error?: (e: unknown) => void; complete?: () => void };
            args[i] = { ...obs, next: (s: AnySnap) => { count(s); obs.next(s); } };
        }
    }
    return (real.onSnapshot as (...a: unknown[]) => real.Unsubscribe)(target, ...args);
}) as typeof real.onSnapshot;

/** 앱은 에뮬레이터 포트 8080을 박아 두었다 — 측정용 에뮬레이터 포트로 바꾼다 */
export const connectFirestoreEmulator: typeof real.connectFirestoreEmulator = (firestore, host, port, options) =>
    real.connectFirestoreEmulator(firestore, host, port === 8080 ? PERF_FIRESTORE_PORT : port, options);
