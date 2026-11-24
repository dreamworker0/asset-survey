# 📦 재물조사 (가칭)

사회복지기관·비영리단체가 함께 쓰는 **무료 재물조사 웹앱(PWA)**. 희망이음·기관 자체 대장 엑셀을 올리면 QR 라벨을 뽑아 주고, 공간 담당자가 휴대폰으로 찍어 조사하고, 재물 담당자가 승인하면 연도별 결과 보고서가 남습니다.

> **지금 상태: 1~5단계 구현, 6단계(협력 기관 시범) 준비 중.** 운영 Firebase 프로젝트 `asset-survey-sp`에 배포돼 있습니다(2026-11-21 첫 배포).
> 대장 가져오기·재물 목록·QR 라벨 → 조사 회차(나눠서/혼자)·스캔 → 제출·승인·마감 → 결과 보고서·희망이음 반영 목록까지 동작합니다.
> 단계별 기준은 [기획서.md](기획서.md) 11장, 시범 준비물은 [시범운영안내.md](시범운영안내.md), 운영 준비 현황은 [OPERATIONS.md](OPERATIONS.md).

- 기획: [기획서.md](기획서.md) · 결정 기록: [결정기록.md](결정기록.md)
- 참고 자료(다른 기관 앱 3종): `docs/` — 저장소에 올리지 않는 로컬 자료입니다(실명이 든 화면 캡처 포함). 린트·테스트 대상이 아닙니다

---

## 어디서 왔나 — 차량운행일지 보일러플레이트

[차량운행일지](https://github.com/dreamworker0/vehicle-drive-log)(MIT)의 2026-11-21 master(`fa069be9`)를 통째로 복사한 뒤 차량 업무를 걷어냈습니다. git 이력은 새로 시작했습니다.

| 남긴 것 | 걷어낸 것 |
|---|---|
| 로그인·랜딩·기관 신청(고유번호증 AI 확인)·초대 코드·승인 대기·약관·처리방침·FAQ·업데이트 소식 | 차량·예약·운행일지·주유·하이패스·정비·출발지(분관) |
| 시스템 관리자 기관 승인, 직원 관리, 설정, 접속기록 점검, 기관 해지 | 구글 캘린더·TMAP·Slack 어시스턴트·AI 도움말·계기판 OCR |
| 기관 격리(`organizationId` + Custom Claims + 보안 규칙 + ESLint 규칙), 행위자 스탬프, 접속기록 트리거(직원 정보) | 운행 통계·집계 배치, 공휴일, 보험 만료 알림, 운행기록 아카이브 |
| 디자인 시스템(Tailwind·다크 모드·글꼴 크기), PWA, 오프라인 확인 장부, Sentry, App Check | 차량 관련 PDF·엑셀 양식(PDF 엔진·접속기록 엑셀은 남김) |
| 백업·기관 파기·증빙 정리 배치, 알림톡·이메일(승인·반려) | |

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | Vite + React 19 + TypeScript, TailwindCSS v4, Zustand |
| 백엔드 | Firebase (Auth · Firestore 서울 · Storage · Functions · Hosting · FCM) |
| 모니터링 | 자체 오류 보고(`clientErrors`) + 운영자 경보 메일. Sentry·Discord 코드는 남아 있지만 운영에서는 끔([OPERATIONS.md](OPERATIONS.md)) |
| 테스트 | Vitest(단위), Firestore/Storage 규칙 테스트(에뮬레이터), Jest(Functions), Playwright(E2E) |

**Node 22 필수.** 의존성 설치·변경은 **npm 10**으로 합니다(npm 11이 만든 lockfile은 CI의 `npm ci`를 깹니다).

```powershell
npx.cmd -y npm@10 ci
```

---

## 환경변수

프론트엔드는 `.env`([.env.example](.env.example)), 에뮬레이터 모드는 `.env.emulator`와 `.env.emulator.local`([예시](.env.emulator.local.example) — 가짜 값, 복사해서 씀)을 씁니다. 운영 Firebase 값·비밀값은 관리자만 갖고 있고, 외부 참여자는 에뮬레이터만으로 개발합니다 → [CONTRIBUTING.md](CONTRIBUTING.md). 에뮬레이터 명령에는 항상 `--project demo-asset-survey`를 붙여 운영에 닿지 않게 합니다.

서비스 주소가 정해지지 않았으므로 코드에 도메인을 박지 않습니다.

- 프론트: `VITE_APP_URL`·`VITE_APP_DOMAIN`(비우면 지금 연 주소, Firebase 기본 도메인)
- Functions: `SERVICE_URL`(비우면 `https://<프로젝트 ID>.web.app`) → [serviceUrl.ts](functions/src/utils/serviceUrl.ts)

Cloud Functions의 `functions/.env` 예시:

```env
GMAIL_USER=...
ALIMTALK_PROXY_URL=...
ADMIN_NOTIFICATION_EMAIL=...
SENTRY_DSN_FUNCTIONS=...     # 없으면 Functions 예외가 Sentry로 가지 않음
DISCORD_WEBHOOK_URL=...      # 선택 (운영 알림)
FIRESTORE_BACKUP_BUCKET=     # 선택. 비우면 {projectId}-backups (기본 버킷은 리전이 달라 못 씀)
SERVICE_URL=                 # 선택. 이메일·알림톡 링크 주소
ALLOW_TEST_WHITELIST=        # 운영에서는 비워 둔다
SENTRY_RELEASE=              # 비워 둔다. 배포 워크플로가 배포 커밋 SHA로 채운다
```

> 이 목록은 `npm run check:functions-env`가 코드(`defineString`/`process.env`)와 대조합니다.

크리덴셜은 **Secret Manager**로 관리합니다([params.ts](functions/src/core/params.ts)).

```bash
firebase functions:secrets:set GEMINI_API_KEY          # 증빙서류 OCR
firebase functions:secrets:set GMAIL_APP_PASSWORD      # 승인/반려·자동 검증 메일(Gmail SMTP)
firebase functions:secrets:set ALIMTALK_PROXY_TOKEN    # 카카오 알림톡 프록시
```

> ⚠️ 알림톡 템플릿은 차량운행일지용으로 등록된 것이라 그대로 쓰면 안 됩니다. 재물조사용 템플릿을 새로 등록하기 전까지 알림톡은 끈 채로 둡니다.

---

## npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 (localhost:5173) |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint (프론트 + Functions) |
| `npm run type-check` / `type-check:functions` | 타입 검사 |
| `npm test` | Vitest 단위 테스트 |
| `npm run test:functions` | Functions 단위 테스트(Jest) |
| `npm run test:rules:all` | Firestore·Storage 규칙 테스트 (에뮬레이터, Java 필요) |
| `npm run test:e2e` | Playwright E2E |
| `npm run verify:fast` | 린트 + 타입 + 환경변수·함수 목록 검사 |

---

## 라이선스

[MIT](LICENSE) — 차량운행일지(© 2026 소셜프리즘)의 코드를 바탕으로 합니다.
