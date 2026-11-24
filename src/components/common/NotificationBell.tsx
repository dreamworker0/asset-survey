import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { subscribeNotifications, markNotificationRead, getNotifications, deleteNotification } from '../../lib/firestore';
import { useToast } from '../../hooks/useToast';
import type { Notification } from '../../types/notification';

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function renderMessageWithLinks(text: string) {
    if (!text) return null;
    const parts = text.split(URL_REGEX);
    return parts.map((part, i) => {
        if (part.match(URL_REGEX)) {
            return (
                <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-300 underline break-all"
                    onClick={(e) => e.stopPropagation()}
                >
                    {part}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

/** 알림 유형별 아이콘 반환 */
function getNotificationIcon(type?: string) {
    switch (type) {
        case 'feedback_reply': return '💬';
        case 'approval': return '✅';
        case 'rejection': return '❌';
        case 'admin_notice': return '📢';
        default: return 'ℹ️';
    }
}

export default function NotificationBell() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
    // 목록을 받는 동안 '알림이 없습니다'가 먼저 보였다가 바뀌던 것을 막는다
    const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
    const containerRef = useRef<HTMLDivElement>(null);
    const bellRef = useRef<HTMLButtonElement>(null);
    const { showToast } = useToast();

    useEffect(() => {
        if (!user) return;

        let unsubscribe: (() => void) | null = null;

        const startWatch = () => {
            if (!unsubscribe) {
                unsubscribe = subscribeNotifications(user.uid, (notifs) => {
                    setNotifications(notifs as Notification[]);
                });
            }
        };

        const stopWatch = () => {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                startWatch();
            } else {
                stopWatch();
            }
        };

        // 초기 마운트 시 가시성 체크 후 시작
        if (document.visibilityState === 'visible') {
            startWatch();
        }

        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            stopWatch();
        };
    }, [user]);

    // 외부 클릭 감지
    const handleClickOutside = useCallback((e: MouseEvent | TouchEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
            setIsOpen(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        // Esc로 닫고 알림 버튼으로 포커스를 돌려준다
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                bellRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen, handleClickOutside]);

    const loadList = async () => {
        if (!user) return;
        setListState('loading');
        try {
            const all = await getNotifications(user.uid, 20);
            setAllNotifications((all as Notification[]).map(n => ({ ...n, read: true })));
            setListState('ready');
        } catch (error) {
            console.error('알림 목록 불러오기 실패:', error);
            setListState('error');
        }
    };

    const handleOpen = async () => {
        setIsOpen(!isOpen);
        if (!isOpen && user) {
            // 읽지 않은 알림 모두 읽음 처리 → 뱃지 숫자 즉시 제거
            for (const n of notifications) {
                markNotificationRead(n.id).catch(() => { });
            }
            await loadList();
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            await deleteNotification(id);
            setAllNotifications(prev => prev.filter(n => n.id !== id));
            setNotifications(prev => prev.filter(n => n.id !== id));
        } catch (error) {
            console.error('Failed to delete notification:', error);
            showToast('알림을 지우지 못했습니다. 잠시 뒤 다시 눌러 주세요.', 'error');
        }
    };

    const unreadCount = notifications.length;

    return (
        <div className="relative" ref={containerRef}>
            <button
                ref={bellRef}
                type="button"
                onClick={handleOpen}
                className="relative btn-icon text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 min-w-[48px] min-h-[48px] flex items-center justify-center"
                aria-label={`알림${unreadCount > 0 ? ` (${unreadCount}건 읽지 않음)` : ''}`}
                aria-expanded={isOpen}
                aria-controls="notification-panel"
            >
                <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {unreadCount > 0 && (
                    <span aria-hidden="true" className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 dark:bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center animate-scale-in">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div id="notification-panel" className="notification-dropdown" role="region" aria-labelledby="notification-panel-title">
                    <div className="p-4 border-b border-surface-100 dark:border-surface-700">
                        <h3 id="notification-panel-title" className="font-semibold text-surface-800 dark:text-surface-200">알림</h3>
                    </div>
                    {listState === 'loading' ? (
                        <div className="p-8 flex justify-center" role="status" aria-label="알림을 불러오는 중">
                            <div className="w-6 h-6 spinner" />
                        </div>
                    ) : listState === 'error' ? (
                        <div className="p-6 text-center space-y-3">
                            <p className="text-sm text-surface-700 dark:text-surface-300">알림을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</p>
                            <button type="button" onClick={() => { void loadList(); }} className="btn-secondary btn-sm min-h-[48px]">
                                다시 시도
                            </button>
                        </div>
                    ) : allNotifications.length === 0 ? (
                        <div className="p-8 text-center text-sm text-surface-600 dark:text-surface-400">
                            알림이 없습니다
                        </div>
                    ) : (
                        <ul className="divide-y divide-surface-50 dark:divide-surface-700">
                            {allNotifications.map(n => {
                                const icon = getNotificationIcon(n.type);
                                // 패널을 여는 순간 모두 읽음 처리되므로 항목 자체는 눌러서 할 일이 없다 — 버튼처럼 꾸미지 않는다
                                return (
                                    <li
                                        key={n.id}
                                        className="p-4 bg-white dark:bg-surface-800"
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className="text-base mt-0.5 flex-shrink-0" aria-hidden="true">{icon}</span>
                                            <div className="min-w-0 flex-1 pr-4">
                                                <div className="flex justify-between items-start gap-2">
                                                    <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{n.title}</p>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleDelete(e, n.id)}
                                                        className="text-surface-600 dark:text-surface-400 hover:text-red-700 dark:hover:text-red-300 transition-colors p-1 -mr-2 min-w-[48px] min-h-[48px] flex items-center justify-center flex-shrink-0"
                                                        aria-label={`'${n.title}' 알림 지우기`}
                                                    >
                                                        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 break-words whitespace-pre-wrap leading-relaxed">
                                                    {renderMessageWithLinks(n.message)}
                                                </p>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
