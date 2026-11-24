/**
 * params — Cloud Functions 시크릿 파라미터 중앙 정의
 *
 * 실제 크리덴셜(외부 서비스 인증 정보)은 defineString/.env 평문이 아닌
 * Google Secret Manager(defineSecret)로 관리한다 (2026-07-11 평가 지적 대응).
 *
 * 배포 전제: 각 시크릿이 미리 등록되어 있어야 배포가 성공한다.
 *   firebase functions:secrets:set <NAME>
 * 그리고 functions/.env에서 동일 키를 제거해야 한다 (이름 충돌 시 배포 거부).
 *
 * 사용 규칙: 이 시크릿을 (간접적으로라도) 읽는 함수는 정의 옵션에
 * `secrets: [...]`를 선언해야 런타임 환경변수(process.env)로 주입된다.
 */
import { defineSecret } from "firebase-functions/params";

/**
 * Gemini API 키 — core/gemini를 (간접적으로라도) 쓰는 함수 전부:
 * ocrDocument·autoVerifyDocument·submitOrgApplication(documentScreen 프리스크린)·askAI(도움말).
 *
 * 과금 LLM 키라 defineString(functions/.env 평문)이 아니라 시크릿으로 둔다.
 * DISCORD_WEBHOOK_URL은 선택 항목이라 시크릿으로 강제하면 값이 없는 배포가 막혀 .env에 둔다.
 */
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** Gmail SMTP 앱 비밀번호 — core/mailer 사용 함수 전부 */
export const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

// EMAILJS_PRIVATE_KEY는 2026-11-21 뺐다 — 자동 검증 승인 메일도 Gmail(GMAIL_APP_PASSWORD)로 보낸다.

/** 알림톡 Cafe24 프록시 인증 토큰 — services/alimtalk 사용 함수 전부 */
export const ALIMTALK_PROXY_TOKEN = defineSecret("ALIMTALK_PROXY_TOKEN");

