/**
 * e2e/emulator/seed.ts — Firebase 에뮬레이터 시드.
 * admin SDK로 Auth 계정(+custom claims)과 Firestore 테스트 데이터를 주입한다.
 * admin SDK는 firebase emulators:exec가 주입하는 FIREBASE_AUTH_EMULATOR_HOST /
 * FIRESTORE_EMULATOR_HOST 환경변수를 감지해 자동으로 에뮬레이터를 대상으로 동작한다.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// 값을 복제하지 않고 원본을 가져온다 — 약관 개정으로 버전이 오르면 시드도 자동으로 따라가야
// 재동의 게이트가 E2E를 막지 않는다. (constants.ts는 import가 없는 순수 상수 모듈이라 Node에서 안전)
import { TERMS_VERSION, PRIVACY_VERSION } from '../../src/lib/constants';

const PROJECT_ID =
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'demo-asset-survey';

export const TEST_ORG_ID = 'e2e-org';
export const TEST_ADMIN = {
    uid: 'e2e-admin',
    email: 'e2e-admin@test.local',
    password: 'test1234',
    name: 'E2E 관리자',
};
export const TEST_EMPLOYEE = {
    uid: 'e2e-employee',
    email: 'e2e-emp@test.local',
    password: 'test1234',
    name: 'E2E 직원',
};

export async function seedEmulator(): Promise<void> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const auth = getAuth();
    const db = getFirestore();

    // 1) Auth 계정 (이미 있으면 무시)
    for (const u of [TEST_ADMIN, TEST_EMPLOYEE]) {
        try {
            await auth.createUser({ uid: u.uid, email: u.email, password: u.password, displayName: u.name });
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
        }
    }
    // Custom claims (firestore.rules가 token.role / token.orgId를 검증)
    await auth.setCustomUserClaims(TEST_ADMIN.uid, { role: 'admin', orgId: TEST_ORG_ID });
    await auth.setCustomUserClaims(TEST_EMPLOYEE.uid, { role: 'employee', orgId: TEST_ORG_ID });

    // 2) Firestore 시드
    const now = new Date();
    // consent는 재동의 게이트(useConsentGate)가 참조한다. 없으면 관리자에게 차단 모달이 떠
    // 클릭을 가로채므로 인증 E2E 전체가 실패한다. 게이트 자체를 검증하는 테스트가 아니라면
    // 시드 계정은 항상 현행 버전에 동의한 상태여야 한다.
    await db.collection('organizations').doc(TEST_ORG_ID).set({
        name: 'E2E 테스트 기관',
        status: 'approved',
        createdAt: now,
        consent: {
            terms: true,
            privacy: true,
            termsVersion: TERMS_VERSION,
            privacyVersion: PRIVACY_VERSION,
            agreedAt: now,
        },
    }, { merge: true });

    await db.collection('users').doc(TEST_ADMIN.uid).set({
        uid: TEST_ADMIN.uid, name: TEST_ADMIN.name, email: TEST_ADMIN.email,
        role: 'admin', organizationId: TEST_ORG_ID, organizationStatus: 'approved',
        status: 'active', createdAt: now,
        consent: { terms: true, termsVersion: TERMS_VERSION, agreedAt: now },
    }, { merge: true });

    await db.collection('users').doc(TEST_EMPLOYEE.uid).set({
        uid: TEST_EMPLOYEE.uid, name: TEST_EMPLOYEE.name, email: TEST_EMPLOYEE.email,
        role: 'employee', organizationId: TEST_ORG_ID, organizationStatus: 'approved',
        status: 'active', createdAt: now,
        consent: { terms: true, termsVersion: TERMS_VERSION, agreedAt: now },
    }, { merge: true });


}

/**
 * 조사 흐름 E2E(authed-survey-flow)용 공간 두 곳을 만든다 — 실행마다 이름이 다르다.
 *
 * globalSetup의 공통 시드에 고정 이름으로 두지 않은 이유: 다른 인증 E2E가 같은 기관을 쓰고, CI는 실패한
 * 테스트를 같은 에뮬레이터에서 한 번 더 돌린다. 이름이 고정이면 재시도 때 지난 시도의 재물이 같은 공간에
 * 남아 대상 수가 달라진다. 실행마다 새 공간을 만들고 조사 대상도 이 두 곳만 고르면 서로 섞이지 않는다.
 *
 * 지난 시도가 도중에 실패해 열린 채 남은 조사가 있으면 새 조사를 시작할 수 없으므로 닫아 둔다
 * (앱도 기관당 진행 중 조사를 하나만 허락한다).
 *
 * @returns 만든 공간 이름 — 가져오기 파일의 위치 칸에 그대로 쓴다(이름이 같으면 위치→공간이 자동으로 이어진다)
 */
export async function seedSurveyFlowSpaces(runId: string): Promise<{ managed: string; unmanaged: string }> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const db = getFirestore();
    const now = new Date();

    const leftovers = await db.collection('surveys')
        .where('organizationId', '==', TEST_ORG_ID)
        .where('status', 'in', ['open', 'closing'])
        .get();
    for (const d of leftovers.docs) await d.ref.update({ status: 'closed', closedAt: now, closedByUid: TEST_ADMIN.uid });

    const managed = `E2E-101호-${runId}`;
    const unmanaged = `E2E-창고-${runId}`;
    const base = {
        organizationId: TEST_ORG_ID, teamIds: [], archived: false, buildingId: null, floor: null,
        lastEditedByUid: TEST_ADMIN.uid, createdAt: now, updatedAt: now,
    };
    // 직원은 '101호'의 공간 담당자 — '나눠서 조사'에서 이 공간을 찍고 제출한다. '창고'는 담당자 없이 둬 관리자가 대신 승인한다.
    await db.collection('spaces').doc(`e2e-space-101-${runId}`).set({ ...base, name: managed, order: 900, managerUids: [TEST_EMPLOYEE.uid] });
    await db.collection('spaces').doc(`e2e-space-store-${runId}`).set({ ...base, name: unmanaged, order: 901, managerUids: [] });
    return { managed, unmanaged };
}

/** 조사 흐름 E2E가 서버 쪽 결과를 맞춰 보는 데 쓴다 — 회차 문서와 희망이음 반영 목록 */
export async function readSurveyResult(surveyId: string) {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const db = getFirestore();
    const survey = (await db.collection('surveys').doc(surveyId).get()).data();
    const tasks = await db.collection('syncTasks')
        .where('organizationId', '==', TEST_ORG_ID)
        .where('surveyId', '==', surveyId)
        .get();
    return {
        status: survey?.status as string | undefined,
        summary: survey?.summary as Record<string, number> | undefined,
        tasks: tasks.docs.map((d) => d.data() as { kind: string; code: string }),
    };
}
