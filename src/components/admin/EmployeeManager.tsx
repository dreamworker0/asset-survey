/**
 * EmployeeManager — 직원 관리 (2026-11-22 흐름대로 다시 짬)
 *
 * 사용자 의견("팀 등록하고 직원 등록하는 과정이 마음에 들지 않는다")과 인터페이스 점검에 따라 화면을
 * 하는 순서대로 놓는다: ① 팀 만들기 → ② 직원 등록(미리 등록하거나 초대 링크 보내기) → ③ 직원 목록.
 * - 사전 등록 창은 제대로 된 대화상자(PanelModal: Esc·첫 칸 초점·aria)이고, 창 안에서 바로 새 팀을 만들 수 있다.
 * - 가입 대기 직원의 팀도 목록에서 바꾼다(예전엔 지우고 다시 등록해야 했다).
 * - 복사 버튼은 글자 링크가 아니라 버튼 모양, 복사하면 알림.
 * 로직은 useEmployeeManager·useTeams.
 */
import { useState, type FormEvent } from 'react';
import useEmployeeManager from '../../hooks/useEmployeeManager';
import { useAuth } from '../../hooks/useAuth';
import { APP_URL } from '../../lib/constants';
import { SkeletonList, SkeletonBox } from '../common/Skeleton';
import EmployeeListItem from './EmployeeListItem';
import EmployeeRow from './EmployeeRow';
import type { Team } from '../../types/team';
import type { UnifiedMember } from '../../types';
import TeamSection from './TeamSection';
import PanelModal from './space/PanelModal';
import useTeams from '../../hooks/useTeams';
import { TEAM_NAME_MAX } from '../../schemas/team';

const NEW_TEAM = '__new__';
const NO_TEAM = '__none__';
/** 목록 줄의 키 — 활성 직원과 사전 등록 문서 ID가 겹칠 수 있어 상태를 붙인다 */
const keyOf = (m: UnifiedMember) => `${m.memberStatus}:${m.id}`;
const stepTitle = 'flex items-center gap-2 font-semibold text-surface-900 dark:text-surface-100';
const stepNum = 'inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold';

export default function EmployeeManager() {
    const {
        organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery, teamFilter, setTeamFilter, statusFilter, setStatusFilter,
        filteredUnifiedList, unifiedList, stats, employees, preRegisteredEmployees,
        bulkAssignTeam, bulkDeletePending, addPreRegisteredMany, bulkSendInvites,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
        handleDeletePreRegistered, handleRestoreEmployee, handleDeletePermanently, handleChangeTeam, handleChangePendingTeam,
    } = useEmployeeManager();
    const { userData } = useAuth();
    const selfUid = userData?.id;
    const teams = useTeams(userData?.organizationId);
    const memberCount = (teamId: string) => employees.filter((e) => e.teamId === teamId).length;
    // 사전 등록 창에서 바로 새 팀 만들기
    const [creatingTeam, setCreatingTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');

    const closeAdd = () => { setShowAddForm(false); setCreatingTeam(false); setNewTeamName(''); };
    const createTeamInDialog = async () => {
        const id = await teams.addTeam(newTeamName);
        if (id) { setNewEmployee({ ...newEmployee, teamId: id }); setCreatingTeam(false); setNewTeamName(''); }
    };
    const submitAdd = async (e: FormEvent<HTMLFormElement>) => { await handleAddEmployee(e); setCreatingTeam(false); };
    const filtering = searchQuery.trim() !== '' || teamFilter !== 'all';
    // 여러 명 고르기(2026-11-23)
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [bulkAddOpen, setBulkAddOpen] = useState(false);
    const pick = (keys: string[], on: boolean) => setSelected((prev) => {
        const next = new Set(prev);
        for (const k of keys) { if (on) next.add(k); else next.delete(k); }
        return next;
    });
    // 목록에서 사라진 사람(삭제·가입으로 상태가 바뀜)은 고른 목록에서도 뺀다
    const pickedMembers = unifiedList.filter((m) => selected.has(keyOf(m)));
    const pickedPending = pickedMembers.filter((m) => m.memberStatus === 'pending').map((m) => m.id);
    // 초대 메일을 한 번도 안 보낸 가입 대기 직원
    const notInvited = preRegisteredEmployees.filter((p) => !p.invitedAt).map((p) => p.id);
    const pickedShown = filteredUnifiedList.filter((m) => selected.has(keyOf(m))).length;
    const allShownPicked = filteredUnifiedList.length > 0 && pickedShown === filteredUnifiedList.length;
    const editingMember = editingKey ? unifiedList.find((m) => keyOf(m) === editingKey) ?? null : null;

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-28 mb-1" />
                <SkeletonBox className="h-4 w-40 mb-6" />
                <SkeletonList count={4} />
            </div>
        );
    }

    const inviteLink = `${APP_URL}?code=${organization?.inviteCode || '------'}`;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">팀·직원 관리</h1>
                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1" aria-live="polite">
                    총 {stats.total}명
                    {stats.active > 0 && <> · 활성 {stats.active}명</>}
                    {stats.pending > 0 && <> · <span className="text-amber-700 dark:text-amber-300">가입 대기 {stats.pending}명</span></>}
                    {stats.disabled > 0 && <> · <span className="text-red-700 dark:text-red-300">비활성 {stats.disabled}명</span></>}
                </p>
            </div>

            {/* ① 팀 만들기 */}
            <TeamSection t={teams} memberCount={memberCount} step={<span className={stepNum} aria-hidden="true">1</span>} />

            {/* ② 직원 등록 — 미리 등록하거나 초대 링크를 보낸다 */}
            <section className="glass-card p-4 mb-6" aria-labelledby="add-staff-title">
                <h2 id="add-staff-title" className={stepTitle}><span className={stepNum} aria-hidden="true">2</span> 직원 등록</h2>
                <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 mb-3">
                    이름·이메일·팀을 미리 등록해 두면, 직원이 초대 링크로 가입할 때 이름과 팀이 저절로 들어갑니다.
                </p>
                {/* 구글 로그인만 쓰므로 계정 관리가 곧 보안이다 — 공용 계정·퇴사자 방치를 막는 안내(2026-11-24) */}
                <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 mb-3">
                    <b className="font-semibold">한 사람에 구글 계정 하나</b>로 등록하세요. 여러 사람이 한 계정을 같이 쓰면 누가 찍고 승인했는지 남지 않습니다.
                    그만두거나 다른 곳으로 옮긴 직원은 아래 목록에서 눌러 <b className="font-semibold">바로 비활성화</b>하세요.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                    <button type="button" onClick={() => setShowAddForm(true)} className="btn-primary min-h-[48px] px-5">
                        + 직원 미리 등록하기
                    </button>
                    <button type="button" onClick={() => setBulkAddOpen(true)} className="btn-secondary min-h-[48px] px-5">
                        여러 명 붙여 넣어 등록
                    </button>
                </div>

                <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700">
                    <p className="text-sm font-medium text-surface-800 dark:text-surface-200 mb-2">초대 링크 보내기</p>
                    <p className="font-mono text-sm text-surface-700 dark:text-surface-300 break-all bg-surface-50 dark:bg-surface-800/60 rounded-lg p-3 select-all">{inviteLink}</p>
                    <p className="text-sm text-surface-700 dark:text-surface-300 mt-2">
                        기관 코드 <span className="font-mono text-lg font-bold text-primary-700 dark:text-primary-300 select-all">{organization?.inviteCode || '------'}</span>
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <button type="button" onClick={() => void handleCopyInviteCode('link')} className="btn-secondary btn-sm min-h-[44px] px-4">링크 복사</button>
                        <button type="button" onClick={() => void handleCopyInviteCode('code')} className="btn-secondary btn-sm min-h-[44px] px-4">코드 복사</button>
                        <button type="button" onClick={() => void handleRegenerateCode()} disabled={regenerating} className="btn-secondary btn-sm min-h-[44px] px-4">
                            {regenerating ? '새로 만드는 중…' : '코드 새로 만들기'}
                        </button>
                    </div>
                    <p className="text-xs text-surface-600 dark:text-surface-400 mt-2">코드를 새로 만들면 예전 링크·코드로는 가입할 수 없습니다.</p>
                </div>
            </section>

            {/* 직원 미리 등록 창 */}
            <PanelModal open={showAddForm} title="직원 미리 등록" titleId="add-employee-title" onClose={closeAdd}>
                <form onSubmit={(e) => void submitAdd(e)} className="space-y-4">
                    <div>
                        <label htmlFor="new-employee-name" className="label">이름 <span className="text-red-700 dark:text-red-300">*</span></label>
                        <input id="new-employee-name" type="text" autoComplete="name" required aria-required="true" value={newEmployee.name}
                            onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })} className="input min-h-[48px]" placeholder="홍길동" />
                    </div>
                    <div>
                        <label htmlFor="new-employee-email" className="label">이메일(구글 계정) <span className="text-red-700 dark:text-red-300">*</span></label>
                        <input id="new-employee-email" type="email" autoComplete="email" inputMode="email" required aria-required="true" value={newEmployee.email}
                            onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })} className="input min-h-[48px]" placeholder="example@gmail.com" />
                    </div>
                    <div>
                        <label htmlFor="new-employee-team" className="label">팀</label>
                        {creatingTeam ? (
                            <>
                                <div className="flex gap-2">
                                    {/* 팀 이름 칸에서 Enter(휴대폰 '완료')를 누르면 직원 등록이 먼저 제출됐다 — 팀 만들기로 돌린다 */}
                                    <input id="new-employee-team" type="text" value={newTeamName} maxLength={TEAM_NAME_MAX} placeholder="새 팀 이름 (예: 행정지원팀)"
                                        enterKeyHint="done"
                                        onKeyDown={(e) => {
                                            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                                            e.preventDefault();
                                            if (!teams.busy && newTeamName.trim()) void createTeamInDialog();
                                        }}
                                        onChange={(e) => setNewTeamName(e.target.value)} className="input flex-1 min-w-0 min-h-[48px]" />
                                    <button type="button" className="btn-primary min-h-[48px] px-3 flex-shrink-0" disabled={teams.busy || !newTeamName.trim()} onClick={() => void createTeamInDialog()}>팀 만들기</button>
                                </div>
                                {/* 잘못 골랐을 때 돌아갈 길 — 예전엔 창을 닫아야만 팀 고르기로 돌아갔다 */}
                                <button type="button" className="btn-secondary btn-sm min-h-[44px] px-3 mt-2" onClick={() => { setCreatingTeam(false); setNewTeamName(''); }}>
                                    있는 팀에서 고르기
                                </button>
                            </>
                        ) : (
                            <select id="new-employee-team" value={newEmployee.teamId} className="input min-h-[48px]"
                                onChange={(e) => {
                                    if (e.target.value === NEW_TEAM) { setCreatingTeam(true); return; }
                                    setNewEmployee({ ...newEmployee, teamId: e.target.value });
                                }}>
                                <option value="">팀 없음</option>
                                {teams.activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                <option value={NEW_TEAM}>+ 새 팀 만들기…</option>
                            </select>
                        )}
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={closeAdd} className="btn-secondary flex-1 min-h-[48px]">닫기</button>
                        <button type="submit" className="btn-primary flex-1 min-h-[48px]">등록</button>
                    </div>
                    <p className="text-xs text-surface-600 dark:text-surface-400">등록하면 창이 닫힙니다. 같은 팀 직원을 이어서 넣을 때는 팀이 그대로 남아 있어요.</p>
                </form>
            </PanelModal>

            {/* ③ 직원 목록 — 상태별로 나눠 보고, 한 줄씩. 자세한 조작은 [고치기] 창(2026-11-23) */}
            <h2 className={`${stepTitle} mb-3`}><span className={stepNum} aria-hidden="true">3</span> 직원 목록</h2>
            {stats.total > 0 && (
                <>
                    <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="상태로 나눠 보기">
                        {([['active', '활성', stats.active], ['pending', '가입 대기', stats.pending], ['disabled', '비활성', stats.disabled], ['all', '전체', stats.total]] as const)
                            .filter(([key, , n]) => key === 'all' || key === 'active' || n > 0)
                            .map(([key, label, n]) => (
                                <button key={key} type="button" aria-pressed={statusFilter === key} onClick={() => { setStatusFilter(key); setSelected(new Set()); }}
                                    className={`min-h-[44px] px-4 rounded-xl text-sm font-medium border ${statusFilter === key
                                        ? 'bg-primary-600 border-primary-600 text-white'
                                        : 'bg-white border-surface-300 text-surface-800 dark:bg-surface-800 dark:border-surface-600 dark:text-surface-200'}`}>
                                    {label} <span className="tabular-nums">{n}</span>
                                </button>
                            ))}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_12rem] mb-3">
                        <div>
                            <label htmlFor="employee-search" className="sr-only">직원 검색</label>
                            <input id="employee-search" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                                className="input min-h-[48px]" placeholder="이름, 이메일 검색" />
                        </div>
                        {teams.activeTeams.length > 0 && (
                            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="input min-h-[48px]" aria-label="팀으로 거르기">
                                <option value="all">전체 팀</option>
                                <option value="none">팀 없음</option>
                                {teams.activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        )}
                    </div>
                    {/* 가입 대기 안내는 사람마다 되풀이하지 않고 한 번만 */}
                    {(statusFilter === 'pending' || statusFilter === 'all') && stats.pending > 0 && (
                        <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 mb-3">
                            <b className="font-semibold">가입 대기</b>는 미리 등록만 하고 아직 가입하지 않은 사람입니다. 초대 링크로 같은 이메일(구글 계정)로 가입하면 이름과 팀이 저절로 들어가고 '활성'이 됩니다.
                            {' '}아직 메일을 안 보낸 사람에게는 아래에서 골라 [초대 메일 보내기]를 누르세요.
                            {notInvited.length > 0 && (
                                <button type="button" className="btn-secondary btn-sm min-h-[44px] px-3 mt-2 block"
                                    onClick={() => void bulkSendInvites(notInvited)}>
                                    ✉️ 아직 안 보낸 {notInvited.length}명 모두에게 초대 메일 보내기
                                </button>
                            )}
                        </p>
                    )}
                </>
            )}

            {stats.total === 0 ? (
                <div className="glass-card p-8 text-center">
                    <div className="text-4xl mb-3" aria-hidden="true">👥</div>
                    <p className="text-surface-800 dark:text-surface-200 font-medium">아직 등록한 직원이 없습니다</p>
                    <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">위 ② 에서 직원을 미리 등록하거나 초대 링크를 보내세요.</p>
                </div>
            ) : filteredUnifiedList.length === 0 ? (
                <div className="glass-card p-8 text-center" aria-live="polite">
                    <p className="text-surface-800 dark:text-surface-200 font-medium">조건에 맞는 직원이 없습니다</p>
                    {(filtering || statusFilter !== 'all') && (
                        <button type="button" className="btn-secondary min-h-[44px] px-4 mt-3" onClick={() => { setSearchQuery(''); setTeamFilter('all'); setStatusFilter('all'); }}>
                            모든 직원 보기
                        </button>
                    )}
                </div>
            ) : (
                <div className="glass-card overflow-hidden">
                    <div className="flex items-center gap-1 border-b border-surface-100 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-800/60">
                        <label className="w-11 h-11 flex items-center justify-center flex-shrink-0 cursor-pointer">
                            <input type="checkbox" className="w-5 h-5 accent-primary-600"
                                checked={allShownPicked}
                                ref={(el) => { if (el) el.indeterminate = pickedShown > 0 && !allShownPicked; }}
                                onChange={(e) => pick(filteredUnifiedList.map(keyOf), e.target.checked)}
                                aria-label="보이는 직원 모두 고르기" />
                        </label>
                        <p className="flex-1 text-sm text-surface-700 dark:text-surface-300 tabular-nums" aria-live="polite">
                            {filteredUnifiedList.length}명{pickedShown > 0 && <span className="text-primary-700 dark:text-primary-300 font-medium"> · {pickedShown}명 고름</span>}
                        </p>
                    </div>
                    <ul className="divide-y divide-surface-100 dark:divide-surface-700" aria-label="직원 목록">
                        {filteredUnifiedList.map((member) => (
                            <EmployeeRow
                                key={keyOf(member)}
                                member={member}
                                checked={selected.has(keyOf(member))}
                                onCheck={(on) => pick([keyOf(member)], on)}
                                teamName={teams.teamName}
                                isSelf={member.memberStatus === 'active' && member.id === selfUid}
                                onEdit={() => setEditingKey(keyOf(member))}
                            />
                        ))}
                    </ul>
                </div>
            )}

            {/* 고른 직원에게 할 일 — 화면 아래에 고정 */}
            {pickedMembers.length > 0 && <div className="h-36 sm:h-24" aria-hidden="true" />}
            {pickedMembers.length > 0 && (
                <div className="fixed bottom-3 left-3 right-3 lg:left-[calc(16rem+1.5rem)] lg:right-6 z-40 flex justify-center pointer-events-none">
                    <div className="pointer-events-auto w-full max-w-4xl glass-card p-3 shadow-xl border border-primary-200 dark:border-primary-800 flex flex-wrap items-center gap-2 bg-white/95 dark:bg-surface-900/95"
                        role="region" aria-label="고른 직원에게 할 일">
                        <span className="text-sm font-semibold text-surface-900 dark:text-surface-100 tabular-nums mr-auto">{pickedMembers.length}명 고름</span>
                        <label htmlFor="bulk-team" className="sr-only">고른 직원의 팀 지정</label>
                        <select id="bulk-team" value="" className="input w-auto min-w-[9rem] min-h-[44px] text-sm"
                            onChange={(e) => {
                                const v = e.target.value;
                                if (!v) return;
                                void bulkAssignTeam(pickedMembers, v === NO_TEAM ? null : v).then((ok) => { if (ok) setSelected(new Set()); });
                            }}>
                            <option value="">팀 지정…</option>
                            {teams.activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            <option value={NO_TEAM}>팀 비우기</option>
                        </select>
                        {pickedPending.length > 0 && (
                            <button type="button" className="btn-primary btn-sm min-h-[44px] px-3"
                                onClick={() => void bulkSendInvites(pickedPending).then((ok) => { if (ok) setSelected(new Set()); })}>
                                ✉️ 초대 메일 보내기 ({pickedPending.length}명)
                            </button>
                        )}
                        {pickedPending.length > 0 && (
                            <button type="button" className="btn-secondary btn-sm min-h-[44px] px-3 text-red-700 dark:text-red-300"
                                onClick={() => void bulkDeletePending(pickedPending).then((ok) => { if (ok) setSelected(new Set()); })}>
                                가입 대기 {pickedPending.length}명 등록 취소
                            </button>
                        )}
                        <button type="button" className="btn-ghost btn-sm min-h-[44px] px-3" onClick={() => setSelected(new Set())}>고르기 해제</button>
                    </div>
                </div>
            )}

            {/* 한 사람 고치기 — 예전 카드를 그대로 창 안에(이름·역할·팀·비활성화·삭제) */}
            <PanelModal open={!!editingMember} title={editingMember ? `${editingMember.name || editingMember.email} 고치기` : '직원 고치기'}
                titleId="employee-edit-title" onClose={() => setEditingKey(null)}>
                {editingMember && (
                    <div className="space-y-4">
                        <EmployeeListItem
                            member={editingMember}
                            selfUid={selfUid}
                            editingId={editingId}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            onEdit={handleEditEmployee}
                            onSaveEdit={handleSaveEdit}
                            onCancelEdit={() => setEditingId(null)}
                            onDelete={handleDeleteEmployee}
                            onChangeRole={handleChangeRole}
                            teams={teams.activeTeams}
                            teamName={teams.teamName}
                            onChangeTeam={handleChangeTeam}
                            onChangePendingTeam={(id, teamId) => void handleChangePendingTeam(id, teamId)}
                            onDeletePreRegistered={handleDeletePreRegistered}
                            onRestore={handleRestoreEmployee}
                            onDeletePermanently={handleDeletePermanently}
                        />
                        <button type="button" className="btn-secondary w-full min-h-[48px]" onClick={() => setEditingKey(null)}>닫기</button>
                    </div>
                )}
            </PanelModal>

            {/* 여러 명 한꺼번에 미리 등록 */}
            <PanelModal open={bulkAddOpen} title="여러 명 한꺼번에 미리 등록" titleId="bulk-employee-title" onClose={() => setBulkAddOpen(false)}>
                {bulkAddOpen && (
                    <BulkEmployeeForm
                        teams={teams.activeTeams}
                        onCancel={() => setBulkAddOpen(false)}
                        onSubmit={async (text, teamId) => {
                            const n = await addPreRegisteredMany(text, teamId, (name) => {
                                const key = name.replace(/\s+/g, '');
                                return teams.activeTeams.find((t) => t.name.replace(/\s+/g, '') === key)?.id ?? null;
                            });
                            if (n > 0) { setBulkAddOpen(false); setSelected(new Set()); }
                        }}
                    />
                )}
            </PanelModal>
        </div>
    );
}

/** 여러 명 붙여 넣기 — 한 줄에 "이름, 이메일, 팀"(엑셀 세 칸 복사도 된다) */
function BulkEmployeeForm({ teams, onCancel, onSubmit }: {
    teams: Team[];
    onCancel: () => void;
    onSubmit: (text: string, teamId: string | null) => Promise<void>;
}) {
    const [text, setText] = useState('');
    const [teamId, setTeamId] = useState('');
    const [busy, setBusy] = useState(false);
    const count = text.split(/\r?\n/).filter((l) => l.trim()).length;
    return (
        <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try { await onSubmit(text, teamId || null); } finally { setBusy(false); }
        }}>
            <div>
                <label htmlFor="bulk-employee-lines" className="label">한 줄에 한 사람: 이름, 이메일, 팀</label>
                <textarea id="bulk-employee-lines" className="input w-full font-mono text-sm" rows={8} value={text} onChange={(e) => setText(e.target.value)}
                    placeholder={'홍길동, hong@gmail.com, 행정지원팀\n김철수, kim@gmail.com'} aria-describedby="bulk-employee-hint" />
                <p id="bulk-employee-hint" className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                    엑셀에서 이름·이메일·팀 세 칸을 복사해 붙여 넣어도 됩니다. 팀은 빼도 되고, 이미 등록·가입한 이메일과 형식이 틀린 줄은 건너뜁니다.
                </p>
            </div>
            <div>
                <label htmlFor="bulk-employee-team" className="label">팀을 안 적은 줄의 팀</label>
                <select id="bulk-employee-team" className="input min-h-[48px]" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                    <option value="">팀 없음</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
            </div>
            <div className="flex gap-2">
                <button type="button" className="btn-secondary flex-1 min-h-[48px]" onClick={onCancel}>취소</button>
                <button type="submit" className="btn-primary flex-1 min-h-[48px]" disabled={busy || count === 0}>
                    {busy ? '등록하는 중…' : count > 0 ? `${count}명 등록` : '등록'}
                </button>
            </div>
        </form>
    );
}
