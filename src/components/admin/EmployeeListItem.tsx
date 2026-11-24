/**
 * EmployeeListItem — 직원 목록의 한 사람 (2026-11-22 다시 짬)
 *
 * 휴대폰에서 한 줄에 고르기 칸 두 개와 아이콘 버튼이 몰려 이름이 사라지고 버튼이 카드 밖으로 넘쳤다
 * (인터페이스 점검·사용자 의견 "휴대폰에서 불편하다"). 그래서
 * - 1줄: 아바타 + 이름·상태·이메일
 * - 2줄: 이름표가 붙은 '팀'·'역할' 고르기(넓은 화면에서도 같은 자리)
 * - 3줄: 글자 버튼(이름 고치기·비활성화 등) — 아이콘만 있던 버튼은 무엇을 하는지 알기 어려웠다
 * 내 계정 줄에는 바꿀 수 없는 역할·비활성화를 그리지 않고 이유를 적는다(전에는 흐린 아이콘 + 마우스 말풍선뿐).
 */
import React from 'react';
import type { User, UserRole, UnifiedMember } from '../../types';
import type { Team } from '../../types/team';

interface Props {
    member: UnifiedMember;
    selfUid?: string;
    editingId: string | null;
    editForm: { name: string; email: string };
    setEditForm: React.Dispatch<React.SetStateAction<{ name: string; email: string }>>;
    onEdit: (member: User) => void;
    onSaveEdit: (uid: string) => void;
    onCancelEdit: () => void;
    onDelete: (member: User) => void;
    onChangeRole: (member: User, role: UserRole) => void;
    /** 팀 — 활성 직원과 가입 대기 모두 여기서 고른다 */
    teams?: Team[];
    teamName?: (id: string | null | undefined) => string | null;
    onChangeTeam?: (member: User, teamId: string) => void;
    onChangePendingTeam?: (preRegId: string, teamId: string) => void;
    onDeletePreRegistered: (id: string) => void;
    onRestore: (member: User) => void;
    onDeletePermanently: (member: User) => void;
}

const smallLabel = 'block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1';

export default function EmployeeListItem({
    member, selfUid, editingId, editForm, setEditForm, onEdit, onSaveEdit, onCancelEdit, onDelete, onChangeRole,
    teams = [], onChangeTeam, onChangePendingTeam, onDeletePreRegistered, onRestore, onDeletePermanently,
}: Props) {
    const isSelf = member.memberStatus === 'active' && !!selfUid && member.id === selfUid;
    const isActive = member.memberStatus === 'active';
    const isPending = member.memberStatus === 'pending';
    const isDisabled = member.memberStatus === 'disabled';
    const loadingSelf = !selfUid;
    const who = member.name || member.email || '직원';
    const teamId = (member.original as { teamId?: string | null }).teamId ?? '';
    const ids = `emp-${member.memberStatus}-${member.id}`;

    const avatar = isDisabled
        ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        : isPending
            ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
            : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300';
    const cardBorder = isDisabled
        ? 'border-l-4 border-red-400 dark:border-red-500'
        : isPending ? 'border-l-4 border-amber-400 dark:border-amber-500' : '';

    const teamSelect = (onChange: (v: string) => void) => (
        <div>
            <label htmlFor={`${ids}-team`} className={smallLabel}>팀</label>
            <select id={`${ids}-team`} value={teamId} onChange={(e) => onChange(e.target.value)} className="input min-h-[48px] py-2 text-sm">
                <option value="">팀 없음</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
        </div>
    );

    return (
        <div className={`glass-card p-4 ${cardBorder}`}>
            {isActive && editingId === member.id ? (
                <div className="flex flex-col sm:flex-row gap-2">
                    <label htmlFor={`${ids}-name`} className="sr-only">이름</label>
                    <input id={`${ids}-name`} type="text" value={editForm.name} autoComplete="name"
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input flex-1 min-h-[48px]" placeholder="이름" />
                    <div className="flex gap-2">
                        <button type="button" onClick={() => onSaveEdit(member.id)} className="btn-primary min-h-[48px] px-5 flex-1 sm:flex-none">저장</button>
                        <button type="button" onClick={onCancelEdit} className="btn-secondary min-h-[48px] px-4 flex-1 sm:flex-none">취소</button>
                    </div>
                </div>
            ) : (
                <>
                    {/* 1줄: 누구인지 */}
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${avatar} flex items-center justify-center font-bold flex-shrink-0`} aria-hidden="true">
                            {who[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-medium text-surface-900 dark:text-surface-100 break-all">{member.name || '(이름 없음)'}</p>
                                {isActive && <span className={`badge ${member.role === 'admin' ? 'badge-primary' : 'badge-neutral'}`}>{member.role === 'admin' ? '관리자' : '직원'}</span>}
                                {isPending && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">가입 대기</span>}
                                {isDisabled && <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">비활성</span>}
                                {isSelf && <span className="badge badge-neutral">나</span>}
                            </div>
                            {member.email && <p className="text-sm text-surface-600 dark:text-surface-400 break-all">{member.email}</p>}
                        </div>
                    </div>
                    {/* 상태 이름표만으로는 무엇을 기다리는지·무엇이 막혔는지 몰랐다 — 한 줄로 풀어 쓴다 */}
                    {isPending && (
                        <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
                            아직 가입하지 않았어요. 이 이메일로 초대 링크를 열어 가입하면 직원으로 바뀝니다.
                        </p>
                    )}
                    {isDisabled && (
                        <p className="text-xs text-red-700 dark:text-red-300 mt-2">
                            앱을 쓸 수 없게 막아 둔 직원입니다. 다시 활성화하면 이전처럼 쓸 수 있어요.
                        </p>
                    )}

                    {/* 2줄: 팀·역할 */}
                    {isActive && (
                        <div className="grid grid-cols-2 gap-2 mt-3">
                            {onChangeTeam && teams.length > 0 ? teamSelect((v) => onChangeTeam(member.original, v)) : <div />}
                            {!isSelf && (
                                <div>
                                    <label htmlFor={`${ids}-role`} className={smallLabel}>역할</label>
                                    <select id={`${ids}-role`} value={member.role || 'employee'} disabled={loadingSelf}
                                        onChange={(e) => onChangeRole(member.original, e.target.value as UserRole)} className="input min-h-[48px] py-2 text-sm">
                                        <option value="employee">직원</option>
                                        <option value="admin">관리자</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    {isPending && onChangePendingTeam && teams.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mt-3">{teamSelect((v) => onChangePendingTeam(member.id, v))}</div>
                    )}

                    {/* 3줄: 할 일 */}
                    <div className="flex flex-wrap gap-2 mt-3">
                        {isActive && (
                            <>
                                <button type="button" onClick={() => onEdit(member.original)} className="btn-secondary btn-sm min-h-[48px] px-3">이름 고치기</button>
                                {!isSelf && (
                                    <button type="button" onClick={() => onDelete(member.original)} disabled={loadingSelf}
                                        className="btn-secondary btn-sm min-h-[48px] px-3 text-red-700 dark:text-red-300">비활성화</button>
                                )}
                                {isSelf && <p className="text-xs text-surface-600 dark:text-surface-400 self-center">내 역할과 비활성화는 다른 관리자가 바꿀 수 있어요.</p>}
                            </>
                        )}
                        {isPending && (
                            <button type="button" onClick={() => onDeletePreRegistered(member.id)}
                                className="btn-secondary btn-sm min-h-[48px] px-3 text-red-700 dark:text-red-300" aria-label={`${who} 사전 등록 취소`}>
                                등록 취소
                            </button>
                        )}
                        {isDisabled && (
                            <>
                                <button type="button" onClick={() => onRestore(member.original)} className="btn-secondary btn-sm min-h-[48px] px-3">다시 활성화</button>
                                <button type="button" onClick={() => onDeletePermanently(member.original)}
                                    className="btn-secondary btn-sm min-h-[48px] px-3 text-red-700 dark:text-red-300" aria-label={`${who} 계정 영구 삭제(조사 기록은 남음)`}>
                                    영구 삭제
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
