import { useState } from 'react';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { Feedback } from '../../types';

interface FeedbackItemProps {
    fb: Feedback;
    showAuthorInfo?: boolean;
    // 부모로부터 받아오는 상태
    expandedId: string | null;
    orgNames: Record<string, string>;
    copiedMessage: string | null;
    sendingReply: string | null;
    replyError: string | null;
    // 부모로부터 받아오는 핸들러
    onToggleExpand: (id: string | null) => void;
    onToggleResolve: (fb: Feedback) => void;
    onSetDeleteTarget: (fb: Feedback) => void;
    onSetSelectedImage: (image: { urls: string[]; index: number }) => void;
    onCopyMessage: (e: React.MouseEvent, id: string, message: string) => void;
    onSendReply: (id: string, text: string) => void;
}

export default function FeedbackItem({
    fb,
    showAuthorInfo = false,
    expandedId,
    orgNames,
    copiedMessage,
    sendingReply,
    replyError,
    onToggleExpand,
    onToggleResolve,
    onSetDeleteTarget,
    onSetSelectedImage,
    onCopyMessage,
    onSendReply,
}: FeedbackItemProps) {
    const isExpanded = expandedId === fb.id;
    const isResolved = fb.status === 'read' || fb.status === 'resolved';
    const isUnread = !isResolved;

    // 답변은 직접 쓴다 — AI 초안은 2026-10-16 운영자 요청으로 없앴다(옛 문서의 aiDraft도 쓰지 않는다)
    const [replyText, setReplyText] = useState('');
    // 이 의견에서 발송을 눌렀는지 — 훅의 replyError는 어느 의견의 것인지 모르고, 발송이 끝나면
    // sendingReply가 비워져 예전 조건(sendingReply === fb.id)으로는 오류가 한 번도 보이지 않았다
    const [triedSend, setTriedSend] = useState(false);

    return (
        <div
            className={`border-b border-surface-50 dark:border-surface-700/50 last:border-b-0 ${isResolved ? 'border-l-4 border-l-accent-400' : isUnread ? 'border-l-4 border-l-primary-400' : ''}`}
        >
            {/* 펼치기 버튼과 처리 버튼을 나란히 둔다 — 예전에는 div role="button" 안에 버튼이 들어 있었다 */}
            <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => onToggleExpand(isExpanded ? null : fb.id)}
                    className="flex-1 min-w-0 min-h-[48px] flex items-start gap-2 text-left rounded-xl p-1 hover:bg-surface-50/70 dark:hover:bg-surface-700/30 transition-colors"
                >
                    <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-surface-600 dark:text-surface-400">{isExpanded ? '▾' : '▸'}</span>
                    <span className="flex-1 min-w-0 block">
                        {showAuthorInfo && (
                            <span className="mb-2 flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                                    {fb.userName || '이름 없음'}
                                </span>
                                {fb.authorUid === 'public-inquiry' && (
                                    <span className="badge-neutral">
                                        비회원 (로그인 전) 문의
                                    </span>
                                )}
                                {(fb.organizationId || fb.organizationName) && (
                                    <span className="text-xs text-surface-600 dark:text-surface-400">
                                        {fb.organizationName || (fb.organizationId && orgNames[fb.organizationId]) || fb.organizationId}
                                    </span>
                                )}
                                {fb.userEmail && (
                                    <span className="text-xs text-surface-600 dark:text-surface-400 break-all">
                                        {fb.userEmail}
                                    </span>
                                )}
                            </span>
                        )}
                        {/* 펼치면 아래에 전문이 나오므로 여기서는 접혔을 때만 두 줄 미리보기를 보인다(같은 글이 두 번 보이던 것) */}
                        {!isExpanded && (
                            <span className="block text-sm text-surface-700 dark:text-surface-300 line-clamp-2">
                                {fb.message}
                            </span>
                        )}
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-surface-600 dark:text-surface-400">
                            {isResolved
                                ? <span className="badge-success">처리완료</span>
                                : <span className="badge-primary">미확인</span>}
                            <span>{formatTimestampFull(fb.createdAt) || '-'}</span>
                            {fb.imageUrls && fb.imageUrls.length > 0 && (
                                <span className="flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 0 3z" />
                                    </svg>
                                    이미지 {fb.imageUrls?.length ?? 0}장
                                </span>
                            )}
                        </span>
                    </span>
                </button>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                    {/* 버튼 글자는 지금 상태가 아니라 누르면 일어날 일을 적는다 */}
                    <button
                        type="button"
                        onClick={() => onToggleResolve(fb)}
                        className="btn-secondary btn-sm min-h-[48px]"
                    >
                        {isUnread ? '처리완료로 표시' : '미확인으로 되돌리기'}
                    </button>
                    <button
                        type="button"
                        onClick={(e) => onCopyMessage(e, fb.id, fb.message || '')}
                        className="btn-icon text-surface-600 dark:text-surface-400 hover:text-primary-700 hover:bg-primary-50 dark:hover:text-primary-300 dark:hover:bg-primary-900/30"
                        aria-label={copiedMessage === fb.id ? '본문을 복사했습니다' : '본문 복사'}
                    >
                        {copiedMessage === fb.id ? (
                            <svg className="w-4 h-4 text-accent-700 dark:text-accent-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                        ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                            </svg>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => onSetDeleteTarget(fb)}
                        className="btn-icon text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                        aria-label="의견 삭제"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* 확장된 내용 */}
            {isExpanded && (
                <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50 p-4 animate-slide-down">
                    <div className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap mb-4">
                        {fb.message}
                    </div>

                    {/* 첨부 이미지 */}
                    {fb.imageUrls && fb.imageUrls.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-2">첨부 이미지</p>
                            <div className="flex gap-3 flex-wrap">
                                {fb.imageUrls?.map((url: string, idx: number) => (
                                    <button
                                        type="button"
                                        key={idx}
                                        onClick={() => onSetSelectedImage({ urls: fb.imageUrls ?? [], index: idx })}
                                        className="w-24 h-24 rounded-xl overflow-hidden border border-surface-200 dark:border-surface-600 hover:border-primary-300 dark:hover:border-primary-700/50 hover:shadow-md transition-all"
                                        aria-label={`첨부 이미지 ${idx + 1} 크게 보기`}
                                    >
                                        <img
                                            src={url}
                                            alt=""
                                            className="w-full h-full object-cover"
                                        />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── 답변 작성·발송 영역 ── */}
                    <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-600">
                        {fb.status === 'resolved' ? (
                            /* 답변 완료 — 발송된 답변 표시 */
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sm font-semibold text-accent-700 dark:text-accent-300"><span aria-hidden="true">✅ </span>발송된 답변</span>
                                    {fb.repliedBy === 'superAdmin' && (
                                        <span className="badge-primary">
                                            관리자
                                        </span>
                                    )}
                                    {fb.repliedAt && (
                                        <span className="text-xs text-surface-600 dark:text-surface-400">
                                            {formatTimestampFull(fb.repliedAt)}
                                        </span>
                                    )}
                                </div>
                                <div className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap bg-accent-50/50 dark:bg-accent-900/10 rounded-xl p-3 border border-accent-200/50 dark:border-accent-800/30">
                                    {fb.reply}
                                </div>
                            </div>
                        ) : (
                            /* 미답변 — 답변 작성 + 발송 */
                            <div>
                                <label htmlFor={`reply-${fb.id}`} className="block mb-2 text-sm font-semibold text-surface-700 dark:text-surface-300">
                                    <span aria-hidden="true">✍️ </span>답변 작성
                                </label>
                                {/* 답변 편집 textarea */}
                                <textarea
                                    id={`reply-${fb.id}`}
                                    value={replyText}
                                    onChange={(e) => { setReplyText(e.target.value); setTriedSend(false); }}
                                    className="w-full min-h-[200px] p-3 rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-700 text-sm md:text-base text-surface-700 dark:text-surface-300 resize-y focus:ring-2 focus:ring-primary-300 dark:focus:ring-primary-700 focus:border-transparent transition-all"
                                    placeholder="답변을 작성하세요..."
                                />

                                {/* 에러 메시지 */}
                                {replyError && triedSend && sendingReply !== fb.id && (
                                    <p className="text-xs text-red-700 dark:text-red-300 mt-1" role="alert">{replyError} 작성한 답변은 그대로 남아 있습니다.</p>
                                )}

                                {/* 발송 버튼 */}
                                <div className="flex justify-end mt-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!replyText.trim()) return;
                                            setTriedSend(true);
                                            onSendReply(fb.id, replyText);
                                        }}
                                        disabled={sendingReply === fb.id || !replyText.trim()}
                                        className="btn-primary min-h-[48px] text-sm"
                                    >
                                        {sendingReply === fb.id ? (
                                            <>
                                                <span className="w-4 h-4 spinner" aria-hidden="true" />
                                                발송 중...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                                                </svg>
                                                답변 발송
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
