/**
 * OrgCard — 활성 기관 카드 (아코디언 형태)
 * 접힌 상태: 기관명 + 직원 수 + 초대코드 요약만 표시
 * 펼친 상태: 상세 정보 + 멤버 목록 + 편집/복원 기능
 */
import { memo, useState } from 'react';
import { formatTimestampFull } from '../../lib/dateUtils';
import { useToast } from '../../hooks/useToast';
import OrgDocumentViewer from './OrgDocumentViewer';
import { hasOrgDocument } from '../../lib/orgDocument';
import OrgCardHeader from './orgCard/OrgCardHeader';
import OrgEditForm from './orgCard/OrgEditForm';
import OrgMemberTable from './orgCard/OrgMemberTable';
import OrgRestoreForm from './orgCard/OrgRestoreForm';
import type { Organization } from '../../types';
import type { User, UserRole } from '../../types/user';

interface OrgCardProps {
    org: Organization;
    members: User[];
    memberCount: number;
    isExpanded: boolean;
    changingRole: string | null;
    loadingMembers: boolean;
    /** 멤버 목록을 못 읽었는지 — "소속된 멤버가 없습니다"와 구분해 다시 시도를 보여 준다 */
    memberLoadError: boolean;
    onRetryMembers: (orgId: string) => void;
    onToggle: (orgId: string) => void;
    onDelete: (org: Organization) => void;
    onEditOrg: (orgId: string, updates: { name: string; address: string }) => Promise<void>;
    onRoleChange: (member: User, orgId: string, newRole: UserRole) => void;
    onRemoveMember: (member: User, orgId: string) => void;
    onRestoreUser: (email: string, orgId: string, name: string) => Promise<void>;
}


export default memo(function OrgCard({
    org, members, memberCount, isExpanded, changingRole, loadingMembers, memberLoadError,
    onRetryMembers, onToggle, onDelete, onEditOrg, onRoleChange, onRemoveMember, onRestoreUser,
}: OrgCardProps) {
    const [editing, setEditing] = useState(false);
    const [showImage, setShowImage] = useState(false);
    const { showToast } = useToast();

    // 기관 ID 복사 — 눌러도 아무 반응이 없던 것을 알림으로 알려 준다
    const copyOrgId = async () => {
        try {
            await navigator.clipboard.writeText(org.id);
            showToast('기관 ID를 복사했습니다.', 'success');
        } catch {
            showToast(`복사하지 못했습니다. 기관 ID: ${org.id}`, 'error');
        }
    };

    // 익명 계정 필터링 (이름이 없거나 '-'인 계정 제외)
    const visibleMembers = members.filter(m => m.name && m.name !== '-');

    return (
        <div className="glass-card overflow-hidden transition-shadow hover:shadow-glass-lg">
            {/* ===== 접힌 상태 헤더 ===== */}
            <OrgCardHeader
                org={org}
                memberCount={memberCount}
                isExpanded={isExpanded}
                editing={editing}
                onToggle={onToggle}
                onDelete={onDelete}
            />

            {/* ===== 펼친 상태 상세 내용 ===== */}
            {isExpanded && (
                <div className="animate-slide-down">
                    {/* 상세 정보 */}
                    <div className="px-5 pb-4 border-t border-surface-100 dark:border-surface-700 pt-3">
                        {editing ? (
                            <OrgEditForm
                                orgId={org.id}
                                initialName={org.name || ''}
                                initialAddress={org.address || ''}
                                onSave={async (id, updates) => {
                                    await onEditOrg(id, updates);
                                    setEditing(false);
                                }}
                                onCancel={() => setEditing(false)}
                            />
                        ) : (
                            /* 상세 정보 표시 */
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{org.name}</h3>
                                    <button
                                        type="button"
                                        onClick={() => setEditing(true)}
                                        className="btn-secondary btn-sm min-h-[48px]"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                        </svg>
                                        기관명·주소 편집
                                    </button>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-600 dark:text-surface-400">
                                    <span className="inline-flex items-center gap-1.5">
                                        ID: <code className="bg-surface-100 dark:bg-surface-700 px-1 py-0.5 rounded text-xs font-mono">{org.id.slice(0, 8)}…</code>
                                        <button
                                            type="button"
                                            onClick={() => { void copyOrgId(); }}
                                            className="btn-secondary btn-sm min-h-[48px]"
                                            aria-label="기관 ID 전체 복사"
                                        >
                                            복사
                                        </button>
                                    </span>
                                    <span aria-hidden="true">•</span>
                                    <span>고유번호: {org.uniqueNumber}</span>
                                    <span aria-hidden="true">•</span>
                                    <span>직원 {visibleMembers.length}명</span>
                                    <span aria-hidden="true">•</span>
                                    <span>초대코드: <code className="bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-primary-700 dark:text-primary-300 font-mono text-xs">{org.inviteCode}</code></span>
                                    {formatTimestampFull(org.approvedAt) && (
                                        <>
                                            <span aria-hidden="true">•</span>
                                            <span>승인일시: {formatTimestampFull(org.approvedAt)}</span>
                                        </>
                                    )}
                                </div>

                                {org.address && (
                                    <p className="text-sm text-surface-600 dark:text-surface-400 flex flex-wrap items-center gap-1.5">
                                        {org.address}
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(org.address)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 min-h-[48px] px-2 rounded text-xs font-medium text-primary-700 dark:text-primary-300 underline underline-offset-2 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                        >
                                            <span aria-hidden="true">📍</span> 지도에서 보기<span className="sr-only">(구글 지도, 새 창)</span>
                                        </a>
                                    </p>
                                )}

                                {/* 증빙서류 보기 토글 */}
                                {hasOrgDocument(org) && (
                                    <div className="mt-1">
                                        <button
                                            type="button"
                                            onClick={() => setShowImage(v => !v)}
                                            aria-expanded={showImage}
                                            className="btn-secondary btn-sm min-h-[48px]"
                                        >
                                            <span aria-hidden="true">{showImage ? '▾' : '▸'}</span>
                                            증빙서류 {showImage ? '닫기' : '보기'}
                                        </button>
                                        {showImage && (
                                            <OrgDocumentViewer orgId={org.id} />
                                        )}
                                    </div>
                                )}

                                {/* 신청자 정보 */}
                                {(org.applicantName || org.applicantEmail || org.applicantPhone) && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-surface-600 dark:text-surface-400 mt-1 pt-1 border-t border-surface-100 dark:border-surface-700 break-all">
                                        {org.applicantName && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                                                </svg>
                                                {org.applicantName}
                                            </span>
                                        )}
                                        {org.applicantPhone && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                                                </svg>
                                                {org.applicantPhone}
                                            </span>
                                        )}
                                        {org.applicantEmail && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                                </svg>
                                                {org.applicantEmail}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* 하고 싶은 말 */}
                                {org.message && (
                                    <div className="mt-2 px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 text-sm">
                                        <span className="text-xs font-medium text-primary-700 dark:text-primary-300"><span aria-hidden="true">💬 </span>하고 싶은 말</span>
                                        <p className="text-surface-700 dark:text-surface-300 mt-0.5 whitespace-pre-wrap">{org.message}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 멤버 목록 */}
                    <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50">
                        <OrgMemberTable
                            members={members}
                            orgId={org.id}
                            changingRole={changingRole}
                            loadingMembers={loadingMembers}
                            loadError={memberLoadError}
                            onRetry={onRetryMembers}
                            onRoleChange={onRoleChange}
                            onRemoveMember={onRemoveMember}
                        />

                        {/* 계정 복원 섹션 */}
                        <div className="border-t border-surface-200 dark:border-surface-600 p-4">
                            <OrgRestoreForm orgId={org.id} onRestoreUser={onRestoreUser} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
