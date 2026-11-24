import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import AssetList from '../../components/admin/AssetList';
import { getAssets, getSpaces, moveAssetsToSpace } from '../../lib/firestore';
import type { Asset } from '../../types/asset';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ userData: { organizationId: 'org-A' } }) }));
vi.mock('../../lib/firestore', () => ({
    getAssets: vi.fn(),
    getSpaces: vi.fn(async () => []),
    getBuildings: vi.fn(async () => []),
    getAssetChecks: vi.fn(async () => new Map()),
    moveAssetsToSpace: vi.fn(),
}));
vi.mock('../../components/admin/LabelPrintDialog', () => ({
    default: ({ assets, onTags }: { assets: Asset[]; onTags: (tags: Map<string, string>) => void }) => (
        <button type="button" onClick={() => onTags(new Map(assets.map((a) => [a.id, 'TAG'])))}>
            {assets.map((a) => a.code).join(', ')} 라벨 발급
        </button>
    ),
}));

const asset = (code: string, overrides: Partial<Asset>): Asset => ({
    id: `org-A__${code}`, organizationId: 'org-A', code, name: code, category: null, spec: null, acquiredAt: null,
    acquiredQuantity: null, quantity: 1, status: 'active', statusRaw: null, locationRaw: null, spaceId: 'space-1',
    department: null, usage: null, missingFromSource: false, manual: false, lastImportId: null, tagId: null, ...overrides,
});

it('빠른 보기에서 대상만 골라 처리하고 발급 결과를 건수에 반영한다', async () => {
    vi.mocked(getAssets).mockClear();
    vi.mocked(getAssets).mockResolvedValue([
        asset('A1', { spaceId: null, tagId: 'ISSUED' }),
        asset('A2', {}),
        asset('A3', { status: 'disposed', spaceId: null }),
    ]);
    render(<MemoryRouter><AssetList /></MemoryRouter>);

    const views = within(await screen.findByRole('group', { name: '운영 재물 빠른 보기' }));
    expect(views.getByRole('button', { name: '운영 전체 2건' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(views.getByRole('button', { name: '공간 미지정 1건' }));
    expect(screen.getAllByRole('link', { name: /A1/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /A2|A3/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '걸러진 1건 모두 고르기' }));
    expect(screen.getByRole('button', { name: '공간 옮기기' })).toBeEnabled();

    fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: 'A1' } });
    fireEvent.click(views.getByRole('button', { name: '라벨 미발급 1건' }));
    expect(screen.getByRole('button', { name: '라벨 인쇄' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /A1|A3/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '걸러진 1건 모두 고르기' }));
    fireEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    fireEvent.click(screen.getByRole('button', { name: 'A2 라벨 발급' }));

    expect(views.getByRole('button', { name: '라벨 미발급 0건' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('라벨을 발급할 재물이 없습니다.')).toBeInTheDocument();
    expect(getAssets).toHaveBeenCalledTimes(1);
});

it('공간 미지정 재물을 옮기면 해당 보기에서 빠진다', async () => {
    const unplaced = asset('A1', { spaceId: null });
    vi.mocked(getAssets).mockResolvedValue([unplaced, asset('A2', {})]);
    vi.mocked(getSpaces).mockResolvedValueOnce([{
        id: 'space-1', organizationId: 'org-A', name: '상담실', order: 0,
        managerUids: [], teamIds: [], archived: false, buildingId: null, floor: null,
    }]);
    vi.mocked(moveAssetsToSpace).mockResolvedValueOnce(1);
    render(<MemoryRouter><AssetList /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '공간 미지정 1건' }));
    fireEvent.click(screen.getByRole('button', { name: '걸러진 1건 모두 고르기' }));
    fireEvent.click(screen.getByRole('button', { name: '공간 옮기기' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('옮길 공간'), { target: { value: 'space-1' } });
    fireEvent.click(dialog.getByRole('button', { name: '옮기기' }));

    expect(await screen.findByRole('button', { name: '공간 미지정 0건' })).toHaveAttribute('aria-pressed', 'true');
    expect(moveAssetsToSpace).toHaveBeenCalledWith(expect.objectContaining({ assets: [unplaced], spaceId: 'space-1' }));
    expect(screen.getByText('공간을 지정할 재물이 없습니다.')).toBeInTheDocument();
});
