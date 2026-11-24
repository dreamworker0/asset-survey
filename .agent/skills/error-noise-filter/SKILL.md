---
name: error-noise-filter
description: 슈퍼관리자 [오류 기록](자체 오류 보고 clientErrors)에 잡힌 환경/브라우저/외부 의존성 발 노이즈 에러를 거른다. 사용자가 "오류 기록 노이즈", "이 에러 무시", "오류 기록에 자꾸 뜨는 X 막아줘" 등을 요청할 때 발동한다.
---

# 오류 보고 노이즈 필터 추가

2026-11-24 Sentry를 걷어낸 뒤 화면 오류는 자체 보고(`src/lib/errorReport.ts` → `reportClientError` 함수 →
`clientErrors` 컬렉션 → 슈퍼관리자 [오류 기록])로만 모은다. 차량운행일지 시절 Sentry 노이즈 필터가 가장 잦은
보수 작업이었듯, 여기서도 **"앱 버그"와 "환경 노이즈"의 판단**이 핵심이다. 잘못 거르면 진짜 버그가 묻힌다.

## 발동 조건

- [오류 기록]에 뜨는 특정 오류 문구를 보여 주며 "이거 막아줘"라고 함
- "오류 기록에 노이즈가 너무 많다", "이 에러는 우리 버그 아님" 등
- App Check, IndexedDB, ServiceWorker, 인앱 브라우저 관련 환경 에러

## 절대 원칙

**거르기 전에 "정말 앱 버그가 아닌지" 한 번 더 검증한다.** 다음 중 하나에 해당할 때만 거른다:

1. 브라우저/OS/네트워크 환경 이슈 (특정 사용자 환경에서만 재현, 코드로 해결 불가)
2. 외부 SDK 내부 에러 (Firebase, reCAPTCHA, vite-plugin-pwa 등)
3. 브라우저 확장 프로그램·인앱 브라우저(Facebook, Kakao 등) 발 에러
4. 앱 코드에서 이미 catch되어 정상 처리되는 비즈니스 에러 (글로벌 바운더리로 새는 것만 차단)

코드로 고칠 수 있거나 빈도가 낮으면 **고치는 게 우선**이다. 필터는 최후의 수단.

압축된 스택이 읽히지 않으면 먼저 원본 위치로 푼다 — 배포 실행의 `sourcemaps-<SHA>` 아티팩트를 받아
`npm run symbolicate -- <소스맵 폴더> <스택 파일>` ([scripts/symbolicate.ts](../../../scripts/symbolicate.ts)).

## 어디에 추가하나

### 프론트엔드: [src/lib/errorReport.ts](../../../src/lib/errorReport.ts)의 `NOISE` 배열

오류 문구 또는 스택에 정규식이 맞으면 보내지 않는다(`buildPayload`가 null을 돌려준다).

```ts
const NOISE = [
    // ... 기존 항목 ...
    // [추가 이유 한 줄: 환경 이슈/외부 SDK/등]
    /새-에러-정규식/,
];
```

호출부에서 예상된 실패를 아예 보고하지 않아야 하면 `captureError` 대신 콘솔만 남기거나
`useRetry`의 `shouldReport`로 거른다 — 필터보다 의도가 분명하다.

### Cloud Functions: [functions/src/core/monitoring.ts](../../../functions/src/core/monitoring.ts)

서버 오류는 [오류 기록]으로 오지 않는다(함수 로그 + 설정 시 Discord). 노이즈는 호출부에서
`log("WARNING", ...)`로 낮추는 것이 원칙이다 — `log("ERROR")`는 곧 `captureError`다
([helpers.ts](../../../functions/src/utils/helpers.ts)의 `isServerFailure` 기준 참고).

## 작성 체크리스트

- [ ] 필터 추가 라인 위에 **이유 주석 한 줄** 필수 ("X 발생 — Y 이유로 앱 버그 아님")
- [ ] 정규식이면 너무 광범위하지 않은지 검토 (예: `/error/i`는 금지). 가능한 한 좁게.
- [ ] 비즈니스 에러를 거르는 거라면 **앱 코드 측에서도 사용자 메시지로 정상 처리되는지** 먼저 확인
- [ ] [src/__tests__/lib/errorReport.test.ts](../../../src/__tests__/lib/errorReport.test.ts)에 거르는 사례 한 줄 추가
- [ ] 커밋 메시지: `chore: 오류 보고에서 [주제] 노이즈를 거름`

## 이미 거르는 것

[src/lib/errorReport.ts](../../../src/lib/errorReport.ts)의 `NOISE`를 먼저 보고 중복 추가를 막는다:

- ResizeObserver loop
- 브라우저 확장(chrome-/moz-/safari-extension)
- App Check throttled·네트워크 지연, reCAPTCHA
- 애널리틱스 설정 받기 실패, 다른 출처 프레임 차단
- CSP 위반 보고

차량운행일지 Sentry가 걸렀던 범주(ChunkLoadError, IDB INTERNAL ASSERTION, iOS Safari IndexedDB lost,
Facebook 인앱 `Java object is gone`, vite-plugin-pwa `newestWorker is null` 등)는 아직 `NOISE`에 없다 —
[오류 기록]에 실제로 뜨면 그때 근거와 함께 넣는다.

## 안티패턴

- 메시지에 ID·UID·시간 등 유동 값이 포함된 정규식 (`/user-[a-z0-9]+ failed/`) — 운영에서 깨짐
- `/.*error.*/i` 같은 광범위 패턴 — 진짜 버그 같이 묻힘
- "일단 무시" 주석 — 6개월 뒤 누구도 못 건드림. 이유와 출처(브라우저/SDK/시나리오)를 명시
