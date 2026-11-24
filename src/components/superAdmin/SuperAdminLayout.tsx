import { useState, useEffect, useCallback, useRef, Suspense, type ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../lib/auth';
import { getApprovedOrganizations } from '../../lib/firestore/organizations';
import { getOrgMemberCounts } from '../../lib/firestore/users';
import { getPendingOrganizationsCount, getApprovedOrganizationsCount } from '../../lib/firestore/organizations';
import { getUnreadFeedbacksCount } from '../../lib/firestore/feedbacks';
import { getSuperAdminsCount } from '../../lib/firestore/superAdmin';
import { enterSaTestMode, type SaTestRole } from '../../lib/saTestMode';
import { useToast } from '../../hooks/useToast';
import TestOrgPickerModal, { type TestOrgOption } from './TestOrgPickerModal';
import { useTheme } from '../../hooks/useTheme';
import Toggle from '../common/Toggle';
import ErrorBoundary from '../common/ErrorBoundary';


import { lazyWithRetry } from '../../lib/lazyWithRetry';

const ServiceDashboard = lazyWithRetry(() => import('./ServiceDashboard'));
const OrgApplicationList = lazyWithRetry(() => import('./OrgApplicationList'));
const OrgManagement = lazyWithRetry(() => import('./OrgManagement'));
const FeedbackManagement = lazyWithRetry(() => import('./FeedbackManagement'));
const SuperAdminManager = lazyWithRetry(() => import('./SuperAdminManager'));
const BroadcastNoticePage = lazyWithRetry(() => import('./BroadcastNoticePage'));
const ClientErrorLog = lazyWithRetry(() => import('./ClientErrorLog'));

interface NavItemProps {
    to: string;
    icon: ReactNode;
    label: string;
    badge?: number | null;
    /** 휴대폰에서 메뉴를 고르면 덮고 있던 사이드바를 닫는다 */
    onNavigate?: () => void;
}

function NavItem({ to, icon, label, badge, onNavigate }: NavItemProps) {
    return (
        <NavLink
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
                `sidebar-link min-h-[48px] ${isActive ? 'sidebar-link-active' : ''}`
            }
        >
            {icon}
            <span>{label}</span>
            {badge != null && (
                <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold rounded-full ${badge > 0 ? 'badge-primary' : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'}`}>
                    {badge}
                </span>
            )}
        </NavLink>
    );
}

export default function SuperAdminLayout() {
    const { user, userData } = useAuth();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [activeOrgCount, setActiveOrgCount] = useState(0);
    const [feedbackCount, setFeedbackCount] = useState(0);
    const [adminCount, setAdminCount] = useState(0);
    const { isDark, toggleTheme } = useTheme();
    const { showToast } = useToast();
    // 관리자·직원 화면 보기 — 볼 기관 목록과 고르는 중인 역할
    const [testOrgs, setTestOrgs] = useState<TestOrgOption[] | null>(null);
    const [pickerRole, setPickerRole] = useState<SaTestRole | null>(null);

    /** 관리자·직원 화면으로 들어간다. 기관이 하나면 바로, 여럿이면 고르는 창을 연다 */
    const startTestMode = useCallback(async (role: SaTestRole) => {
        let orgs = testOrgs;
        if (!orgs) {
            try {
                orgs = (await getApprovedOrganizations()).map(o => ({ id: o.id, name: o.name || o.id }));
                setTestOrgs(orgs);
            } catch {
                showToast('기관 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
                return;
            }
        }
        if (orgs.length === 0) {
            showToast('승인된 기관이 없어 관리자·직원 화면을 볼 수 없습니다.', 'info');
            return;
        }
        if (orgs.length === 1) {
            enterSaTestMode(role, orgs[0].id);
            return;
        }
        setPickerRole(role);
    }, [testOrgs, showToast]);
    const closePicker = useCallback(() => setPickerRole(null), []);
    const closeSidebar = useCallback(() => setSidebarOpen(false), []);
    // 배지 숫자를 다시 읽게 하는 신호 — 신청을 승인·거절하면 사이드바 '신청 관리' 숫자가 그대로 남던 문제
    const [countsVersion, setCountsVersion] = useState(0);
    const refreshCounts = useCallback(() => setCountsVersion(v => v + 1), []);

    const asideRef = useRef<HTMLElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    // 넓은 화면(lg)에서는 메뉴가 늘 보인다 — 좁은 화면에서 닫힌 서랍은 Tab·화면낭독기가 들어가지 않게 inert로 막는다(2026-11-22)
    const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)')?.matches);
    useEffect(() => {
        const mq = window.matchMedia?.('(min-width: 1024px)');
        if (!mq) return;
        const onChange = () => setIsDesktop(mq.matches);
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);

    // 휴대폰에서 열린 사이드바: 첫 메뉴로 초점, Esc로 닫고 메뉴 버튼으로 초점을 돌려준다
    useEffect(() => {
        if (!sidebarOpen || isDesktop) return;
        asideRef.current?.querySelector<HTMLElement>('nav a, nav button')?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setSidebarOpen(false); menuButtonRef.current?.focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [sidebarOpen, isDesktop]);

    // 사이드바 배지 카운트 단발성 조회 (비용 절감)
    useEffect(() => {
        let isMounted = true;
        const fetchCounts = async () => {
            if (!user || userData?.role !== 'superAdmin') return; // Auth/AppCheck 검증 안된 상태 쿼리 차단

            try {
                const [pendingsCount, approvedCount, unreadFeedbackCount] = await Promise.all([
                    getPendingOrganizationsCount(),
                    getApprovedOrganizationsCount(),
                    getUnreadFeedbacksCount()
                ]);

                if (!isMounted) return;

                setPendingCount(pendingsCount);
                setFeedbackCount(unreadFeedbackCount);

                try {
                    const approved = await getApprovedOrganizations();
                    if (isMounted) setTestOrgs(approved.map(o => ({ id: o.id, name: o.name || o.id })));
                    const counts = await getOrgMemberCounts(approved.map(o => o.id));
                    if (isMounted) {
                        const active = approved.filter(o => counts[o.id] > 0).length;
                        setActiveOrgCount(active);
                    }
                } catch {
                    if (isMounted) setActiveOrgCount(approvedCount);
                }
            } catch(e) {
                const err = e as { code?: string; message?: string };
                if (err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions')) {
                    // AppCheck 실패 또는 권한 없음 에러는 의도된 방어이므로 에러 노이즈 억제
                    console.warn("SuperAdmin 뱃지 카운트 조회 억제됨 (권한 부족)");
                } else {
                    console.error("SuperAdmin 뱃지 카운트 조회 에러:", e);
                }
            }
        };

        fetchCounts();

        return () => { isMounted = false; };
    }, [user, userData?.role, countsVersion]);

    // 슈퍼관리자 수 조회
    useEffect(() => {
        getSuperAdminsCount().then(count => setAdminCount(count)).catch(() => {});
    }, []);

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex">
            <TestOrgPickerModal
                open={pickerRole !== null}
                roleLabel={pickerRole === 'employee' ? '직원' : '관리자'}
                orgs={testOrgs ?? []}
                onSelect={(orgId) => { if (pickerRole) enterSaTestMode(pickerRole, orgId); }}
                onClose={closePicker}
            />
            {/* 모바일 오버레이 */}
            {sidebarOpen && (
                <div
                    role="presentation"
                    className="fixed inset-0 bg-black/30 z-40 lg:hidden"
                    onClick={closeSidebar}
                />
            )}

            {/* 사이드바 */}
            <aside ref={asideRef} id="superadmin-sidebar" inert={!sidebarOpen && !isDesktop} className={`
        fixed lg:sticky inset-y-0 left-0 lg:top-0 lg:h-screen z-50
        w-64 bg-white dark:bg-surface-900 border-r border-surface-100 dark:border-surface-700
        transform transition-transform duration-300 ease-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
      `}>
                <div className="p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] border-b border-surface-100 dark:border-surface-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-xl flex items-center justify-center">
                            <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                            </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-surface-900 dark:text-surface-100 text-sm">시스템 관리자</p>
                            <p className="text-xs text-surface-600 dark:text-surface-400 break-all">{user?.email}</p>
                        </div>
                        {/* 휴대폰에서 사이드바를 닫는 버튼 — 바깥 어둠을 누르는 방법만 있으면 찾기 어렵다 */}
                        <button
                            type="button"
                            onClick={closeSidebar}
                            className="btn-icon lg:hidden shrink-0"
                            aria-label="메뉴 닫기"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="슈퍼관리자 메뉴">
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/dashboard"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                            </svg>
                        }
                        label="운영 현황"
                    />
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/applications"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z" />
                            </svg>
                        }
                        label="신청 관리"
                        badge={pendingCount}
                    />
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/organizations"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M5.25 3h13.5M5.25 21h13.5M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                            </svg>
                        }
                        label="기관 관리"
                        badge={activeOrgCount}
                    />
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/feedbacks"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                            </svg>
                        }
                        label="의견 관리"
                        badge={feedbackCount}
                    />
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/admins"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                        }
                        label="슈퍼관리자 관리"
                        badge={adminCount}
                    />
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/broadcast"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
                            </svg>
                        }
                        label="전체 공지"
                    />
                    <NavItem
                        onNavigate={closeSidebar}
                        to="/super-admin/errors"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                            </svg>
                        }
                        label="오류 기록"
                    />

                </nav>

                <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-surface-100 dark:border-surface-700 space-y-1">


                    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
                        <div className="flex items-center gap-3">
                            {isDark ? (
                                <svg className="w-5 h-5 text-amber-400 dark:text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                                </svg>
                            )}
                            <span className="text-sm text-surface-600 dark:text-surface-300">{isDark ? '다크 모드' : '라이트 모드'}</span>
                        </div>
                        <Toggle label="다크 모드" checked={isDark} onChange={toggleTheme} />
                    </div>
                    <button type="button" onClick={logout} className="sidebar-link w-full text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-300 min-h-[48px]">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                        <span>로그아웃</span>
                    </button>
                </div>
            </aside>

            {/* 메인 콘텐츠 */}
            <main className="flex-1 flex flex-col min-w-0">
                {/* 상단 바
                z-[45] — 알림 패널이 하단 고정 배너에 가려지지 않게 하는 값이다.
                이 헤더는 sticky+z-index로도, backdrop-filter로도 각각 stacking context를 만든다.
                그래서 안에 든 .notification-dropdown의 z-50은 헤더 내부에서만 유효하고,
                바깥에서 패널의 실질 높이는 헤더의 z가 된다. z-30이던 시절에는 원클릭 추천
                예약 배너(z-40)와 약관 재동의 배너(z-40)가 알림 패널을 덮었다.
                고정 배너(40)보다 위, 모달(50)보다 아래여야 하므로 그 사이 값을 쓴다.
                */}
                <header className="sticky top-0 z-[45] bg-white/80 dark:bg-surface-900/80 backdrop-blur-md border-b border-surface-100 dark:border-surface-700 px-4 lg:px-6 h-[calc(3.5rem+env(safe-area-inset-top,0px))] flex items-center justify-between safe-top">
                    <button
                        ref={menuButtonRef}
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        className="btn-icon lg:hidden min-h-[48px] min-w-[48px]"
                        aria-label="메뉴 열기"
                        aria-expanded={sidebarOpen}
                        aria-controls="superadmin-sidebar"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                    <div className="flex-1" />
                    {/* 관리자·직원 화면 보기 — 무엇을 하는 버튼인지 글로 보이게 하고, 휴대폰에서도 44px 이상 */}
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => { void startTestMode('admin'); }}
                            className="btn-secondary btn-sm min-h-[48px]"
                        >
                            <span aria-hidden="true">🏢</span> 관리자<span className="hidden sm:inline"> 화면 보기</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { void startTestMode('employee'); }}
                            className="btn-secondary btn-sm min-h-[48px]"
                        >
                            <span aria-hidden="true">🙋</span> 직원<span className="hidden sm:inline"> 화면 보기</span>
                        </button>
                    </div>

                </header>

                {/* 페이지 콘텐츠 */}
                <div className="flex-1 p-4 lg:p-6 overflow-y-auto">
                    <Suspense fallback={<div className="flex items-center justify-center py-20" role="status" aria-label="불러오는 중"><div className="w-10 h-10 spinner" /></div>}>
                        {/* 라우트 단위 경계 — 한 화면(예: 차트)의 크래시가 관리자 화면 전체를 비우지 않게 한다 (2026-09-02).
                            key를 경로로 두어 다른 메뉴로 이동하면 경계가 새로 마운트돼 폴백에서 벗어난다 — 없으면 hasError가 남아 모든 메뉴가 계속 폴백만 보인다. */}
                        <ErrorBoundary key={location.pathname}>
                            <Routes>
                                <Route path="dashboard" element={<ServiceDashboard />} />
                                <Route path="applications" element={<OrgApplicationList onCountChange={refreshCounts} />} />
                                <Route path="organizations" element={<OrgManagement />} />
                                <Route path="feedbacks" element={<FeedbackManagement />} />
                                <Route path="admins" element={<SuperAdminManager />} />
                                <Route path="broadcast" element={<BroadcastNoticePage />} />
                                <Route path="errors" element={<ClientErrorLog />} />
                                <Route path="" element={<Navigate to="dashboard" replace />} />
                            </Routes>
                        </ErrorBoundary>
                    </Suspense>
                </div>
            </main>
        </div>
    );
}
