/**
 * AdminDashboard — 기관 관리자(재물 담당자) 첫 화면
 *
 * 지금은 기관 정보와 재물·공간·직원 수만 보여 준다.
 * 조사 진행률·공간별 현황은 기획서 F14 현황판에서 채운다.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { auth } from '../../lib/firebase';
import { refreshTokenSilently } from '../../lib/tokenRefresh';
import { getOrganizationMembers, getOrganization, getSpaces, getAssetCounts } from '../../lib/firestore';
import ReleaseNotesBanner from '../common/ReleaseNotesBanner';
import type { Organization } from '../../types/organization';

export default function AdminDashboard() {
    const { userData } = useAuth();
    const [employeeCount, setEmployeeCount] = useState(0);
    const [spaceCount, setSpaceCount] = useState(0);
    const [assetCounts, setAssetCounts] = useState({ active: 0, inactive: 0, disposed: 0 });
    const [org, setOrg] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);
    // 불러오기 실패 — 예전엔 콘솔에만 남고 화면엔 0건이 떠 "재물이 없다"로 오해했다(2026-11-22 점검)
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        // 기관이 없으면 읽을 것이 없다 — 로딩 표시만 끝없이 돌지 않게 끝낸다
        if (!userData?.organizationId) { setLoading(false); return; }
        const orgId = userData.organizationId;
        setLoading(true);
        setLoadError(false);

        const load = async (retryCount = 0): Promise<void> => {
            try {
                const [members, organization, spaces, counts] = await Promise.all([
                    getOrganizationMembers(orgId),
                    getOrganization(orgId),
                    getSpaces(orgId),
                    getAssetCounts(orgId),
                ]);
                setAssetCounts(counts);
                setSpaceCount(spaces.filter(s => !s.archived).length);
                setEmployeeCount(members.filter(m => m.role !== 'superAdmin').length);
                setOrg((organization as Organization) ?? null);
            } catch (err) {
                // Custom Claims 토큰이 아직 갱신되지 않은 경우 재시도 (최대 2회)
                const firebaseErr = err as { code?: string; message?: string };
                const isPermError = firebaseErr.code === 'permission-denied'
                    || firebaseErr.message?.includes('Missing or insufficient permissions');
                if (isPermError && retryCount < 2) {
                    const delayMs = 1500 * Math.pow(2, retryCount);
                    try { if (auth.currentUser) await refreshTokenSilently(auth.currentUser); } catch { /* noop */ }
                    await new Promise(r => setTimeout(r, delayMs));
                    return load(retryCount + 1);
                }
                console.error('대시보드 로드 실패:', err);
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [userData?.organizationId, reloadKey]);

    const value = (text: string) => (loading ? <span className="w-5 h-5 spinner inline-block" role="img" aria-label="불러오는 중" /> : loadError ? '—' : text);

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <ReleaseNotesBanner />
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">대시보드</h1>

            {loadError && (
                <div role="alert" className="glass-card p-4 mb-4 flex flex-wrap items-center gap-3 border border-red-200 dark:border-red-900/50">
                    <p className="flex-1 min-w-[12rem] text-sm text-red-700 dark:text-red-300">
                        현황을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.
                    </p>
                    <button type="button" className="btn-secondary btn-sm min-h-[48px]" onClick={() => setReloadKey(k => k + 1)}>다시 불러오기</button>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                <div className="glass-card p-4">
                    <p className="text-xs text-surface-600 dark:text-surface-400 mb-1">기관</p>
                    <p className="text-xl font-bold text-surface-900 dark:text-surface-100 break-keep">{value(org?.name || '-')}</p>
                </div>
                {/* 누를 수 있는 칸은 링크로 — 오른쪽 › 표시로 눌러서 들어가는 칸임을 보인다 */}
                <StatLink to="/admin/assets" label="운영 재물" value={value(`${assetCounts.active.toLocaleString('ko-KR')}건`)}
                    extra={!loading && !loadError && (assetCounts.inactive > 0 || assetCounts.disposed > 0)
                        ? `불용 ${assetCounts.inactive} · 폐기 ${assetCounts.disposed}` : undefined} />
                <StatLink to="/admin/spaces" label="공간" value={value(`${spaceCount}곳`)} />
                <StatLink to="/admin/employees" label="등록 직원" value={value(`${employeeCount}명`)} />
            </div>

            {/* 예전 "기능을 준비하고 있습니다" 안내는 지난 기능이라 시작 순서로 바꿨다 */}
            <section className="glass-card p-5" aria-labelledby="dash-steps">
                <h2 id="dash-steps" className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-3">이렇게 시작하세요</h2>
                <ol className="space-y-2">
                    {STEPS.map((step, i) => (
                        <li key={step.to}>
                            <Link to={step.to} className="flex items-center gap-3 rounded-xl border border-surface-200 dark:border-surface-700 p-3 min-h-[48px] hover:bg-surface-50 dark:hover:bg-surface-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
                                <span className="w-7 h-7 flex-shrink-0 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-sm font-semibold flex items-center justify-center">{i + 1}</span>
                                <span className="flex-1 min-w-0">
                                    <span className="block font-medium text-surface-900 dark:text-surface-100">{step.title}</span>
                                    <span className="block text-sm text-surface-600 dark:text-surface-400">{step.text}</span>
                                </span>
                                <span aria-hidden="true" className="text-surface-500 text-lg">›</span>
                            </Link>
                        </li>
                    ))}
                </ol>
            </section>
        </div>
    );
}

const STEPS = [
    { to: '/admin/spaces', title: '공간 등록', text: '건물·층과 사무실·창고 같은 공간을 만듭니다.' },
    { to: '/admin/import', title: '재물 가져오기', text: '희망이음 대장이나 빈 양식을 올리거나, 재물에서 하나씩 등록합니다.' },
    { to: '/admin/employees', title: '팀·직원 등록', text: '팀을 만들고 조사를 도울 직원을 등록합니다.' },
    { to: '/admin/surveys', title: '재물조사 시작', text: '조사 기간을 열고, 재물 화면에서 QR 라벨을 뽑아 붙입니다.' },
];

function StatLink({ to, label, value, extra }: { to: string; label: string; value: React.ReactNode; extra?: string }) {
    return (
        <Link to={to} className="glass-card p-4 flex items-start gap-2 hover:ring-2 hover:ring-primary-200 dark:hover:ring-primary-800 transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
            <span className="flex-1 min-w-0">
                <span className="block text-xs text-surface-600 dark:text-surface-400 mb-1">{label}</span>
                <span className="block text-xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">{value}</span>
                {extra && <span className="block text-xs text-surface-600 dark:text-surface-400 mt-0.5">{extra}</span>}
            </span>
            <span aria-hidden="true" className="text-surface-500 text-lg self-center">›</span>
        </Link>
    );
}
