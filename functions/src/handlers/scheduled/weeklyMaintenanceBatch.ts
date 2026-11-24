/**
 * weeklyMaintenanceBatch — 매주 일요일 03:00(KST) 유지보수 배치
 *
 * 1. purgeOrgs: soft-deleted 기관 30일 경과 시 기관 데이터 전체 파기(purgeOrganizationData)
 * 2. cleanupImages: 승인·반려 후 30일 경과 기관의 증빙 이미지 삭제
 * 3. cleanupOrphanAuth: 기관에 소속되지 않은 채 90일 넘게 쓰이지 않은 로그인 계정 정리
 *    (기본은 보고만 — `system/authCleanup.deleteEnabled`를 켜야 지운다, cleanupOrphanAuthAccounts 주석)
 *
 * ## 왜 주 1회인가
 * 판정 기준이 **30일·90일**이다. 매일 돌려도 어제와 오늘의 대상이 사실상 같고,
 * 하루 늦게 처리해도 규정·용량 어느 쪽에도 영향이 없다. 매일 도는 동안에는 대상이 없는
 * 날에도 기관 전수 쿼리와 GCS 존재 확인이 그대로 나갔다.
 *
 * `retryCount: 0` — 셋 다 멱등하지만(대상이 남아 있으면 다음 주에 다시 처리) 삭제를 포함하므로
 * 자동 재실행으로 이득을 볼 구간이 없다. (rules/cloud-functions.md §3.1)
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { purgeOrgs, cleanupImages } from "./dailyNightlyBatch";
import { runStep, logBatchResult } from "../../utils/batchStep";
import { GMAIL_APP_PASSWORD } from "../../core/params";
import { cleanupOrphanAuthAccounts } from "../../services/account/cleanupOrphanAuthAccounts";

const CONTEXT = "weeklyMaintenanceBatch";

export const weeklyMaintenanceBatch = onSchedule(
    {
        schedule: "0 3 * * 0", // KST 일요일 03:00 (야간 배치들과 시간대를 겹치지 않게 둔다)
        timeZone: "Asia/Seoul",
        retryCount: 0,
        // 실패·기관 파기 실패를 운영자에게 메일로 보낸다(utils/batchStep의 logBatchResult)
        secrets: [GMAIL_APP_PASSWORD],
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async function () {
        const db = getFirestore();
        const bucket = getStorage().bucket();

        const failed: string[] = [];

        await runStep(failed, CONTEXT, "purgeOrgs", () => purgeOrgs(db, bucket));
        await runStep(failed, CONTEXT, "cleanupImages", () => cleanupImages(db, bucket));
        // 기관 파기(purgeOrgs) 뒤에 둔다 — 같은 주에 파기된 기관의 직원은 90일이 지나야 대상이 된다
        await runStep(failed, CONTEXT, "cleanupOrphanAuth", () => cleanupOrphanAuthAccounts({ auth: getAuth(), db, bucket }));

        await logBatchResult(CONTEXT, failed);
    }
);
