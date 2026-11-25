/**
 * AdminDashboard — 기관 관리자(재물 담당자) 첫 화면
 *
 * 기관 요약(기관·운영 재물·공간·직원)과 함께 진행 중인 재물조사 요약(남은 기간·대상·승인 현황),
 * 세팅 완료 여부에 따른 스마트 온보딩/실무 빠른 이동을 제공한다.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { auth } from '../../lib/firebase';
import { refreshTokenSilently } from '../../lib/tokenRefresh';
import {
    getOrganizationMembers, getOrganization, getSpaces, getAssetCounts, getOpenSurvey, getSubmissions,
} from '../../lib/firestore';
import { daysLeft } from '../../lib/survey/report';
import ReleaseNotesBanner from '../common/ReleaseNotesBanner';
import { SkeletonStatCard } from '../common/Skeleton';
import type { Organization } from '../../types/organization';
import type { Survey, SurveySubmission } from '../../types/survey';

export default function AdminDashboard() {
    const { userData } = useAuth();
    const [employeeCount, setEmployeeCount] = useState(0);
    const [spaceCount, setSpaceCount] = useState(0);
    const [assetCounts, setAssetCounts] = useState({ active: 0, inactive: 0, disposed: 0 });
    const [org, setOrg] = useState<Organization | null>(null);
    const [openSurvey, setOpenSurvey] = useState<Survey | null>(null);
    const [submissions, setSubmissions] = useState<SurveySubmission[]>([]);
    const [loading, setLoading] = useState(true);
    // 불러오기 실패 — 예전엔 콘솔에만 남고 화면엔 0건이 떠 "재물이 없다"로 오해했다(2026-11-22 점검)
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        // 기관이 없으면 읽을 것이 없다 — 로딩 표시만 끝없이 돌지 않게 끝낸다
        if (!userData?.organizationId) { setLoading(false); return; }
        const orgId = userData.organizationId;
        let cancelled = false;
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
                if (cancelled) return;
                setAssetCounts(counts);
                setSpaceCount(spaces.filter(s => !s.archived).length);
                setEmployeeCount(members.filter(m => m.role !== 'superAdmin').length);
                setOrg((organization as Organization) ?? null);

                // 진행 중 조사 요약은 보조 정보라 실패해도 기본 대시보드는 그대로 보여 준다
                try {
                    const activeSurvey = await getOpenSurvey(orgId);
                    if (cancelled) return;
                    setOpenSurvey(activeSurvey);
                    if (activeSurvey && activeSurvey.mode === 'delegated') {
                        const subs = await getSubmissions(orgId, activeSurvey.id);
                        if (!cancelled) setSubmissions(subs);
                    } else {
                        setSubmissions([]);
                    }
                } catch {
                    if (!cancelled) {
                        setOpenSurvey(null);
                        setSubmissions([]);
                    }
                }
            } catch (err) {
                if (cancelled) return;
                // Custom Claims 토큰이 아직 갱신되지 않은 경우 재시도 (최대 2회)
                const firebaseErr = err as { code?: string; message?: string };
                const isPermError = firebaseErr.code === 'permission-denied'
                    || firebaseErr.message?.includes('Missing or insufficient permissions');
                if (isPermError && retryCount < 2) {
                    const delayMs = 1500 * Math.pow(2, retryCount);
                    try { if (auth.currentUser) await refreshTokenSilently(auth.currentUser); } catch { /* noop */ }
                    await new Promise(r => setTimeout(r, delayMs));
                    if (!cancelled) return load(retryCount + 1);
                    return;
                }
                console.error('대시보드 로드 실패:', err);
                setLoadError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [userData?.organizationId, reloadKey]);

    const value = (text: string) => (loadError ? '—' : text);
    const setupReady = !loading && !loadError && ((spaceCount > 0 && assetCounts.active > 0) || openSurvey !== null);
    const stepDone = [
        spaceCount > 0,
        assetCounts.active > 0,
        employeeCount > 1,
        openSurvey !== null,
    ];

    const pendingReviewCount = submissions.filter(s => s.state === 'submitted').length;
    const approvedSpaceCount = submissions.filter(s => s.state === 'approved').length;
    const rejectedSpaceCount = submissions.filter(s => s.state === 'rejected').length;
    const totalSurveySpaces = openSurvey ? openSurvey.spaceIds.length : 0;
    const surveyDaysLeft = openSurvey ? daysLeft(openSurvey.endDate) : 0;

    return (
        <div className="max-w-5xl mx-auto animate-fade-in">
            <ReleaseNotesBanner />
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">대시보드</h1>

            {loadError && (
                <div role="alert" className="glass-card p-4 mb-4 flex flex-wrap items-center gap-3 border-red-200 dark:border-red-900/50">
                    <p className="flex-1 min-w-[12rem] text-sm text-red-700 dark:text-red-300">
                        현황을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.
                    </p>
                    <button type="button" className="btn-secondary btn-sm min-h-[48px]" onClick={() => setReloadKey(k => k + 1)}>다시 불러오기</button>
                </div>
            )}

            {/* 진행 중인 재물조사 최우선 요약 배너 */}
            {!loading && !loadError && openSurvey && (
                <section className="glass-card p-5 mb-6 border-primary-200 dark:border-primary-800/70 bg-primary-50/40 dark:bg-primary-950/20" aria-labelledby="active-survey-title">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                <span className={openSurvey.status === 'closing' ? 'badge-warning' : 'badge-primary'}>
                                    {openSurvey.status === 'closing' ? '마감 중' : '진행 중인 재물조사'}
                                </span>
                                <span className={`text-xs font-semibold tabular-nums ${surveyDaysLeft < 0 ? 'text-red-700 dark:text-red-300' : 'text-surface-600 dark:text-surface-400'}`}>
                                    {surveyDaysLeft > 0 ? `D-${surveyDaysLeft}` : surveyDaysLeft === 0 ? 'D-DAY' : `${-surveyDaysLeft}일 지남`}
                                </span>
                            </div>
                            <h2 id="active-survey-title" className="text-lg font-bold text-surface-900 dark:text-surface-100 break-keep">
                                {openSurvey.name}
                            </h2>
                            <p className="text-sm text-surface-600 dark:text-surface-400 tabular-nums mt-0.5">
                                {openSurvey.startDate} ~ {openSurvey.endDate} · 대상 {openSurvey.targetCount.toLocaleString('ko-KR')}건
                            </p>
                            {openSurvey.mode === 'delegated' && totalSurveySpaces > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <span className={pendingReviewCount > 0 ? 'badge-primary' : 'badge-neutral'}>
                                        승인 대기 {pendingReviewCount}곳
                                    </span>
                                    <span className="badge-success">
                                        승인 완료 {approvedSpaceCount} / {totalSurveySpaces}곳
                                    </span>
                                    {rejectedSpaceCount > 0 && (
                                        <span className="badge-danger">반려 {rejectedSpaceCount}곳</span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                            <Link to="/admin/surveys" className="btn-primary btn-sm min-h-[48px] px-4 flex-1 sm:flex-none">
                                현황판 보기
                            </Link>
                            {openSurvey.status === 'open' && (
                                <Link to="/employee/scan" className="btn-secondary btn-sm min-h-[48px] px-4 flex-1 sm:flex-none">
                                    직접 스캔
                                </Link>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6" role="status" aria-label="대시보드 요약 불러오는 중">
                    <SkeletonStatCard />
                    <SkeletonStatCard />
                    <SkeletonStatCard />
                    <SkeletonStatCard />
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    <div className="glass-card p-4 flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 flex items-center justify-center shrink-0" aria-hidden="true">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M5.25 3h13.5M5.25 21h13.5M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs text-surface-600 dark:text-surface-400 mb-0.5">기관</p>
                            <p className="text-lg font-bold text-surface-900 dark:text-surface-100 break-keep leading-snug">{value(org?.name || '-')}</p>
                        </div>
                    </div>
                    <StatLink
                        to="/admin/assets"
                        label="운영 재물"
                        value={value(`${assetCounts.active.toLocaleString('ko-KR')}건`)}
                        extra={!loadError && (assetCounts.inactive > 0 || assetCounts.disposed > 0)
                            ? `불용 ${assetCounts.inactive} · 폐기 ${assetCounts.disposed}` : undefined}
                        iconBg="bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                            </svg>
                        }
                    />
                    <StatLink
                        to="/admin/spaces"
                        label="공간"
                        value={value(`${spaceCount}곳`)}
                        iconBg="bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                            </svg>
                        }
                    />
                    <StatLink
                        to="/admin/employees"
                        label="등록 직원"
                        value={value(`${employeeCount}명`)}
                        iconBg="bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                            </svg>
                        }
                    />
                </div>
            )}

            {setupReady ? (
                <div className="space-y-4">
                    <section className="glass-card p-5" aria-labelledby="dash-quick">
                        <h2 id="dash-quick" className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-3">자주 쓰는 업무</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {QUICK_ACTIONS.map((action) => (
                                <Link
                                    key={action.to}
                                    to={action.to}
                                    className="flex items-center gap-3 rounded-xl border border-surface-200 dark:border-surface-700 p-3.5 min-h-[56px] hover:bg-surface-50 dark:hover:bg-surface-800/70 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                                >
                                    <span className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0" aria-hidden="true">
                                        {action.icon}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block font-semibold text-sm text-surface-900 dark:text-surface-100">{action.title}</span>
                                        <span className="block text-xs text-surface-600 dark:text-surface-400 mt-0.5">{action.text}</span>
                                    </span>
                                    <span aria-hidden="true" className="text-surface-400 dark:text-surface-500 text-lg">›</span>
                                </Link>
                            ))}
                        </div>
                    </section>

                    <details className="glass-card p-4 group">
                        <summary className="flex items-center justify-between gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-[40px] text-sm font-semibold text-surface-700 dark:text-surface-300">
                            <span>초기 설정 순서 보기 (이렇게 시작하세요)</span>
                            <span aria-hidden="true" className="text-surface-400 dark:text-surface-500 group-open:rotate-90 transition-transform">▸</span>
                        </summary>
                        <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-800">
                            <OnboardingList stepDone={stepDone} />
                        </div>
                    </details>
                </div>
            ) : (
                <section className="glass-card p-5" aria-labelledby="dash-steps">
                    <h2 id="dash-steps" className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-3">이렇게 시작하세요</h2>
                    <OnboardingList stepDone={stepDone} />
                </section>
            )}
        </div>
    );
}

function OnboardingList({ stepDone }: { stepDone: boolean[] }) {
    return (
        <ol className="space-y-2">
            {STEPS.map((step, i) => {
                const done = stepDone[i];
                return (
                    <li key={step.to}>
                        <Link to={step.to} className="flex items-center gap-3 rounded-xl border border-surface-200 dark:border-surface-700 p-3 min-h-[48px] hover:bg-surface-50 dark:hover:bg-surface-800/70 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
                            <span className={`w-7 h-7 flex-shrink-0 rounded-full text-sm font-semibold flex items-center justify-center ${done
                                ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                                : 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                            }`} aria-hidden="true">
                                {done ? (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                    </svg>
                                ) : i + 1}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="block font-medium text-surface-900 dark:text-surface-100">
                                    {step.title}
                                    {done && <span className="ml-2 text-xs font-medium text-accent-700 dark:text-accent-300">준비됨</span>}
                                </span>
                                <span className="block text-sm text-surface-600 dark:text-surface-400">{step.text}</span>
                            </span>
                            <span aria-hidden="true" className="text-surface-400 dark:text-surface-500 text-lg">›</span>
                        </Link>
                    </li>
                );
            })}
        </ol>
    );
}

const STEPS = [
    { to: '/admin/spaces', title: '공간 등록', text: '건물·층과 사무실·창고 같은 공간을 만듭니다.' },
    { to: '/admin/import', title: '재물 가져오기', text: '희망이음 대장이나 빈 양식을 올리거나, 재물에서 하나씩 등록합니다.' },
    { to: '/admin/employees', title: '팀·직원 등록', text: '팀을 만들고 조사를 도울 직원을 등록합니다.' },
    { to: '/admin/surveys', title: '재물조사 시작', text: '조사 기간을 열고, 재물 화면에서 QR 라벨을 뽑아 붙입니다.' },
];

const QUICK_ACTIONS = [
    {
        to: '/admin/surveys',
        title: '재물조사 현황판 · 시작',
        text: '진행 중인 조사를 관리하거나 지난 결과 보고서를 봅니다.',
        icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        ),
    },
    {
        to: '/admin/assets',
        title: '재물 목록 · 라벨 인쇄',
        text: '재물을 검색하고 공간별 QR 라벨을 뽑습니다.',
        icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
            </svg>
        ),
    },
    {
        to: '/admin/spaces',
        title: '공간 · 담당자 관리',
        text: '건물·층과 사무실별 조사 담당자를 지정합니다.',
        icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21" />
            </svg>
        ),
    },
    {
        to: '/admin/employees',
        title: '팀 · 직원 관리',
        text: '직원 초대 링크를 확인하고 권한과 팀을 관리합니다.',
        icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
        ),
    },
];

function StatLink({
    to, label, value, extra, icon, iconBg,
}: {
    to: string;
    label: string;
    value: ReactNode;
    extra?: string;
    icon: ReactNode;
    iconBg: string;
}) {
    return (
        <Link to={to} className="glass-card p-4 flex items-start gap-3 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-glass-lg transition-all focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`} aria-hidden="true">
                {icon}
            </div>
            <span className="flex-1 min-w-0">
                <span className="block text-xs text-surface-600 dark:text-surface-400 mb-0.5">{label}</span>
                <span className="block text-xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">{value}</span>
                {extra && <span className="block text-xs text-surface-600 dark:text-surface-400 mt-0.5">{extra}</span>}
            </span>
            <span aria-hidden="true" className="text-surface-400 dark:text-surface-500 text-lg self-center">›</span>
        </Link>
    );
}
