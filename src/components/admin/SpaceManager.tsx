/**
 * SpaceManager — 공간 관리 (기관 관리자 전용, 기획서 F03)
 *
 * 재물이 놓인 곳(사무실·시설)을 등록하고 공간 담당자를 지정한다.
 * 상태와 저장은 useSpaceManager가 맡고, 여기는 표시만 한다.
 *
 * ## 건물 → 층 → 공간 (2026-11-22)
 * 구글 워크스페이스의 "건물 및 리소스"처럼 건물과 층을 따로 등록하고, 공간은 건물·층을 골라 둔다.
 * 화면은 [공간] [건물·층] 두 탭이다. 건물을 하나도 등록하지 않은 기관은 묶음 없이 한 목록으로 보인다.
 *
 * ## 공간이 많은 기관 (2026-11-22)
 * 공간마다 큰 카드라 60곳이면 화면이 끝없이 길었다 — 한 줄 목록·층 접기·검색·'담당 없음만'·
 * 여러 곳 한꺼번에(담당 지정·위치 옮기기·삭제)·여러 공간 한꺼번에 추가를 넣었다(space/SpaceList.tsx).
 * 창·편집 폼은 space/SpaceModals.tsx로 나눴다(2026-11-24).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import useSpaceManager from '../../hooks/useSpaceManager';
import useTeams from '../../hooks/useTeams';
import { useAuth } from '../../hooks/useAuth';
import { SkeletonList } from '../common/Skeleton';
import { SPACE_NAME_MAX } from '../../schemas/space';
import { groupSpacesByLocation, hasNoAssignee } from '../../lib/spaceGroups';
import LocationSelects from './space/LocationSelects';
import BuildingPanel from './space/BuildingPanel';
import SpaceList, { AssigneeOptions, type SpaceSection } from './space/SpaceList';
import { SpaceEditModal, AssigneeEditor, BulkAddModal, MoveModal } from './space/SpaceModals';
import { ROLE_LABEL, NO_LOCATION } from './space/spaceConstants';
import type { SpaceLocation } from '../../lib/firestore/spaces';

/** 이보다 공간이 많으면 처음에 층을 접어 둔다 */
const COLLAPSE_OVER = 20;

type Tab = 'spaces' | 'buildings';

const normalizeSearch = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export default function SpaceManager() {
    const sm = useSpaceManager();
    const {
        loading, loadError, busy, reload,
        activeSpaces, archivedSpaces, members, nameOf,
        addSpace, saveSpaceDetails, moveSpace, addManager, removeManager, addTeam, removeTeam, archiveSpace, restoreSpace,
        bulkAssign, bulkSetLocation, bulkArchive, addSpaces,
        activeBuildings, archivedBuildings, spacesIn,
        addBuilding, editBuilding, moveBuilding, archiveBuilding, restoreBuilding,
    } = sm;
    const { userData } = useAuth();
    const teamsState = useTeams(userData?.organizationId);
    const [tab, setTab] = useState<Tab>('spaces');
    const [newName, setNewName] = useState('');
    const [newLocation, setNewLocation] = useState<SpaceLocation>(NO_LOCATION);
    const [showArchived, setShowArchived] = useState(false);
    // 고치기 창은 ID로 들고 최신 공간을 다시 찾는다 — 창에서 담당을 바꾸면 바로 보이게
    const [editingId, setEditingId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [onlyUnassigned, setOnlyUnassigned] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    // null = 아직 손대지 않음(공간이 많으면 모두 접힌 상태로 본다)
    const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
    const [bulkAddOpen, setBulkAddOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);

    const hasBuildings = activeBuildings.length > 0;
    const editingSpace = editingId ? activeSpaces.find((s) => s.id === editingId) ?? null : null;
    const filtering = search.trim() !== '' || onlyUnassigned;

    // 건물·층 묶음 → 접을 수 있는 묶음(층마다 하나). 건물이 없으면 한 묶음
    const allSections = useMemo<SpaceSection[]>(() => {
        if (!hasBuildings) {
            return [{ key: 'all', building: '', floor: '', spaces: activeSpaces, firstOfBuilding: true, buildingCount: activeSpaces.length }];
        }
        return groupSpacesByLocation(activeSpaces, activeBuildings).flatMap((g) => g.floors.map((f, i) => ({
            key: `${g.buildingId ?? 'none'}|${f.floor ?? ''}`,
            building: g.buildingId ? g.label : '',
            floor: f.label,
            spaces: f.spaces,
            firstOfBuilding: i === 0,
            buildingCount: g.count,
        })));
    }, [hasBuildings, activeSpaces, activeBuildings]);

    const sections = useMemo(() => {
        if (!filtering) return allSections;
        const q = normalizeSearch(search);
        return allSections
            .map((sec) => ({ ...sec, spaces: sec.spaces.filter((s) => (!q || normalizeSearch(s.name).includes(q)) && (!onlyUnassigned || hasNoAssignee(s))) }))
            .filter((sec) => sec.spaces.length > 0)
            .map((sec, i, arr) => ({ ...sec, firstOfBuilding: i === 0 || arr[i - 1].building !== sec.building }));
    }, [allSections, filtering, search, onlyUnassigned]);

    const effectiveCollapsed = useMemo(
        () => collapsed ?? (activeSpaces.length > COLLAPSE_OVER ? new Set(allSections.map((s) => s.key)) : new Set<string>()),
        [collapsed, activeSpaces.length, allSections],
    );
    const unassignedCount = activeSpaces.filter(hasNoAssignee).length;
    const shownCount = sections.reduce((n, s) => n + s.spaces.length, 0);
    // 삭제·숨김으로 사라진 공간은 고른 목록에서도 뺀다
    const selectedIds = [...selected].filter((id) => activeSpaces.some((s) => s.id === id));

    const toggleSection = (key: string) => {
        const next = new Set(effectiveCollapsed);
        if (next.has(key)) next.delete(key); else next.add(key);
        setCollapsed(next);
    };
    const setAllCollapsed = (fold: boolean) => setCollapsed(fold ? new Set(allSections.map((s) => s.key)) : new Set());
    const select = (ids: string[], on: boolean) => setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) { if (on) next.add(id); else next.delete(id); }
        return next;
    });

    const handleAdd = async (e: FormEvent) => {
        e.preventDefault();
        if (await addSpace(newName, newLocation)) setNewName(''); // 같은 건물·층에 이어서 넣기 쉽게 위치는 남긴다
    };

    return (
        <div className="max-w-3xl mx-auto animate-fade-in">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">공간 관리</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">
                재물이 놓인 곳(사무실·시설)을 등록하고 담당 직원이나 팀을 정합니다. 건물이 여러 곳이면 [건물·층]에서 먼저 등록하세요.
                &lsquo;나눠서 조사&rsquo; 방식에서는 담당이 자기 공간을 조사합니다. 조사 방식은{' '}
                <Link to="/admin/settings" className="underline underline-offset-2 text-primary-700 dark:text-primary-300 font-medium">
                    설정
                </Link>
                에서 바꿉니다.
            </p>

            <div role="tablist" aria-label="공간 관리 보기" className="flex gap-1 p-1 mb-6 rounded-xl bg-surface-100 dark:bg-surface-800 w-full sm:w-auto sm:inline-flex">
                {([['spaces', `공간 ${activeSpaces.length}`], ['buildings', `건물·층 ${activeBuildings.length}`]] as const).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`space-tab-${key}`}
                        aria-selected={tab === key}
                        aria-controls={`space-panel-${key}`}
                        onClick={() => setTab(key)}
                        className={`flex-1 sm:flex-none min-h-[48px] px-4 rounded-lg text-sm font-medium transition-colors ${tab === key
                            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                            : 'text-surface-600 dark:text-surface-400'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'buildings' ? (
                <div role="tabpanel" id="space-panel-buildings" aria-labelledby="space-tab-buildings">
                    {loading ? <SkeletonList count={2} /> : (
                        <BuildingPanel
                            busy={busy}
                            activeBuildings={activeBuildings}
                            archivedBuildings={archivedBuildings}
                            spacesIn={spacesIn}
                            addBuilding={addBuilding}
                            editBuilding={editBuilding}
                            moveBuilding={moveBuilding}
                            archiveBuilding={archiveBuilding}
                            restoreBuilding={restoreBuilding}
                        />
                    )}
                </div>
            ) : (
                <div role="tabpanel" id="space-panel-spaces" aria-labelledby="space-tab-spaces">
                    {/* 공간 추가 — 한 곳씩, 또는 [여러 곳 한꺼번에] */}
                    <form onSubmit={handleAdd} className="glass-card p-4 mb-4 flex flex-col gap-2">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <label htmlFor="new-space-name" className="sr-only">새 공간 이름</label>
                            <input
                                id="new-space-name"
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                maxLength={SPACE_NAME_MAX}
                                placeholder="새 공간 이름 (예: 상담실, 프로그램실1)"
                                className="input flex-1 min-h-[48px]"
                            />
                            <button type="submit" disabled={busy || !newName.trim()} className="btn-primary min-h-[48px] px-5">
                                공간 추가
                            </button>
                        </div>
                        {hasBuildings && (
                            <LocationSelects idPrefix="new-space" buildings={activeBuildings} value={newLocation} onChange={setNewLocation} disabled={busy} />
                        )}
                        <button type="button" className="btn-secondary btn-sm min-h-[48px] self-start" onClick={() => setBulkAddOpen(true)}>
                            여러 공간 한꺼번에 추가
                        </button>
                    </form>

                    {loading ? (
                        <SkeletonList count={3} />
                    ) : loadError ? (
                        <div className="glass-card p-6 text-center">
                            <p className="text-sm text-red-700 dark:text-red-300 mb-3" role="alert">{loadError}</p>
                            <button type="button" onClick={reload} className="btn-secondary min-h-[48px] px-4">다시 불러오기</button>
                        </div>
                    ) : activeSpaces.length === 0 ? (
                        <div className="glass-card p-8 text-center">
                            <div className="text-4xl mb-3" aria-hidden="true">🏢</div>
                            <p className="text-surface-700 dark:text-surface-300 font-medium">아직 등록한 공간이 없습니다</p>
                            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                                위 칸에 공간 이름을 적어 추가하세요. 방이 많으면 [여러 공간 한꺼번에 추가]로 목록을 붙여 넣으세요.
                                희망이음 대장의 위치 이름과 같게 쓰면 엑셀 가져오기 때 자동으로 맞춰집니다.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* 찾기·거르기 */}
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <label htmlFor="space-search" className="sr-only">공간 이름으로 찾기</label>
                                <input id="space-search" type="search" className="input flex-1 min-w-[10rem] min-h-[48px]" placeholder="공간 이름으로 찾기"
                                    value={search} onChange={(e) => setSearch(e.target.value)} />
                                <label className="flex items-center gap-2 min-h-[48px] text-sm text-surface-700 dark:text-surface-300">
                                    <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
                                    담당 없음만 <span className="tabular-nums text-surface-600 dark:text-surface-400">({unassignedCount})</span>
                                </label>
                                {hasBuildings && !filtering && (
                                    <span className="flex gap-1">
                                        <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={() => setAllCollapsed(false)}>모두 펼치기</button>
                                        <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={() => setAllCollapsed(true)}>모두 접기</button>
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-surface-600 dark:text-surface-400 mb-2" aria-live="polite">
                                {filtering ? `찾은 공간 ${shownCount}곳` : `공간 ${activeSpaces.length}곳`} · 줄 앞 상자로 여러 곳을 골라 한꺼번에 담당 지정·옮기기·삭제할 수 있습니다.
                            </p>

                            {sections.length === 0 ? (
                                <div className="glass-card p-6 text-center">
                                    <p className="text-sm text-surface-700 dark:text-surface-300 mb-3">
                                        {onlyUnassigned && !search.trim() ? '담당이 없는 공간이 없습니다. 🎉' : '조건에 맞는 공간이 없습니다.'}
                                    </p>
                                    <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => { setSearch(''); setOnlyUnassigned(false); }}>찾기·거르기 지우기</button>
                                </div>
                            ) : (
                                <SpaceList
                                    sections={sections}
                                    grouped={hasBuildings}
                                    collapsed={effectiveCollapsed}
                                    forceOpen={filtering}
                                    onToggleSection={toggleSection}
                                    selected={selected}
                                    onSelect={select}
                                    busy={busy}
                                    nameOf={nameOf}
                                    teamName={teamsState.teamName}
                                    onEdit={(s) => setEditingId(s.id)}
                                    onMove={(s, dir) => void moveSpace(s, dir)}
                                />
                            )}

                            {/* 고른 공간에 할 일 — 고른 동안 화면 아래에 붙는다 */}
                            {/* 막대가 가리지 않게 목록 아래에 자리를 비워 둔다 */}
                            {selectedIds.length > 0 && <div className="h-36 sm:h-24" aria-hidden="true" />}
                            {selectedIds.length > 0 && (
                                // 화면 아래에 고정 — sticky는 레이아웃의 overflow 때문에 목록 끝에 머물러, 위쪽 층을 고르면 보이지 않았다
                                <div className="fixed bottom-3 left-3 right-3 lg:left-[calc(16rem+1.5rem)] lg:right-6 z-40 flex justify-center pointer-events-none">
                                <div className="pointer-events-auto w-full max-w-3xl glass-card p-3 shadow-xl border border-primary-200 dark:border-primary-800 flex flex-wrap items-center gap-2 bg-white/95 dark:bg-surface-900/95"
                                    role="region" aria-label="고른 공간에 할 일">
                                    <span className="text-sm font-semibold text-surface-900 dark:text-surface-100 tabular-nums mr-auto">{selectedIds.length}곳 고름</span>
                                    <label htmlFor="bulk-assign" className="sr-only">고른 공간에 담당 지정</label>
                                    <select id="bulk-assign" value="" disabled={busy} className="input w-auto min-w-[10rem] min-h-[48px] text-sm"
                                        onChange={(e) => { const v = e.target.value; if (v) void bulkAssign(selectedIds, v); }}>
                                        <option value="">+ 담당 지정 (팀·직원)</option>
                                        <AssigneeOptions teams={teamsState.activeTeams} members={members} roleLabel={ROLE_LABEL} />
                                    </select>
                                    {hasBuildings && (
                                        <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" disabled={busy} onClick={() => setMoveOpen(true)}>위치 옮기기</button>
                                    )}
                                    <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3 text-red-700 dark:text-red-300" disabled={busy}
                                        onClick={async () => { if (await bulkArchive(selectedIds)) setSelected(new Set()); }}>
                                        삭제
                                    </button>
                                    <button type="button" className="btn-ghost btn-sm min-h-[48px] px-3" onClick={() => setSelected(new Set())}>고르기 해제</button>
                                </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* 삭제한 공간 */}
                    {!loading && archivedSpaces.length > 0 && (
                        <div className="mt-8">
                            <button
                                type="button"
                                onClick={() => setShowArchived((v) => !v)}
                                aria-expanded={showArchived}
                                className="btn-secondary btn-sm min-h-[48px]"
                            >
                                <span aria-hidden="true">{showArchived ? '▾' : '▸'}</span> 삭제한 공간 {archivedSpaces.length}개
                            </button>
                            {showArchived && (
                                <ul className="space-y-2 mt-2" aria-label="삭제한 공간 목록">
                                    {archivedSpaces.map((space) => (
                                        <li key={space.id} className="glass-card p-4 flex items-center justify-between gap-3">
                                            <span className="text-sm text-surface-700 dark:text-surface-300 break-keep min-w-0">{space.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => restoreSpace(space)}
                                                disabled={busy}
                                                className="btn-secondary btn-sm min-h-[48px] px-3 flex-shrink-0"
                                                aria-label={`${space.name} 되살리기`}
                                            >
                                                되살리기
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}

            <SpaceEditModal
                space={editingSpace}
                buildings={activeBuildings}
                busy={busy}
                onClose={() => setEditingId(null)}
                onSave={(name, loc) => (editingSpace ? saveSpaceDetails(editingSpace, name, loc) : Promise.resolve(false))}
                onDelete={async () => (editingSpace ? archiveSpace(editingSpace) : false)}
                assignee={editingSpace && (
                    <AssigneeEditor
                        space={editingSpace}
                        busy={busy}
                        members={members}
                        nameOf={nameOf}
                        teams={teamsState.activeTeams}
                        teamName={teamsState.teamName}
                        onAddManager={(uid) => addManager(editingSpace, uid)}
                        onRemoveManager={(uid) => removeManager(editingSpace, uid)}
                        onAddTeam={(id) => addTeam(editingSpace, id)}
                        onRemoveTeam={(id) => removeTeam(editingSpace, id)}
                    />
                )}
            />

            <BulkAddModal open={bulkAddOpen} buildings={activeBuildings} busy={busy} initialLocation={newLocation}
                onClose={() => setBulkAddOpen(false)} onAdd={addSpaces} />

            <MoveModal open={moveOpen} count={selectedIds.length} buildings={activeBuildings} busy={busy}
                onClose={() => setMoveOpen(false)}
                onMove={async (loc) => { if (await bulkSetLocation(selectedIds, loc)) setMoveOpen(false); }} />
        </div>
    );
}
