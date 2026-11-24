/**
 * Firestore 함수 통합 re-export
 *
 * 모든 Firestore 관련 함수를 컬렉션별 모듈에서 가져와 통합 export합니다.
 * 기존 `import { ... } from '../lib/firestore'` 구문이 그대로 동작합니다.
 */

// 사용자 (Users)
export {
    getUser,
    createUser,
    leaveOrganization,
    updateUser,
    updateUsersTeamBatch,
    getOrganizationMembers,
    getOrganizationAdmins,
    getOrgMemberCounts,
    clearUserOrganization,
    recheckDeniedTarget,
} from './users';

// 사전 등록 직원 (Pre-registered Employees)
export {
    getPreRegisteredEmployees,
    addPreRegisteredEmployee,
    deletePreRegisteredEmployee,
    updatePreRegisteredTeam,
    addPreRegisteredBatch,
    updatePreRegisteredTeamBatch,
    deletePreRegisteredBatch,
    sendInviteEmails,
} from './preRegistered';

// 기관 (Organizations)
export {
    createOrganization,
    getOrganization,
    updateOrganization,
    deleteOrganization,
    permanentDeleteOrganization,
    restoreOrganization,
    getPendingOrganizations,
    getRejectedOrganizations,
    getDeletedOrganizations,
    getApprovedOrganizations,
    approveOrganization,
    approveOrganizationWithAdmins,
    rejectOrganization,
    generateInviteCode,
    findOrganizationByInviteCode,
    regenerateInviteCode,
} from './organizations';

// 알림 (Notifications)
export {
    createNotification,
    getNotifications,
    markNotificationRead,
    subscribeNotifications,
    deleteNotification,
} from './notifications';

// 피드백 (Feedbacks)
export {
    createFeedback,
    getAllFeedbacks,
    updateFeedback,
    deleteFeedback,
} from './feedbacks';

// 슈퍼관리자 관리
export {
    getSuperAdmins,
    getUserByEmail,
    addSuperAdmin,
    removeSuperAdmin,
} from './superAdmin';

// 전체 공지 발송 이력 (Broadcasts) — superAdmin 전용 읽기, 전역 도메인
export {
    getRecentBroadcasts,
} from './broadcasts';

// 앱 오류 기록 (superAdmin 전용)
export { getRecentClientErrors } from './clientErrors';

// 접속기록 (Audit Logs) — 기관 관리자 점검용 읽기 전용
export {
    getAuditLogs,
    getAuditLogsForExport,
    AUDIT_LOG_PAGE_SIZE,
    AUDIT_LOG_EXPORT_MAX,
} from './auditLogs';
export type {
    AuditLogKind, AuditLogPage, AuditLogQueryOptions, AuditLogExportResult,
} from './auditLogs';

// 공간 (Spaces) — 기획서 F03
export {
    getSpaces,
    getMySpaces,
    createSpace,
    updateSpace,
    updateSpacesBatch,
    createSpacesBatch,
    reorderSpaces,
    sortSpaces,
    normalizeSpaceName,
    validateSpaceName,
} from './spaces';
export type { SpaceLocation } from './spaces';

// 팀 (2026-11-22) — 직원 소속 팀, 공간 담당 팀
export { getTeams, createTeam, updateTeam, sortTeams, validateTeamName, normalizeTeamName } from './teams';

// 재물 사진 (2026-11-22)
export { uploadAssetPhoto, removeAssetPhoto, PHOTO_SOURCE_MAX_BYTES } from './assetPhotos';
export type { AssetPhotoFields } from './assetPhotos';

// 조사 현장 사진 (2026-11-22)
export { uploadScanPhoto, removeScanPhoto } from './scanPhotos';

// 재물 직접 등록·수정 (2026-11-22)
export {
    createAssetManually, updateAssetManually, nextAssetCode, AssetCodeTakenError, moveAssetsToSpace, MANUAL_EDIT_FIELDS,
} from './assets';
export type { ManualAssetFields } from './assets';

// 재물 마지막 확인 (상시 확인 기록) — QR로 열거나 조사에서 찍을 때 남긴다
export { recordAssetCheck, getAssetCheck, getAssetChecks, clearAssetCheckSnapshots } from './assetChecks';
export type { RecordAssetCheckInput } from './assetChecks';

// 건물 (Buildings) — 공간을 묶는 위 단계(건물 → 층 → 공간)
export {
    getBuildings,
    createBuilding,
    updateBuilding,
    reorderBuildings,
    sortBuildings,
    normalizeBuildingText,
    validateBuildingName,
    validateBuildingAddress,
    parseFloors,
    floorsFromRange,
    validateFloors,
    floorLabel,
} from './buildings';
export type { BuildingInput } from './buildings';

// 재물 (Assets) — 기획서 F04~F09
export {
    getAssets,
    getAsset,
    getAssetAccounting,
    getAssetHistory,
    getAssetsBySpaces,
    findAssetByTag,
    findAssetByCode,
    issueTags,
    getAccountingMap,
    getAssetCounts,
    getRecentImports,
    commitImport,
    newImportId,
    importRecordExists,
} from './assets';
export type { CommitImportInput } from './assets';

// 조사 회차·대상·스캔 — 기획서 F10~F12
export {
    getSurveys,
    getSurvey,
    getOpenSurvey,
    getSurveyTargets,
    groupTargets,
    startSurvey,
    peekScan,
    saveScan,
    updateScanCondition,
    deleteScan,
    getScans,
    subscribeSpaceScans,
    subscribeSurveyScans,
    submissionId,
    subscribeSubmissions,
    subscribeSubmission,
    getSubmissions,
    submitSpace,
    reviewSpace,
    beginClosing,
    cancelClosing,
    closeSurvey,
    getSyncTasks,
    setSyncTaskDone,
    getSurveyEvents,
} from './surveys';
export type { StartSurveyInput, SaveScanInput } from './surveys';
