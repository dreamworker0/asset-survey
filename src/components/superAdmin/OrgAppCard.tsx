/**
 * OrgAppCard — 기관 신청 카드 컴포넌트
 * OrgApplicationList에서 추출된 서브 컴포넌트
 */
import { memo, useId, useState } from 'react';
import { formatTimestampFull } from '../../lib/dateUtils';
import OrgDocumentViewer from './OrgDocumentViewer';
import { hasOrgDocument } from '../../lib/orgDocument';
import type { Organization } from '../../types';

interface OrgAppCardProps {
    app: Organization;
    tab: 'pending' | 'rejected';
    actionLoading: Record<string, string | null>;
    selectedApp: string | null;
    onApprove: (app: Organization) => void;
    onReject: (app: Organization, reason: string) => void;
    onDelete: (app: Organization) => void;
    onMoveToPending: (app: Organization) => void;
    onAiReanalyze: (app: Organization) => void;
    onToggleImage: (id: string) => void;
}

export default memo(function OrgAppCard({
    app,
    tab,
    actionLoading,
    selectedApp,
    onApprove,
    onReject,
    onDelete,
    onMoveToPending,
    onAiReanalyze,
    onToggleImage,
}: OrgAppCardProps) {
    const [isRejecting, setIsRejecting] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const reasonId = useId();

    const handleRejectClick = () => {
        const defaultReason = app.aiVerifyDetail?.reason || '비영리 목적의 사업자등록증이 제출되지 않았거나 내용 식별이 어렵습니다.\n서류 보완 후 다시 신청해 주시기 바랍니다.';
        setRejectReason(defaultReason);
        setIsRejecting(true);
    };

    return (
        <div className="glass-card p-5 hover:shadow-glass-lg transition-shadow">
            <div className="flex flex-col md:flex-row md:items-start gap-4">
                <div className="flex-1 space-y-3">
                    {/* 기관명 + 상태 배지 */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{app.name}</h3>
                        {tab === 'rejected' && (
                            <span className="badge-danger">
                                거절됨
                            </span>
                        )}
                        {tab === 'pending' && (
                            app.aiVerified ? (
                                // 대기 목록에 있으므로 아직 승인된 것이 아니다 — "자동 승인"이 아니라 추천으로 적는다
                                <span className="badge-success font-bold border border-green-200 dark:border-green-700">
                                    <span aria-hidden="true">✅</span> AI: 승인 추천
                                </span>
                            ) : app.aiVerifyDetail ? (
                                <span className="badge-danger font-bold border border-red-200 dark:border-red-700">
                                    <span aria-hidden="true">❌</span> AI: 거절 추천
                                </span>
                            ) : (
                                <span className="badge-neutral border border-surface-200 dark:border-surface-600">
                                    <span aria-hidden="true">🔍</span> AI 분석 필요
                                </span>
                            )
                        )}
                        {tab === 'rejected' && app.aiVerifyDetail?.rejected && (
                            <span className="badge-danger font-bold border border-red-200 dark:border-red-700">
                                <span aria-hidden="true">🤖</span> AI 자동 거부
                            </span>
                        )}
                    </div>

                    {/* 기관 상세 정보 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm break-all">
                        <div>
                            <span className="text-surface-600 dark:text-surface-400">신청자:</span>
                            <span className="ml-2 text-surface-700 dark:text-surface-300 font-medium">{app.applicantName}</span>
                        </div>
                        <div>
                            <span className="text-surface-600 dark:text-surface-400">이메일:</span>
                            <span className="ml-2 text-surface-700 dark:text-surface-300">{app.applicantEmail}</span>
                        </div>
                        {app.uniqueNumber && (
                            <div>
                                <span className="text-surface-600 dark:text-surface-400">고유번호:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300 font-mono">{app.uniqueNumber}</span>
                            </div>
                        )}
                        <div>
                            <span className="text-surface-600 dark:text-surface-400">전화번호:</span>
                            <span className="ml-2 text-surface-700 dark:text-surface-300">{app.applicantPhone || '-'}</span>
                        </div>
                        {app.address && (
                            <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-surface-600 dark:text-surface-400">주소:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300">{app.address}</span>
                                <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(app.address)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 min-h-[48px] px-2 rounded text-xs font-medium text-primary-700 dark:text-primary-300 underline underline-offset-2 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors break-keep"
                                >
                                    <span aria-hidden="true">📍</span> 지도에서 보기<span className="sr-only">(구글 지도, 새 창)</span>
                                </a>
                            </div>
                        )}
                        {tab === 'rejected' && app.rejectedAt && (
                            <div className="sm:col-span-2">
                                <span className="text-surface-600 dark:text-surface-400">거절일:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300">
                                    {formatTimestampFull(app.rejectedAt) || '-'}
                                </span>
                            </div>
                        )}
                        {app.createdAt && (
                            <div className="sm:col-span-2">
                                <span className="text-surface-600 dark:text-surface-400">신청일시:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300">
                                    {formatTimestampFull(app.createdAt) || '-'}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 하고 싶은 말 */}
                    {app.message && (
                        <div className="mt-2 px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 text-sm">
                            <span className="text-xs font-medium text-primary-700 dark:text-primary-300"><span aria-hidden="true">💬 </span>하고 싶은 말</span>
                            <p className="text-surface-700 dark:text-surface-300 mt-0.5 whitespace-pre-wrap">{app.message}</p>
                        </div>
                    )}

                    {/* 고유번호증 사본 토글 */}
                    {hasOrgDocument(app) && (
                        <div>
                            <button
                                type="button"
                                onClick={() => onToggleImage(app.id)}
                                aria-expanded={selectedApp === app.id}
                                className="btn-secondary btn-sm min-h-[48px]"
                            >
                                <span aria-hidden="true">{selectedApp === app.id ? '▾' : '▸'}</span>
                                증빙서류 사본 {selectedApp === app.id ? '닫기' : '보기'}
                            </button>
                            {selectedApp === app.id && (
                                <OrgDocumentViewer orgId={app.id} />
                            )}
                        </div>
                    )}

                    {/* AI 분석 미완료 시 분석 버튼 */}
                    {!app.aiVerifyDetail && hasOrgDocument(app) && (
                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={() => onAiReanalyze(app)}
                                disabled={!!actionLoading[app.id]}
                                className="btn-secondary btn-sm min-h-[48px]"
                            >
                                {actionLoading[app.id] === 'ai' ? (
                                    <><div className="w-3.5 h-3.5 spinner" aria-hidden="true" /> AI 분석 중...</>
                                ) : (
                                    <><span aria-hidden="true">🤖</span> AI 분석 실행</>
                                )}
                            </button>
                        </div>
                    )}

                    {/* AI 검증 상세 결과 */}
                    {app.aiVerifyDetail && (
                        <div className="mt-3 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-surface-600 dark:text-surface-400">AI 검증 결과</p>
                                <button
                                    type="button"
                                    onClick={() => onAiReanalyze(app)}
                                    disabled={!!actionLoading[app.id]}
                                    className="btn-secondary btn-sm min-h-[48px]"
                                >
                                    {actionLoading[app.id] === 'ai' ? '분석 중...' : 'AI 다시 분석'}
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                                <div className="flex items-center gap-1.5">
                                    <span aria-hidden="true" className={`w-2 h-2 shrink-0 rounded-full ${app.aiVerifyDetail.documentType === '고유번호증' || app.aiVerifyDetail.documentType === '사업자등록증(비영리)' ? 'bg-green-500 dark:bg-green-400' : 'bg-red-500 dark:bg-red-400'}`} />
                                    <span className="text-surface-600 dark:text-surface-400">문서 유형:</span>
                                    <span className={`font-medium ${app.aiVerifyDetail.documentType === '고유번호증' || app.aiVerifyDetail.documentType === '사업자등록증(비영리)' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                                        {app.aiVerifyDetail.documentType || '확인 불가'}
                                    </span>
                                </div>
                                {app.aiVerifyDetail.extractedName && (
                                    <div className="flex items-center gap-1.5">
                                        <span aria-hidden="true" className={`w-2 h-2 shrink-0 rounded-full ${app.aiVerifyDetail.nameMatch ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <span className="text-surface-600 dark:text-surface-400">추출 기관명:</span>
                                        <span className={`font-medium ${app.aiVerifyDetail.nameMatch ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                                            {app.aiVerifyDetail.extractedName}
                                            {app.aiVerifyDetail.nameMatch ? ' (신청 기관명과 일치)' : ' (신청 기관명과 다름)'}
                                        </span>
                                    </div>
                                )}
                                {app.aiVerifyDetail.uniqueNumber && (
                                    <div className="flex items-center gap-1.5">
                                        <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-green-500 dark:bg-green-400" />
                                        <span className="text-surface-600 dark:text-surface-400">{app.aiVerifyDetail.documentType === '고유번호증' ? '고유번호:' : '사업자번호:'}</span>
                                        <span className="font-mono text-surface-700 dark:text-surface-300">{app.aiVerifyDetail.uniqueNumber}</span>
                                    </div>
                                )}
                                {app.aiVerifyDetail.address && (
                                    <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2 break-all">
                                        <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-green-500 dark:bg-green-400" />
                                        <span className="text-surface-600 dark:text-surface-400">주소:</span>
                                        <span className="text-surface-700 dark:text-surface-300">{app.aiVerifyDetail.address}</span>
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(app.aiVerifyDetail.address)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 min-h-[48px] px-2 rounded text-xs font-medium text-primary-700 dark:text-primary-300 underline underline-offset-2 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors break-keep"
                                        >
                                            <span aria-hidden="true">📍</span> 지도에서 보기<span className="sr-only">(구글 지도, 새 창)</span>
                                        </a>
                                    </div>
                                )}
                                {app.aiVerifyDetail.rejected && app.aiVerifyDetail.reason && (
                                    <div className="sm:col-span-2 mt-1 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-xs text-red-700 dark:text-red-300">
                                        <span aria-hidden="true">⚠️ </span><span className="font-semibold">AI 거절 사유:</span> {app.aiVerifyDetail.reason}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 액션 버튼 */}
                {tab === 'pending' && (
                    <div className={`flex md:flex-col gap-2 ${isRejecting ? 'md:w-80' : ''}`}>
                        {!isRejecting ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onApprove(app)}
                                    disabled={!!actionLoading[app.id]}
                                    className="btn-success btn-sm min-h-[48px] flex-1 md:flex-none"
                                >
                                    {actionLoading[app.id] === 'approve' ? (
                                        <><div className="w-4 h-4 spinner" aria-hidden="true" />승인 중…</>
                                    ) : '승인'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRejectClick}
                                    disabled={!!actionLoading[app.id]}
                                    className="btn-danger btn-sm flex-1 md:flex-none min-h-[48px]"
                                >
                                    {actionLoading[app.id] === 'reject' ? (
                                        <><div className="w-4 h-4 spinner" aria-hidden="true" />거절 중…</>
                                    ) : '거절'}
                                </button>
                            </>
                        ) : (
                            <div className="w-full p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/30">
                                <label htmlFor={reasonId} className="block text-xs font-semibold text-red-800 dark:text-red-300 mb-1.5">
                                    거절 사유 (신청자에게 이메일·알림톡으로 보냅니다)
                                </label>
                                <textarea
                                    id={reasonId}
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    className="w-full text-sm p-2 rounded-md border border-red-200 dark:border-red-800/50 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-red-500/20 outline-none resize-none text-surface-900 dark:text-surface-100"
                                    rows={3}
                                    placeholder="신청자에게 발송될 거절 사유를 입력하세요."
                                />
                                <div className="flex flex-col sm:flex-row justify-end gap-2 mt-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsRejecting(false)}
                                        className="btn-secondary btn-sm min-h-[48px]"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsRejecting(false);
                                            onReject(app, rejectReason);
                                        }}
                                        className="btn-danger btn-sm min-h-[48px]"
                                        disabled={!!actionLoading[app.id] || !rejectReason.trim()}
                                    >
                                        {actionLoading[app.id] === 'reject' ? '처리 중...' : '거절 및 이메일 발송'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'rejected' && (
                    <div className="flex md:flex-col gap-2">
                        <button
                            type="button"
                            onClick={() => onMoveToPending(app)}
                            disabled={!!actionLoading[app.id]}
                            className="btn-secondary btn-sm min-h-[48px] flex-1 md:flex-none"
                        >
                            {actionLoading[app.id] === 'moveToPending' ? (
                                <><div className="w-4 h-4 spinner" aria-hidden="true" />되돌리는 중…</>
                            ) : '대기 중으로 되돌리기'}
                        </button>
                        <button
                            type="button"
                            onClick={() => onDelete(app)}
                            disabled={!!actionLoading[app.id]}
                            className="btn-danger btn-sm min-h-[48px] flex-1 md:flex-none"
                        >
                            {actionLoading[app.id] === 'delete' ? (
                                <><div className="w-4 h-4 spinner" aria-hidden="true" />삭제 중…</>
                            ) : '신청 기록 삭제'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});
