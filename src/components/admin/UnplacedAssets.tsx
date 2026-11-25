/**
 * UnplacedAssets — 공간 미지정 재물 정리 (2026-11-23)
 *
 * 시범 기관의 첫 가져오기에서 재물 2,942건 중 783건(27%)이 공간 없이 들어왔다 — 대장의 위치 15가지가
 * 앱의 공간 이름과 맞지 않아서다. 예전엔 엑셀을 처음부터 다시 올려야 연결할 수 있었다.
 * 여기서는 공간 없는 재물을 **대장 위치별로 묶어** 위치 하나에 공간 하나를 고르면 그 재물들이 한 번에 옮겨지고,
 * 그 연결을 기관에 저장해 다음 가져오기 때도 같은 공간으로 들어가게 한다.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useAssetList from '../../hooks/useAssetList';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import { suggestLocationMap } from '../../hooks/useAssetImport';
import { moveAssetsToSpace, createSpace, validateSpaceName, normalizeSpaceName } from '../../lib/firestore';
import { locationKey } from '../../lib/import/diff';
import { parseLocation } from '../../lib/import/locationMatch';
import SpacePickOptions from './space/SpacePickOptions';
import type { Asset } from '../../types/asset';

interface Group {
    key: string;
    location: string | null;
    assets: Asset[];
}

export default function UnplacedAssets() {
    const al = useAssetList();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [choice, setChoice] = useState<Record<string, string>>({});
    const [suggested, setSuggested] = useState(false);
    const [working, setWorking] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    const groups = useMemo<Group[]>(() => {
        const map = new Map<string, Group>();
        for (const a of al.assets) {
            if (a.spaceId) continue;
            const key = locationKey(a.locationRaw ?? null);
            if (!map.has(key)) map.set(key, { key, location: a.locationRaw ?? null, assets: [] });
            map.get(key)!.assets.push(a);
        }
        return [...map.values()].sort((x, y) => y.assets.length - x.assets.length);
    }, [al.assets]);

    // 처음 한 번: 가져오기와 같은 규칙으로 공간을 미리 골라 둔다(이름이 같거나 '본관 2층 상담실'처럼 건물·층이 붙은 경우)
    useEffect(() => {
        if (al.loading || suggested || groups.length === 0) return;
        setChoice(suggestLocationMap(groups.map((g) => g.key), al.spaces, {}, al.buildings));
        setSuggested(true);
    }, [al.loading, suggested, groups, al.spaces, al.buildings]);

    const total = groups.reduce((n, g) => n + g.assets.length, 0);
    const ready = groups.filter((g) => choice[g.key]);
    const readyCount = ready.reduce((n, g) => n + g.assets.length, 0);

    /** 대장 위치 이름 그대로 공간을 만든다 — '본관 2층 상담실'이면 건물·층을 떼고 넣는다(가져오기와 같은 규칙) */
    const createFor = async (g: Group) => {
        if (!al.orgId || !g.location) return;
        const parsed = parseLocation(g.location, al.buildings);
        let name = parsed.name;
        if (name !== normalizeSpaceName(g.location) && validateSpaceName(name, al.spaces)) name = g.location;
        const problem = validateSpaceName(name, al.spaces);
        if (problem) { showToast(problem, 'warning'); return; }
        setWorking(true);
        try {
            const active = al.spaces.filter((s) => !s.archived);
            const order = active.length === 0 ? 0 : Math.max(...active.map((s) => s.order)) + 1;
            const id = await createSpace(al.orgId, name, order, { buildingId: parsed.buildingId, floor: parsed.floor });
            await al.reload(); // 새 공간이 고르기 칸에 보이게
            setChoice((prev) => ({ ...prev, [g.key]: id }));
            showToast(`공간 '${normalizeSpaceName(name)}'을(를) 만들었습니다. [옮기기]를 누르면 재물이 들어갑니다.`, 'success');
        } catch {
            showToast('공간을 만들지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
        } finally {
            setWorking(false);
        }
    };

    const apply = async () => {
        if (!al.orgId || ready.length === 0) return;
        const ok = await confirm({
            title: `재물 ${readyCount.toLocaleString('ko-KR')}건을 옮길까요?`,
            message: `대장 위치 ${ready.length}가지를 고른 공간에 연결합니다. 변경 이력에 남고, 다음에 대장을 다시 가져와도 같은 위치는 같은 공간으로 들어갑니다.`,
            confirmText: '옮기기',
        });
        if (!ok) return;
        setWorking(true);
        setProgress({ done: 0, total: readyCount });
        let done = 0;
        let moved = 0;
        try {
            for (const g of ready) {
                const spaceId = choice[g.key];
                moved += await moveAssetsToSpace({
                    orgId: al.orgId, assets: g.assets, spaceId, locationLinks: { [g.key]: spaceId },
                    onProgress: (d) => setProgress({ done: done + d, total: readyCount }),
                });
                done += g.assets.length;
                al.applySpace(new Set(g.assets.map((a) => a.id)), spaceId);
            }
            showToast(`재물 ${moved.toLocaleString('ko-KR')}건을 공간에 넣었습니다.`, 'success');
        } catch {
            showToast(`옮기다 멈췄습니다(${done.toLocaleString('ko-KR')}건까지 됨). 인터넷 연결을 확인하고 다시 눌러 주세요.`, 'error');
            void al.reload();
        } finally {
            setWorking(false);
            setProgress(null);
        }
    };

    if (al.loading) return <div className="flex justify-center py-20" role="status" aria-label="불러오는 중"><div className="w-8 h-8 spinner" /></div>;
    if (al.error) {
        return (
            <div className="max-w-3xl mx-auto glass-card p-6 text-center">
                <p className="text-red-700 dark:text-red-300 mb-3" role="alert">재물 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.</p>
                <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void al.reload()}>다시 불러오기</button>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto animate-fade-in">
            <Link to="/admin/assets" className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 dark:text-primary-300 min-h-[48px]">
                <span aria-hidden="true">←</span> 재물 목록
            </Link>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">공간 미지정 재물 정리</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">
                공간이 정해지지 않은 재물을 <b className="font-semibold">대장의 위치</b>별로 묶었습니다. 위치마다 공간을 고르고 [옮기기]를 누르세요.
                고른 연결은 저장되어 다음에 대장을 다시 가져올 때도 그대로 씁니다. 맞는 공간이 없으면 [이 이름으로 공간 만들기]를 누르세요.
            </p>

            {groups.length === 0 ? (
                <div className="glass-card p-8 text-center">
                    <div className="text-4xl mb-3" aria-hidden="true">🎉</div>
                    <p className="text-surface-800 dark:text-surface-200 font-medium">공간이 정해지지 않은 재물이 없습니다</p>
                    <Link to="/admin/assets" className="btn-secondary min-h-[48px] px-5 mt-4">재물 목록으로</Link>
                </div>
            ) : (
                <>
                    <p className="text-sm text-surface-700 dark:text-surface-300 mb-2 tabular-nums" aria-live="polite">
                        공간 미지정 {total.toLocaleString('ko-KR')}건 · 위치 {groups.length}가지
                        {readyCount > 0 && <> · <b className="text-primary-700 dark:text-primary-300">공간 고름 {ready.length}가지({readyCount.toLocaleString('ko-KR')}건)</b></>}
                    </p>
                    <ul className="space-y-2 mb-28" aria-label="대장 위치별 공간 미지정 재물">
                        {groups.map((g) => {
                            const id = `unplaced-${g.key.replace(/[^a-zA-Z0-9_-]/g, '_')}-${groups.indexOf(g)}`;
                            const sample = g.assets.slice(0, 3).map((a) => a.name ?? a.code).join(', ');
                            return (
                                <li key={g.key} className="glass-card p-3">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                        <label htmlFor={id} className="font-medium text-surface-900 dark:text-surface-100 break-keep">
                                            {g.location ?? '(대장에 위치 없음)'}
                                        </label>
                                        <span className="text-sm font-semibold tabular-nums text-surface-800 dark:text-surface-200">{g.assets.length.toLocaleString('ko-KR')}건</span>
                                    </div>
                                    <p className="text-xs text-surface-600 dark:text-surface-400 mb-2 break-keep">예: {sample}{g.assets.length > 3 ? ' …' : ''}</p>
                                    <div className="flex flex-wrap gap-2">
                                        <select id={id} className="input flex-1 min-w-[12rem] min-h-[48px]" value={choice[g.key] ?? ''} disabled={working}
                                            onChange={(e) => setChoice((prev) => ({ ...prev, [g.key]: e.target.value }))}>
                                            <option value="">공간 고르기…</option>
                                            <SpacePickOptions spaces={al.spaces} buildings={al.buildings} />
                                        </select>
                                        {g.location && !choice[g.key] && (
                                            <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" disabled={working} onClick={() => void createFor(g)}>
                                                이 이름으로 공간 만들기
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="fixed bottom-3 left-3 right-3 lg:left-[calc(16rem+1.5rem)] lg:right-6 z-40 flex justify-center pointer-events-none">
                        <div className="pointer-events-auto w-full max-w-3xl glass-card p-3 shadow-glass-lg border border-primary-200 dark:border-primary-800 flex flex-wrap items-center gap-2 bg-white/95 dark:bg-surface-900/95 backdrop-blur-md">
                            <p className="flex-1 min-w-[10rem] text-sm text-surface-800 dark:text-surface-200 tabular-nums" role="status">
                                {progress
                                    ? `옮기는 중… ${progress.done.toLocaleString('ko-KR')} / ${progress.total.toLocaleString('ko-KR')}건`
                                    : readyCount > 0 ? `${ready.length}가지 위치, 재물 ${readyCount.toLocaleString('ko-KR')}건을 옮길 준비가 됐습니다` : '위치마다 공간을 고르세요'}
                            </p>
                            <button type="button" className="btn-primary min-h-[48px] px-5" disabled={working || readyCount === 0} onClick={() => void apply()}>
                                {working && progress ? '옮기는 중…' : `옮기기${readyCount > 0 ? ` (${readyCount.toLocaleString('ko-KR')}건)` : ''}`}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
