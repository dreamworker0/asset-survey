/**
 * HelpModal — 로그인한 사용자용 '도움말 · 자주 하는 질문' 인앱 모달 (2026-11-24)
 *
 * 직원은 [더보기], 관리자는 [설정]에서 연다. 공개 FAQ(/faq)는 라이트모드 강제·공개 네비를 쓰므로
 * 로그인 상태에서는 다크모드를 유지하는 이 모달로 같은 FAQ 데이터(shared/faqData.ts)를 보여 준다.
 *
 * - 검색: 질문·답변을 함께, 띄어쓰기·대소문자 무시(lib/helpSearch)
 * - 분류별 접기/펼치기. 직원은 현장 분류(스캔·제출·설치)를 먼저, 맨 위에 '처음 쓰는 분께' 8단계
 * - AI에게 묻기: FAQ로 못 찾은 질문을 askAI로 보낸다(useAskAI). 개인정보를 적지 말라는 안내를 늘 보인다
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    EMPLOYEE_QUICK_GUIDE, EMPLOYEE_QUICK_GUIDE_TITLE, EMPLOYEE_QUICK_GUIDE_TIP,
} from '../../lib/faqData';
import { groupFaqs, normalizeForSearch, type HelpRole } from '../../lib/helpSearch';
import useAskAI, { ASK_AI_MAX_LENGTH, ASK_AI_PRIVACY_NOTICE } from '../../hooks/useAskAI';

interface Props {
    /** 보는 사람 — 직원이면 현장 분류와 처음 쓰는 분께 안내를 먼저 보여 준다 */
    audience: HelpRole;
    onClose: () => void;
}

export default function HelpModal({ audience, onClose }: Props) {
    const baseId = useId();
    const titleId = `${baseId}-title`;
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const questionRef = useRef<HTMLTextAreaElement>(null);

    const [search, setSearch] = useState('');
    const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set());
    const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());
    const [guideOpen, setGuideOpen] = useState(true);
    const [question, setQuestion] = useState('');
    const { status, answer, error, ask } = useAskAI();

    const searching = normalizeForSearch(search).length > 0;
    const groups = useMemo(() => groupFaqs(audience, search), [audience, search]);
    const matchCount = groups.reduce((n, g) => n + g.items.length, 0);

    // 부모가 매번 새 onClose를 넘겨도 포커스가 다시 튀지 않도록 최신 값만 ref에 담는다
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    // 열리면 닫기 버튼에 포커스, 닫히면 연 버튼으로 포커스를 돌려준다.
    // Esc는 포커스 위치와 상관없이 닫고, Tab은 모달 안에서만 돈다(ConfirmModal과 같은 방식).
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onCloseRef.current(); return; }
            if (e.key !== 'Tab' || !dialogRef.current) return;
            const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input, textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            opener?.focus?.();
        };
    }, []);

    const toggleCategory = (category: string) => setOpenCategories((prev) => {
        const next = new Set(prev);
        if (next.has(category)) next.delete(category); else next.add(category);
        return next;
    });
    const toggleItem = (id: string) => setOpenItems((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    /** 검색으로 못 찾았을 때 — 검색어를 질문 칸으로 옮겨 AI에게 묻기로 이어 준다 */
    const moveSearchToQuestion = () => {
        setQuestion(search.trim().slice(0, ASK_AI_MAX_LENGTH));
        questionRef.current?.focus();
        questionRef.current?.scrollIntoView?.({ block: 'center' });
    };

    const handleAsk = (e: React.FormEvent) => {
        e.preventDefault();
        if (!question.trim() || status === 'loading') return;
        void ask(question);
    };

    const loading = status === 'loading';

    return createPortal(
        <div
            role="presentation"
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
            onClick={onClose}
        >
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-white dark:bg-surface-800 rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] flex flex-col animate-scale-in"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 머리 — 스크롤해도 닫기 버튼이 늘 보이게 본문과 나눈다 */}
                <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-surface-100 dark:border-surface-700">
                    <h3 id={titleId} className="text-lg font-bold text-surface-900 dark:text-surface-100">
                        <span aria-hidden="true">❓ </span>도움말 · 자주 하는 질문
                    </h3>
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

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* 직원: 처음 쓰는 분께 */}
                    {audience === 'employee' && !searching && (
                        <section aria-labelledby={`${baseId}-guide`} className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20">
                            <h4 id={`${baseId}-guide`} className="m-0">
                                <button
                                    type="button"
                                    aria-expanded={guideOpen}
                                    aria-controls={`${baseId}-guide-body`}
                                    onClick={() => setGuideOpen((v) => !v)}
                                    className="w-full flex items-center justify-between gap-2 px-4 min-h-[48px] text-left text-sm font-bold text-primary-800 dark:text-primary-200 rounded-xl focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                                >
                                    <span><span aria-hidden="true">🙋 </span>처음 쓰는 분께</span>
                                    <span aria-hidden="true">{guideOpen ? '▾' : '▸'}</span>
                                </button>
                            </h4>
                            {guideOpen && (
                                <div id={`${baseId}-guide-body`} className="px-4 pb-4 space-y-2">
                                    <p className="text-xs font-semibold text-primary-700 dark:text-primary-300">{EMPLOYEE_QUICK_GUIDE_TITLE}</p>
                                    <ol className="list-decimal pl-5 space-y-1.5 text-sm text-surface-800 dark:text-surface-200 leading-relaxed">
                                        {EMPLOYEE_QUICK_GUIDE.map((step) => (
                                            <li key={step.text}>
                                                {step.text}
                                                {step.details && (
                                                    <ul className="list-disc pl-5 mt-1 space-y-0.5 text-surface-700 dark:text-surface-300">
                                                        {step.details.map((d) => <li key={d}>{d}</li>)}
                                                    </ul>
                                                )}
                                            </li>
                                        ))}
                                    </ol>
                                    <p className="text-xs text-surface-700 dark:text-surface-300 leading-relaxed">{EMPLOYEE_QUICK_GUIDE_TIP}</p>
                                </div>
                            )}
                        </section>
                    )}

                    {/* 검색 */}
                    <div className="space-y-2">
                        <label htmlFor={`${baseId}-search`} className="block text-sm font-semibold text-surface-800 dark:text-surface-200">
                            질문 찾기
                        </label>
                        <input
                            id={`${baseId}-search`}
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="예: 라벨, 제출, 카메라"
                            className="input min-h-[48px]"
                        />
                        {searching && (
                            <p role="status" className="text-xs text-surface-600 dark:text-surface-400">
                                {matchCount > 0 ? `질문 ${matchCount}개를 찾았어요.` : '맞는 질문이 없어요. 아래 AI에게 묻기를 써 보세요.'}
                            </p>
                        )}
                        {searching && matchCount === 0 && (
                            <button type="button" onClick={moveSearchToQuestion} className="btn-secondary btn-sm min-h-[48px] w-full">
                                이 낱말로 AI에게 묻기
                            </button>
                        )}
                    </div>

                    {/* 분류별 FAQ */}
                    <div className="space-y-2">
                        {groups.map((group, groupIdx) => {
                            // 분류 이름에는 공백이 있어 id로 쓰지 않는다(aria-controls는 공백으로 id를 나눈다)
                            const catId = `${baseId}-cat-${groupIdx}`;
                            // 검색 중에는 찾은 분류를 모두 펼친다
                            const catOpen = searching || openCategories.has(group.category);
                            return (
                                <section key={group.category} className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
                                    <h4 className="m-0">
                                        <button
                                            type="button"
                                            aria-expanded={catOpen}
                                            aria-controls={catId}
                                            onClick={() => toggleCategory(group.category)}
                                            className="w-full flex items-center justify-between gap-2 px-4 min-h-[48px] text-left bg-surface-50 dark:bg-surface-700/60 hover:bg-surface-100 dark:hover:bg-surface-700 text-sm font-semibold text-surface-900 dark:text-surface-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                                        >
                                            <span>{group.category} <span className="font-normal text-surface-600 dark:text-surface-400">({group.items.length})</span></span>
                                            <span aria-hidden="true">{catOpen ? '▾' : '▸'}</span>
                                        </button>
                                    </h4>
                                    {catOpen && (
                                        <ul id={catId} className="divide-y divide-surface-100 dark:divide-surface-700">
                                            {group.items.map((item) => {
                                                const itemOpen = openItems.has(item.id);
                                                const answerId = `${baseId}-a-${item.id}`;
                                                return (
                                                    <li key={item.id}>
                                                        <button
                                                            type="button"
                                                            aria-expanded={itemOpen}
                                                            aria-controls={answerId}
                                                            onClick={() => toggleItem(item.id)}
                                                            className="w-full flex items-start gap-2 px-4 py-3 min-h-[48px] text-left text-sm text-surface-800 dark:text-surface-200 hover:bg-primary-50 dark:hover:bg-surface-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                                                        >
                                                            <span aria-hidden="true" className="text-primary-700 dark:text-primary-300 font-bold">Q</span>
                                                            <span className="flex-1 leading-snug">{item.question}</span>
                                                            <span aria-hidden="true" className="text-surface-600 dark:text-surface-400">{itemOpen ? '▾' : '▸'}</span>
                                                        </button>
                                                        {itemOpen && (
                                                            <div id={answerId} className="px-4 pb-4 pt-1 space-y-1.5">
                                                                {item.answer.map((line, i) => (
                                                                    <p key={i} className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed">{line}</p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </section>
                            );
                        })}
                    </div>

                    {/* AI에게 묻기 */}
                    <section aria-labelledby={`${baseId}-ai`} className="rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3">
                        <h4 id={`${baseId}-ai`} className="text-sm font-bold text-surface-900 dark:text-surface-100">
                            <span aria-hidden="true">🤖 </span>AI에게 묻기
                        </h4>
                        <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
                            위에서 답을 못 찾았을 때 써 보세요. AI는 이 도움말에 적힌 내용 안에서만 답해요.
                        </p>
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 leading-relaxed">
                            <span aria-hidden="true">⚠️ </span>{ASK_AI_PRIVACY_NOTICE}
                        </p>
                        <form onSubmit={handleAsk} className="space-y-2">
                            <label htmlFor={`${baseId}-question`} className="sr-only">AI에게 물을 질문</label>
                            <textarea
                                id={`${baseId}-question`}
                                ref={questionRef}
                                value={question}
                                onChange={(e) => setQuestion(e.target.value.slice(0, ASK_AI_MAX_LENGTH))}
                                maxLength={ASK_AI_MAX_LENGTH}
                                rows={3}
                                placeholder="예: 라벨이 안 읽히면 어떻게 하나요?"
                                className="input min-h-[48px] resize-y"
                                aria-describedby={`${baseId}-count`}
                                disabled={loading}
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span id={`${baseId}-count`} className="text-xs text-surface-600 dark:text-surface-400">
                                    {question.length}/{ASK_AI_MAX_LENGTH}자
                                </span>
                                <button
                                    type="submit"
                                    disabled={!question.trim() || loading}
                                    className="btn-primary min-h-[48px] min-w-[96px]"
                                >
                                    {loading ? '보내는 중…' : '보내기'}
                                </button>
                            </div>
                        </form>

                        <div aria-live="polite">
                            {loading && (
                                <div role="status" className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                                    <span className="w-4 h-4 spinner" aria-hidden="true" />
                                    답을 만드는 중이에요…
                                </div>
                            )}
                            {status === 'answered' && (
                                <div className="rounded-lg bg-surface-50 dark:bg-surface-700/60 px-3 py-3 space-y-2">
                                    <p className="text-sm text-surface-900 dark:text-surface-100 whitespace-pre-line leading-relaxed">{answer}</p>
                                    <p className="text-xs text-surface-600 dark:text-surface-400">
                                        AI 답변은 틀릴 수 있어요. 중요한 일은 기관의 재물 담당자에게 확인해 주세요.
                                    </p>
                                </div>
                            )}
                        </div>
                        {status === 'error' && (
                            <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        )}
                    </section>
                </div>
            </div>
        </div>,
        document.body,
    );
}
