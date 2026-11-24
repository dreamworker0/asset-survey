/**
 * useAssetImport — 가져오기 화면의 흐름 (기획서 F04~F07)
 *
 * 엑셀 읽기는 모의로 시트 줄을 돌려주고, 그 뒤(머리글 찾기·열 연결·검사·비교)는 실제 코드로 돈다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Space } from '../../types/space';

const mockShowToast = vi.fn();
const mockConfirm = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ userData: { organizationId: 'org-A' } }) }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));
vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));

const mockReadWorkbook = vi.fn();
vi.mock('../../lib/import/parseSheet', async () => {
    const actual = await vi.importActual<typeof import('../../lib/import/parseSheet')>('../../lib/import/parseSheet');
    return { ...actual, readWorkbook: (...a: unknown[]) => mockReadWorkbook(...a) };
});

vi.mock('../../lib/firestore', async () => {
    const spaces = await vi.importActual<typeof import('../../lib/firestore/spaces')>('../../lib/firestore/spaces');
    return {
        getOrganization: vi.fn(), getSpaces: vi.fn(), createSpace: vi.fn(), getAssets: vi.fn(),
        getAccountingMap: vi.fn(), commitImport: vi.fn(), getBuildings: vi.fn(async () => []),
        newImportId: vi.fn(() => 'imp-first'), importRecordExists: vi.fn(async () => false),
        validateSpaceName: spaces.validateSpaceName, normalizeSpaceName: spaces.normalizeSpaceName,
    };
});

import * as firestore from '../../lib/firestore';
import useAssetImport, { suggestLocationMap, reportedTotalOf } from '../../hooks/useAssetImport';

const space = (over: Partial<Space>): Space => ({
    id: 's1', organizationId: 'org-A', name: '공간', order: 0, managerUids: [], teamIds: [], archived: false, buildingId: null, floor: null, ...over,
});

const ROWS = [
    ['고정자산대장'],
    ['자산코드', '자산명', '자산금액', '자산위치'],
    ['1-1-1', 'TV', 450000, '101호'],
    ['1-5-1', '냉장고', 1200000, '창고'],
    ['', '합계', 1650000, ''],
];
const fakeFile = (size = 1000) => ({ name: '대장.xlsx', size, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;

beforeEach(() => {
    vi.clearAllMocks();
    mockReadWorkbook.mockResolvedValue([{ name: '시트1', rows: ROWS }]);
    vi.mocked(firestore.getOrganization).mockResolvedValue({ id: 'org-A', name: '기관', locationSpaceMap: { 창고: 'sp-store' } } as never);
    vi.mocked(firestore.getSpaces).mockResolvedValue([
        space({ id: 'sp-101', name: '101호' }), space({ id: 'sp-store', name: '물품창고', order: 1 }),
    ]);
    vi.mocked(firestore.getAssets).mockResolvedValue([]);
    vi.mocked(firestore.getAccountingMap).mockResolvedValue(new Map());
    vi.mocked(firestore.commitImport).mockResolvedValue('imp-1');
});

describe('도우미', () => {
    it('reportedTotalOf는 합계 줄 중 가장 큰 금액(총합계)을 쓴다', () => {
        expect(reportedTotalOf([{ amount: 100 }, { amount: 300 }, { amount: null }])).toBe(300);
        expect(reportedTotalOf([])).toBeNull();
    });

    it('suggestLocationMap: 지난번 연결 → 같은 이름 공간 → 미지정, 숨긴 공간은 제외', () => {
        const spaces = [space({ id: 'a', name: '101호' }), space({ id: 'b', name: '창고', archived: true })];
        expect(suggestLocationMap(['101호', '창고', '복도'], spaces, { 복도: 'a', 창고: 'b' })).toEqual({ '101호': 'a', 복도: 'a' });
    });
});

describe('useAssetImport', () => {
    it('파일을 고르면 머리글을 찾고 열을 맞춰 검사 결과를 낸다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });

        expect(result.current.step).toBe('map');
        expect(result.current.table?.headerRowIndex).toBe(1);
        expect(result.current.columnMap).toMatchObject({ code: '자산코드', name: '자산명', amount: '자산금액', location: '자산위치' });
        expect(result.current.parsed?.counts.total).toBe(2);
        expect(result.current.reportedTotal).toBe(1650000);
        expect(result.current.blockers).toEqual([]);
    });

    it('20MB가 넘는 파일은 읽지 않고 안내한다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile(25 * 1024 * 1024)); });
        expect(result.current.step).toBe('pick');
        expect(result.current.error).toMatch(/너무 큽니다/);
        expect(mockReadWorkbook).not.toHaveBeenCalled();
    });

    it('품명 열을 빼면 다음으로 넘어가지 못한다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        act(() => result.current.setColumn('name', ''));
        expect(result.current.blockers).toEqual(['품명 열을 골라 주세요.']);
    });

    it('한 머리글을 다른 필드에 고르면 원래 필드에서 빠진다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        act(() => result.current.setColumn('usage', '자산위치'));
        expect(result.current.columnMap.usage).toBe('자산위치');
        expect(result.current.columnMap.location).toBeUndefined();
    });

    it('비교 단계: 위치를 공간에 미리 연결하고, 확정하면 저장을 부른다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(true); // 자주 쓰는 열을 빠뜨렸다는 물음에 "그대로 진행"
        await act(async () => { await result.current.goCompare(); });

        expect(result.current.step).toBe('compare');
        expect(result.current.locationMap).toEqual({ '101호': 'sp-101', 창고: 'sp-store' });
        expect(result.current.diff?.added).toHaveLength(2);

        mockConfirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.confirmImport(); });
        expect(firestore.commitImport).toHaveBeenCalledWith(expect.objectContaining({
            orgId: 'org-A', fileName: '대장.xlsx', sheetName: '시트1', reportedTotal: 1650000,
            locationMap: { '101호': 'sp-101', 창고: 'sp-store' },
        }));
        expect(result.current.step).toBe('done');
        expect(result.current.importId).toBe('imp-1');
        // 완료 화면은 비교 결과가 아니라 남겨 둔 요약으로 그린다(완료 단계에서는 비교를 다시 계산하지 않는다)
        expect(result.current.diff).toBeNull();
        expect(result.current.result).toEqual({ added: 2, changed: 0, missing: 0, unchanged: 0 });
    });

    it('확정을 취소하면 저장하지 않고, 저장이 실패하면 비교 단계로 돌아와 다시 하라고 안내한다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(true); // 자주 쓰는 열을 빠뜨렸다는 물음에 "그대로 진행"
        await act(async () => { await result.current.goCompare(); });

        mockConfirm.mockResolvedValueOnce(false);
        await act(async () => { await result.current.confirmImport(); });
        expect(firestore.commitImport).not.toHaveBeenCalled();

        mockConfirm.mockResolvedValueOnce(true);
        vi.mocked(firestore.commitImport).mockRejectedValueOnce(new Error('denied'));
        await act(async () => { await result.current.confirmImport(); });
        expect(result.current.step).toBe('compare');
        expect(result.current.error).toMatch(/다시 확정하면/);
    });

    it('멈춘 가져오기를 다시 확정하면 처음 기록 ID·건수로 이어서 저장한다(2026-11-24)', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.goCompare(); });

        // 처음: 2건 새로 등록하다 멈춤
        mockConfirm.mockResolvedValueOnce(true);
        vi.mocked(firestore.commitImport).mockRejectedValueOnce(new Error('unavailable'));
        // 멈추기 전에 1-1-1은 저장됐다 — 다시 읽으면 앱에 있다
        vi.mocked(firestore.getAssets).mockResolvedValueOnce([{
            id: 'org-A__1-1-1', organizationId: 'org-A', code: '1-1-1', name: 'TV', category: null, spec: null, acquiredAt: null,
            acquiredQuantity: null, quantity: null, usefulLife: null, status: 'active', statusRaw: null, locationRaw: '101호', spaceId: 'sp-101',
            department: null, usage: null, missingFromSource: false, manual: false, lastImportId: 'imp-first', tagId: null,
        }] as never);
        vi.mocked(firestore.getAccountingMap).mockResolvedValueOnce(new Map([['org-A__1-1-1', {
            id: 'org-A__1-1-1', organizationId: 'org-A', amount: 450000, depreciation: null, residual: null,
        }]]) as never);
        await act(async () => { await result.current.confirmImport(); });
        expect(result.current.diff?.added).toHaveLength(1);
        expect(result.current.diff?.unchanged).toBe(1);

        // 다시 확정 — 이어서 저장한다고 알리고, 같은 기록 ID·처음 건수(2건)를 넘긴다
        mockConfirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.confirmImport(); });
        expect(mockConfirm.mock.calls[mockConfirm.mock.calls.length - 1][0]).toMatchObject({ title: '가져오기 이어서 저장' });
        expect(firestore.newImportId).toHaveBeenCalledTimes(1);
        expect(vi.mocked(firestore.commitImport).mock.calls.map((c) => c[0].importId)).toEqual(['imp-first', 'imp-first']);
        expect(vi.mocked(firestore.commitImport).mock.calls[1][0].recordDiff).toEqual({ added: 2, changed: 0, missing: 0, unchanged: 0 });
        expect(result.current.step).toBe('done');
        expect(result.current.result).toEqual({ added: 2, changed: 0, missing: 0, unchanged: 0 });
    });

    it('남은 것이 없고 기록이 이미 있으면(응답만 못 받음) 다시 쓰지 않고 끝낸다', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.goCompare(); });

        mockConfirm.mockResolvedValueOnce(true);
        vi.mocked(firestore.commitImport).mockRejectedValueOnce(new Error('deadline-exceeded'));
        const saved = (code: string, name: string, amount: number) => ({
            asset: { id: `org-A__${code}`, organizationId: 'org-A', code, name, category: null, spec: null, acquiredAt: null,
                acquiredQuantity: null, quantity: null, usefulLife: null, status: 'active', statusRaw: null, locationRaw: null, spaceId: null,
                department: null, usage: null, missingFromSource: false, manual: false, lastImportId: 'imp-first', tagId: null },
            acc: [`org-A__${code}`, { id: `org-A__${code}`, organizationId: 'org-A', amount, depreciation: null, residual: null }] as const,
        });
        const a = saved('1-1-1', 'TV', 450000);
        const b = saved('1-5-1', '냉장고', 1200000);
        a.asset.locationRaw = '101호' as never; a.asset.spaceId = 'sp-101' as never;
        b.asset.locationRaw = '창고' as never; b.asset.spaceId = 'sp-store' as never;
        vi.mocked(firestore.getAssets).mockResolvedValueOnce([a.asset, b.asset] as never);
        vi.mocked(firestore.getAccountingMap).mockResolvedValueOnce(new Map([a.acc, b.acc]) as never);
        await act(async () => { await result.current.confirmImport(); });
        expect(result.current.diff?.unchanged).toBe(2);

        vi.mocked(firestore.importRecordExists).mockResolvedValueOnce(true);
        mockConfirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.confirmImport(); });
        expect(firestore.importRecordExists).toHaveBeenCalledWith('imp-first');
        expect(firestore.commitImport).toHaveBeenCalledTimes(1);
        expect(result.current.step).toBe('done');
        expect(result.current.importId).toBe('imp-first');
    });

    it('위치 이름으로 공간을 만들어 바로 연결한다', async () => {
        vi.mocked(firestore.getOrganization).mockResolvedValue({ id: 'org-A', name: '기관' } as never);
        vi.mocked(firestore.createSpace).mockResolvedValue('sp-new');
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(true); // 자주 쓰는 열을 빠뜨렸다는 물음에 "그대로 진행"
        await act(async () => { await result.current.goCompare(); });
        expect(result.current.locationMap['창고']).toBeUndefined();

        await act(async () => { await result.current.createSpaceFor('창고', '창고'); });
        expect(firestore.createSpace).toHaveBeenCalledWith('org-A', '창고', 2, { buildingId: null, floor: null });
        expect(result.current.locationMap['창고']).toBe('sp-new');
    });

    it('위치 앞의 건물·층 이름은 떼어 내 건물·층을 채워 공간을 만든다', async () => {
        vi.mocked(firestore.getOrganization).mockResolvedValue({ id: 'org-A', name: '기관' } as never);
        vi.mocked(firestore.getBuildings).mockResolvedValueOnce([
            { id: 'b1', organizationId: 'org-A', name: '본관', address: '', floors: ['1', '2'], order: 0, archived: false },
        ] as never);
        vi.mocked(firestore.createSpace).mockResolvedValue('sp-new');
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(true); // 자주 쓰는 열을 빠뜨렸다는 물음에 "그대로 진행"
        await act(async () => { await result.current.goCompare(); });

        await act(async () => { await result.current.createSpaceFor('본관 2층 창고', '본관 2층 창고'); });
        expect(firestore.createSpace).toHaveBeenCalledWith('org-A', '창고', 2, { buildingId: 'b1', floor: '2' });
        expect(result.current.locationMap['본관 2층 창고']).toBe('sp-new');
    });

    it('자주 쓰는 열(분류·수량 등)을 빠뜨렸으면 비교 단계로 가기 전에 묻고, [돌아가서 연결]이면 머문다(2026-11-23)', async () => {
        const { result } = renderHook(() => useAssetImport());
        await act(async () => { await result.current.pickFile(fakeFile()); });
        mockConfirm.mockResolvedValueOnce(false);
        await act(async () => { await result.current.goCompare(); });
        expect(mockConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: '자주 쓰는 열을 연결하지 않았습니다', cancelText: '돌아가서 연결' }));
        expect(result.current.step).toBe('map');
    });

});
