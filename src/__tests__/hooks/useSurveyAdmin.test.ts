/**
 * useSurveyAdmin — 관리자 조사 회차 시작 (기획서 F10)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'admin-1' }, userData: { organizationId: 'org-A', role: 'admin' } }) }));
let pushScans: (s: unknown[]) => void = () => { };
let pushSubs: (s: unknown[]) => void = () => { };
const confirm = vi.fn();
const showToast = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../lib/firestore', async () => {
    const real = await vi.importActual<typeof import('../../lib/firestore/surveys')>('../../lib/firestore/surveys');
    return {
        getSurveys: vi.fn(), getSurveyTargets: vi.fn(), getSpaces: vi.fn(), getAssets: vi.fn(),
        getOrganization: vi.fn(), startSurvey: vi.fn(), groupTargets: real.groupTargets,
        getOrganizationMembers: vi.fn(async () => [{ id: 'emp-1', name: '김직원' }]),
        subscribeSurveyScans: vi.fn((_o: string, _s: string, cb: (x: unknown[]) => void) => { pushScans = cb; return () => { }; }),
        subscribeSubmissions: vi.fn((_o: string, _s: string, cb: (x: unknown[]) => void) => { pushSubs = cb; return () => { }; }),
        reviewSpace: vi.fn(), closeSurvey: vi.fn(), getBuildings: vi.fn(async () => []),
        beginClosing: vi.fn(), cancelClosing: vi.fn(), getScans: vi.fn(async () => []), getSubmissions: vi.fn(async () => []),
        getSurveyEvents: vi.fn(async () => []),
    };
});
vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

import * as fs from '../../lib/firestore';
import useSurveyAdmin, { defaultStartForm, validateStartForm, buildReportSnapshot } from '../../hooks/useSurveyAdmin';

const space = (id: string, archived = false) => ({ id, organizationId: 'org-A', name: id, order: 0, managerUids: [], archived });
const asset = (id: string, spaceId: string | null, status = 'active') => ({ id, code: id, name: null, tagId: null, spaceId, status });

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.getSurveys).mockResolvedValue([]);
    vi.mocked(fs.getSpaces).mockResolvedValue([space('sp-1'), space('sp-2'), space('old', true)] as never);
    vi.mocked(fs.getOrganization).mockResolvedValue({ id: 'org-A', surveyMode: 'solo' } as never);
    vi.mocked(fs.getAssets).mockResolvedValue([asset('a', 'sp-1'), asset('b', 'sp-2'), asset('c', null), asset('d', 'sp-1', 'disposed')] as never);
    vi.mocked(fs.startSurvey).mockResolvedValue('sv1');
});

describe('양식', () => {
    it('기본값 — 올해 정기 재물조사, 2주, 숨기지 않은 공간 전부, 미지정 포함', () => {
        const f = defaultStartForm([space('sp-1'), space('old', true)] as never, new Date(2026, 10, 21));
        expect(f).toEqual({ name: '2026년 정기 재물조사', startDate: '2026-11-21', endDate: '2026-12-05', spaceIds: ['sp-1'], includesUnassigned: true });
    });
    it('검사', () => {
        const ok = defaultStartForm([space('sp-1')] as never, new Date(2026, 10, 21));
        expect(validateStartForm(ok)).toBeNull();
        expect(validateStartForm({ ...ok, name: ' ' })).toMatch(/이름/);
        expect(validateStartForm({ ...ok, endDate: '2026-11-01' })).toMatch(/빠릅니다/);
        expect(validateStartForm({ ...ok, spaceIds: [], includesUnassigned: false })).toMatch(/공간/);
    });
});

describe('useSurveyAdmin', () => {
    it('대상 수를 미리 보여 주고, 확인하면 기관 조사 방식으로 시작한다', async () => {
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.openForm(); });
        expect(result.current.preview).toMatchObject({ total: 3, unassigned: 1 });

        confirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.start(); });
        expect(fs.startSurvey).toHaveBeenCalledWith(expect.objectContaining({
            orgId: 'org-A', spaceIds: ['sp-1', 'sp-2'], includesUnassigned: true, mode: 'solo',
        }));
        expect(result.current.form).toBeNull();
    });

    it('진행 중 회차가 있으면 새로 시작하지 않는다', async () => {
        vi.mocked(fs.getSurveys).mockResolvedValue([{ id: 'sv0', status: 'open', organizationId: 'org-A' }] as never);
        vi.mocked(fs.getSurveyTargets).mockResolvedValue([]);
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.openForm(); });
        await act(async () => { await result.current.start(); });
        expect(fs.startSurvey).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('이미 진행 중인 조사가 있습니다.', 'error');
    });
});

describe('현황판·승인·마감 (기획서 F13~F15)', () => {
    const OPEN = { id: 'sv1', status: 'open', organizationId: 'org-A', mode: 'delegated', spaceIds: ['sp-1', 'sp-2'], includesUnassigned: false, name: '조사', startDate: '2026-11-21', endDate: '2026-12-05' };
    const TARGETS = [
        { id: 'sv1__sp-1', spaceId: 'sp-1', items: [{ id: 'a1', code: '1', name: 'TV', tagId: null }] },
        { id: 'sv1__sp-2', spaceId: 'sp-2', items: [{ id: 'a2', code: '2', name: '책상', tagId: null }] },
    ];
    const SCAN_A1 = { id: 'sv1__a1', assetId: 'a1', code: '1', name: 'TV', spaceId: 'sp-1', expectedSpaceId: 'sp-1', result: 'ok', method: 'qr', condition: 'normal', memo: '' };
    const SCAN_A2 = { ...SCAN_A1, id: 'sv1__a2', assetId: 'a2', code: '2', name: '책상', spaceId: 'sp-2', expectedSpaceId: 'sp-2' };
    const APPROVED = [{ spaceId: 'sp-1', state: 'approved' }, { spaceId: 'sp-2', state: 'approved' }];
    beforeEach(() => {
        vi.mocked(fs.getSurveys).mockResolvedValue([OPEN] as never);
        vi.mocked(fs.getSurveyTargets).mockResolvedValue(TARGETS as never);
    });

    it('반려·대신 승인은 사유가 없으면 막고, 있으면 넘긴다', async () => {
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => pushSubs([{ spaceId: 'sp-1', state: 'submitted', submittedByUid: 'emp-1' }]));

        let ok = true;
        await act(async () => { ok = await result.current.review({ spaceId: 'sp-1', decision: 'rejected', reason: ' ' }); });
        expect(ok).toBe(false);
        expect(fs.reviewSpace).not.toHaveBeenCalled();

        await act(async () => { await result.current.review({ spaceId: 'sp-1', decision: 'approved', reason: '' }); });
        expect(fs.reviewSpace).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'sp-1', decision: 'approved', current: expect.objectContaining({ submittedByUid: 'emp-1' }) }));

        await act(async () => { await result.current.review({ spaceId: 'sp-2', decision: 'approved', reason: '' }); }); // 대신 승인인데 사유 없음
        expect(fs.reviewSpace).toHaveBeenCalledTimes(1);
    });

    it('모든 공간이 승인돼야 마감하고, 마감하면 보고서 요약·반영 목록·공간 이름을 넘긴다', async () => {
        vi.mocked(fs.getSpaces).mockResolvedValue([space('sp-1'), space('sp-2')] as never);
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => pushSubs([{ spaceId: 'sp-1', state: 'approved' }]));
        expect(result.current.blockers).toEqual(['sp-2']);
        await act(async () => { await result.current.close(); });
        expect(fs.closeSurvey).not.toHaveBeenCalled();

        act(() => {
            pushSubs([{ spaceId: 'sp-1', state: 'approved' }, { spaceId: 'sp-2', state: 'approved' }]);
            pushScans([SCAN_A1]);
        });
        expect(result.current.blockers).toEqual([]);
        expect(result.current.totals).toMatchObject({ target: 2, found: 1 });
        vi.mocked(fs.getSubmissions).mockResolvedValue([
            { spaceId: 'sp-1', state: 'approved', submittedByUid: 'emp-1', reviewedByUid: 'admin-1' },
            { spaceId: 'sp-2', state: 'approved', submittedByUid: null, reviewedByUid: 'admin-1' },
        ] as never);
        vi.mocked(fs.getScans).mockResolvedValue([SCAN_A1] as never);
        vi.mocked(fs.getOrganization).mockResolvedValue({ id: 'org-A', name: '행복복지관', approvalLine: [{ title: '담당' }, { title: '관장' }] } as never);
        vi.mocked(fs.getOrganizationMembers).mockResolvedValue([{ id: 'emp-1', name: '김직원' }, { id: 'admin-1', name: '박관리' }, { id: 'other', name: '다른사람' }] as never);
        confirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.close(); });
        // 보고서 머리를 마감 시점으로 남긴다 — 이 회차에 나온 사람만
        expect(vi.mocked(fs.closeSurvey).mock.calls[0][0].reportSnapshot).toEqual({
            orgName: '행복복지관', approvalLine: [{ title: '담당' }, { title: '관장' }],
            personNames: { 'emp-1': '김직원', 'admin-1': '박관리' },
        });
        // 먼저 멈추고, 서버에서 새로 읽은 뒤 닫는다
        expect(fs.beginClosing).toHaveBeenCalledWith('sv1');
        expect(fs.getScans).toHaveBeenCalledWith('org-A', 'sv1', { fromServer: true });
        expect(vi.mocked(fs.beginClosing).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fs.getScans).mock.invocationCallOrder[0]);
        expect(fs.closeSurvey).toHaveBeenCalledWith(expect.objectContaining({
            orgId: 'org-A', surveyId: 'sv1', spaceNames: { 'sp-1': 'sp-1', 'sp-2': 'sp-2' },
            summary: expect.objectContaining({ target: 2, found: 1, missing: 1 }),
            tasks: [expect.objectContaining({ kind: 'missing', code: '2', fromSpaceId: 'sp-2' })],
        }));
    });

    it('확인창을 연 사이 찍힌 물건도 요약·반영 목록에 들어간다(멈춘 뒤 서버 값으로 계산)', async () => {
        vi.mocked(fs.getSpaces).mockResolvedValue([space('sp-1'), space('sp-2')] as never);
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => { pushSubs(APPROVED); pushScans([SCAN_A1]); });
        // 화면은 1/2, 그 사이 다른 관리자가 책상을 찍었다
        vi.mocked(fs.getSubmissions).mockResolvedValue(APPROVED as never);
        vi.mocked(fs.getScans).mockResolvedValue([SCAN_A1, SCAN_A2] as never);
        confirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.close(); });
        expect(confirm.mock.calls[0][0].message).toContain('확인 1/2건');
        expect(fs.closeSurvey).toHaveBeenCalledWith(expect.objectContaining({
            summary: expect.objectContaining({ target: 2, found: 2, missing: 0 }),
            tasks: [],
        }));
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('확인창 뒤에 들어온 스캔까지 반영해 확인 2/2건'), 'success');
    });

    it('멈춘 뒤 보니 승인되지 않은 공간이 있으면 마감을 취소해 다시 연다', async () => {
        vi.mocked(fs.getSpaces).mockResolvedValue([space('sp-1'), space('sp-2')] as never);
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => pushSubs(APPROVED));
        vi.mocked(fs.getSubmissions).mockResolvedValue([APPROVED[0], { spaceId: 'sp-2', state: 'rejected' }] as never);
        confirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.close(); });
        expect(fs.cancelClosing).toHaveBeenCalledWith('sv1');
        expect(fs.closeSurvey).not.toHaveBeenCalled();
    });

    it('마감 중에 멈춘 회차는 다시 멈추지 않고 이어서 닫는다 — 실패하면 이어서 마감을 안내한다', async () => {
        vi.mocked(fs.getSpaces).mockResolvedValue([space('sp-1'), space('sp-2')] as never);
        vi.mocked(fs.getSurveys).mockResolvedValue([{ ...OPEN, status: 'closing' }] as never);
        vi.mocked(fs.getSubmissions).mockResolvedValue(APPROVED as never);
        vi.mocked(fs.getScans).mockResolvedValue([SCAN_A1] as never);
        const { result } = renderHook(() => useSurveyAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.open?.status).toBe('closing');

        vi.mocked(fs.closeSurvey).mockRejectedValueOnce(new Error('unavailable'));
        confirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.close(); });
        expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/이어서 마감/), 'error');

        confirm.mockResolvedValueOnce(true);
        await act(async () => { await result.current.close(); });
        expect(fs.beginClosing).not.toHaveBeenCalled();
        expect(fs.closeSurvey).toHaveBeenCalledTimes(2);
        // 두 번 모두 같은 결과 — 반영 목록이 같아 재시도가 겹치거나 막히지 않는다
        expect(vi.mocked(fs.closeSurvey).mock.calls[1][0].tasks).toEqual(vi.mocked(fs.closeSurvey).mock.calls[0][0].tasks);

        await act(async () => { await result.current.cancelClose(); });
        expect(fs.cancelClosing).toHaveBeenCalledWith('sv1');
    });
});

describe('buildReportSnapshot (2026-11-24)', () => {
    it('결재선을 숨겼으면 빈 줄, 나간 사람은 담지 않고, 이력에 나온 사람과 마감한 사람은 담는다', () => {
        const snap = buildReportSnapshot(
            { name: '기관', approvalLine: [{ title: '담당' }], hideApprovalLine: true },
            [{ id: 'a', name: '' , email: 'a@x.org' }, { id: 'b', name: '비' }, { id: 'c', name: '씨' }],
            [{ submittedByUid: 'gone', reviewedByUid: null }],
            [{ byUid: 'a' }],
            'b',
        );
        expect(snap).toEqual({ orgName: '기관', approvalLine: [], personNames: { a: 'a@x.org', b: '비' } });
    });
});
