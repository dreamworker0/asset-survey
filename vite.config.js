import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * E2E 전용: 엔트리 청크 단절 시뮬레이션 (프리뷰 서버 한정)
 *
 * boot-failure 스펙이 "청크를 못 받는 회선"을 만들 때 쓴다. Playwright 인터셉션으로
 * 표현하면 WebKit에서 abort·fulfill·unroute 모두 리로드된 페이지에 반영되지 않아
 * (2026-08-09 CI: 리로드 후 청크 재요청 0건) 복구를 검증할 수 없었다. 그래서 실패를
 * 인터셉션이 아니라 **서버가 주는 진짜 503**으로 표현한다.
 *
 * 설계가 세 갈래인 이유:
 * - **켜기 = 쿠키**(값이 토큰): 프리뷰 서버는 병렬 워커가 공유하므로 전역 플래그면
 *   다른 테스트까지 끊긴다. 단절을 원하는 테스트만 자기 컨텍스트에 쿠키를 심는다.
 * - **끄기 = 서버 측 토글**(/__e2e/outage/off): 복구를 clearCookies에 맡기면
 *   브라우저가 리로드 요청에 쿠키 변경을 언제 반영하는지에 다시 의존하게 된다.
 *   토큰을 서버에서 꺼 버리면 쿠키가 계속 실려 와도 정상 응답한다.
 * - **요청 로그**(/__e2e/outage/log): 실패 시 "리로드가 서버까지 왔는가"를 테스트가
 *   실패 메시지에 실을 수 있게 한다. 브라우저 쪽 네트워크 이벤트는 캐시 재사용을
 *   구분하지 못해 CI에서 원인 확정이 안 됐던 자리다.
 *
 * 프리뷰 서버는 로컬 검증·E2E에서만 쓰이므로 프로덕션(Firebase Hosting)과 무관하다.
 */
const E2E_OUTAGE_CHUNK = /^\/assets\/(lightEntry|LandingPage)-[^/]+\.js/

function e2eEntryOutage() {
  /** 서버에서 꺼 버린 토큰들 — 쿠키가 남아 있어도 무시한다 */
  const stoppedTokens = new Set()
  /** 엔트리 청크 요청 기록 (진단용) */
  const hits = []
  return {
    name: 'e2e-entry-outage',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (url.startsWith('/__e2e/outage/off')) {
          const token = new URL(url, 'http://localhost').searchParams.get('token')
          if (token) stoppedTokens.add(token)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true, token }))
          return
        }
        if (url.startsWith('/__e2e/outage/log')) {
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(hits))
          return
        }
        if (E2E_OUTAGE_CHUNK.test(url)) {
          const token = /(?:^|;\s*)vdl-e2e-outage=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null
          const outage = token !== null && !stoppedTokens.has(token)
          hits.push({ at: new Date().toISOString(), url, token, status: outage ? 503 : 200 })
          if (outage) {
            res.statusCode = 503
            res.setHeader('cache-control', 'no-store')
            res.setHeader('vary', 'Cookie')
            res.end()
            return
          }
        }
        next()
      })
    },
  }
}

/**
 * index.html의 %PUBLIC_ORIGIN%을 공개 주소로 채운다 (오픈 그래프 og:image는 절대 주소여야 한다)
 *
 * 카카오톡·페이스북 미리보기 수집기는 자바스크립트를 돌리지 않아 SEOHead(APP_URL)가 닿지 않는다.
 * 전용 도메인이 생기면 VITE_APP_URL만 넣으면 되고, 비어 있으면 Firebase 기본 도메인을 쓴다.
 * 미리보기 채널에서도 그림 주소는 운영 도메인을 가리키지만 같은 그림이라 문제없다.
 */
const DEFAULT_PUBLIC_ORIGIN = 'https://asset-survey-sp.web.app'

function publicOriginHtml() {
  let origin = DEFAULT_PUBLIC_ORIGIN
  return {
    name: 'public-origin-html',
    configResolved(config) {
      origin = (config.env.VITE_APP_URL || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, '')
    },
    transformIndexHtml(html) {
      return html.replaceAll('%PUBLIC_ORIGIN%', origin)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': __dirname + 'src',
      'xlsx': 'xlsx/dist/xlsx.mini.min.js',
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    e2eEntryOutage(),
    publicOriginHtml(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'icons/app-icon.svg', 'icons/app-icon-192.png', 'icons/app-icon-512.png'],
      manifest: false, // public/manifest.json 직접 사용
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        /*
         * ## 프리캐시는 **앱 셸만** 담는다 (2026-09-09)
         *
         * 이전 값은 js·css·html·svg·png·woff2·webp를 재귀 글롭으로 통째로 담는 패턴이었다.
         * 청구서에서 드러났다:
         * Hosting 대역폭이 평일 1.2GB(월 26GB, 무료 한도 10GB)였고, 그 정체는
         * **비로그인 랜딩 방문 1회당 1.14MB**였다. 랜딩 자체는 128KB인데 서비스 워커가
         * 곧바로 청크 148개(전송 1.01MB)를 끌어왔다 — recharts(99KB)·xlsx(82KB)·
         * leaflet(42KB)까지, 로그인도 하지 않고 떠나는 방문자에게.
         *
         * main.tsx에 "첫 방문자는 자기에게 필요 없는 appEntry(100KB + 의존성)를 내려받느라
         * 정작 필요한 lightEntry와 대역폭을 다퉜다"고 적어 두고 그건 막아 뒀는데, 바로 옆에서
         * **10배 큰 것이** 같은 일을 하고 있었다.
         *
         * 그래서 기본값을 뒤집는다. 프리캐시에는 index.html이 실제로 참조하는 셸
         * (index-*.js 2.6KB + firebase-auth-*.js 29.5KB + index-*.css 22.9KB = gzip 55KB)만
         * 두고, 나머지 청크는 **방문 시점에** sw.ts의 `/assets/` 런타임 캐시가 담는다.
         * 재물조사 앱에서 오프라인을 보장하는 경로는 **현장 스캔**뿐이다 — 진행 중 조사가 있으면
         * 직원 홈(EmployeeHome)이 스캔 화면·카메라 청크를 미리 받아 둔다(관리자·보고서 화면은
         * 오프라인 대상이 아니다). (차량운행일지의 `lib/warmDriverRoutes.ts`는 0단계에서 걷어냈다.)
         *
         * ⚠️ 이 패턴이 엔트리 파일명과 어긋나면 셸이 프리캐시에서 조용히 빠져 **오프라인이
         * 통째로 죽는다.** 그 회귀는 `scripts/check-bundle-size.ts`의 프리캐시 게이트가
         * 막는다 — index.html이 참조하는 파일이 프리캐시 매니페스트에 전부 들어 있는지
         * 대조하고, 하나라도 빠지면 빌드를 실패시킨다(fail-closed).
         */
        globPatterns: [
          'index.html',
          'assets/index-*.{js,css}',
          'assets/firebase-auth-*.js',
          /*
           * sw-purge.js는 **긴급 퍼지 킬 스위치**다(PURGE_VER을 올리면 전 클라이언트가
           * 워커·캐시를 버린다 — index.html이 defer 스크립트로 싣는다). firebase.json이
           * 이 파일을 `max-age=31536000, immutable`로 서빙하므로, 리비전이 붙는 프리캐시가
           * 갱신본을 서빙해 주지 않으면 클라이언트는 최대 1년간 옛 사본을 쓰고
           * **PURGE_VER를 올려도 도달하지 않는다.** 서비스 워커 동작을 바꾸는 이 설정에서
           * 그 복구 수단을 잃을 수는 없다. 1KB이므로 예산에도 영향이 없다.
           */
          'sw-purge.js',
        ],
        // 자체 호스팅 폰트는 프리캐시에서 제외한다. Pretendard 동적 서브셋은 조각이 92개(3.1MB)라
        // 프리캐시에 넣으면 설치 즉시 전부 내려받는다 — 현장 저사양 폰의 데이터·용량을 쓸 이유가 없다.
        // 실제로 필요한 조각은 unicode-range에 따라 몇 개뿐이고, 그것만 sw.ts의 런타임 캐시가 담는다.
        // (globPatterns를 좁힌 뒤로는 fonts/**가 애초에 걸리지 않지만, 패턴을 넓힐 때
        //  이 제외가 함께 사라지지 않도록 남겨 둔다.)
        globIgnores: ['fonts/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: {
    // 소스맵은 **배포 워크플로에서만** 켠다(BUILD_SOURCEMAPS=1).
    // 'hidden'이라 번들에 sourceMappingURL 주석이 남지 않고, .map 파일은
    // firebase.json의 hosting.ignore가 제외해 프로덕션으로 나가지 않는다 —
    // 배포 워크플로가 Actions 아티팩트로 보관해, [오류 기록]의 압축된 스택을
    // `npm run symbolicate`로 원본 파일·줄로 풀 때 쓴다.
    // 로컬·CI 빌드에서 켜면 빌드 시간과 디스크만 늘어나므로 기본은 끈다.
    sourcemap: process.env.BUILD_SOURCEMAPS === '1' ? 'hidden' : false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          'firebase-auth': ['firebase/app', 'firebase/auth'],
          // firestore와 storage를 분리한다 — 합쳐두면 firebase 12.16 기준 단일 청크가 582KB로
          // largestJs 예산(600KB)에 18KB만 남아 다음 마이너 업데이트에서 바로 게이트가 터진다.
          // 증빙 업로드(storage)는 운행일지 작성 일부 경로에서만 쓰여 분리 시 지연 로딩 여지도 생긴다.
          'firebase-db': ['firebase/firestore'],
          'firebase-storage': ['firebase/storage'],
          'firebase-messaging': ['firebase/messaging'],
          // react-dom/client·jsx-runtime·scheduler 서브패스를 명시하지 않으면 렌더러 본체(~200KB)가
          // 앱 공유 청크로 흘러들어가 매 배포마다 재다운로드된다 (react-vendor는 버전 업 전까지 캐시 유지)
          'react-vendor': [
            'react',
            'react/jsx-runtime',
            'react-dom',
            'react-dom/client',
            'scheduler',
            'react-router',
            'react-router-dom',
          ],
          'xlsx': ['xlsx'],
          // QR 카메라(스캔 화면에서만 불러옴). 이름을 따로 주지 않으면 패키지 엔트리 이름을 따라
          // `index-*.js`가 되어 위 globPatterns의 셸 패턴('assets/index-*')에 걸려 프리캐시로 들어간다
          // (2026-11-21 4단계에서 프리캐시 게이트가 잡음 — 98KB가 설치 즉시 내려받아졌다).
          'html5-qrcode': ['html5-qrcode'],
          'image-compression': ['browser-image-compression'],
        },
      },
    },
  },
})
