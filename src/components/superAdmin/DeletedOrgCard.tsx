/**
 * DeletedOrgCard — 삭제된 기관 카드 (OrgManagement에서 분리)
 */
import type { Organization } from '../../types';
import { WITHDRAW_REASON_LABELS } from '../../types/organization';
import { toDateOrNull } from '../../lib/dateUtils';

interface DeletedOrgCardProps {
    org: Organization;
    isDeleting: boolean;
    onRestore: (org: Organization) => void;
    onPermanentDelete: (org: Organization) => void;
}

function getDaysInfo(deletedAt: Organization['deletedAt']): { elapsed: number; remaining: number } {
    const deletedDate = toDateOrNull(deletedAt);
    if (!deletedDate) return { elapsed: 0, remaining: 30 };
    const elapsed = Math.floor((Date.now() - deletedDate.getTime()) / (1000 * 60 * 60 * 24));
    return { elapsed, remaining: Math.max(0, 30 - elapsed) };
}

export default function DeletedOrgCard({ org, isDeleting, onRestore, onPermanentDelete }: DeletedOrgCardProps) {
    const { elapsed, remaining } = getDaysInfo(org.deletedAt);
    const isVoluntary = org.deletedBy === 'admin';
    const reasonLabel = org.withdrawReason ? WITHDRAW_REASON_LABELS[org.withdrawReason] : null;

    return (
        <div className={`glass-card overflow-hidden border-l-4 border-l-red-300 dark:border-l-red-700 transition-opacity ${isDeleting ? 'opacity-60' : ''}`}>
            <div className="p-5">
                {/* 휴대폰에서는 버튼을 아래로 내려 기관명이 좁아지지 않게 한다 */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-surface-700 dark:text-surface-300 break-keep">{org.name}</h3>
                            {isDeleting ? (
                                <span className="badge-danger" role="status">
                                    <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                                    삭제 중…
                                </span>
                            ) : (
                                <span className="badge-danger">삭제됨</span>
                            )}
                            {!isDeleting && isVoluntary && (
                                <span className="badge-warning">자발적 탈퇴</span>
                            )}
                        </div>
                        {isVoluntary && reasonLabel && (
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                                사유: {reasonLabel}
                                {org.withdrawReason === 'other' && org.withdrawReasonDetail ? ` — ${org.withdrawReasonDetail}` : ''}
                            </p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-surface-600 dark:text-surface-400">
                            <span>고유번호: {org.uniqueNumber}</span>
                            <span aria-hidden="true">•</span>
                            <span>삭제 {elapsed}일 경과</span>
                            <span aria-hidden="true">•</span>
                            <span className={remaining <= 7 ? 'text-red-700 dark:text-red-300 font-medium' : ''}>
                                {remaining > 0 ? `복구 가능 기간 ${remaining}일 남음` : '복구 가능 기간 지남'}
                            </span>
                        </div>
                        {org.address && (
                            <p className="text-sm text-surface-600 dark:text-surface-400">{org.address}</p>
                        )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => onRestore(org)}
                            disabled={isDeleting}
                            className="btn-secondary btn-sm min-h-[48px]"
                            aria-label={`${org.name} 기관 복구`}
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                            </svg>
                            복구
                        </button>
                        <button
                            type="button"
                            onClick={() => onPermanentDelete(org)}
                            disabled={isDeleting}
                            className="btn-danger btn-sm min-h-[48px]"
                            aria-label={`${org.name} 기관 영구 삭제`}
                        >
                            {isDeleting ? (
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" aria-hidden="true" />
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            )}
                            영구 삭제
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
