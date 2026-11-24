#!/usr/bin/env tsx
/**
 * generate-functions-doc.ts
 *
 * Cloud Functions 레퍼런스 마크다운 자동 생성 스크립트
 *
 * 사용법:
 *   npx tsx scripts/generate-functions-doc.ts
 *
 * 출력: docs/FUNCTIONS_REFERENCE.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'FUNCTIONS_REFERENCE.md');

// ── 함수 카탈로그 (수동 관리 — 함수 추가 시 여기에도 추가) ──
// 정합성 확인: functions/src/index.ts의 export 목록과 이 배열의 name이 1:1이어야 한다.
interface FunctionEntry {
  name: string;
  type: 'onCall' | 'onRequest' | 'onSchedule' | 'onDocumentCreated' | 'onDocumentWritten' | 'onDocumentUpdated' | 'onDocumentDeleted' | 'onUserDeleted';
  file: string;
  description: string;
  auth: string;
  params?: string;
  returns?: string;
  note?: string;
}

const FUNCTIONS: FunctionEntry[] = [
  // ── OCR ──
  {
    name: 'ocrDocument',
    type: 'onCall',
    file: 'handlers/callable/ocrDocument.ts',
    description: '사업자등록증/고유번호증 이미지를 OCR하여 기관명, 사업자번호, 주소 추출',
    auth: '인증 필수',
    params: '{ imageBase64: string, mimeType: string }',
    returns: '{ orgName: string, bizNumber: string, address: string }',
  },
  {
    name: 'askAI',
    type: 'onCall',
    file: 'handlers/callable/askAI.ts',
    description: '앱 안 도움말의 "AI에게 묻기". FAQ 본문(shared/faqData.ts)과 직원용 첫 사용 안내만 근거로 Gemini가 2~4문장으로 답한다. 근거 글에 없으면 "도움말에 없다 — 재물 담당자에게 물어보라"로 답한다. 규칙·근거 글은 systemInstruction, 질문은 본문으로 나눈다. 질문은 300자까지, 분당 5회·하루 20회(사용자당, 둘 다 fail-closed). 질문 글은 로그·Sentry에 남기지 않는다.',
    auth: '인증 필수 + 기관 소속(토큰 `orgId`), App Check',
    params: '{ question: string }',
    returns: '{ answer: string }',
  },
  {
    name: 'getOrgDocumentUrl',
    type: 'onCall',
    file: 'handlers/callable/getOrgDocumentUrl.ts',
    description: '기관 증빙서류의 5분 만료 서명 URL 발급 (심사 화면 표시용). 증빙서류는 영구 다운로드 토큰 없이 경로만 저장되므로 표시 시점마다 온디맨드 발급한다.',
    auth: 'superAdmin 전용',
    params: '{ orgId: string }',
    returns: '{ url: string }',
  },

  // ── 사용자·기관 ──
  {
    name: 'joinOrganization',
    type: 'onCall',
    file: 'handlers/callable/joinOrganization.ts',
    description: '초대 코드로 기관에 가입. 신규 사용자가 Custom Claims 미보유 시에도 정상 처리. 이용약관 동의를 함께 기록한다(개인정보 동의는 받지 않음 — 처리 근거가 기관의 업무 수행이므로). `termsVersion`은 `YYYY-MM-DD` 형식.',
    auth: '인증 필수 (익명 로그인 차단)',
    params: '{ code: string, agreedTerms: true, termsVersion: string }',
    // 표 셀 안의 파이프는 백틱으로 감싸도 셀이 쪼개지므로 이스케이프한다.
    returns: "{ success: boolean, orgId: string, orgName: string, role: 'admin' \\| 'employee' }",
  },
  {
    name: 'regenerateInviteCode',
    type: 'onCall',
    file: 'handlers/callable/regenerateInviteCode.ts',
    description: '기관 초대 코드 재발급. Rules가 기관관리자의 `inviteCode` 쓰기를 막으므로(타 기관 코드를 복사해 신규 직원을 가로채는 경로 차단) 서버 난수 + 전체 기관 중복 검사로만 발급한다. 승인된 기관만 대상. 부를 때마다 새 코드가 나오는 비멱등 호출이라 클라이언트는 재시도하지 않는다.',
    auth: '해당 기관 관리자(클레임 `role=admin` + `orgId` 일치) 또는 superAdmin',
    params: '{ organizationId: string }',
    returns: '{ inviteCode: string }',
  },
  {
    name: 'sendInviteEmails',
    type: 'onCall',
    file: 'handlers/callable/sendInviteEmails.ts',
    description: '가입 대기(사전 등록) 직원에게 초대 메일(가입 링크·"이 주소의 구글 계정으로 로그인" 안내)을 Gmail로 보낸다. 받는 주소는 요청이 아니라 사전 등록 문서에서 읽어 임의 주소로 시스템 메일을 보내지 못하게 한다. 승인된 기관·초대 코드가 있을 때만, 한 번에 100명까지. 10분 안에 보낸 사람은 건너뛰고, 보낸 사람 문서에 `invitedAt`·`inviteCount`를 남긴다.',
    auth: '해당 기관 관리자(클레임 `role=admin` + `orgId` 일치) 또는 superAdmin',
    params: '{ organizationId: string; preRegIds: string[] }',
    returns: '{ sent: number; skipped: number; failed: number }',
  },
  {
    name: 'reportClientError',
    type: 'onCall',
    file: 'handlers/callable/reportClientError.ts',
    description: '앱 화면에서 난 오류 요약(이름·문구·기능·코드·스택 앞부분·화면 경로·버전)을 받아 같은 오류끼리 `clientErrors/{묶음 열쇠}`에 횟수·처음/마지막 시각·브라우저 종류·겪은 기관과 함께 센다. Sentry 없이 운영 관측을 맡는다. 이메일·전화번호·긴 ID는 지우고 uid는 받지 않으며, 기관은 로그인 토큰에서만 읽는다. 30일 TTL(expiresAt). 로그인 전 오류도 받도록 인증·App Check를 요구하지 않고 IP당 시간당 60회·전역 시간당 600회로 막는다. 한도 초과·저장 실패도 오류를 던지지 않는다.',
    auth: '없음(로그인 전 화면 포함) — IP·전역 상한',
    params: '{ name?, message, where?, code?, stack?, path?, version? }',
    returns: '{ ok: boolean }',
  },
  {
    name: 'acceptCurrentTerms',
    type: 'onCall',
    file: 'handlers/callable/acceptCurrentTerms.ts',
    description: '개정 약관·처리방침 재동의 기록. 동의 기록은 Rules가 클라이언트 쓰기를 차단하므로 이 함수만 기록한다. 기관 관리자는 기관 위탁 동의(`organizations.consent`)와 본인 약관 동의(`users.consent`)를 함께, 직원은 본인 약관 동의만 기록. 관리자는 `agreedPrivacy`·`privacyVersion`이 필수.',
    auth: '인증 필수',
    params: '{ agreedTerms: true, termsVersion: string, agreedPrivacy?: true, privacyVersion?: string }',
    returns: '{ success: boolean, orgRecorded: boolean }',
  },
  {
    name: 'recordSession',
    type: 'onCall',
    file: 'handlers/callable/recordSession.ts',
    description: '로그인 세션 기록 — 고시 제16조의 접속지(IP)·계정·일시를 남긴다. 트리거는 IP를 볼 수 없어 콜러블로 받는다. `sessionId`는 브라우저 세션당 난수 1개이며 문서 ID에 쓰여 같은 세션의 재호출이 중복을 만들지 않는다. User-Agent는 브라우저/OS 수준으로 축약해 저장한다.',
    auth: '인증 필수',
    params: '{ sessionId: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'recordExport',
    type: 'onCall',
    file: 'handlers/callable/recordExport.ts',
    description: '개인정보 반출(엑셀·PDF 내보내기) 기록 — 고시 제16조. 형식·대상·건수만 남기고 **반출된 데이터 내용과 검색 조건은 담지 않는다**. `format`·`dataset`은 화이트리스트로 제한해 임의 값 주입을 막는다. 브라우저에서 파일을 만들므로 클라이언트가 부르지 않으면 남지 않는 한계가 있다.',
    auth: '인증 필수',
    // 표 셀 안의 파이프는 백틱으로 감싸도 셀이 쪼개지므로 이스케이프한다.
    params: "{ format: 'excel' \\| 'pdf', dataset: string, recordCount: number, exportId: string }",
    returns: '{ success: boolean }',
  },
  {
    name: 'refreshDashboardStats',
    type: 'onCall',
    file: 'handlers/callable/refreshDashboardStats.ts',
    description: '시스템 관리자 운영 현황 대시보드 통계를 바로 다시 집계해 `system/dashboardStats`에 저장한다(평소엔 밤 배치가 매일 갱신). 전 기관을 훑으므로 마지막 갱신 뒤 10분 안의 재요청은 재집계를 건너뛰고 `skipped: true`와 남은 시간을 돌려준다.',
    auth: '시스템 관리자(superAdmin) 전용',
    params: '없음',
    returns: '{ skipped: boolean, lastUpdatedAt: string, retryAfterSec?: number }',
  },
  {
    name: 'sendBroadcastNotice',
    type: 'onCall',
    file: 'handlers/callable/sendBroadcastNotice.ts',
    description: "전체 기관의 관리자·직원에게 앱 내 알림 + 푸시를 일괄 발송. `sendAdminNotice`가 자기 기관 한정이라 서비스 전역 고지(약관 개정 등) 경로가 없어 신설. `dryRun: true`면 **대상 수만 반환하고 아무것도 보내지 않는다** — 화면이 이 값을 확인시킨 뒤에만 실제 발송한다. `noticeId`로 문서 ID를 고정해 재클릭·재시도가 알림을 중복 생성하지 않는다. 비활성 계정과 기관 미소속 계정은 제외. 발송 사실은 `broadcasts/{noticeId}`에 남긴다 — 앱 내 알림 커밋 직후 `sending`으로 먼저 쓰고 푸시 결과를 `sent`로 덧쓴다(중간에 죽으면 `sending`으로 남아 「알림은 나갔고 푸시 결과만 모른다」를 뜻한다).",
    auth: '시스템 관리자(superAdmin) 전용',
    params: '{ title: string, message: string, noticeId: string, dryRun?: boolean }',
    returns: '{ success: boolean, dryRun: boolean, recipientCount: number, pushSent?: number, pushFailed?: number }',
  },
  {
    name: 'disableUser',
    type: 'onCall',
    file: 'handlers/callable/disableUser.ts',
    description: 'Firebase Auth 비활성화 + Firestore 사용자 문서 삭제 (직원 제거)',
    auth: '기관 관리자 이상 (admin/superAdmin)',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'enableUser',
    type: 'onCall',
    file: 'handlers/callable/enableUser.ts',
    description: '비활성 직원을 다시 활성화. Auth 계정 차단(disabled)을 먼저 풀고 users 문서를 status: active·disabledAt: null로 되돌린다(disableUser의 짝). Auth 계정이 없으면 문서만 복구한다. 과거 클라이언트 재활성화가 문서만 고쳐 로그인이 막히던 문제(2026-11-18)로 서버로 옮겼다.',
    auth: '기관 관리자 이상 (같은 기관, superAdmin 대상 불가)',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'restoreUser',
    type: 'onCall',
    file: 'handlers/callable/restoreUser.ts',
    description: '비활성화된 계정을 Auth 재활성화 + Firestore 문서 복원',
    auth: '기관 관리자 이상',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'deleteUserPermanently',
    type: 'onCall',
    file: 'handlers/callable/deleteUserPermanently.ts',
    description: '비활성(disabled) 직원의 users 문서 + 개인 부속 데이터 + Auth 계정을 영구 삭제.',
    auth: '기관 관리자 (같은 기관, disabled 상태 직원만)',
    params: '{ uid: string }',
  },
  {
    name: 'withdrawOrganization',
    type: 'onCall',
    file: 'handlers/callable/withdrawOrganization.ts',
    description: '기관 자발적 서비스 해지. 소속 직원 user 문서를 일괄 삭제하고 기관을 soft delete(30일 복구 가능) 처리하며 해지 사유를 기록한다.',
    auth: '기관 관리자 (자기 기관만)',
    params: '{ organizationId: string, reason: string, reasonDetail?: string }',
  },
  {
    name: 'purgeOrganization',
    type: 'onCall',
    file: 'handlers/callable/purgeOrganization.ts',
    description: '해지된(status: deleted) 기관을 즉시 파기한다 — 슈퍼관리자 [영구 삭제]. 주간 배치 purgeOrgs와 같은 purgeOrganizationData로 운행일지·예약·차량·주유·정비·하이패스·알림·연동·통계·증빙 이미지를 지우고 기관 문서를 마지막에 지운다. 감사 기록(auditLogs)은 1년 보관 요건이라 남긴다.',
    auth: 'superAdmin',
    params: '{ orgId: string }',
    returns: '{ success: true, deleted: Record<string, number> }',
    note: '기관 문서를 마지막에 지우므로 타임아웃 시 재호출하면 이어서 지운다(멱등)',
  },

  // ── 알림·이메일 ──
  {
    name: 'sendAdminNotice',
    type: 'onCall',
    file: 'handlers/callable/sendAdminNotice.ts',
    description: '관리자가 기관 전체 직원에게 알림을 발송',
    auth: '기관 관리자 이상',
    params: '{ organizationId: string, title: string, message: string }',
  },
  {
    name: 'sendApprovalEmail',
    type: 'onCall',
    file: 'handlers/callable/sendApprovalEmail.ts',
    description: '기관 승인 이메일 서버사이드 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendRejectionEmail',
    type: 'onCall',
    file: 'handlers/callable/sendRejectionEmail.ts',
    description: '기관 거절 이메일 서버사이드 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendManualApprovalAlimtalk',
    type: 'onCall',
    file: 'handlers/callable/sendManualApprovalAlimtalk.ts',
    description: '수동 승인 시 신청자에게 카카오 알림톡 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendManualRejectionAlimtalk',
    type: 'onCall',
    file: 'handlers/callable/sendManualRejectionAlimtalk.ts',
    description: '기관 신청 반려 시 신청자에게 카카오 알림톡 발송 (반려 이메일과 병행 호출)',
    auth: 'superAdmin',
    params: '{ orgId: string, reason?: string }',
  },

  // ── 피드백·AI ──
  {
    name: 'sendFeedbackReply',
    type: 'onCall',
    file: 'handlers/callable/sendFeedbackReply.ts',
    description: '슈퍼관리자가 피드백 답변 발송. 이메일 또는 알림톡으로 사용자에게 전달.',
    auth: 'superAdmin',
    params: '{ feedbackId: string, reply: string }',
  },

  // ── 통계·정리 ──

  // ── 공개(비로그인) 엔드포인트 ──
  {
    name: 'submitOrgApplication',
    type: 'onCall',
    file: 'handlers/https/submitOrgApplication.ts',
    description: '익명(비로그인) 사용자가 기관 신청서를 제출하는 엔드포인트. 저장 전에 증빙서류를 판별해(프리스크린) 비영리 증빙이 아니면 접수하지 않는다',
    auth: '없음 (공개 — App Check 보호)',
  },
  {
    name: 'submitPublicFeedback',
    type: 'onCall',
    file: 'handlers/https/submitPublicFeedback.ts',
    description: '랜딩 페이지 비로그인 방문자 문의 접수',
    auth: '없음 (공개 — App Check 보호)',
  },

  // ── 일회성 마이그레이션 ──

  // ── Slack 연동 (멀티테넌트 셀프서비스) ──

  // ── 프록시 (onRequest) ──

  // ── Slack 수신 엔드포인트 (onRequest) ──

  // ── 스케줄러 ──
  {
    name: 'dailyNightlyBatch',
    type: 'onSchedule',
    file: 'handlers/scheduled/dailyNightlyBatch.ts',
    description: '야간 배치: Firestore 백업(GCS export) → 어제 백업 완료 확인 → 시스템 관리자 운영 현황 통계 집계(system/dashboardStats)',
    auth: '시스템 자동 실행',
    note: 'schedule: "20 2 * * *" (KST 02:20). 2026-08-28 Cloud Run 비용 점검에서 일곱 스텝 통합 배치를 집계·백업·주간 유지보수 셋으로 분리(1GiB→512MiB, 재시도 범위 축소)',
  },
  {
    name: 'weeklyMaintenanceBatch',
    type: 'onSchedule',
    file: 'handlers/scheduled/weeklyMaintenanceBatch.ts',
    description: '주간 유지보수: soft-delete 기관 30일 후 기관 데이터 전체 파기(purgeOrganizationData) → 증빙 이미지 정리 → 소속 없이 90일 넘게 쓰이지 않은 로그인 계정 정리(기본 보고만, system/authCleanup.deleteEnabled로 켬)',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 3 * * 0" (KST 일요일 03:00). 판정 기준이 30일·3년이라 매일 돌 이유가 없어 주 1회로 옮긴 것',
  },

  // ── Firestore 트리거 (onCreate) ──
  {
    name: 'trackFirstEmployee',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/trackFirstEmployee.ts',
    description: '기관 첫 번째 직원 등록 시점을 Firestore에 기록',
    auth: '시스템 자동 실행',
    note: 'users/{uid}',
  },
  {
    name: 'notifyNewFeedback',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/notifyNewFeedback.ts',
    description: 'feedbacks/{feedbackId} 생성 시 운영 채널(Discord)에 알림. 작성자별·전역 일일 상한(fail-closed)',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'auditUserCreated',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/auditLog.ts',
    description: '사용자 문서 생성 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
    note: 'users/{userId}',
  },

  // ── Firestore 트리거 (onWrite) ──
  {
    name: 'autoVerifyDocument',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/autoVerifyDocument.ts',
    description: 'organizations/{orgId} 문서에 증빙서류(uniqueNumberImagePath, 레거시 uniqueNumberImageUrl)가 추가되면 Gemini OCR + 비영리 판별 → 자동 승인/거절 처리 및 이메일 발송',
    auth: '시스템 자동 실행 (Firestore 트리거)',
    note: '화이트리스트 기관은 즉시 승인. 종교/학교/병원/영리 사업자는 자동 거절.',
  },
  {
    name: 'setCustomClaims',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/setCustomClaims.ts',
    description: 'users/{uid} 문서 변경 시 Firebase Auth Custom Claims (role, orgId) 자동 동기화',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'notifyNewApplication',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/notifyNewApplication.ts',
    description: '기관 신청(pending)/승인(approved)/거절(rejected) 상태 변화 시 이메일 및 Discord 알림 발송',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'notifyRoleChange',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/notifyRoleChange.ts',
    description: '사용자 권한(role) 변경 감지 시 Discord 보안 알림 발송',
    auth: '시스템 자동 실행',
    note: 'users/{uid}',
  },

  // ── Firestore 트리거 (onUpdate) ──
  {
    name: 'auditUserUpdated',
    type: 'onDocumentUpdated',
    file: 'handlers/triggers/auditLog.ts',
    description: '사용자 개인정보 변경 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
  },

  // ── Firestore 트리거 (onDelete) ──
  {
    name: 'auditUserDeleted',
    type: 'onDocumentDeleted',
    file: 'handlers/triggers/auditLog.ts',
    description: '사용자 문서 삭제 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
  },

  // ── Auth 트리거 ──
  {
    name: 'onUserDelete',
    type: 'onUserDeleted',
    file: 'handlers/triggers/onUserDelete.ts',
    description: 'Firebase Auth 계정 삭제 시 Firestore 개인정보 익명화 처리',
    auth: '시스템 자동 실행 (Auth 트리거)',
  },
];

// ── 타입별 이모지 ──
const TYPE_EMOJI: Record<string, string> = {
  onCall: '📞',
  onRequest: '🌐',
  onSchedule: '⏰',
  onDocumentCreated: '📝',
  onDocumentWritten: '✏️',
  onDocumentUpdated: '🔄',
  onDocumentDeleted: '🗑️',
  onUserDeleted: '👤',
};

const TYPE_LABEL: Record<string, string> = {
  onCall: 'onCall (클라이언트 직접 호출)',
  onRequest: 'onRequest (HTTP 요청)',
  onSchedule: 'onSchedule (스케줄)',
  onDocumentCreated: 'Firestore onCreate',
  onDocumentWritten: 'Firestore onWrite',
  onDocumentUpdated: 'Firestore onUpdate',
  onDocumentDeleted: 'Firestore onDelete',
  onUserDeleted: 'Auth 트리거',
};

// ── 마크다운 생성 ──
function generateMarkdown(functions: FunctionEntry[]): string {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const grouped: Record<string, FunctionEntry[]> = {};
  for (const fn of functions) {
    if (!grouped[fn.type]) grouped[fn.type] = [];
    grouped[fn.type].push(fn);
  }

  const typeOrder = [
    'onCall',
    'onRequest',
    'onSchedule',
    'onDocumentCreated',
    'onDocumentWritten',
    'onDocumentUpdated',
    'onDocumentDeleted',
    'onUserDeleted',
  ];

  let md = `# Cloud Functions 레퍼런스

> **자동 생성 문서** — \`scripts/generate-functions-doc.ts\`로 생성됨
>
> 마지막 업데이트: ${now}
>
> 총 함수 수: **${functions.length}개**

---

## 목차

`;

  for (const type of typeOrder) {
    if (!grouped[type]) continue;
    const emoji = TYPE_EMOJI[type] || '';
    const label = TYPE_LABEL[type] || type;
    md += `- [${emoji} ${label}](#${type.toLowerCase().replace(/\s/g, '-')})\n`;
  }

  md += '\n---\n';

  for (const type of typeOrder) {
    if (!grouped[type]) continue;
    const emoji = TYPE_EMOJI[type] || '';
    const label = TYPE_LABEL[type] || type;
    const fns = grouped[type];

    md += `\n## ${emoji} ${label}\n\n`;
    md += `> 총 ${fns.length}개\n\n`;

    for (const fn of fns) {
      md += `### \`${fn.name}\`\n\n`;
      md += `| 항목 | 내용 |\n|------|------|\n`;
      md += `| **파일** | \`functions/src/${fn.file}\` |\n`;
      md += `| **설명** | ${fn.description} |\n`;
      md += `| **인증** | ${fn.auth} |\n`;
      if (fn.params) md += `| **요청 파라미터** | \`${fn.params}\` |\n`;
      if (fn.returns) md += `| **반환값** | \`${fn.returns}\` |\n`;
      if (fn.note) md += `| **비고** | ${fn.note} |\n`;
      md += '\n';
    }

    md += '---\n';
  }

  md += `\n## 업데이트 방법\n\n`;
  md += `새 함수를 추가하거나 변경했을 때:\n\n`;
  md += `\`\`\`bash\nnpx tsx scripts/generate-functions-doc.ts\n\`\`\`\n\n`;
  md += `\`scripts/generate-functions-doc.ts\`의 \`FUNCTIONS\` 배열에 항목을 추가(또는 수정)한 뒤 위 명령을 실행한다. `;
  md += `배열의 \`name\`은 \`functions/src/index.ts\`의 export 목록과 1:1로 일치해야 한다.\n`;

  return md;
}

// ── 실행 ──
const markdown = generateMarkdown(FUNCTIONS);

// docs/ 디렉터리 없으면 생성
const docsDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, markdown, 'utf-8');
console.log(`✅ 문서 생성 완료: ${OUTPUT_PATH}`);
console.log(`   총 함수: ${FUNCTIONS.length}개`);
