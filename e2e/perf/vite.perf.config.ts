/**
 * 성능 측정 전용 Vite 설정 — 프로덕션 설정(vite.config.js)에 별칭 두 개만 더한다.
 *
 * - `firebase/firestore` → firestoreReadCounter.ts (받은 문서 수 세기 + 측정용 Firestore 에뮬레이터 포트)
 * - `firebase/auth` → authEmulatorShim.ts (측정용 Auth 에뮬레이터 포트)
 *
 * playwright.perf.config.ts가 이 설정으로 `vite build --mode emulator` 후 `vite preview`를 띄운다.
 * 개발 서버가 아니라 프로덕션 빌드로 재야 렌더 시간이 실제 배포본에 가깝다. 결과물은 test-results/perf-dist(깃 제외)에 둔다.
 */
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'url';
import baseConfig from '../../vite.config.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default mergeConfig(baseConfig, defineConfig({
    resolve: {
        alias: [
            { find: /^firebase\/firestore$/, replacement: here('./firestoreReadCounter.ts') },
            { find: /^firebase\/auth$/, replacement: here('./authEmulatorShim.ts') },
        ],
    },
    build: {
        outDir: 'test-results/perf-dist',
        emptyOutDir: true,
    },
    preview: {
        // 프리뷰는 빌드 결과를 그대로 낸다 — outDir은 build 설정을 따른다
        strictPort: true,
    },
}));
