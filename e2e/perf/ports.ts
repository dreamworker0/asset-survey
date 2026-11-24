/**
 * 성능 측정 전용 에뮬레이터·서버 포트 — firebase.perf.json과 같은 값이어야 한다.
 *
 * 같은 PC에서 다른 작업이 기본 포트(Firestore 8080·Auth 9099·허브 4400)로 에뮬레이터를 띄워 둘 수 있어
 * 측정은 따로 띄운 에뮬레이터를 쓴다. 앱(src/lib/firebase.ts)은 기본 포트를 박아 두었으므로, 측정 빌드에서만
 * firestoreReadCounter.ts·authEmulatorShim.ts가 연결 포트를 이 값으로 바꾼다(제품 코드는 건드리지 않는다).
 */
export const PERF_FIRESTORE_PORT = 8180;
export const PERF_AUTH_PORT = 9299;
/** 측정용 프로덕션 빌드를 띄우는 vite preview 포트 */
export const PERF_WEB_PORT = 5180;
