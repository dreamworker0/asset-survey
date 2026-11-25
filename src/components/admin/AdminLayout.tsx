import React, { useState, useEffect, useRef, Suspense, startTransition } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../lib/auth';
import { SA_TEST_ROLE_KEY, exitSaTestMode } from '../../lib/saTestMode';
import { rememberAdminArea } from '../../lib/lastArea';
import NotificationBell from '../common/NotificationBell';
import Toggle from '../common/Toggle';
import AdminNotice from './AdminNotice';
import ReleaseNotesModal from '../common/ReleaseNotesModal';
import ErrorBoundary from '../common/ErrorBoundary';
import { useTheme } from '../../hooks/useTheme';
import useBackButton from '../../hooks/useBackButton';
import useReleaseNotesStatus from '../../hooks/useReleaseNotesStatus';
import AppIcon from '../common/AppIcon';

const AdminDashboard = lazyWithRetry(() => import('./AdminDashboard'));
const EmployeeManager = lazyWithRetry(() => import('./EmployeeManager'));
const SpaceManager = lazyWithRetry(() => import('./SpaceManager'));
const AssetImport = lazyWithRetry(() => import('./AssetImport'));
const AssetList = lazyWithRetry(() => import('./AssetList'));
const UnplacedAssets = lazyWithRetry(() => import('./UnplacedAssets'));
const AssetDetail = lazyWithRetry(() => import('./AssetDetail'));
const AssetForm = lazyWithRetry(() => import('./AssetForm'));
const SurveyManager = lazyWithRetry(() => import('./SurveyManager'));
const SurveyReport = lazyWithRetry(() => import('./SurveyReport'));
const Settings = lazyWithRetry(() => import('./Settings'));
const AuditLogViewer = lazyWithRetry(() => import('./AuditLogViewer'));


interface NavItemProps {
    to: string;
    icon: React.ReactNode;
    label: string;
    badge?: number | null;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>, to: string) => void;
}

function NavItem({ to, icon, label, badge, onClick }: NavItemProps) {
    return (
        <NavLink
            to={to}
            onClick={(e) => onClick?.(e, to)}
            className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
            }
        >
            {icon}
            <span>{label}</span>
            {badge != null && (
                <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold rounded-full ${badge > 0 ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'}`}>
                    {badge}
                </span>
            )}
        </NavLink>
    );
}

export default function AdminLayout() {
    const { user, isSuperAdmin } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const asideRef = useRef<HTMLElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    // 넓은 화면(lg)에서는 메뉴가 늘 보인다 — 좁은 화면에서 닫힌 서랍은 키보드·화면낭독기가 들어가지 않게 inert로 막는다
    const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)')?.matches);
    const navigate = useNavigate();
    const location = useLocation();
    const { isDark, toggleTheme } = useTheme();
    const [showReleaseNotes, setShowReleaseNotes] = useState(false);
    const { hasNew: hasNewReleaseNotes, markSeen: markReleaseNotesSeen } = useReleaseNotesStatus();
    useBackButton();

    useEffect(() => {
        const mq = window.matchMedia?.('(min-width: 1024px)');
        if (!mq) return;
        const onChange = () => setIsDesktop(mq.matches);
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);

    // 서랍이 열리면 첫 메뉴로 초점, Esc로 닫고 메뉴 버튼으로 초점을 돌려준다(2026-11-22 점검)
    useEffect(() => {
        if (!sidebarOpen || isDesktop) return;
        asideRef.current?.querySelector<HTMLElement>('nav a, nav button')?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setSidebarOpen(false);
                menuButtonRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [sidebarOpen, isDesktop]);

    // 다음에 앱을 열 때 이 화면으로 돌아오게 기억한다 (슈퍼관리자 테스트 모드는 제외)
    useEffect(() => {
        if (!isSuperAdmin) rememberAdminArea(user?.uid, 'admin');
    }, [user?.uid, isSuperAdmin]);

    const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, to: string) => {
        if (location.pathname === to) {
            e.preventDefault();
            return;
        }
        e.preventDefault();
        startTransition(() => {
            navigate(to);
        });
        setSidebarOpen(false); // 모바일에서 클릭 시 닫기
    };

    const menuItems = [
        {
            to: '/admin/dashboard',
            label: '대시보드',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" /></svg>,
        },
        {
            to: '/admin/spaces',
            label: '공간 관리',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" /></svg>,
        },
        {
            to: '/admin/surveys',
            label: '재물조사',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" /></svg>,
        },
        {
            to: '/admin/assets',
            label: '재물 목록',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>,
        },
        {
            to: '/admin/import',
            label: '재물 가져오기',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>,
        },
        {
            to: '/admin/employees',
            label: '팀·직원 관리',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>,
        },
        {
            // 고시 제16조 ②의 월 1회 점검을 위해 설정 안쪽이 아닌 메뉴에서 바로 연다
            to: '/admin/audit-logs',
            label: '접속기록',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>,
        },
        {
            to: '/admin/settings',
            label: '설정',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>,
        },
    ];

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex">
            {/* 모바일 오버레이 */}
            {sidebarOpen && (
                <div role="presentation" className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* 사이드바 */}
            <aside ref={asideRef} id="admin-sidebar" inert={!sidebarOpen && !isDesktop} className={`
        fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50
        w-64 h-dvh bg-white dark:bg-surface-900 border-r border-surface-200/80 dark:border-surface-800
        transform transition-transform duration-300 ease-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
      `}>
                <div className="p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] border-b border-surface-200/80 dark:border-surface-800" role="banner">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-xl flex items-center justify-center shrink-0">
                            <AppIcon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-surface-900 dark:text-surface-100 text-sm truncate">재물조사</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{user?.displayName || user?.email}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setSidebarOpen(false); menuButtonRef.current?.focus(); }}
                            className="btn-icon lg:hidden shrink-0 -mr-2"
                            aria-label="메뉴 닫기"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="관리자 메뉴">
                    {menuItems.map((item) => (
                        <NavItem key={item.to} {...item} onClick={handleNavClick} />
                    ))}


                </nav>

                <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-surface-200/80 dark:border-surface-800 space-y-1">
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
                    <button onClick={logout} className="sidebar-link w-full text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-800 dark:hover:text-red-200 min-h-[48px]">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                        <span>로그아웃</span>
                    </button>
                </div>
            </aside>

            {/* 메인 콘텐츠 */}
            <main className="flex-1 flex flex-col min-w-0" role="main">
                {/* 상단 바
                z-[45] — 알림 패널이 하단 고정 배너에 가려지지 않게 하는 값이다.
                이 헤더는 sticky+z-index로도, backdrop-filter로도 각각 stacking context를 만든다.
                그래서 안에 든 .notification-dropdown의 z-50은 헤더 내부에서만 유효하고,
                바깥에서 패널의 실질 높이는 헤더의 z가 된다. z-30이던 시절에는 원클릭 추천
                예약 배너(z-40)와 약관 재동의 배너(z-40)가 알림 패널을 덮었다.
                고정 배너(40)보다 위, 모달(50)보다 아래여야 하므로 그 사이 값을 쓴다.
                */}
                <header className="sticky top-0 z-[45] bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border-b border-surface-200/80 dark:border-surface-800 px-4 lg:px-6 h-[calc(3.5rem+env(safe-area-inset-top,0px))] flex items-center justify-between safe-top">
                    <button ref={menuButtonRef} type="button" onClick={() => setSidebarOpen(true)} className="btn-icon lg:hidden min-h-[48px] min-w-[48px]"
                        aria-label="메뉴 열기" aria-expanded={sidebarOpen} aria-controls="admin-sidebar">
                        <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                        {isSuperAdmin && (
                            <button
                                onClick={() => {
                                    startTransition(() => {
                                        exitSaTestMode();
                                    });
                                }}
                                className="btn-icon min-h-[48px] min-w-[48px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                                title="슈퍼관리자 화면으로 복귀"
                                aria-label="슈퍼관리자 화면으로 복귀"
                            >
                                <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (isSuperAdmin) {
                                    sessionStorage.setItem(SA_TEST_ROLE_KEY, 'employee');
                                    startTransition(() => {
                                        window.location.href = '/employee';
                                    });
                                } else {
                                    startTransition(() => {
                                        navigate('/employee');
                                    });
                                }
                            }}
                            className="btn-icon text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
                            title="직원 화면으로 전환"
                            aria-label="직원 화면으로 전환"
                        >
                            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                            </svg>
                        </button>

                        <button
                            onClick={() => { markReleaseNotesSeen(); setShowReleaseNotes(true); }}
                            className="btn-icon relative min-h-[48px] min-w-[48px] text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
                            title="업데이트 소식"
                            aria-label={hasNewReleaseNotes ? '업데이트 소식 (새 소식 있음)' : '업데이트 소식'}
                        >
                            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
                            </svg>
                            {hasNewReleaseNotes && (
                                <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-600 ring-2 ring-white dark:ring-surface-900" />
                            )}
                        </button>
                        <AdminNotice />
                        <NotificationBell />
                    </div>
                </header>

                {showReleaseNotes && <ReleaseNotesModal onClose={() => setShowReleaseNotes(false)} />}

                <div className="flex-1 p-4 lg:p-6 overflow-y-auto">
                    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 spinner" /></div>}>
                        {/* 라우트 단위 경계 — 한 화면(예: 차트)의 크래시가 관리자 화면 전체를 비우지 않게 한다 (2026-09-02).
                            key를 경로로 두어 다른 메뉴로 이동하면 경계가 새로 마운트돼 폴백에서 벗어난다 — 없으면 hasError가 남아 모든 메뉴가 계속 폴백만 보인다. */}
                        <ErrorBoundary key={location.pathname}>
                            <Routes>
                                <Route path="dashboard" element={<AdminDashboard />} />
                                <Route path="spaces" element={<SpaceManager />} />
                                <Route path="surveys" element={<SurveyManager />} />
                                <Route path="surveys/:surveyId" element={<SurveyReport />} />
                                <Route path="assets" element={<AssetList />} />
                                <Route path="assets/unplaced" element={<UnplacedAssets />} />
                                <Route path="assets/new" element={<AssetForm />} />
                                <Route path="assets/:assetId" element={<AssetDetail />} />
                                <Route path="assets/:assetId/edit" element={<AssetForm />} />
                                <Route path="import" element={<AssetImport />} />
                                <Route path="employees" element={<EmployeeManager />} />
                                <Route path="settings" element={<Settings />} />
                                {/* 접속기록 점검 — 왼쪽 메뉴와 설정 카드 양쪽에서 진입한다 */}
                                <Route path="audit-logs" element={<AuditLogViewer />} />
                                <Route path="" element={<Navigate to="dashboard" replace />} />
                            </Routes>
                        </ErrorBoundary>
                    </Suspense>
                </div>
            </main>
        </div>
    );
}
