/**
 * 성능 측정 빌드 전용 `firebase/auth` 대체 모듈 — Auth 에뮬레이터 포트만 측정용으로 바꾼다.
 *
 * e2e/perf/vite.perf.config.ts가 `firebase/auth`를 이 파일로 돌린다. 나머지는 원본 그대로 다시 내보낸다.
 * 프로덕션 빌드(vite.config.js)는 이 파일을 모른다.
 */
import { connectAuthEmulator as realConnectAuthEmulator } from '@firebase/auth';
import { PERF_AUTH_PORT } from './ports';

export * from '@firebase/auth';

export const connectAuthEmulator: typeof realConnectAuthEmulator = (auth, url, options) =>
    realConnectAuthEmulator(auth, url.replace(/:9099(?=\/?$)/, `:${PERF_AUTH_PORT}`), options);
