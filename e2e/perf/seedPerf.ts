/**
 * e2e/perf/seedPerf.ts — 성능 측정용 가상 기관 데이터(재물 2,000건) 시드.
 *
 * 공통 인증 E2E 시드(e2e/emulator/seed.ts)는 그대로 두고, 측정 전용 에뮬레이터(firebase.perf.json)에만 넣는다.
 * admin SDK는 firebase emulators:exec가 주입하는 FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST로 에뮬레이터를 쓴다.
 *
 * 모양(가상 — 실제 기관 자료가 아니다):
 * - 건물 2개, 공간 60개
 * - 재물 2,000건: 운영 약 93%(불용·폐기 섞음), 10%는 공간 미지정, 라벨 절반 발급, 금액 문서 2,000건
 *   updatedAt은 30일 전부터 1분 간격으로 흩어 둔다 — 모두 같은 시각이면 '바뀐 것만 읽기'의 2분 겹침에 전부 걸려
 *   실제와 다른 결과가 나온다.
 * - 마지막 확인 기록 1,200건(재물의 60%), 지난 2년에 흩어 둠
 * - 진행 중 조사 1회차: 운영 재물 전부가 대상(공간 61묶음), 스캔 500건, 공간 제출 12건
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { seedEmulator, TEST_ORG_ID, TEST_ADMIN, TEST_EMPLOYEE } from '../emulator/seed';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-asset-survey';

export const PERF_ASSET_COUNT = 2000;
export const PERF_SPACE_COUNT = 60;
export const PERF_CHECK_COUNT = 1200;
export const PERF_SCAN_COUNT = 500;
export const PERF_SUBMISSION_COUNT = 12;
export const PERF_SURVEY_ID = 'perf-survey';
/** 공간 거르기 측정에 고르는 공간 */
export const PERF_FILTER_SPACE_ID = 'perf-space-07';
/** 검색 측정어 — 품명 20종 중 하나라 약 5%가 걸린다 */
export const PERF_SEARCH_TERM = '의자';

const NO_SPACE_KEY = '_none';
const DAY = 24 * 60 * 60 * 1000;

const ITEMS: Array<[name: string, category: string]> = [
    ['사무용 의자', '집기'], ['책상', '집기'], ['노트북', '전산'], ['모니터', '전산'], ['프린터', '전산'],
    ['캐비닛', '집기'], ['냉장고', '가전'], ['에어컨', '가전'], ['정수기', '가전'], ['소파', '집기'],
    ['회의 테이블', '집기'], ['빔프로젝터', '전산'], ['복합기', '전산'], ['전자레인지', '가전'], ['책장', '집기'],
    ['파티션', '집기'], ['선풍기', '가전'], ['청소기', '가전'], ['카메라', '전산'], ['태블릿', '전산'],
];

const db = (): Firestore => {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    return getFirestore();
};

export const perfAssetCode = (i: number) => `P-${String(i).padStart(4, '0')}`;
export const perfAssetId = (i: number) => `${TEST_ORG_ID}__${encodeURIComponent(perfAssetCode(i))}`;
const spaceId = (n: number) => `perf-space-${String(n).padStart(2, '0')}`;
/** i번째 재물의 공간(10건 중 1건은 미지정) */
const spaceOf = (i: number): string | null => (i % 10 === 0 ? null : spaceId(i % PERF_SPACE_COUNT));
const statusOf = (i: number) => (i % 30 === 0 ? 'disposed' : i % 15 === 0 ? 'inactive' : 'active');

/** 재물 i의 시드 모양 — 측정 사이에 되돌릴 때도 같은 값을 쓴다 */
function assetDoc(i: number, base: number) {
    const [item, category] = ITEMS[i % ITEMS.length];
    const at = Timestamp.fromMillis(base - (PERF_ASSET_COUNT - i) * 60_000);
    return {
        organizationId: TEST_ORG_ID,
        code: perfAssetCode(i),
        name: `${item} ${(i % 7) + 1}호`,
        category,
        spec: `규격-${i % 13}`,
        acquiredAt: `${2010 + (i % 15)}-03-15`,
        acquiredQuantity: 1,
        quantity: 1,
        usefulLife: i % 3 === 0 ? 5 : null,
        status: statusOf(i),
        statusRaw: null,
        locationRaw: spaceOf(i) ? null : `창고 ${i % 4}`,
        spaceId: spaceOf(i),
        department: null,
        usage: null,
        missingFromSource: i % 50 === 0,
        manual: false,
        lastImportId: null,
        tagId: i % 2 === 0 ? `perf-tag-${i}` : null,
        lastEditedByUid: TEST_ADMIN.uid,
        createdAt: at,
        updatedAt: at,
    };
}

/** 시드 기준 시각 — 가장 최근 재물이 30일 전에 바뀐 기관 */
const seedBase = () => Date.now() - 30 * DAY;

/**
 * 재물 2,000건을 시드 값으로 (다시) 쓴다 — 측정 묶음(데스크톱·휴대폰)마다 처음 상태에서 시작하려고 부른다.
 * '10건 바뀜' 측정이 updatedAt을 지금으로 바꿔 두면 다음 묶음의 '바뀐 것만 읽기' 결과가 달라지기 때문이다.
 */
export async function resetPerfAssets(): Promise<void> {
    const w = db().bulkWriter();
    const base = seedBase();
    for (let i = 1; i <= PERF_ASSET_COUNT; i++) void w.set(db().collection('assets').doc(perfAssetId(i)), assetDoc(i, base));
    await w.close();
}

/** 재물 n건을 관리자가 고친 것처럼 바꾼다(updatedAt = 서버 시각) — '10건 바뀐 뒤 다시 열기' 측정용 */
export async function touchPerfAssets(from: number, n: number): Promise<void> {
    const w = db().bulkWriter();
    for (let i = from; i < from + n; i++) {
        void w.update(db().collection('assets').doc(perfAssetId(i)), {
            spec: `고친 규격-${Date.now()}`, updatedAt: FieldValue.serverTimestamp(), lastEditedByUid: TEST_ADMIN.uid,
        });
    }
    await w.close();
}

/** 진행 중 조사에 스캔 n건을 더한다(현황판 리스너의 추가 읽기 측정용). 더한 스캔 ID를 돌려준다 */
export async function addPerfScans(fromAsset: number, n: number): Promise<string[]> {
    const w = db().bulkWriter();
    const ids: string[] = [];
    const now = Timestamp.now();
    let i = fromAsset;
    while (ids.length < n && i <= PERF_ASSET_COUNT) {
        const sp = spaceOf(i);
        if (statusOf(i) === 'active' && sp) {
            const id = `${PERF_SURVEY_ID}__${perfAssetId(i)}`;
            ids.push(id);
            void w.set(db().collection('scans').doc(id), scanDoc(i, sp, now));
        }
        i++;
    }
    await w.close();
    return ids;
}

export async function deletePerfScans(ids: string[]): Promise<void> {
    const w = db().bulkWriter();
    for (const id of ids) void w.delete(db().collection('scans').doc(id));
    await w.close();
}

function scanDoc(i: number, sp: string, at: Timestamp) {
    return {
        organizationId: TEST_ORG_ID, surveyId: PERF_SURVEY_ID, assetId: perfAssetId(i), code: perfAssetCode(i),
        name: assetDoc(i, 0).name, spaceId: sp, expectedSpaceId: sp, result: 'ok', method: 'qr', condition: 'normal',
        memo: '', scannedByUid: TEST_EMPLOYEE.uid, scannedAt: at, lastEditedByUid: TEST_EMPLOYEE.uid, updatedAt: at,
    };
}

export async function seedPerfData(): Promise<void> {
    await seedEmulator();
    const fs = db();
    const now = Date.now();
    const stamp = { lastEditedByUid: TEST_ADMIN.uid, createdAt: Timestamp.fromMillis(now - 60 * DAY), updatedAt: Timestamp.fromMillis(now - 60 * DAY) };
    const w = fs.bulkWriter();

    // 건물·공간
    const buildings = [
        { id: 'perf-bldg-main', name: '본관', floors: ['B1', '1층', '2층', '3층'] },
        { id: 'perf-bldg-annex', name: '별관', floors: ['1층', '2층'] },
    ];
    buildings.forEach((b, order) => void w.set(fs.collection('buildings').doc(b.id), {
        organizationId: TEST_ORG_ID, name: b.name, address: '', floors: b.floors, order, archived: false, ...stamp,
    }));
    const spaceIds: string[] = [];
    for (let n = 0; n < PERF_SPACE_COUNT; n++) {
        const b = buildings[n < 40 ? 0 : 1];
        const id = spaceId(n);
        spaceIds.push(id);
        void w.set(fs.collection('spaces').doc(id), {
            organizationId: TEST_ORG_ID, name: `${100 + n}호`, order: n, managerUids: n % 5 === 0 ? [TEST_EMPLOYEE.uid] : [],
            teamIds: [], archived: false, buildingId: b.id, floor: b.floors[n % b.floors.length], ...stamp,
        });
    }

    // 재물·금액
    const base = seedBase();
    for (let i = 1; i <= PERF_ASSET_COUNT; i++) {
        const id = perfAssetId(i);
        void w.set(fs.collection('assets').doc(id), assetDoc(i, base));
        void w.set(fs.collection('assetAccounting').doc(id), {
            organizationId: TEST_ORG_ID, amount: 100_000 + (i % 40) * 25_000, depreciation: null, residual: null,
            lastEditedByUid: TEST_ADMIN.uid, updatedAt: Timestamp.fromMillis(base),
        });
    }

    // 마지막 확인 기록 — 5건 중 3건
    let checks = 0;
    for (let i = 1; i <= PERF_ASSET_COUNT && checks < PERF_CHECK_COUNT; i++) {
        if (i % 5 === 0 || i % 5 === 1) continue;
        checks++;
        const id = perfAssetId(i);
        void w.set(fs.collection('assetChecks').doc(id), {
            organizationId: TEST_ORG_ID, assetId: id, checkedAt: Timestamp.fromMillis(now - (i % 730) * DAY),
            checkedByUid: TEST_EMPLOYEE.uid, via: 'qr', spaceId: spaceOf(i), surveyId: null,
        });
    }

    // 진행 중 조사 — 운영 재물 전부가 대상
    const groups = new Map<string, Array<Record<string, unknown>>>([...spaceIds.map((id) => [id, []] as [string, Array<Record<string, unknown>>]), [NO_SPACE_KEY, []]]);
    let targetCount = 0;
    for (let i = 1; i <= PERF_ASSET_COUNT; i++) {
        if (statusOf(i) !== 'active') continue;
        const a = assetDoc(i, base);
        groups.get(a.spaceId ?? NO_SPACE_KEY)?.push({
            id: perfAssetId(i), code: a.code, name: a.name, tagId: a.tagId,
            ...(a.usefulLife != null ? { acquiredAt: a.acquiredAt, usefulLife: a.usefulLife } : {}),
        });
        targetCount++;
    }
    const surveyAt = Timestamp.fromMillis(now - 3 * DAY);
    void w.set(fs.collection('surveys').doc(PERF_SURVEY_ID), {
        organizationId: TEST_ORG_ID, name: '성능 측정 조사', startDate: '2026-11-21', endDate: '2026-12-05',
        spaceIds, includesUnassigned: true, mode: 'delegated', status: 'open', targetCount,
        lastEditedByUid: TEST_ADMIN.uid, createdAt: surveyAt,
    });
    for (const [key, items] of groups) {
        void w.set(fs.collection('surveyTargets').doc(`${PERF_SURVEY_ID}__${key}`), {
            organizationId: TEST_ORG_ID, surveyId: PERF_SURVEY_ID, spaceId: key === NO_SPACE_KEY ? null : key, items,
            lastEditedByUid: TEST_ADMIN.uid, createdAt: surveyAt,
        });
    }
    // 스캔 500건 — 공간이 있는 운영 재물 앞에서부터
    let scans = 0;
    for (let i = 1; i <= PERF_ASSET_COUNT && scans < PERF_SCAN_COUNT; i++) {
        const sp = spaceOf(i);
        if (statusOf(i) !== 'active' || !sp) continue;
        scans++;
        void w.set(fs.collection('scans').doc(`${PERF_SURVEY_ID}__${perfAssetId(i)}`), scanDoc(i, sp, surveyAt));
    }
    // 공간 제출 12건(절반 승인)
    for (let n = 0; n < PERF_SUBMISSION_COUNT; n++) {
        const sp = spaceIds[n];
        const approved = n % 2 === 0;
        void w.set(fs.collection('surveySubmissions').doc(`${PERF_SURVEY_ID}__${sp}`), {
            organizationId: TEST_ORG_ID, surveyId: PERF_SURVEY_ID, spaceId: sp, state: approved ? 'approved' : 'submitted',
            submittedByUid: TEST_EMPLOYEE.uid, submittedAt: surveyAt, reviewedByUid: approved ? TEST_ADMIN.uid : null,
            reviewedAt: approved ? surveyAt : null, reason: '', selfApproved: false, proxyApproved: false,
            lastEditedByUid: TEST_EMPLOYEE.uid, updatedAt: surveyAt,
        });
    }
    await w.close();
    console.log(`[perf] 시드 완료 — 재물 ${PERF_ASSET_COUNT}·확인 ${checks}·대상 ${targetCount}·스캔 ${scans}·제출 ${PERF_SUBMISSION_COUNT}`);
}
