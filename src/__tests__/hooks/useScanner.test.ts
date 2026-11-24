/**
 * useScanner — 현장 스캔 흐름 (기획서 F11·F12)
 *
 * 고정하는 계약:
 *   - 직원은 '나눠서 조사' 회차에서 자기 담당 공간만, 관리자는 모든 대상 공간을 찍는다
 *   - 대상 목록에 없으면 서버에서 재물을 찾아 범위 밖/미등록을 가린다(시작 뒤 뽑은 라벨은 대상으로 다시 맞춤)
 *   - 이미 찍은 재물(이 공간 목록 또는 서버)은 저장하지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Survey, SurveyTarget } from '../../types/survey';

let role = 'employee';
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'emp1' }, userData: { organizationId: 'org-A', role } }) }));
const showToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast }) }));
const confirm = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
let pushSubmission: (s: unknown) => void = () => { };
let pushStatus: (s: unknown) => void = () => { };
vi.mock('../../lib/firestore', () => ({
    getOpenSurvey: vi.fn(), getSurveyTargets: vi.fn(), getSpaces: vi.fn(), findAssetByTag: vi.fn(), findAssetByCode: vi.fn(),
    peekScan: vi.fn(), saveScan: vi.fn(), updateScanCondition: vi.fn(), deleteScan: vi.fn(),
    subscribeSpaceScans: vi.fn(() => () => { }),
    subscribeSurveyStatus: vi.fn((_id: string, cb: (s: unknown) => void) => { pushStatus = cb; return () => { }; }),
    subscribeSubmission: vi.fn((_s: string, _p: string, cb: (s: unknown) => void) => { pushSubmission = cb; return () => { }; }),
    submitSpace: vi.fn(),
}));

import * as fs from '../../lib/firestore';
import useScanner from '../../hooks/useScanner';

const SURVEY = { id: 'sv1', organizationId: 'org-A', name: '조사', startDate: '2026-11-21', endDate: '2026-12-05', spaceIds: ['sp-1', 'sp-2'], includesUnassigned: false, mode: 'delegated', status: 'open', targetCount: 2, lastEditedByUid: 'a' } as Survey;
const TARGETS = [
    { id: 'sv1__sp-1', organizationId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', lastEditedByUid: 'a', items: [{ id: 'org-A__1', code: '1', name: 'TV', tagId: null }] },
    { id: 'sv1__sp-2', organizationId: 'org-A', surveyId: 'sv1', spaceId: 'sp-2', lastEditedByUid: 'a', items: [{ id: 'org-A__2', code: '2', name: '책상', tagId: 'AAAAAAAAA2' }] },
] as SurveyTarget[];
const space = (id: string, managers: string[]) => ({ id, organizationId: 'org-A', name: id, order: 0, managerUids: managers, archived: false });

async function ready(initial: string | null = 'sp-1') {
    const h = renderHook(() => useScanner(initial));
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    return h;
}
async function scan(h: Awaited<ReturnType<typeof ready>>, text: string, method: 'qr' | 'manual' = 'qr') {
    await act(async () => { h.result.current.handle(text, method); });
    await waitFor(() => expect(h.result.current.checking).toBe(false));
}

beforeEach(() => {
    vi.clearAllMocks();
    role = 'employee';
    vi.mocked(fs.getOpenSurvey).mockResolvedValue(SURVEY);
    vi.mocked(fs.getSurveyTargets).mockResolvedValue(TARGETS);
    vi.mocked(fs.getSpaces).mockResolvedValue([space('sp-1', ['emp1']), space('sp-2', ['emp2']), space('sp-3', ['emp1'])] as never);
    vi.mocked(fs.peekScan).mockResolvedValue(null);
    vi.mocked(fs.findAssetByTag).mockResolvedValue(null);
    vi.mocked(fs.findAssetByCode).mockResolvedValue(null);
});

describe('찍을 수 있는 공간', () => {
    it('직원은 회차 대상이면서 자기가 담당하는 공간만', async () => {
        const h = await ready();
        expect(h.result.current.mySpaces.map((s) => s.id)).toEqual(['sp-1']);
        expect(h.result.current.spaceId).toBe('sp-1');
    });
    it('남의 공간을 주소로 열면 내 공간으로 바꾼다', async () => {
        const h = await ready('sp-2');
        expect(h.result.current.spaceId).toBe('sp-1');
    });
    it('관리자는 모든 대상 공간, 혼자 조사 회차는 직원에게 공간이 없다', async () => {
        role = 'admin';
        expect((await ready()).result.current.mySpaces.map((s) => s.id)).toEqual(['sp-1', 'sp-2']);
        role = 'employee';
        vi.mocked(fs.getOpenSurvey).mockResolvedValue({ ...SURVEY, mode: 'solo' });
        expect((await ready()).result.current.mySpaces).toEqual([]);
    });
});

describe('찍기', () => {
    it('대상이면 바로 판정해 저장한다(정상)', async () => {
        const h = await ready();
        await scan(h, '1', 'manual');
        expect(fs.saveScan).toHaveBeenCalledWith(expect.objectContaining({
            orgId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', method: 'manual',
            draft: expect.objectContaining({ scanId: 'sv1__org-A__1', result: 'ok' }),
        }));
        expect(fs.findAssetByCode).not.toHaveBeenCalled();
        expect(h.result.current.last).toMatchObject({ kind: 'saved', method: 'manual' });
    });

    it('다른 공간 대상의 태그 → 다른 공간', async () => {
        const h = await ready();
        await scan(h, 'https://app.example/t/AAAAAAAAA2');
        expect(vi.mocked(fs.saveScan).mock.calls[0][0].draft).toMatchObject({ result: 'otherSpace', expectedSpaceId: 'sp-2' });
    });

    it('시작 뒤에 뽑은 라벨은 서버에서 찾아 대상으로 다시 맞춘다', async () => {
        vi.mocked(fs.findAssetByTag).mockResolvedValue({ id: 'org-A__1', code: '1', name: 'TV', status: 'active' } as never);
        const h = await ready();
        await scan(h, 'https://app.example/t/BBBBBBBBB1');
        expect(vi.mocked(fs.saveScan).mock.calls[0][0].draft).toMatchObject({ assetId: 'org-A__1', result: 'ok' });
    });

    it('대상이 아닌 기관 재물 → 범위 밖, 없는 코드 → 미등록', async () => {
        vi.mocked(fs.findAssetByCode).mockResolvedValueOnce({ id: 'org-A__9', code: '9', name: '폐기 TV', status: 'disposed' } as never);
        const h = await ready();
        await scan(h, '9', 'manual');
        await scan(h, 'zzz', 'manual');
        expect(vi.mocked(fs.saveScan).mock.calls.map((c) => c[0].draft.result)).toEqual(['outOfScope', 'unregistered']);
    });

    it('서버에 이미 있으면(다른 공간에서 찍힘) 저장하지 않고 중복으로 알린다', async () => {
        vi.mocked(fs.peekScan).mockResolvedValue({ spaceId: 'sp-2', result: 'otherSpace' } as never);
        const h = await ready();
        await scan(h, '1', 'manual');
        expect(fs.saveScan).not.toHaveBeenCalled();
        expect(h.result.current.last).toMatchObject({ kind: 'duplicate', judgement: { existing: { spaceId: 'sp-2' } } });
    });

    it('오프라인이라 서버 확인을 못 하면 그대로 저장한다(나중에 서버가 거절하면 알림)', async () => {
        vi.mocked(fs.findAssetByCode).mockRejectedValue(new Error('offline'));
        vi.mocked(fs.peekScan).mockResolvedValue(undefined);
        const h = await ready();
        await scan(h, '1', 'manual');
        expect(vi.mocked(fs.saveScan).mock.calls[0][0].draft.result).toBe('ok');
        vi.mocked(fs.saveScan).mock.calls[0][0].onRejected?.(new Error('denied'));
        expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/저장되지 않았습니다/), 'error');
    });

    it('대상 목록에 없는 코드를 대장에서 찾다 실패하면 미등록으로 남기지 않고 다시 찍게 한다', async () => {
        vi.mocked(fs.findAssetByCode).mockRejectedValue(new Error('offline'));
        const h = await ready();
        await scan(h, 'zzz', 'manual');
        expect(fs.saveScan).not.toHaveBeenCalled();
        expect(h.result.current.last).toMatchObject({ kind: 'lookupFailed', code: 'zzz' });

        // 연결이 돌아오면 같은 코드를 다시 찍어 정상 판정된다
        vi.mocked(fs.findAssetByCode).mockResolvedValue(null);
        vi.mocked(fs.peekScan).mockResolvedValue(undefined);
        await scan(h, 'zzz', 'manual');
        expect(vi.mocked(fs.saveScan).mock.calls[0][0].draft.result).toBe('unregistered');
    });
});

describe('공간 제출 (기획서 F13)', () => {
    it('확인하면 제출하고, 제출·승인된 공간은 스캔을 받지 않으며 반려되면 다시 받는다', async () => {
        const h = await ready();
        confirm.mockResolvedValueOnce(true);
        await act(async () => { await h.result.current.submit(1); });
        expect(fs.submitSpace).toHaveBeenCalledWith('org-A', 'sv1', 'sp-1');
        expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/1건/) }));

        act(() => pushSubmission({ state: 'submitted', spaceId: 'sp-1' }));
        expect(h.result.current.locked).toBe(true);
        await scan(h, '1', 'manual');
        expect(fs.saveScan).not.toHaveBeenCalled();

        act(() => pushSubmission({ state: 'rejected', reason: '다시 확인', spaceId: 'sp-1' }));
        expect(h.result.current.locked).toBe(false);
        await scan(h, '1', 'manual');
        expect(fs.saveScan).toHaveBeenCalled();
    });

    it('취소하면 제출하지 않는다', async () => {
        const h = await ready();
        confirm.mockResolvedValueOnce(false);
        await act(async () => { await h.result.current.submit(0); });
        expect(fs.submitSpace).not.toHaveBeenCalled();
    });
});

// 재물 담당자가 마감을 시작하면(closing) Rules가 스캔·제출을 거부한다 — 열어 둔 직원 화면도 바로 잠가야 한다
describe('마감 중 잠금', () => {
    it('회차가 closing으로 바뀌면 paused가 되고 찍어도 저장하지 않는다', async () => {
        const h = await ready();
        expect(h.result.current.paused).toBe(false);

        act(() => pushStatus('closing'));
        expect(h.result.current.paused).toBe(true);

        await act(async () => { h.result.current.handle('1', 'manual'); });
        expect(fs.saveScan).not.toHaveBeenCalled();
    });

    it('마감이 취소되면(open) 다시 찍을 수 있다', async () => {
        const h = await ready();
        act(() => pushStatus('closing'));
        act(() => pushStatus('open'));
        expect(h.result.current.paused).toBe(false);
    });

    it('처음부터 마감 중인 회차로 열면 잠겨 있다', async () => {
        vi.mocked(fs.getOpenSurvey).mockResolvedValue({ ...SURVEY, status: 'closing' });
        const h = await ready();
        expect(h.result.current.paused).toBe(true);
    });

    it('마감 중에는 제출하지 않는다', async () => {
        const h = await ready();
        act(() => pushStatus('closing'));
        await act(async () => { await h.result.current.submit(0); });
        expect(confirm).not.toHaveBeenCalled();
        expect(fs.submitSpace).not.toHaveBeenCalled();
    });
});
