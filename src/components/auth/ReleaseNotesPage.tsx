import { useState, useEffect } from 'react';
import { loadReleaseNotes, type ReleaseNote } from '../../lib/releaseNotes';
import ReleaseNoteItems from '../common/ReleaseNoteItems';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';
import PublicNav from '../common/PublicNav';

export default function ReleaseNotesPage() {
    useForceLightMode();
    const [notes, setNotes] = useState<ReleaseNote[]>([]);
    const [loading, setLoading] = useState(true);

    // 불러오기에 실패하면 loadReleaseNotes가 빈 배열을 돌려준다 — 빈 화면 대신 다시 시도 버튼을 보인다
    const [attempt, setAttempt] = useState(0);
    const retry = () => { setLoading(true); setAttempt((n) => n + 1); };

    useEffect(() => {
        let cancelled = false;
        loadReleaseNotes().then((data) => {
            if (cancelled) return;
            setNotes(data);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [attempt]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 flex flex-col">
            <SEOHead
                title="업데이트 소식"
                description="재물조사의 신규 기능, 개선 사항, 버그 수정 내역을 확인하세요."
                path="/release-notes"
            />
            <PublicNav />
            <div className="flex-1 py-8 px-4">
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-soft p-6 md:p-8 space-y-8">
                    <div className="text-center border-b border-surface-100 dark:border-surface-700 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1"><span aria-hidden="true">📋 </span>업데이트 소식</h1>
                        <p className="text-sm text-surface-600 dark:text-surface-400">
                            재물조사 서비스의 변경 사항을 확인하세요.
                        </p>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12" role="status" aria-label="업데이트 소식을 불러오는 중">
                            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800/50 border-t-primary-600 rounded-full animate-spin" />
                        </div>
                    ) : notes.length === 0 ? (
                        <div className="text-center py-8 space-y-3">
                            <p className="text-sm text-surface-700 dark:text-surface-300">업데이트 소식을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.</p>
                            <button type="button" onClick={retry} className="btn-secondary btn-sm min-h-[48px]">다시 시도</button>
                        </div>
                    ) : (
                        notes.map((note, noteIdx) => (
                            <section key={note.date + noteIdx} className="space-y-3">
                                {/* 날짜 헤더 */}
                                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                    <time className="text-sm font-mono font-semibold text-primary-700 dark:text-primary-300 whitespace-nowrap">
                                        {note.date}
                                    </time>
                                    {note.title && (
                                        <span className="text-sm font-medium text-surface-700 dark:text-surface-300">
                                            {note.title}
                                        </span>
                                    )}
                                </div>

                                {/* 변경 사항 리스트 — 주제별로 묶는다 */}
                                <ReleaseNoteItems items={note.items} />

                                {/* 구분선 (마지막 제외) */}
                                {noteIdx < notes.length - 1 && (
                                    <hr className="border-surface-100 dark:border-surface-700" />
                                )}
                            </section>
                        ))
                    )}

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 text-center">
                        <p className="text-xs text-surface-600 dark:text-surface-400">
                            © 2026 재물조사. 지속적으로 개선하고 있습니다.
                        </p>
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
}
