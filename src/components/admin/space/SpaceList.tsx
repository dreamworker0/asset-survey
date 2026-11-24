/**
 * SpaceList — 공간 관리의 공간 목록(한 줄 목록·층 접기·여러 곳 고르기) (2026-11-22)
 *
 * 공간이 수십 곳인 기관에서 공간마다 큰 카드라 한 화면에 3~4곳만 보이고, 담당도 한 곳씩 골라야 했다.
 * - 공간 하나를 한 줄로(이름·담당 요약·순서·고치기). 담당이 없으면 ⚠️로 알린다.
 * - 건물·층마다 접고 펼친다. 공간이 많으면(20곳 넘게) 처음엔 접어 둔다.
 * - 줄 앞 상자로 여러 곳을 고르고, 층 제목 옆 상자로 그 층을 모두 고른다. 고른 뒤 할 일은 화면 아래 막대(BulkBar).
 * 검색·'담당 없음만'으로 거른 동안에는 모두 펼쳐 보인다.
 */
import { hasNoAssignee } from '../../../lib/spaceGroups';
import type { Space } from '../../../types/space';
import type { Team } from '../../../types/team';

export interface SpaceSection {
    /** 접기 상태 키 — 건물ID|층 */
    key: string;
    /** 건물 이름(건물이 없거나 미지정이면 빈 글자) */
    building: string;
    /** 층 이름(없으면 빈 글자) */
    floor: string;
    spaces: Space[];
    /** 같은 건물의 첫 묶음인가(건물 제목을 이 위에 단다) */
    firstOfBuilding: boolean;
    /** 건물의 공간 수 */
    buildingCount: number;
}


interface Props {
    sections: SpaceSection[];
    /** 건물을 등록한 기관인가 — 아니면 묶음 제목 없이 한 목록 */
    grouped: boolean;
    collapsed: Set<string>;
    /** 검색·거르기 중에는 접기를 무시한다 */
    forceOpen: boolean;
    onToggleSection: (key: string) => void;
    selected: Set<string>;
    onSelect: (ids: string[], on: boolean) => void;
    busy: boolean;
    nameOf: (uid: string) => string;
    teamName: (id: string) => string | null;
    onEdit: (space: Space) => void;
    onMove: (space: Space, dir: -1 | 1) => void;
}

export default function SpaceList({
    sections, grouped, collapsed, forceOpen, onToggleSection, selected, onSelect, busy, nameOf, teamName, onEdit, onMove,
}: Props) {
    return (
        <div className="space-y-4">
            {sections.map((sec) => {
                const open = forceOpen || !collapsed.has(sec.key);
                const ids = sec.spaces.map((s) => s.id);
                const picked = ids.filter((id) => selected.has(id)).length;
                const empty = sec.spaces.filter(hasNoAssignee).length;
                const title = [sec.building, sec.floor].filter(Boolean).join(' ') || (grouped ? '건물 미지정' : '공간');
                const listId = `space-section-${sec.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                return (
                    <section key={sec.key} aria-label={`${title} 공간`}>
                        {grouped && sec.firstOfBuilding && (
                            <h2 className="flex items-baseline gap-2 text-lg font-bold text-surface-900 dark:text-surface-100 mb-2 mt-2">
                                <span aria-hidden="true">{sec.building ? '🏫' : '📦'}</span>
                                {sec.building || '건물 미지정'}
                                <span className="text-sm font-normal text-surface-600 dark:text-surface-400">공간 {sec.buildingCount}곳</span>
                            </h2>
                        )}
                        <div className="glass-card overflow-hidden">
                            {/* 묶음 머리 — 모두 고르기 + 접기 */}
                            <div className="flex items-center gap-1 border-b border-surface-100 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-800/60">
                                <label className="w-12 h-12 flex items-center justify-center flex-shrink-0 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="w-5 h-5 accent-primary-600"
                                        checked={ids.length > 0 && picked === ids.length}
                                        ref={(el) => { if (el) el.indeterminate = picked > 0 && picked < ids.length; }}
                                        onChange={(e) => onSelect(ids, e.target.checked)}
                                        disabled={ids.length === 0}
                                        aria-label={`${title} 공간 모두 고르기`}
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => onToggleSection(sec.key)}
                                    aria-expanded={open}
                                    aria-controls={listId}
                                    disabled={forceOpen}
                                    className="flex-1 min-w-0 flex items-center gap-2 min-h-[48px] pr-3 text-left text-sm disabled:cursor-default"
                                >
                                    {!forceOpen && <span aria-hidden="true" className="text-surface-500">{open ? '▾' : '▸'}</span>}
                                    <span className="font-semibold text-primary-700 dark:text-primary-300">{grouped ? (sec.floor || '층 미지정') : '전체 공간'}</span>
                                    <span className="text-surface-600 dark:text-surface-400 tabular-nums">{sec.spaces.length}곳</span>
                                    {empty > 0 && <span className="text-amber-800 dark:text-amber-300 text-xs font-medium tabular-nums">· 담당 없음 {empty}</span>}
                                    {picked > 0 && <span className="ml-auto text-xs font-medium text-primary-700 dark:text-primary-300 tabular-nums">{picked}곳 고름</span>}
                                </button>
                            </div>
                            {open && (
                                <ul id={listId} className="divide-y divide-surface-100 dark:divide-surface-700" aria-label={`${title} 공간 목록`}>
                                    {sec.spaces.map((space, i) => (
                                        <SpaceRow
                                            key={space.id}
                                            space={space}
                                            checked={selected.has(space.id)}
                                            onCheck={(on) => onSelect([space.id], on)}
                                            isFirst={i === 0}
                                            isLast={i === sec.spaces.length - 1}
                                            busy={busy}
                                            nameOf={nameOf}
                                            teamName={teamName}
                                            onEdit={() => onEdit(space)}
                                            onMove={(dir) => onMove(space, dir)}
                                            canMove={!forceOpen}
                                        />
                                    ))}
                                </ul>
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function SpaceRow({ space, checked, onCheck, isFirst, isLast, busy, nameOf, teamName, onEdit, onMove, canMove }: {
    space: Space;
    checked: boolean;
    onCheck: (on: boolean) => void;
    isFirst: boolean;
    isLast: boolean;
    busy: boolean;
    nameOf: (uid: string) => string;
    teamName: (id: string) => string | null;
    onEdit: () => void;
    onMove: (dir: -1 | 1) => void;
    /** 거른 목록에서는 이웃이 가려져 있어 순서 바꾸기를 숨긴다 */
    canMove: boolean;
}) {
    const none = hasNoAssignee(space);
    const who = [
        ...(space.teamIds ?? []).map((id) => `👥 ${teamName(id) ?? '(삭제한 팀)'}`),
        ...space.managerUids.map(nameOf),
    ].join(' · ');
    return (
        <li className={`flex items-center gap-1 pr-2 ${checked ? 'bg-primary-50/70 dark:bg-primary-900/20' : ''}`}>
            <label className="w-12 h-12 flex items-center justify-center flex-shrink-0 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={checked} onChange={(e) => onCheck(e.target.checked)}
                    aria-label={`${space.name} 고르기`} />
            </label>
            <div className="flex-1 min-w-0 py-2">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 break-keep">{space.name}</p>
                <p className={`text-xs break-keep ${none ? 'text-amber-800 dark:text-amber-300 font-medium' : 'text-surface-600 dark:text-surface-400'}`}>
                    {none ? <><span aria-hidden="true">⚠️ </span>담당 없음</> : who}
                </p>
            </div>
            {canMove && (
                <>
                    <button type="button" onClick={() => onMove(-1)} disabled={busy || isFirst}
                        className="btn-icon min-h-[48px] min-w-[48px] hidden sm:inline-flex" aria-label={`${space.name} 위로`} title="위로">
                        <span aria-hidden="true">▲</span>
                    </button>
                    <button type="button" onClick={() => onMove(1)} disabled={busy || isLast}
                        className="btn-icon min-h-[48px] min-w-[48px] hidden sm:inline-flex" aria-label={`${space.name} 아래로`} title="아래로">
                        <span aria-hidden="true">▼</span>
                    </button>
                </>
            )}
            <button type="button" onClick={onEdit} disabled={busy} className="btn-secondary btn-sm min-h-[48px] px-3 flex-shrink-0"
                aria-label={`${space.name} 고치기`}>
                고치기
            </button>
        </li>
    );
}

/** 담당 고르기 칸의 선택지(팀·직원 묶음) — 고치기 창과 한꺼번에 지정 막대가 함께 쓴다 */
export function AssigneeOptions({ teams, members, roleLabel }: {
    teams: Team[];
    members: Array<{ uid: string; name: string; role: string }>;
    roleLabel: Record<string, string>;
}) {
    return (
        <>
            {teams.length > 0 && (
                <optgroup label="팀 — 팀 직원 모두가 조사">
                    {teams.map((t) => <option key={t.id} value={`t:${t.id}`}>👥 {t.name}</option>)}
                </optgroup>
            )}
            {members.length > 0 && (
                <optgroup label="직원">
                    {members.map((m) => <option key={m.uid} value={`u:${m.uid}`}>{m.name} ({roleLabel[m.role] ?? m.role})</option>)}
                </optgroup>
            )}
        </>
    );
}
