/**
 * Cloud Functions 진입점 — 여기서 export한 함수만 배포된다.
 *
 * 차량운행일지(보일러플레이트)에서 기관 가입·승인, 직원·권한, 접속기록, 공지·의견,
 * 백업·정리 배치만 가져왔다. 재물조사 업무 함수는 이 아래에 이어 붙인다.
 */
import "./core/firebase";

// ── 기관 신청·증빙서류 확인 ──
// 고유번호증/사업자등록증 OCR (Gemini) — 신청 화면의 사전 확인
export { ocrDocument } from "./handlers/callable/ocrDocument";
// 신청 접수(비인증 콜러블) → 서류 자동 검증 → 승인·반려 알림
export { submitOrgApplication } from "./handlers/https/submitOrgApplication";
export { autoVerifyDocument } from "./handlers/triggers/autoVerifyDocument";
export { notifyNewApplication } from "./handlers/triggers/notifyNewApplication";
// 증빙서류 단기 서명 URL (superAdmin 전용)
export { getOrgDocumentUrl } from "./handlers/callable/getOrgDocumentUrl";
// 승인·반려 이메일과 알림톡 (superAdmin이 수동으로 다시 보낼 때)
export { sendApprovalEmail } from "./handlers/callable/sendApprovalEmail";
export { sendRejectionEmail } from "./handlers/callable/sendRejectionEmail";
export { sendManualApprovalAlimtalk } from "./handlers/callable/sendManualApprovalAlimtalk";
export { sendManualRejectionAlimtalk } from "./handlers/callable/sendManualRejectionAlimtalk";

// ── 기관 합류·초대 코드·약관 ──
export { joinOrganization } from "./handlers/callable/joinOrganization";
export { regenerateInviteCode } from "./handlers/callable/regenerateInviteCode";
export { sendInviteEmails } from "./handlers/callable/sendInviteEmails";
export { reportClientError } from "./handlers/callable/reportClientError";
export { acceptCurrentTerms } from "./handlers/callable/acceptCurrentTerms";
export { trackFirstEmployee } from "./handlers/triggers/trackFirstEmployee";

// ── 직원 계정 관리 ──
// 역할 변경 시 Custom Claims(orgId·role) 동기화 — 보안 규칙이 이 클레임으로 기관을 가른다
export { setCustomClaims } from "./handlers/triggers/setCustomClaims";
export { disableUser } from "./handlers/callable/disableUser";
export { enableUser } from "./handlers/callable/enableUser";
export { restoreUser } from "./handlers/callable/restoreUser";
// 비활성 직원 완전 삭제 (users 문서 + Auth 계정)
export { deleteUserPermanently } from "./handlers/callable/deleteUserPermanently";
// Auth 계정 삭제 시 users 문서 익명화
export { onUserDelete } from "./handlers/triggers/onUserDelete";
// superAdmin 승격 경보
export { notifyRoleChange } from "./handlers/triggers/notifyRoleChange";

// ── 기관 해지·파기 ──
export { withdrawOrganization } from "./handlers/callable/withdrawOrganization";
export { purgeOrganization } from "./handlers/callable/purgeOrganization";

// ── 접속기록 (개인정보 안전성 확보조치 기준 제16조) ──
export { recordSession } from "./handlers/callable/recordSession";
export { recordExport } from "./handlers/callable/recordExport";
export { refreshDashboardStats } from "./handlers/callable/refreshDashboardStats";
export {
    auditUserCreated, auditUserUpdated, auditUserDeleted,
} from "./handlers/triggers/auditLog";

// ── 도움말 ──
// AI에게 묻기 (Gemini) — FAQ·직원 안내만 근거로 답한다
export { askAI } from "./handlers/callable/askAI";

// ── 공지·의견 ──
export { sendAdminNotice } from "./handlers/callable/sendAdminNotice";
export { sendBroadcastNotice } from "./handlers/callable/sendBroadcastNotice";
export { notifyNewFeedback } from "./handlers/triggers/notifyNewFeedback";
export { sendFeedbackReply } from "./handlers/callable/sendFeedbackReply";
export { submitPublicFeedback } from "./handlers/https/submitPublicFeedback";

// ── 배치 ──
// 야간: Firestore 백업 + 어제 백업 확인 (매일 02:20)
export { dailyNightlyBatch } from "./handlers/scheduled/dailyNightlyBatch";
// 주간: 해지 기관 파기 + 증빙 이미지 정리 + 고아 로그인 계정 정리 (매주 일 03:00)
export { weeklyMaintenanceBatch } from "./handlers/scheduled/weeklyMaintenanceBatch";
