import { useState, useEffect, Suspense, startTransition } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { getOrganization } from '../../lib/firestore';
import { SA_TEST_ROLE_KEY, exitSaTestMode } from '../../lib/saTestMode';
import { rememberAdminArea } from '../../lib/lastArea';
import NotificationBell from '../common/NotificationBell';
import AdminNotice from '../admin/AdminNotice';
import IOSInstallPrompt from '../common/IOSInstallPrompt';
import useBackButton from '../../hooks/useBackButton';
import useReleaseNotesStatus from '../../hooks/useReleaseNotesStatus';
import ErrorBoundary from '../common/ErrorBoundary';
import AppIcon from '../common/AppIcon';

const MorePage = lazyWithRetry(() => import('./MorePage'));
const EmployeeHome = lazyWithRetry(() => import('./EmployeeHome'));
const ScanPage = lazyWithRetry(() => import('./ScanPage'));
const MyAssets = lazyWithRetry(() => import('./MyAssets'));
const EmployeeAssetDetail = lazyWithRetry(() => import('./EmployeeAssetDetail'));

interface NavItem {
    to: string;
    label: string;
    icon: React.ReactElement;
}

const navItems: NavItem[] = [
    {
        to: '/employee/home',
        label: '홈',
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
        ),
    },
    {
        to: '/employee/scan',
        label: '스캔',
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
            </svg>
        ),
    },
    {
        to: '/employee/more',
        label: '더보기',
        icon: (
            <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
        ),
    },
];

export default function EmployeeLayout() {
    const { user, userData, isSuperAdmin } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [orgName, setOrgName] = useState('');
    const { hasNew: hasNewReleaseNotes } = useReleaseNotesStatus();
    useBackButton();

    // 기관 관리자가 직원 화면을 쓰고 있으면 다음에 앱을 열 때 여기로 돌아오게 기억한다
    useEffect(() => {
        if (userData?.role === 'admin' && !isSuperAdmin) rememberAdminArea(user?.uid, 'employee');
    }, [user?.uid, userData?.role, isSuperAdmin]);

    useEffect(() => {
        if (!userData?.organizationId) return;
        getOrganization(userData.organizationId)
            .then(org => org && setOrgName(org.name || ''))
            .catch(() => { });
    }, [userData?.organizationId]);

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
            {/* 상단 바
            z-[45] — 알림 패널이 하단 고정 배너에 가려지지 않게 하는 값이다.
            이 헤더는 sticky+z-index로도, backdrop-filter로도 각각 stacking context를 만든다.
            그래서 안에 든 .notification-dropdown의 z-50은 헤더 내부에서만 유효하고,
            바깥에서 패널의 실질 높이는 헤더의 z가 된다. z-30이던 시절에는 원클릭 추천
            예약 배너(z-40)와 약관 재동의 배너(z-40)가 알림 패널을 덮었다.
            고정 배너(40)보다 위, 모달(50)보다 아래여야 하므로 그 사이 값을 쓴다.
            */}
            <header className="sticky top-0 z-[45] bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border-b border-surface-200/80 dark:border-surface-800 px-4 h-[calc(3.5rem+env(safe-area-inset-top,0px))] flex items-center justify-between safe-top">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 flex-shrink-0 bg-primary-100 dark:bg-primary-900/40 rounded-lg flex items-center justify-center">
                        <AppIcon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                    </div>
                    {/* 기관명은 한 줄로 — 오른쪽 버튼에 밀려 "소셜프리/즘"처럼 글자 단위로 꺾이지 않게 한다. */}
                    <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm truncate" title={orgName || undefined}>{orgName || '재물조사'}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {isSuperAdmin && (
                        <button
                            onClick={exitSaTestMode}
                            className="btn-icon min-h-[48px] min-w-[48px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                            title="슈퍼관리자 화면으로 복귀"
                            aria-label="슈퍼관리자 화면으로 복귀"
                        >
                            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                            </svg>
                        </button>
                    )}
                    {(userData?.role === 'admin' || isSuperAdmin) && (
                        <button
                            onClick={() => {
                                if (isSuperAdmin) {
                                    sessionStorage.setItem(SA_TEST_ROLE_KEY, 'admin');
                                    window.location.href = '/admin';
                                } else {
                                    startTransition(() => {
                                        navigate('/admin');
                                    });
                                }
                            }}
                            className="btn-icon text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 flex items-center justify-center"
                            title="관리자 화면으로 전환"
                            aria-label="관리자 화면으로 전환"
                        >
                            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                            </svg>
                        </button>
                    )}
                    <AdminNotice />
                    <NotificationBell />
                </div>
            </header>

            {/* iOS Safari 홈 화면 추가 안내 */}
            <IOSInstallPrompt />

            {/* 메인 콘텐츠 */}
            <main className="flex-1 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
                {/* key를 경로로 두어 다른 메뉴로 이동하면 폴백에서 벗어난다 (2026-09-02, Admin·SuperAdmin과 동일) */}
                <ErrorBoundary key={location.pathname}>
                <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 spinner" /></div>}>
                    <Routes>
                        <Route path="home" element={<EmployeeHome />} />
                        <Route path="scan" element={<ScanPage />} />
                        <Route path="assets" element={<MyAssets />} />
                        <Route path="assets/:assetId" element={<EmployeeAssetDetail />} />
                        <Route path="more" element={<MorePage />} />
                        <Route path="" element={<Navigate to="home" replace />} />
                    </Routes>
                </Suspense>
                </ErrorBoundary>
            </main>

            {/* 하단 탭 바 (모바일 최적화) */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border-t border-surface-200/80 dark:border-surface-800 z-30 safe-bottom" aria-label="직원 메뉴">
                <div className="grid grid-cols-3 items-center h-[68px] max-w-lg mx-auto px-2 relative">
                    {navItems.map((item, idx) => {
                        // NavLink 클릭 시 startTransition을 통해 부드러운 페이지 전환 유도
                        const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
                            if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                                e.preventDefault();
                                startTransition(() => {
                                    navigate(item.to);
                                });
                            }
                        };

                        // 중앙의 Elevated 스캔 버튼 — 비활성일 때도 브랜드 주색과 라벨로 용도가 바로 보이게
                        if (idx === 1) {
                            return (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    onClick={handleNavClick}
                                    className={({ isActive }) =>
                                        `flex flex-col items-center justify-center gap-0.5 py-1 min-h-[48px] rounded-xl transition-all duration-200 ${isActive
                                            ? 'text-primary-700 dark:text-primary-300 font-bold'
                                            : 'text-surface-700 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400 font-semibold'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <span className={`-mt-5 flex items-center justify-center w-12 h-12 rounded-full shadow-glass-lg transition-all duration-200 active:scale-95 ${isActive
                                                ? 'bg-primary-600 dark:bg-primary-500 text-white ring-4 ring-primary-200 dark:ring-primary-900/70'
                                                : 'bg-primary-600 dark:bg-primary-500 text-white ring-4 ring-white dark:ring-surface-900 hover:bg-primary-700 dark:hover:bg-primary-400'
                                            }`}>
                                                {item.icon}
                                            </span>
                                            <span className={`text-xs ${isActive ? 'tracking-tight' : ''}`}>{item.label}</span>
                                        </>
                                    )}
                                </NavLink>
                            );
                        }

                        // 일반 탭 아이템
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={handleNavClick}
                                className={({ isActive }) =>
                                    `flex flex-col items-center justify-center gap-1 py-1.5 min-h-[48px] rounded-xl transition-all duration-200 ${isActive
                                        ? 'text-primary-600 dark:text-primary-400 font-bold'
                                        : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 hover:bg-surface-100/60 dark:hover:text-surface-200 dark:hover:bg-surface-800/60 font-medium'
                                    }`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`relative ${isActive ? 'scale-110 transition-transform' : 'transition-transform'}`}>
                                            {item.icon}
                                            {item.to === '/employee/more' && hasNewReleaseNotes && (
                                                <>
                                                    <span aria-hidden="true" className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-600 ring-2 ring-white dark:ring-surface-900" />
                                                    <span className="sr-only">새 소식 있음</span>
                                                </>
                                            )}
                                        </div>
                                        <span className={`text-xs ${isActive ? 'tracking-tight' : ''}`}>{item.label}</span>
                                    </>
                                )}
                            </NavLink>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
