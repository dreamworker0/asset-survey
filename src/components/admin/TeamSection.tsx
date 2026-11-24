/**
 * TeamSection — 직원 관리 위쪽의 팀 칸 (2026-11-22)
 *
 * 팀을 먼저 만들고 직원(사전 등록 포함)에 팀을 정한다. 공간 관리에서 담당을 팀으로도 지정할 수 있다.
 * 팀은 처음에 한 번 만들면 거의 손대지 않으므로, 팀이 생기면 한 줄 요약으로 접고
 * 추가·이름 바꾸기·삭제는 [팀 고치기] 창에서 한다(팀마다 버튼이 늘어서 화면이 복잡하다는 의견).
 * '삭제'는 실제로 지우지 않고 숨긴다 — 공간 담당·사전 등록·지난 기록이 팀을 가리키고 있어서다. 창에서 되살릴 수 있다.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import type useTeams from '../../hooks/useTeams';
import { TEAM_NAME_MAX } from '../../schemas/team';
import PanelModal from './space/PanelModal';

interface Props {
    t: ReturnType<typeof useTeams>;
    /** 팀 ID → 직원 수(활성) */
    memberCount: (teamId: string) => number;
    /** 단계 번호 표시(직원 관리 화면의 ① ② ③) */
    step?: ReactNode;
}

export default function TeamSection({ t, memberCount, step }: Props) {
    const [editing, setEditing] = useState(false);
    const hasTeams = t.activeTeams.length > 0;

    return (
        <section className="glass-card p-4 mb-6" aria-labelledby="team-section-title">
            <h2 id="team-section-title" className="flex items-center gap-2 font-semibold text-surface-900 dark:text-surface-100">
                {step} {hasTeams ? `팀 ${t.activeTeams.length}개` : '팀 만들기'}
            </h2>
            {hasTeams ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <ul className="flex-1 min-w-[12rem] flex flex-wrap gap-x-1 text-sm text-surface-800 dark:text-surface-200" aria-label="팀 목록">
                        {t.activeTeams.map((team, i) => (
                            <li key={team.id}>
                                {team.name} <span className="text-surface-600 dark:text-surface-400 tabular-nums">{memberCount(team.id)}명</span>
                                {i < t.activeTeams.length - 1 && <span aria-hidden="true" className="text-surface-400"> · </span>}
                            </li>
                        ))}
                    </ul>
                    <button type="button" className="btn-secondary btn-sm min-h-[48px]" onClick={() => setEditing(true)}>팀 고치기</button>
                </div>
            ) : (
                <>
                    <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 mb-3">
                        팀을 먼저 만들고 직원마다 팀을 정하세요. 공간 관리에서 담당을 팀으로 지정하면 그 팀 직원 모두가 그 공간을 조사합니다.
                    </p>
                    <AddTeamForm t={t} inputId="new-team-name" />
                    {t.archivedTeams.length > 0 && (
                        <button type="button" className="btn-secondary btn-sm min-h-[48px] mt-3" onClick={() => setEditing(true)}>
                            삭제한 팀 {t.archivedTeams.length}개 보기
                        </button>
                    )}
                </>
            )}

            <PanelModal open={editing} title="팀 고치기" titleId="team-edit-title" onClose={() => setEditing(false)}>
                <AddTeamForm t={t} inputId="panel-team-name" />
                {hasTeams && (
                    <ul className="mt-4 divide-y divide-surface-200 dark:divide-surface-700 border-y border-surface-200 dark:border-surface-700" aria-label="팀 목록">
                        {t.activeTeams.map((team) => (
                            <li key={team.id} className="flex flex-wrap items-center gap-2 py-2">
                                <span className="flex-1 min-w-[8rem] font-medium text-surface-900 dark:text-surface-100 break-keep">
                                    {team.name} <span className="text-xs font-normal text-surface-600 dark:text-surface-400 tabular-nums">{memberCount(team.id)}명</span>
                                </span>
                                <button type="button" onClick={() => void t.renameTeam(team)} disabled={t.busy}
                                    className="btn-secondary btn-sm min-h-[48px] px-3" aria-label={`${team.name} 이름 바꾸기`}>
                                    이름 바꾸기
                                </button>
                                <button type="button" onClick={() => void t.archiveTeam(team, memberCount(team.id))} disabled={t.busy}
                                    className="btn-secondary btn-sm min-h-[48px] px-3 text-red-700 dark:text-red-300" aria-label={`${team.name} 삭제`}>
                                    삭제
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-xs text-surface-600 dark:text-surface-400 mt-3">
                    직원이 남은 팀은 삭제할 수 없습니다. 먼저 직원 목록에서 다른 팀으로 옮기세요.
                </p>
                {t.archivedTeams.length > 0 && (
                    <div className="mt-4">
                        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">삭제한 팀</h3>
                        <ul className="flex flex-wrap gap-2" aria-label="삭제한 팀 목록">
                            {t.archivedTeams.map((team) => (
                                <li key={team.id}>
                                    <button type="button" onClick={() => void t.restoreTeam(team)} disabled={t.busy}
                                        className="btn-secondary btn-sm min-h-[48px] px-3" aria-label={`${team.name} 되살리기`}>
                                        {team.name} 되살리기
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <button type="button" className="btn-secondary w-full min-h-[48px] mt-5" onClick={() => setEditing(false)}>닫기</button>
            </PanelModal>
        </section>
    );
}

/** 새 팀 추가 줄 — 접기 전 칸과 [팀 고치기] 창에서 함께 쓴다 */
function AddTeamForm({ t, inputId }: { t: Props['t']; inputId: string }) {
    const [name, setName] = useState('');
    const handleAdd = async (e: FormEvent) => {
        e.preventDefault();
        if (await t.addTeam(name)) setName('');
    };
    return (
        <form onSubmit={handleAdd} className="flex gap-2">
            <label htmlFor={inputId} className="sr-only">새 팀 이름</label>
            <input id={inputId} type="text" className="input flex-1 min-w-0 min-h-[48px]" value={name} maxLength={TEAM_NAME_MAX}
                placeholder="예: 행정지원팀" onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn-primary min-h-[48px] px-4 flex-shrink-0" disabled={t.busy || !name.trim()}>팀 추가</button>
        </form>
    );
}
