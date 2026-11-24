/**
 * useAssetList — 관리자 재물 목록 거르기·고르기 (기획서 F08·F09)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Asset } from '../../types/asset';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ userData: { organizationId: 'org-A' } }) }));
vi.mock('../../lib/firestore', () => ({ getAssets: vi.fn(), getSpaces: vi.fn(), getBuildings: vi.fn(async () => []), getAssetChecks: vi.fn(async () => new Map()) }));

import * as firestore from '../../lib/firestore';
import useAssetList, { filterAssets, sortAssets, DEFAULT_FILTERS, LIST_PAGE, buildingFilter, floorFilter } from '../../hooks/useAssetList';

const asset = (code: string, over: Partial<Asset> = {}): Asset => ({
    id: `org-A__${code}`, organizationId: 'org-A', code, name: 'TV', category: null, spec: null, acquiredAt: null,
    acquiredQuantity: null, quantity: 1, status: 'active', statusRaw: null, locationRaw: '101호', spaceId: 'sp1',
    department: null, usage: null, missingFromSource: false, manual: false, lastImportId: null, tagId: null, ...over,
});

describe('sortAssets·filterAssets', () => {
    it('자산코드는 숫자 크기 순', () => {
        expect(sortAssets([asset('1-10'), asset('1-2'), asset('1-1')]).map((a) => a.code)).toEqual(['1-1', '1-2', '1-10']);
    });

    const list = [
        asset('1', { name: '냉 장 고' }),
        asset('2', { status: 'disposed' }),
        asset('3', { spaceId: null, locationRaw: '창고' }),
        asset('4', { missingFromSource: true, tagId: 'ABCDEFGH23' }),
    ];
    const codes = (f: Partial<typeof DEFAULT_FILTERS>) => filterAssets(list, { ...DEFAULT_FILTERS, ...f }).map((a) => a.code);

    it('기본은 운영만', () => {
        expect(codes({})).toEqual(['1', '3', '4']);
        expect(codes({ status: 'all' })).toEqual(['1', '2', '3', '4']);
    });
    it('검색은 띄어쓰기 무시, 위치 원문도 찾는다', () => {
        expect(codes({ search: '냉장' })).toEqual(['1']);
        expect(codes({ search: '창고' })).toEqual(['3']);
    });
    it('공간 미지정·특정 공간', () => {
        expect(codes({ space: 'none' })).toEqual(['3']);
        expect(codes({ space: 'sp1' })).toEqual(['1', '4']);
    });
    it('건물·층 단위로 거른다 — 건물이 없는 공간·공간 미지정은 빠진다', () => {
        const all = [
            asset('a', { spaceId: 's1' }), asset('b', { spaceId: 's2' }), asset('c', { spaceId: 's3' }), asset('d', { spaceId: null }),
        ];
        const places = new Map([
            ['s1', { buildingId: 'b1', floor: '1' }],
            ['s2', { buildingId: 'b1', floor: '2' }],
            ['s3', { buildingId: null, floor: null }],
        ]);
        const pick = (space: string) => filterAssets(all, { ...DEFAULT_FILTERS, space }, places).map((x) => x.code);
        expect(pick(buildingFilter('b1'))).toEqual(['a', 'b']);
        expect(pick(floorFilter('b1', '2'))).toEqual(['b']);
        expect(pick(buildingFilter('b9'))).toEqual([]);
    });
    it('마지막 확인으로 거른다 — 6개월·1년 넘게 못 본 것에는 한 번도 안 본 것도 든다', () => {
        const all = [asset('a'), asset('b'), asset('c'), asset('d')];
        const now = new Date(2026, 10, 22);
        const at = (y: number, m: number) => ({ checkedAt: new Date(y, m, 1) }) as never;
        const checks = new Map([
            [all[0].id, at(2026, 10)], // 이번 달
            [all[1].id, at(2026, 2)],  // 8개월 전
            [all[2].id, at(2025, 5)],  // 1년 넘게 전
        ]);
        const pick = (checked: typeof DEFAULT_FILTERS.checked) =>
            filterAssets(all, { ...DEFAULT_FILTERS, checked }, undefined, checks, now).map((x) => x.code);
        expect(pick('all')).toEqual(['a', 'b', 'c', 'd']);
        expect(pick('over6m')).toEqual(['b', 'c', 'd']);
        expect(pick('over1y')).toEqual(['c', 'd']);
        expect(pick('never')).toEqual(['d']);
    });

    it('내용연수 지난 것만 — 취득일자·내용연수가 다 있고 끝나는 날이 지난 것 (2026-11-22)', () => {
        const all = [
            asset('a', { acquiredAt: '2020-01-01', usefulLife: 5 }), // 2025-01-01 끝 → 지남
            asset('b', { acquiredAt: '2024-01-01', usefulLife: 5 }), // 2029년까지
            asset('c', { acquiredAt: '2010-01-01' }),                // 내용연수 없음
            asset('d', { usefulLife: 1 }),                            // 취득일자 없음
        ];
        const now = new Date(2026, 10, 22);
        const pick = (onlyLifeOver: boolean) =>
            filterAssets(all, { ...DEFAULT_FILTERS, onlyLifeOver }, undefined, undefined, now).map((x) => x.code);
        expect(pick(false)).toEqual(['a', 'b', 'c', 'd']);
        expect(pick(true)).toEqual(['a']);
    });

    it('대장에 없음만·라벨 발급 여부', () => {
        expect(codes({ onlyMissing: true })).toEqual(['4']);
        expect(codes({ label: 'untagged' })).toEqual(['1', '3']);
        expect(codes({ label: 'tagged' })).toEqual(['4']);
    });
});

describe('useAssetList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(firestore.getAssets).mockResolvedValue(Array.from({ length: 150 }, (_, i) => asset(String(i + 1))));
        vi.mocked(firestore.getSpaces).mockResolvedValue([]);
    });

    it('100건씩 그리고, 걸러진 결과 전부를 고를 수 있다', async () => {
        const { result } = renderHook(() => useAssetList());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.visible).toHaveLength(LIST_PAGE);
        expect(result.current.hasMore).toBe(true);

        act(() => result.current.selectFiltered());
        expect(result.current.selected.size).toBe(150);
        expect(result.current.selectedAssets[0].code).toBe('1');

        act(() => result.current.setMany(['org-A__1', 'org-A__2'], false));
        expect(result.current.selected.size).toBe(148);
    });

    it('발급한 태그를 다시 읽지 않고 목록에 반영한다', async () => {
        const { result } = renderHook(() => useAssetList());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.applyTags(new Map([['org-A__1', 'ABCDEFGH23']])));
        expect(result.current.assets[0].tagId).toBe('ABCDEFGH23');
        expect(firestore.getAssets).toHaveBeenCalledTimes(1);
    });

    it('마지막 확인 기록을 못 읽으면 목록은 보이고 실패를 알린 뒤, 기록만 다시 읽는다', async () => {
        vi.mocked(firestore.getAssetChecks).mockRejectedValueOnce(new Error('unavailable'));
        const { result } = renderHook(() => useAssetList());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe(false);
        expect(result.current.assets).toHaveLength(150);
        expect(result.current.checksError).toBe(true);

        await act(() => result.current.reloadChecks());
        expect(result.current.checksError).toBe(false);
        expect(firestore.getAssets).toHaveBeenCalledTimes(1);
    });
});
