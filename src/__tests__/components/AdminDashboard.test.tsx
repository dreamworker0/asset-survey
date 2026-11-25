/**
 * AdminDashboard — 진행 중인 재물조사 요약 배너, 스마트 온보딩/자주 쓰는 업무 전환, 오류 복구 검증
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '../../components/admin/AdminDashboard';
import {
    getAssetCounts,
    getOpenSurvey,
    getOrganization,
    getOrganizationMembers,
    getSpaces,
    getSubmissions,
} from '../../lib/firestore';

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ userData: { organizationId: 'org-1', role: 'admin' } }),
}));
vi.mock('../../components/common/ReleaseNotesBanner', () => ({
    default: () => null,
}));
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../../lib/tokenRefresh', () => ({ refreshTokenSilently: vi.fn() }));
vi.mock('../../lib/firestore', () => ({
    getOrganizationMembers: vi.fn(),
    getOrganization: vi.fn(),
    getSpaces: vi.fn(),
    getAssetCounts: vi.fn(),
    getOpenSurvey: vi.fn(),
    getSubmissions: vi.fn(),
}));

describe('AdminDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getOrganization).mockResolvedValue({ id: 'org-1', name: '희망복지관' } as never);
        vi.mocked(getOrganizationMembers).mockResolvedValue([{ id: 'u1', role: 'admin' }] as never);
    });

    it('초기 세팅 전(공간·재물 0건)이면 이렇게 시작하세요 안내를 바로 펼친다', async () => {
        vi.mocked(getSpaces).mockResolvedValue([]);
        vi.mocked(getAssetCounts).mockResolvedValue({ active: 0, inactive: 0, disposed: 0 });
        vi.mocked(getOpenSurvey).mockResolvedValue(null);

        render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

        expect(await screen.findByRole('heading', { name: '이렇게 시작하세요' })).toBeVisible();
        expect(screen.getByText('희망복지관')).toBeVisible();
        expect(screen.queryByRole('heading', { name: '자주 쓰는 업무' })).toBeNull();
    });

    it('진행 중인 조사가 있으면 최우선 요약 배너와 자주 쓰는 업무를 보여 준다', async () => {
        vi.mocked(getSpaces).mockResolvedValue([
            { id: 's1', archived: false },
            { id: 's2', archived: false },
        ] as never);
        vi.mocked(getAssetCounts).mockResolvedValue({ active: 42, inactive: 3, disposed: 1 });
        vi.mocked(getOpenSurvey).mockResolvedValue({
            id: 'sv-1',
            name: '2026년 정기 재물조사',
            startDate: '2026-11-01',
            endDate: '2026-11-30',
            spaceIds: ['s1', 's2'],
            mode: 'delegated',
            status: 'open',
            targetCount: 42,
        } as never);
        vi.mocked(getSubmissions).mockResolvedValue([
            { id: 'sv-1__s1', state: 'submitted' },
            { id: 'sv-1__s2', state: 'approved' },
        ] as never);

        render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

        expect(await screen.findByRole('heading', { name: '2026년 정기 재물조사' })).toBeVisible();
        expect(screen.getByText('승인 대기 1곳')).toBeVisible();
        expect(screen.getByText('승인 완료 1 / 2곳')).toBeVisible();
        expect(screen.getByRole('link', { name: '현황판 보기' })).toHaveAttribute('href', '/admin/surveys');
        expect(screen.getByRole('heading', { name: '자주 쓰는 업무' })).toBeVisible();
        expect(screen.getByText('초기 설정 순서 보기 (이렇게 시작하세요)')).toBeInTheDocument();
    });
});
