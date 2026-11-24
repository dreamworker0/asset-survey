/**
 * 새 재물조사 시작 양식 — 이름·기간·대상 공간(건물·층 묶음 선택)·조사 방식.
 * SurveyManager.tsx에서 나눴다(2026-11-24).
 */
import type { StartForm } from '../../../hooks/useSurveyAdmin';
import { groupSpacesByLocation, orderSpacesByLocation } from '../../../lib/spaceGroups';
import type { Space } from '../../../types/space';
import type { Building } from '../../../types/building';
import { sub, card } from './surveyStyles';

interface StartFormProps {
    form: StartForm;
    setForm: (f: StartForm) => void;
    spaces: Space[];
    buildings: Building[];
    preview: { count: (key: string) => number; total: number; unassigned: number } | null;
    error: string | null;
    mode: 'delegated' | 'solo';
    starting: boolean;
    onStart: () => void;
    onCancel: () => void;
}

export function StartFormView({ form, setForm, spaces, buildings, preview, error, mode, starting, onStart, onCancel }: StartFormProps) {
    // 건물 → 층 → 공간 순서 — 고른 공간도 이 순서로 담아 보고서가 같은 순서로 나오게 한다
    const active = orderSpacesByLocation(spaces, buildings);
    const groups = groupSpacesByLocation(active, buildings);
    const hasBuildings = buildings.some((b) => !b.archived);
    const setIds = (ids: Set<string>) => setForm({ ...form, spaceIds: active.map((x) => x.id).filter((id) => ids.has(id)) });
    const toggle = (id: string) => {
        const next = new Set(form.spaceIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setIds(next);
    };
    /** 건물·층 묶음 한꺼번에 — 다 골라져 있으면 모두 빼고, 아니면 모두 고른다 */
    const toggleMany = (ids: string[]) => {
        const next = new Set(form.spaceIds);
        const all = ids.every((id) => next.has(id));
        for (const id of ids) { if (all) next.delete(id); else next.add(id); }
        setIds(next);
    };
    const spaceRow = (x: Space) => (
        <li key={x.id}>
            <label className="flex items-center gap-3 min-h-[48px] text-sm text-surface-800 dark:text-surface-200">
                <input type="checkbox" className="w-5 h-5 accent-primary-600 flex-shrink-0" checked={form.spaceIds.includes(x.id)} onChange={() => toggle(x.id)} />
                <span className="flex-1 break-keep">{x.name}</span>
                <span className={sub}>{preview?.count(x.id) ?? 0}건 · 담당 {x.managerUids.length}명{(x.teamIds ?? []).length > 0 ? ` · 팀 ${(x.teamIds ?? []).length}` : ''}</span>
            </label>
        </li>
    );
    // 담당 팀이 있으면 담당자가 있는 것으로 본다(2026-11-22)
    const noManager = active.filter((x) => form.spaceIds.includes(x.id) && x.managerUids.length === 0 && (x.teamIds ?? []).length === 0);
    return (
        <section className={card} aria-labelledby="start-title">
            <h2 id="start-title" className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-3">새 조사 시작</h2>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 text-sm text-surface-700 dark:text-surface-300">
                    회차 이름
                    <input className="input min-h-[48px] mt-1" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="text-sm text-surface-700 dark:text-surface-300">
                    시작
                    <input type="date" className="input min-h-[48px] mt-1" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </label>
                <label className="text-sm text-surface-700 dark:text-surface-300">
                    끝
                    <input type="date" className="input min-h-[48px] mt-1" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </label>
            </div>

            <fieldset className="mt-4">
                <legend className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">대상 공간 <span className={`${sub} font-normal`}>(운영 재물만 대상)</span></legend>
                {hasBuildings && active.length > 0 && (
                    <p className={`${sub} mb-1`}>건물·층 이름 옆 상자로 그 안의 공간을 한꺼번에 고르거나 뺄 수 있습니다.</p>
                )}
                <ul className="divide-y divide-surface-100 dark:divide-surface-700">
                    {!hasBuildings ? active.map(spaceRow) : groups.filter((g) => g.count > 0).map((g) => {
                        const ids = g.floors.flatMap((f) => f.spaces.map((x) => x.id));
                        const picked = ids.filter((id) => form.spaceIds.includes(id)).length;
                        return (
                            <li key={g.buildingId ?? 'none'} className="py-1">
                                <GroupCheck
                                    label={g.label} level="building" picked={picked} total={ids.length}
                                    onToggle={() => toggleMany(ids)}
                                />
                                <ul className="pl-4">
                                    {g.floors.map((f) => {
                                        const fids = f.spaces.map((x) => x.id);
                                        const fpicked = fids.filter((id) => form.spaceIds.includes(id)).length;
                                        return (
                                            <li key={f.floor ?? 'none'}>
                                                {f.label && g.buildingId && (
                                                    <GroupCheck
                                                        label={`${g.label} ${f.label}`} display={f.label} level="floor"
                                                        picked={fpicked} total={fids.length} onToggle={() => toggleMany(fids)}
                                                    />
                                                )}
                                                <ul className={f.label && g.buildingId ? 'pl-4' : ''}>{f.spaces.map(spaceRow)}</ul>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        );
                    })}
                    {(preview?.unassigned ?? 0) > 0 && (
                        <li>
                            <label className="flex items-center gap-3 min-h-[48px] text-sm text-surface-800 dark:text-surface-200">
                                <input type="checkbox" className="w-5 h-5 accent-primary-600 flex-shrink-0" checked={form.includesUnassigned} onChange={(e) => setForm({ ...form, includesUnassigned: e.target.checked })} />
                                <span className="flex-1">공간 미지정 재물</span>
                                <span className={sub}>{preview?.unassigned}건 · 어디서 찍든 '다른 공간'으로 나옴</span>
                            </label>
                        </li>
                    )}
                </ul>
            </fieldset>

            {mode === 'delegated' && noManager.length > 0 && (
                <p className="mt-3 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                    담당자가 없는 공간이 있습니다({noManager.map((x) => x.name).join(', ')}). 그 공간은 관리자가 찍고 승인합니다.
                </p>
            )}
            {mode === 'solo' && <p className={`${sub} mt-3`}>조사 방식이 '혼자 조사'라 관리자만 찍고, 제출·승인 없이 바로 마감합니다.</p>}
            {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}

            <div className="flex flex-col sm:flex-row gap-2 justify-end mt-4">
                <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={onCancel} disabled={starting}>취소</button>
                <button type="button" className="btn-primary min-h-[48px] px-5" onClick={onStart} disabled={!!error || starting || !preview || preview.total === 0}>
                    {starting ? '시작하는 중…' : `대상 ${(preview?.total ?? 0).toLocaleString('ko-KR')}건으로 시작`}
                </button>
            </div>
        </section>
    );
}

/** 건물·층 묶음 체크 상자 — 일부만 골랐으면 '일부 선택'(indeterminate)으로 보인다 */
function GroupCheck({ label, display, level, picked, total, onToggle }: {
    label: string; display?: string; level: 'building' | 'floor'; picked: number; total: number; onToggle: () => void;
}) {
    return (
        <label className={`flex items-center gap-3 min-h-[48px] text-sm ${level === 'building'
            ? 'font-semibold text-surface-900 dark:text-surface-100'
            : 'font-medium text-primary-700 dark:text-primary-300'}`}>
            <input
                type="checkbox"
                className="w-5 h-5 accent-primary-600 flex-shrink-0"
                checked={total > 0 && picked === total}
                ref={(el) => { if (el) el.indeterminate = picked > 0 && picked < total; }}
                onChange={onToggle}
                aria-label={`${label} 공간 모두 고르기`}
            />
            <span className="flex-1">{display ?? label}</span>
            <span className={sub}>{picked}/{total}곳</span>
        </label>
    );
}
