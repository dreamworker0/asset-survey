/**
 * Firestore — 시스템 관리자 운영 현황 통계 (전역 도메인: system/dashboardStats)
 *
 * 기관 단위 컬렉션이 아니라 서비스 전체 집계 문서 1건이라 organizationId 필터가 없다
 * (eslint의 조직 필터 규칙 예외 목록에 이 파일이 있다). 규칙상 superAdmin만 읽을 수 있다.
 */
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions } from '../firebase';
import { captureError } from '../monitoring';
import { dashboardStatsSchema, type DashboardStats } from '../../schemas/dashboard';

/** 집계 문서를 읽는다 — 아직 한 번도 집계하지 않았으면 null */
export const getDashboardStats = async (): Promise<DashboardStats | null> => {
    try {
        const snap = await getDoc(doc(db, 'system', 'dashboardStats'));
        return snap.exists() ? dashboardStatsSchema.parse(snap.data()) : null;
    } catch (error) {
        captureError(error, { context: 'getDashboardStats' });
        throw error;
    }
};

export interface RefreshDashboardResult {
    skipped: boolean;
    lastUpdatedAt?: string;
    retryAfterSec?: number;
}

/** 서버에서 바로 다시 집계한다 — 마지막 갱신 뒤 10분 안이면 건너뛰고 남은 시간을 돌려준다 */
export const refreshDashboardStats = async (): Promise<RefreshDashboardResult> => {
    try {
        const call = httpsCallable<void, RefreshDashboardResult>(
            firebaseFunctions,
            'refreshDashboardStats',
            { timeout: 300_000 },
        );
        return (await call()).data;
    } catch (error) {
        captureError(error, { context: 'refreshDashboardStats' });
        throw error;
    }
};
