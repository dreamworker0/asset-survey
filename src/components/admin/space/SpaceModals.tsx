/**
 * 공간 관리의 창·편집 폼 — [공간 고치기]·담당 지정·여러 공간 추가·위치 옮기기.
 * SpaceManager.tsx에서 나눴다(2026-11-24). 상태와 저장은 useSpaceManager가 맡고, 여기는 표시만 한다.
 */
import { useState, type FormEvent } from 'react';
import { SPACE_NAME_MAX } from '../../../schemas/space';
import { hasNoAssignee } from '../../../lib/spaceGroups';
import LocationSelects from './LocationSelects';
import PanelModal from './PanelModal';
import { AssigneeOptions } from './SpaceList';
import type { Space } from '../../../types/space';
import type { Team } from '../../../types/team';
import type { Building } from '../../../types/building';
import type { SpaceLocation } from '../../../lib/firestore/spaces';

import { ROLE_LABEL, NO_LOCATION } from './spaceConstants';

/**
 * [공간 고치기] 창 — 담당·이름·위치(건물·층)·삭제를 한곳에 모았다(2026-11-22).
 * 목록이 한 줄로 바뀌면서 담당 지정도 이 창으로 옮겼다(여러 곳은 목록에서 골라 한꺼번에).
 */
export function SpaceEditModal({ space, buildings, busy, onClose, onSave, onDelete, assignee }: {
    space: Space | null;
    buildings: Building[];
    busy: boolean;
    onClose: () => void;
    onSave: (name: string, loc: SpaceLocation | undefined) => Promise<boolean>;
    onDelete: () => Promise<boolean>;
    assignee: React.ReactNode;
}) {
    return (
        <PanelModal open={space !== null} title={space ? `'${space.name}' 고치기` : '공간 고치기'} titleId="space-edit-title" onClose={onClose}>
            {space && (
                <>
                    {assignee}
                    <SpaceEditForm key={space.id} space={space} buildings={buildings} busy={busy} onCancel={onClose} onSave={onSave} onDelete={onDelete} />
                </>
            )}
        </PanelModal>
    );
}

/** 고치기 창의 담당 칸 — 지정된 팀·직원(빼기)과 [+ 담당 지정] */
export function AssigneeEditor({ space, busy, members, nameOf, teams, teamName, onAddManager, onRemoveManager, onAddTeam, onRemoveTeam }: {
    space: Space;
    busy: boolean;
    members: { uid: string; name: string; role: string }[];
    nameOf: (uid: string) => string;
    teams: Team[];
    teamName: (id: string) => string | null;
    onAddManager: (uid: string) => void;
    onRemoveManager: (uid: string) => void;
    onAddTeam: (teamId: string) => void;
    onRemoveTeam: (teamId: string) => void;
}) {
    const spaceTeams = space.teamIds ?? [];
    const candidates = members.filter((m) => !space.managerUids.includes(m.uid));
    const teamCandidates = teams.filter((t) => !spaceTeams.includes(t.id));
    const nothingToAdd = candidates.length === 0 && teamCandidates.length === 0;
    return (
        <div className="mb-5 pb-4 border-b border-surface-200 dark:border-surface-700">
            <p className="label">담당 <span className="text-xs font-normal text-surface-600 dark:text-surface-400">(팀을 지정하면 그 팀 직원 모두가 조사)</span></p>
            {hasNoAssignee(space) ? (
                <p className="text-sm text-amber-800 dark:text-amber-300 mb-2"><span aria-hidden="true">⚠️ </span>아직 담당이 없습니다.</p>
            ) : (
                <ul className="flex flex-wrap gap-2 mb-2" aria-label={`${space.name} 담당`}>
                    {spaceTeams.map((id) => (
                        <li key={`t-${id}`} className="inline-flex items-center gap-1 pl-3 pr-1 rounded-full bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-300 text-sm">
                            <span aria-hidden="true">👥</span> {teamName(id) ?? '(삭제한 팀)'}
                            <button type="button" onClick={() => onRemoveTeam(id)} disabled={busy}
                                className="w-12 h-12 -my-1 flex items-center justify-center rounded-full hover:bg-accent-100 dark:hover:bg-accent-800/50"
                                aria-label={`${teamName(id) ?? '팀'} 담당에서 빼기`}>
                                <span aria-hidden="true">✕</span>
                            </button>
                        </li>
                    ))}
                    {space.managerUids.map((uid) => (
                        <li key={`u-${uid}`} className="inline-flex items-center gap-1 pl-3 pr-1 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm">
                            {nameOf(uid)}
                            <button type="button" onClick={() => onRemoveManager(uid)} disabled={busy}
                                className="w-12 h-12 -my-1 flex items-center justify-center rounded-full hover:bg-primary-100 dark:hover:bg-primary-800/50"
                                aria-label={`${nameOf(uid)} 담당에서 빼기`}>
                                <span aria-hidden="true">✕</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <label htmlFor="edit-space-assign" className="sr-only">{space.name} 담당 지정</label>
            <select id="edit-space-assign" value="" disabled={busy || nothingToAdd} className="input w-full min-h-[48px]"
                onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith('t:')) onAddTeam(v.slice(2));
                    else if (v.startsWith('u:')) onAddManager(v.slice(2));
                }}>
                <option value="">{nothingToAdd ? '더 정할 직원·팀이 없습니다' : '+ 담당 지정 (팀·직원)'}</option>
                <AssigneeOptions teams={teamCandidates} members={candidates} roleLabel={ROLE_LABEL} />
            </select>
        </div>
    );
}

function SpaceEditForm({ space, buildings, busy, onCancel, onSave, onDelete }: {
    space: Space;
    buildings: Building[];
    busy: boolean;
    onCancel: () => void;
    onSave: (name: string, loc: SpaceLocation | undefined) => Promise<boolean>;
    onDelete: () => Promise<boolean>;
}) {
    const [name, setName] = useState(space.name);
    const [loc, setLoc] = useState<SpaceLocation>({ buildingId: space.buildingId ?? null, floor: space.floor ?? null });
    const hasBuildings = buildings.length > 0;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (await onSave(name, hasBuildings ? loc : undefined)) onCancel();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="edit-space-name" className="label">공간 이름</label>
                <input id="edit-space-name" type="text" className="input w-full min-h-[48px]" value={name} maxLength={SPACE_NAME_MAX}
                    onChange={(e) => setName(e.target.value)} aria-describedby="edit-space-name-hint" required />
                <p id="edit-space-name-hint" className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                    엑셀 대장의 위치 이름과 같게 쓰면 가져오기 때 자동으로 맞춰집니다.
                </p>
            </div>
            {hasBuildings && (
                <div>
                    <p className="label">건물·층</p>
                    <LocationSelects idPrefix="edit-space" buildings={buildings} value={loc} onChange={setLoc} disabled={busy} />
                </div>
            )}
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="btn-secondary min-h-[48px] px-4">닫기</button>
                <button type="submit" disabled={busy || !name.trim()} className="btn-primary min-h-[48px] px-5">이름·위치 저장</button>
            </div>
            <div className="border-t border-surface-200 dark:border-surface-700 pt-4 flex flex-wrap items-center gap-3">
                <p className="flex-1 min-w-[12rem] text-xs text-surface-600 dark:text-surface-400">
                    더 쓰지 않는 공간은 삭제하세요. 이 공간의 재물은 지워지지 않고, 나중에 되살릴 수 있습니다.
                </p>
                <button type="button" disabled={busy} className="btn-secondary btn-sm min-h-[48px] text-red-700 dark:text-red-300"
                    onClick={async () => { if (await onDelete()) onCancel(); }}>
                    공간 삭제
                </button>
            </div>
        </form>
    );
}

/** 여러 공간 한꺼번에 추가 — 한 줄에 하나씩 붙여 넣는다 */
export function BulkAddModal({ open, buildings, busy, initialLocation, onClose, onAdd }: {
    open: boolean;
    buildings: Building[];
    busy: boolean;
    initialLocation: SpaceLocation;
    onClose: () => void;
    onAdd: (text: string, loc: SpaceLocation) => Promise<number>;
}) {
    return (
        <PanelModal open={open} title="여러 공간 한꺼번에 추가" titleId="bulk-add-title" onClose={onClose}>
            {open && <BulkAddForm buildings={buildings} busy={busy} initialLocation={initialLocation} onClose={onClose} onAdd={onAdd} />}
        </PanelModal>
    );
}

function BulkAddForm({ buildings, busy, initialLocation, onClose, onAdd }: {
    buildings: Building[];
    busy: boolean;
    initialLocation: SpaceLocation;
    onClose: () => void;
    onAdd: (text: string, loc: SpaceLocation) => Promise<number>;
}) {
    const [text, setText] = useState('');
    const [loc, setLoc] = useState<SpaceLocation>(initialLocation);
    const count = text.split(/\r?\n/).map((l) => l.split('\t')[0].trim()).filter(Boolean).length;
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (await onAdd(text, loc) > 0) onClose();
    };
    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="bulk-add-names" className="label">공간 이름 (한 줄에 하나)</label>
                <textarea id="bulk-add-names" className="input w-full" rows={8} value={text} onChange={(e) => setText(e.target.value)}
                    placeholder={'상담실\n프로그램실1\n프로그램실2\n사무실'} aria-describedby="bulk-add-hint" />
                <p id="bulk-add-hint" className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                    엑셀·한글의 방 목록을 그대로 붙여 넣어도 됩니다(엑셀은 첫 칸만 씁니다). 이미 있는 이름은 건너뜁니다.
                </p>
            </div>
            {buildings.length > 0 && (
                <div>
                    <p className="label">건물·층 <span className="text-xs font-normal text-surface-600 dark:text-surface-400">(모두 같은 곳에 넣습니다)</span></p>
                    <LocationSelects idPrefix="bulk-add" buildings={buildings} value={loc} onChange={setLoc} disabled={busy} />
                </div>
            )}
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="btn-secondary min-h-[48px] px-4">취소</button>
                <button type="submit" disabled={busy || count === 0} className="btn-primary min-h-[48px] px-5">
                    {count > 0 ? `${count}곳 추가` : '추가'}
                </button>
            </div>
        </form>
    );
}

/** 고른 공간들을 같은 건물·층으로 옮기는 창 */
export function MoveModal({ open, count, buildings, busy, onClose, onMove }: {
    open: boolean;
    count: number;
    buildings: Building[];
    busy: boolean;
    onClose: () => void;
    onMove: (loc: SpaceLocation) => Promise<void>;
}) {
    return (
        <PanelModal open={open} title={`공간 ${count}곳 옮기기`} titleId="bulk-move-title" onClose={onClose}>
            {open && <MoveForm buildings={buildings} busy={busy} onClose={onClose} onMove={onMove} />}
        </PanelModal>
    );
}

function MoveForm({ buildings, busy, onClose, onMove }: {
    buildings: Building[];
    busy: boolean;
    onClose: () => void;
    onMove: (loc: SpaceLocation) => Promise<void>;
}) {
    const [loc, setLoc] = useState<SpaceLocation>(NO_LOCATION);
    return (
        <form onSubmit={(e) => { e.preventDefault(); void onMove(loc); }} className="space-y-4">
            <div>
                <p className="label">옮길 건물·층</p>
                <LocationSelects idPrefix="bulk-move" buildings={buildings} value={loc} onChange={setLoc} disabled={busy} />
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="btn-secondary min-h-[48px] px-4">취소</button>
                <button type="submit" disabled={busy} className="btn-primary min-h-[48px] px-5">옮기기</button>
            </div>
        </form>
    );
}
