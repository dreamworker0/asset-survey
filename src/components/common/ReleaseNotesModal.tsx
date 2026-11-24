/**
 * ReleaseNotesModal — 로그인한 사용자용 '업데이트 소식' 인앱 모달
 *
 * 공개용 ReleaseNotesPage(/release-notes)는 라이트모드 강제·공개 네비를 쓰므로,
 * 로그인 상태에서는 다크모드를 유지하는 이 모달로 소식을 보여준다.
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { loadReleaseNotes, type ReleaseNote } from '../../lib/releaseNotes';
import ReleaseNoteItems from './ReleaseNoteItems';

/** 최근 N일 이내 소식만 노출(기본 7일). 너무 많은 과거 소식으로 압도되지 않게 한다. */
const RECENT_DAYS = 7;

function cutoffDateStr(days: number): string {
    const now = new Date();
    const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
}

export default function ReleaseNotesModal({ onClose }: { onClose: () => void }) {
    const [notes, setNotes] = useState<ReleaseNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);
    // 불러오기에 실패하면 loadReleaseNotes가 빈 배열을 돌려준다 — 다시 시도 버튼으로 재요청한다
    const [attempt, setAttempt] = useState(0);
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let cancelled = false;
        loadReleaseNotes().then((data) => {
            if (cancelled) return;
            setNotes(data);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [attempt]);

    // 부모가 매번 새 onClose를 넘겨도 포커스가 다시 튀지 않도록 최신 값만 ref에 담는다
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    // 열리면 닫기 버튼에 포커스, Esc는 포커스 위치와 상관없이 닫는다
    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // 최근 7일 이내 소식. 없으면 가장 최근 1건은 보여준다(빈 화면 방지).
    const cutoff = cutoffDateStr(RECENT_DAYS);
    const recent = notes.filter((n) => n.date >= cutoff);
    const sorted = [...notes].sort((a, b) => (a.date < b.date ? 1 : -1));
    const recentOrLatest = recent.length > 0 ? recent : sorted.slice(0, 1);
    const visibleNotes = showAll ? notes : recentOrLatest;
    const hiddenCount = notes.length - visibleNotes.length;

    return createPortal(
        <div
            role="presentation"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
        >
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="release-notes-modal-title"
                className="bg-white dark:bg-surface-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 animate-scale-in"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 id="release-notes-modal-title" className="text-lg font-bold text-surface-900 dark:text-surface-100"><span aria-hidden="true">📋 </span>업데이트 소식</h3>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        className="btn-icon min-h-[48px] min-w-[48px] text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200"
                        aria-label="창 닫기"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-12" role="status" aria-label="업데이트 소식을 불러오는 중"><div className="w-8 h-8 spinner" /></div>
                ) : notes.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                        <p className="text-sm text-surface-700 dark:text-surface-300">업데이트 소식을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.</p>
                        <button
                            type="button"
                            onClick={() => { setLoading(true); setAttempt((n) => n + 1); }}
                            className="btn-secondary btn-sm min-h-[48px]"
                        >
                            다시 시도
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {!showAll && recent.length > 0 && (
                            <p className="text-xs text-surface-600 dark:text-surface-400">최근 {RECENT_DAYS}일 이내 소식이에요.</p>
                        )}
                        {visibleNotes.map((note, noteIdx) => (
                            <section key={note.date + noteIdx} className="space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <time className="text-sm font-mono font-semibold text-primary-700 dark:text-primary-300 whitespace-nowrap">
                                        {note.date}
                                    </time>
                                    {note.title && (
                                        <span className="text-sm font-medium text-surface-700 dark:text-surface-300">
                                            {note.title}
                                        </span>
                                    )}
                                </div>
                                <ReleaseNoteItems items={note.items} />
                                {noteIdx < visibleNotes.length - 1 && (
                                    <hr className="border-surface-100 dark:border-surface-700 mt-4" />
                                )}
                            </section>
                        ))}

                        {!showAll && hiddenCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowAll(true)}
                                className="btn-secondary btn-sm w-full min-h-[48px]"
                            >
                                이전 업데이트 소식 모두 보기 ({hiddenCount}개) <span aria-hidden="true">▾</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
