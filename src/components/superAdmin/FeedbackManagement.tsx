import { useState, useEffect, useCallback, useRef } from 'react';
import useFeedbackManagement from '../../hooks/useFeedbackManagement';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { Feedback } from '../../types';
import FeedbackItem from './FeedbackItem';

export default function FeedbackManagement() {
    const {
        loading,
        loadError,
        reload,
        feedbacks,
        searchQuery,
        setSearchQuery,
        filter,
        setFilter,
        selectedImage,
        setSelectedImage,
        deleteTarget,
        setDeleteTarget,
        deleting,
        orgNames,
        expandedId,
        setExpandedId,
        expandedGroups,
        copiedEmail,
        copiedMessage,
        sendingReply,
        replyError,
        handleToggleResolve,
        handleDelete,
        handleSendReply,
        groupedFeedbacks,
        toggleGroup,
        handleCopyEmail,
        handleCopyMessage,
        totalFiltered,
        unreadCount,
        resolvedCount,
        timelineFeedbacks,
    } = useFeedbackManagement();

    // 보기 모드 상태
    const [viewMode, setViewMode] = useState<'grouped' | 'timeline'>('grouped');

    // 삭제 확인 창 — 열리면 취소 버튼에 초점을 두고 Esc로 닫는다
    const deleteCancelRef = useRef<HTMLButtonElement>(null);
    const deleteOpen = deleteTarget !== null;
    useEffect(() => {
        if (!deleteOpen) return;
        deleteCancelRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) setDeleteTarget(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [deleteOpen, deleting, setDeleteTarget]);

    // 확대 이미지 넘기기 — 끝에서 다음을 누르면 처음으로 돌아간다
    const showSiblingImage = useCallback((step: number) => {
        setSelectedImage(prev => prev && {
            ...prev,
            index: (prev.index + step + prev.urls.length) % prev.urls.length,
        });
    }, [setSelectedImage]);

    // 확대 보기 중 키보드 ←/→로 넘기고 Esc로 닫는다
    const imageOpen = selectedImage !== null;
    useEffect(() => {
        if (!imageOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') showSiblingImage(-1);
            else if (e.key === 'ArrowRight') showSiblingImage(1);
            else if (e.key === 'Escape') setSelectedImage(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [imageOpen, showSiblingImage, setSelectedImage]);

    const renderFeedbackItem = (fb: Feedback, showAuthorInfo = false) => {
        return (
            <FeedbackItem
                key={fb.id}
                fb={fb}
                showAuthorInfo={showAuthorInfo}
                expandedId={expandedId}
                orgNames={orgNames}
                copiedMessage={copiedMessage}
                sendingReply={sendingReply}
                replyError={replyError}
                onToggleExpand={setExpandedId}
                onToggleResolve={handleToggleResolve}
                onSetDeleteTarget={setDeleteTarget}
                onSetSelectedImage={setSelectedImage}
                onCopyMessage={handleCopyMessage}
                onSendReply={handleSendReply}
            />
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20" role="status" aria-label="의견 불러오는 중">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="max-w-4xl mx-auto glass-card p-6 text-center">
                <p className="text-red-700 dark:text-red-300 mb-3" role="alert">의견 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.</p>
                <button type="button" className="btn-secondary min-h-[48px] px-5" onClick={reload}>다시 불러오기</button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">의견 관리</h1>
                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                    사용자가 보낸 의견을 확인하세요
                    {unreadCount > 0 && (
                        <span className="ml-2 badge-danger">
                            미확인 {unreadCount}건
                        </span>
                    )}
                </p>
            </div>

            {/* 필터 & 검색 */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
                    {[
                        { key: 'unread', label: '미확인' },
                        { key: 'resolved', label: `처리완료${resolvedCount > 0 ? ` ${resolvedCount}` : ''}` },
                        { key: 'all', label: '전체' },
                    ].map(f => (
                        <button
                            type="button"
                            key={f.key}
                            aria-pressed={filter === f.key}
                            onClick={() => setFilter(f.key as 'all' | 'unread' | 'resolved')}
                            className={`px-3 py-1.5 min-h-[48px] rounded-lg text-sm font-medium transition-all ${filter === f.key
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-600 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
                                }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                
                <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl p-1 shrink-0">
                    {[
                        { key: 'grouped', label: '사람별' },
                        { key: 'timeline', label: '시간순' },
                    ].map(v => (
                        <button
                            type="button"
                            key={v.key}
                            aria-pressed={viewMode === v.key}
                            onClick={() => setViewMode(v.key as 'grouped' | 'timeline')}
                            className={`px-3 py-1.5 min-h-[48px] rounded-lg text-sm font-medium transition-all ${viewMode === v.key
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-600 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
                                }`}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>

                <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="input pl-10 min-h-[48px]"
                        aria-label="의견 검색"
                        placeholder="작성자, 이메일, 내용 검색"
                    />
                </div>
            </div>

            {/* 피드백 목록 */}
            {totalFiltered === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 dark:text-surface-600 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                    </svg>
                    <p className="text-surface-600 dark:text-surface-400 text-lg font-medium">
                        {feedbacks.length === 0 ? '받은 의견이 없습니다' : searchQuery.trim() ? '검색 결과가 없습니다' : '이 조건에 맞는 의견이 없습니다'}
                    </p>
                    {feedbacks.length > 0 && filter !== 'all' && (
                        <button type="button" onClick={() => setFilter('all')} className="btn-secondary btn-sm min-h-[48px] mt-3">
                            전체 의견 보기
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid gap-3">
                    {viewMode === 'timeline' ? (
                        <div className="glass-card overflow-hidden">
                            {timelineFeedbacks.map(fb => renderFeedbackItem(fb, true))}
                        </div>
                    ) : (
                        groupedFeedbacks.map(group => {
                            const isGroupOpen = expandedGroups.has(group.key);
                            const latestTime = formatTimestampFull(group.items[0]?.createdAt) || '-';

                            return (
                                <div key={group.key} className="glass-card overflow-hidden">
                                    {/* 그룹 헤더 — 펼치기 버튼과 이메일 복사 버튼을 나란히 둔다(버튼 안의 버튼 방지) */}
                                    <div className="p-3 sm:p-4 flex items-start gap-2">
                                        <button
                                            type="button"
                                            aria-expanded={isGroupOpen}
                                            onClick={() => toggleGroup(group.key)}
                                            className="flex-1 min-w-0 min-h-[48px] flex items-center gap-3 text-left rounded-xl p-1 hover:bg-surface-50/70 dark:hover:bg-surface-700/30 transition-colors"
                                        >
                                            <span aria-hidden="true" className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary-700 dark:text-primary-300">
                                                {(group.name || '?')[0]}
                                            </span>
                                            <span className="flex-1 min-w-0 block">
                                                <span className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                                                        {group.name}
                                                    </span>
                                                    {group.orgName && (
                                                        <span className="text-xs text-surface-600 dark:text-surface-400">
                                                            {group.orgName}
                                                        </span>
                                                    )}
                                                    <span className="badge-neutral">
                                                        {group.items.length}건
                                                    </span>
                                                    {group.unreadCount > 0 && (
                                                        <span className="badge-primary">
                                                            미확인 {group.unreadCount}
                                                        </span>
                                                    )}
                                                </span>
                                                {group.email && (
                                                    <span className="block text-xs text-surface-600 dark:text-surface-400 break-all">
                                                        {group.email}
                                                    </span>
                                                )}
                                                <span className="block text-xs text-surface-600 dark:text-surface-400">
                                                    최근 {latestTime}
                                                </span>
                                            </span>
                                            <span aria-hidden="true" className="shrink-0 text-surface-600 dark:text-surface-400">
                                                {isGroupOpen ? '▾' : '▸'}
                                            </span>
                                        </button>
                                        {group.email && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleCopyEmail(e, group.email)}
                                                className="btn-icon shrink-0 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700"
                                                aria-label={copiedEmail === group.email ? '이메일을 복사했습니다' : `${group.name} 이메일 복사`}
                                            >
                                                {copiedEmail === group.email ? (
                                                    <svg className="w-4 h-4 text-accent-700 dark:text-accent-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-2.234-1.233-4.154-3.05-5.16" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 2.25h-3a2.25 2.25 0 0 0-2.25 2.25v.75h7.5v-.75A2.25 2.25 0 0 0 16.5 2.25Z" />
                                                    </svg>
                                                )}
                                            </button>
                                        )}
                                    </div>

                                    {/* 그룹 내 의견 목록 */}
                                    {isGroupOpen && (
                                        <div className="border-t border-surface-100 dark:border-surface-700 animate-slide-down">
                                            {group.items.map(fb => renderFeedbackItem(fb, false))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* 이미지 확대 모달 — 바깥을 누르거나 Esc(위 keydown)로 닫는다 */}
            {selectedImage && (
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setSelectedImage(null)}
                >
                    {/* 창 안 클릭이 바깥 닫기로 번지지 않게만 막는다 (TestOrgPickerModal과 같은 방식) */}
                    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="첨부 이미지 크게 보기"
                        className="relative max-w-3xl max-h-[90vh] mx-4 animate-scale-in"
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setSelectedImage(null)}
                            aria-label="닫기"
                            className="absolute -top-3 -right-3 w-12 h-12 bg-white dark:bg-surface-800 rounded-full shadow-lg flex items-center justify-center text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-surface-100 transition-colors z-10"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <img
                            src={selectedImage.urls[selectedImage.index]}
                            alt={`첨부 이미지 ${selectedImage.index + 1}`}
                            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
                        />
                        {/* 이미지가 2장 이상이면 이전/다음 버튼과 위치 표시 */}
                        {selectedImage.urls.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => showSiblingImage(-1)}
                                    aria-label="이전 이미지"
                                    className="absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/90 dark:bg-surface-800/90 rounded-full shadow-lg flex items-center justify-center text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-surface-100 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => showSiblingImage(1)}
                                    aria-label="다음 이미지"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/90 dark:bg-surface-800/90 rounded-full shadow-lg flex items-center justify-center text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-surface-100 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                    </svg>
                                </button>
                                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-xs font-medium" aria-live="polite">
                                    {selectedImage.index + 1} / {selectedImage.urls.length}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* 삭제 확인 모달 — Esc(위 keydown)나 바깥을 누르면 닫는다 */}
            {deleteTarget && (
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => !deleting && setDeleteTarget(null)}
                >
                    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="feedback-delete-title"
                        aria-describedby="feedback-delete-desc"
                        className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl p-6 max-w-sm mx-4 animate-scale-in"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                                <svg className="w-5 h-5 text-red-700 dark:text-red-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </div>
                            <div>
                                <h3 id="feedback-delete-title" className="font-semibold text-surface-900 dark:text-surface-100">의견 삭제</h3>
                                <p className="text-sm text-surface-600 dark:text-surface-400">
                                    <span className="font-medium">{deleteTarget.userName || '이름 없음'}</span>님의 의견을 삭제할까요?
                                </p>
                            </div>
                        </div>
                        <p id="feedback-delete-desc" className="text-sm text-red-700 dark:text-red-300 mb-5">삭제된 의견은 복구할 수 없습니다.</p>
                        <div className="flex gap-2 justify-end">
                            <button
                                ref={deleteCancelRef}
                                type="button"
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                                className="btn-secondary min-h-[48px] text-sm"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={deleting}
                                className="btn-danger min-h-[48px] text-sm"
                            >
                                {deleting ? '삭제 중...' : '삭제'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
