/**
 * useSurveyReport — 마감 시점 보고서 머리(기관명·결재선·사람 이름) (2026-11-24)
 *
 * 고정하는 계약:
 *   - 마감 때 남긴 reportSnapshot이 있으면 지금 기관명·결재선·이름보다 먼저 쓴다
 *   - 남긴 적 없는 사람(마감 뒤 반영 체크 등)은 지금 이름을 쓴다
 *   - 이름을 읽은 뒤에야 로딩이 끝난다(열자마자 출력해도 '알 수 없음'이 찍히지 않게)
 *   - 예전에 마감한 회차(남긴 값 없음)는 지금 값을 쓴다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ userData: { organizationId: 'org-A' } }) }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../lib/pdf/surveyReportPdf', () => ({ printSurveyReport: vi.fn() }));
vi.mock('../../lib/excelExport', () => ({ downloadSurveyReportExcel: vi.fn() }));
vi.mock('../../lib/firestore', () => ({
    getSurvey: vi.fn(), getSurveyTargets: vi.fn(async () => []), getScans: vi.fn(async () => []),
    getSubmissions: vi.fn(async () => []), getSpaces: vi.fn(async () => []), getOrganization: vi.fn(),
    getOrganizationMembers: vi.fn(), getSyncTasks: vi.fn(async () => []), setSyncTaskDone: vi.fn(),
    getSurveyEvents: vi.fn(async () => []), getBuildings: vi.fn(async () => []),
}));
vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

import * as fs from '../../lib/firestore';
import { printSurveyReport } from '../../lib/pdf/surveyReportPdf';
import useSurveyReport from '../../hooks/useSurveyReport';

const SURVEY = {
    id: 'sv1', organizationId: 'org-A', name: '조사', startDate: '2026-11-01', endDate: '2026-11-14',
    spaceIds: [], includesUnassigned: false, mode: 'delegated', status: 'closed', targetCount: 0, spaceNames: {},
};

beforeEach(() => {
    vi.clearAllMocks();
    // 지금은 기관 이름·결재선이 바뀌었고, 김직원은 이름을 바꿨다
    vi.mocked(fs.getOrganization).mockResolvedValue({ id: 'org-A', name: '새 이름 복지관', approvalLine: [{ title: '팀장' }] } as never);
    vi.mocked(fs.getOrganizationMembers).mockResolvedValue([{ id: 'emp-1', name: '김직원(개명)' }, { id: 'admin-2', name: '새관리' }] as never);
});

describe('useSurveyReport', () => {
    it('마감 때 남긴 기관명·결재선·이름을 먼저 쓰고, 남긴 적 없는 사람은 지금 이름을 쓴다', async () => {
        vi.mocked(fs.getSurvey).mockResolvedValue({
            ...SURVEY,
            reportSnapshot: { orgName: '행복복지관', approvalLine: [{ title: '담당' }, { title: '관장' }], personNames: { 'emp-1': '김직원', 'gone': '나간사람' } },
        } as never);
        const { result } = renderHook(() => useSurveyReport('sv1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.ctx!.personName('emp-1')).toBe('김직원');
        expect(result.current.ctx!.personName('gone')).toBe('나간사람');
        expect(result.current.ctx!.personName('admin-2')).toBe('새관리');
        result.current.printPdf();
        expect(printSurveyReport).toHaveBeenCalledWith(expect.anything(), '행복복지관', [{ title: '담당' }, { title: '관장' }], expect.any(Function));
    });

    it('남긴 값이 없는 예전 회차는 지금 값 — 이름은 로딩이 끝날 때 이미 들어 있다', async () => {
        vi.mocked(fs.getSurvey).mockResolvedValue(SURVEY as never);
        const { result } = renderHook(() => useSurveyReport('sv1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.ctx!.personName('emp-1')).toBe('김직원(개명)');
        result.current.printPdf();
        expect(printSurveyReport).toHaveBeenCalledWith(expect.anything(), '새 이름 복지관', [{ title: '팀장' }], expect.any(Function));
    });

    it('이름을 못 읽어도 보고서는 연다', async () => {
        vi.mocked(fs.getSurvey).mockResolvedValue(SURVEY as never);
        vi.mocked(fs.getOrganizationMembers).mockRejectedValue(new Error('denied'));
        const { result } = renderHook(() => useSurveyReport('sv1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe(false);
        expect(result.current.ctx!.personName('emp-1')).toBe('알 수 없음');
    });
});
