/**
 * useAssetList — 관리자 재물 목록 (기획서 F08) + 라벨 인쇄할 재물 고르기(F09)
 *
 * 기관의 재물을 한 번 읽어 와 화면에서 거른다(검색·공간·상태·대장에 없음·라벨). 500~2,000건 기관을
 * 기준으로, 거를 때마다 서버를 다시 읽지 않는 쪽이 읽기 비용이 적다. 그리는 것은 100건씩 늘린다.
 *
 * 공간 거르기는 건물·층 단위로도 된다(2026-11-22) — 건물 하나를 거른 뒤 '모두 고르기'로 그 건물 라벨을 한 번에 뽑는다.
 * 마지막 확인(상시 확인 기록, 같은 날)으로도 거른다 — "6개월 넘게 못 본 재물"을 찾아 점검한다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isUsefulLifeOver, todayText } from '../lib/usefulLife';
import { useAuth } from './useAuth';
import { getAssets, getSpaces, getBuildings, getAssetChecks } from '../lib/firestore';
import { toDateOrNull } from '../lib/dateUtils';
import type { AssetCheck } from '../types/assetCheck';
import { spaceLocationMap } from '../lib/spaceGroups';
import type { Asset, AssetStatus } from '../types/asset';
import type { Space } from '../types/space';
import type { Building } from '../types/building';

export const LIST_PAGE = 100;

/**
 * 공간 거르기 — 전체 / 공간 미지정 / 특정 공간 ID / 건물(`b:건물ID`) / 층(`f:건물ID|층`)
 * 건물·층은 공간 ID가 아니라 접두사로 구분한다(공간 문서 ID에는 ':'가 들어가지 않는다).
 */
export type SpaceFilter = 'all' | 'none' | string;

export const buildingFilter = (buildingId: string): SpaceFilter => `b:${buildingId}`;
export const floorFilter = (buildingId: string, floor: string): SpaceFilter => `f:${buildingId}|${floor}`;

/** 공간 ID → 건물·층 (건물·층 거르기에 쓴다) */
export type SpacePlaceIndex = Map<string, { buildingId: string | null; floor: string | null }>;

export const spacePlaceIndex = (spaces: Space[]): SpacePlaceIndex =>
    new Map(spaces.map((s) => [s.id, { buildingId: s.buildingId ?? null, floor: s.floor ?? null }]));

/** 재물이 공간 거르기 조건에 맞는가 */
function matchesSpace(a: Asset, filter: SpaceFilter, places?: SpacePlaceIndex): boolean {
    if (filter === 'all') return true;
    if (filter === 'none') return a.spaceId == null;
    if (filter.startsWith('b:') || filter.startsWith('f:')) {
        const place = a.spaceId ? places?.get(a.spaceId) : undefined;
        if (!place?.buildingId) return false;
        if (filter.startsWith('b:')) return place.buildingId === filter.slice(2);
        const [bid, floor] = filter.slice(2).split('|');
        return place.buildingId === bid && (place.floor ?? '') === floor;
    }
    return a.spaceId === filter;
}
export type StatusFilter = AssetStatus | 'all';
export type LabelFilter = 'all' | 'untagged' | 'tagged';
/** 마지막 확인 거르기 — 전체 / 6개월 넘게 안 봄(한 번도 안 본 것 포함) / 1년 넘게 안 봄(포함) / 한 번도 안 봄 */
export type CheckedFilter = 'all' | 'over6m' | 'over1y' | 'never';

/** 마지막 확인 시각(없으면 null) */
export const checkedAtOf = (checks: Map<string, AssetCheck> | undefined, assetId: string): Date | null =>
    toDateOrNull(checks?.get(assetId)?.checkedAt ?? null);

const monthsAgo = (now: Date, n: number) => { const d = new Date(now); d.setMonth(d.getMonth() - n); return d; };

function matchesChecked(at: Date | null, f: CheckedFilter, now: Date): boolean {
    if (f === 'all') return true;
    if (f === 'never') return at === null;
    const limit = monthsAgo(now, f === 'over6m' ? 6 : 12);
    return at === null || at < limit;
}

export interface AssetFilters {
    search: string;
    space: SpaceFilter;
    status: StatusFilter;
    onlyMissing: boolean;
    /** 내용연수(내구연한)가 지난 것만 (2026-11-22) */
    onlyLifeOver?: boolean;
    label: LabelFilter;
    checked: CheckedFilter;
}

export const DEFAULT_FILTERS: AssetFilters = { search: '', space: 'all', status: 'active', onlyMissing: false, onlyLifeOver: false, label: 'all', checked: 'all' };

const collator = new Intl.Collator('ko', { numeric: true });

/** 자산코드 순(숫자는 숫자 크기로 — 1-2 < 1-10) */
export const sortAssets = (list: Asset[]): Asset[] => [...list].sort((a, b) => collator.compare(a.code, b.code));

/** 거르기 — 검색은 자산코드·품명·원본 위치에서 띄어쓰기·대소문자 무시하고 찾는다 */
export function filterAssets(
    list: Asset[], f: AssetFilters, places?: SpacePlaceIndex, checks?: Map<string, AssetCheck>, now = new Date(),
): Asset[] {
    const q = f.search.replace(/\s+/g, '').toLowerCase();
    const today = todayText(now);
    return list.filter((a) => {
        if (!matchesChecked(checkedAtOf(checks, a.id), f.checked ?? 'all', now)) return false;
        if (f.status !== 'all' && a.status !== f.status) return false;
        if (!matchesSpace(a, f.space, places)) return false;
        if (f.onlyMissing && !a.missingFromSource) return false;
        if (f.onlyLifeOver && !isUsefulLifeOver(a, today)) return false;
        if (f.label === 'untagged' && a.tagId) return false;
        if (f.label === 'tagged' && !a.tagId) return false;
        if (q) {
            const hay = `${a.code} ${a.name ?? ''} ${a.locationRaw ?? ''}`.replace(/\s+/g, '').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

export default function useAssetList() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId ?? null;
    const [assets, setAssets] = useState<Asset[]>([]);
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [checks, setChecks] = useState<Map<string, AssetCheck>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    /** 마지막 확인 기록 조회 실패 — 목록은 보이지만 확인 날짜·필터를 믿을 수 없다 */
    const [checksError, setChecksError] = useState(false);
    const [filters, setFilters] = useState<AssetFilters>(DEFAULT_FILTERS);
    const [shown, setShown] = useState(LIST_PAGE);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(false);
        try {
            const [a, s, b, c] = await Promise.all([
                getAssets(orgId), getSpaces(orgId), getBuildings(orgId),
                // 마지막 확인은 못 읽어도 목록은 보인다 — 대신 실패를 알려 '한 번도 확인 안 됨'으로 오해하지 않게 한다
                getAssetChecks(orgId).catch(() => null),
            ]);
            setAssets(sortAssets(a));
            setSpaces(s);
            setBuildings(b);
            setChecks(c ?? new Map());
            setChecksError(c === null);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    /** 마지막 확인 기록만 다시 읽는다 — 목록 전체를 다시 그리지 않는다 */
    const reloadChecks = useCallback(async () => {
        if (!orgId) return;
        try {
            setChecks(await getAssetChecks(orgId));
            setChecksError(false);
        } catch {
            setChecksError(true);
        }
    }, [orgId]);

    const places = useMemo(() => spacePlaceIndex(spaces), [spaces]);
    const filtered = useMemo(() => filterAssets(assets, filters, places, checks), [assets, filters, places, checks]);
    /** 공간 표시 이름 — 건물을 등록했으면 "본관 2층 상담실" */
    const spaceName = useMemo(() => {
        const loc = spaceLocationMap(spaces, buildings);
        return new Map(spaces.map((s) => [s.id, loc[s.id] ? `${loc[s.id]} ${s.name}` : s.name]));
    }, [spaces, buildings]);

    const setFilter = useCallback(<K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setShown(LIST_PAGE);
    }, []);
    const resetFilters = useCallback(() => { setFilters(DEFAULT_FILTERS); setShown(LIST_PAGE); }, []);

    const toggle = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);
    /** 여러 건을 한꺼번에 고르거나 뺀다(표 머리의 체크 칸) */
    const setMany = useCallback((ids: string[], on: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const id of ids) { if (on) next.add(id); else next.delete(id); }
            return next;
        });
    }, []);
    /** 지금 걸러진 결과 전부를 고른다(화면에 아직 안 그린 것 포함) */
    const selectFiltered = useCallback(() => {
        setSelected((prev) => new Set([...prev, ...filtered.map((a) => a.id)]));
    }, [filtered]);
    const clearSelection = useCallback(() => setSelected(new Set()), []);

    /** 고른 재물 — 목록 순서대로(라벨도 이 순서로 인쇄된다) */
    const selectedAssets = useMemo(() => assets.filter((a) => selected.has(a.id)), [assets, selected]);

    /** 라벨 인쇄에서 발급한 태그를 목록에 반영한다(다시 읽지 않고) */
    const applyTags = useCallback((tags: Map<string, string>) => {
        setAssets((prev) => prev.map((a) => (!a.tagId && tags.has(a.id) ? { ...a, tagId: tags.get(a.id) ?? null } : a)));
    }, []);

    /** 공간을 옮긴 재물을 목록에 반영한다(다시 읽지 않고) — 공간 옮기기·공간 미지정 정리(2026-11-23) */
    const applySpace = useCallback((ids: Set<string>, spaceId: string | null) => {
        setAssets((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, spaceId } : a)));
    }, []);

    return {
        orgId, assets, spaces, buildings, spaceName, checks, checksError, reloadChecks, loading, error, reload: load, applySpace,
        filters, setFilter, resetFilters, filtered,
        visible: filtered.slice(0, shown), hasMore: filtered.length > shown, showMore: () => setShown((n) => n + LIST_PAGE),
        selected, toggle, setMany, selectFiltered, clearSelection, selectedAssets, applyTags,
    };
}
