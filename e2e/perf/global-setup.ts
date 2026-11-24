/**
 * e2e/perf/global-setup.ts — 성능 측정 전용 globalSetup(공통 인증 E2E의 globalSetup과 별개).
 */
import { seedPerfData } from './seedPerf';

export default async function globalSetup() {
    if (!process.env.FIRESTORE_EMULATOR_HOST?.endsWith(':8180')) {
        // 운영이나 다른 에뮬레이터에 시드하지 않도록 측정용 에뮬레이터(firebase.perf.json)에서만 돈다
        throw new Error(`측정용 Firestore 에뮬레이터(8180)가 아닙니다: FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? '(없음)'} — npm run perf:assets로 실행하세요.`);
    }
    await seedPerfData();
}
