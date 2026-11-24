---
description: 에러 핸들링 및 오류 보고(captureError) 의무화 규칙. try-catch 및 비즈니스 에러 처리 시 반드시 참고한다.
---

# 글로벌 룰: 에러 핸들링 및 로깅 의무화 (Error Handling & Logging Guidelines)

이 규칙은 `차량운행일지` 프로젝트에서 코드를 작성, 수정 또는 에이전트를 통해 기능을 생성할 때 **반드시 준수**해야 하는 글로벌 행동 규칙입니다.

## 1. 목적
조용히 실패하는 예외(Silent Failure)를 방지하고, 오류 보고(자체 [오류 기록]·Functions 로그) 및 디버깅 로그를 일관되게 남기기 위함입니다. 차량운행일지는 다양한 운영체제와 인앱 브라우저에서 실행되므로 예외 관리가 필수적입니다.

## 2. 세부 원칙
- **선행 룰 확인**: 비동기 및 주요 로직을 짤 때 무조건 이 룰을 기준으로 체크.
- **빈 catch 블록 절대 금지**: `try-catch` 구문을 작성할 때 `catch` 블록을 비워두거나 단순히 `console.error`만 남기지 마세요.
- **오류 보고 필수**: 프론트엔드 및 백엔드 로직에서 의미 있는 비즈니스 에러가 발생할 소지가 있다면, 항상 래퍼 `captureError(error, context)`(§3)를 활용해 기록하세요.
- **컨텍스트 포함**: 에러를 로깅할 때 단순 메세지만 보내지 말고, 영향을 받은 사용자 ID, 발생 위치, 관련 데이터(페이로드) 등의 컨텍스트(Context/Breadcrumbs)를 함께 넘겨야 합니다.

## 3. 적용 예시 (권장 패턴)

Sentry는 2026-11-24 걷어냈다(처리방침에 없는 외부 수탁자를 두지 않으려고). 반드시 래퍼를 쓴다:

- **프론트엔드**: `captureError(error, context)` — `src/lib/monitoring.ts`. 자체 보고(`errorReport` → 슈퍼관리자 [오류 기록])로 보내고 콘솔에도 남긴다. **context 중 기능 이름(`context` 키)만 서버로 간다** — 나머지는 콘솔 진단용이다.
- **Cloud Functions**: `captureError(error, context)` — `functions/src/core/monitoring.ts`. Discord(설정 시)로 보낸다. 로그는 호출부(`log("ERROR")` 등)가 남긴다. 사람이 꼭 알아야 하는 것은 `adminAlertMail`·`noteBatchAlert`로 메일을 보낸다.

```typescript
import { captureError } from '../lib/monitoring'; // 프론트엔드 예시

try {
  await someAsyncFunction(payload);
} catch (error) {
  // [MUST] 1. 단순히 삼키지 않는다. 2. 컨텍스트와 함께 기록한다.
  captureError(error, { context: 'someFeature.submit' });

  // [MUST] 3. 사용자에게 안전한 피드백 (컴포넌트: useToast().showToast / 비-React: notifyUser)
  showToast("데이터 처리 중 문제가 발생했습니다.");
  throw error; // 필요 시 상위로 전파
}
```

## 4. 에이전트 체크리스트
에이전트는 사용자가 코드를 수정해달라고 요청할 때 위 사항이 누락되어 있다면 먼저 **"try-catch 및 오류 보고(captureError)를 포함해 작성해드릴까요?"** 라고 묻거나 코드를 자동으로 보강하여 제시해야 합니다.

## 5. 관련 규칙
- **인증 토큰 복원력**: [token-auth-resilience](token-auth-resilience.md) — Firebase Auth 토큰 만료/갱신, 세션 유지 패턴
- **OCR 비용 보안**: [ocr-cost-security](ocr-cost-security.md) — API 할당량 초과 시 에러 처리 포함
