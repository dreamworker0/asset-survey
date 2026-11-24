import { defineConfig, devices } from '@playwright/test';
import { PERF_WEB_PORT } from './e2e/perf/ports';

/**
 * 성능 측정 전용 설정 — 가상 2,000건 기관에서 재물 목록·조사 현황판의 읽기 수와 시간을 잰다.
 *
 * 실행: `npm run perf:assets`
 *   → firebase.perf.json으로 측정용 에뮬레이터(Firestore 8180·Auth 9299)를 따로 띄우고(다른 작업의 기본 포트와 겹치지 않게)
 *   → globalSetup이 재물 2,000건 등을 시드하고
 *   → webServer가 측정용 프로덕션 빌드(e2e/perf/vite.perf.config.ts: 읽기 계수기 별칭)를 만들어 vite preview로 띄운다.
 *
 * 측정 파일은 `*.perf.ts`라 CI의 인증 E2E(testMatch /authed-.*\.spec\.ts/)·기본 E2E(*.spec.ts)에 걸리지 않는다.
 * 결과는 test-results/perf/*.json에 남는다.
 */
export default defineConfig({
    testDir: './e2e/perf',
    testMatch: /.*\.perf\.ts/,
    // 측정은 직렬로 — 동시에 돌면 CPU를 나눠 써 시간이 흔들린다
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 15 * 60 * 1000,
    outputDir: 'test-results/perf-output',
    reporter: [['list']],
    globalSetup: './e2e/perf/global-setup.ts',
    use: {
        baseURL: `http://127.0.0.1:${PERF_WEB_PORT}`,
        headless: true,
        serviceWorkers: 'block',
        trace: 'off',
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
        // 휴대폰 화면 + CPU 4배 느리게(스펙에서 CDP Emulation.setCPUThrottlingRate)
        { name: 'mobile-4x', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: `vite build --config e2e/perf/vite.perf.config.ts --mode emulator && vite preview --config e2e/perf/vite.perf.config.ts --mode emulator --port ${PERF_WEB_PORT} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${PERF_WEB_PORT}`,
        reuseExistingServer: false,
        timeout: 5 * 60 * 1000,
    },
});
