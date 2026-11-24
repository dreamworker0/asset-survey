/**
 * useSurveyReport — 재물조사 결과 보고서·희망이음 반영 목록·조사 이력 (기획서 F15~F17)
 *
 * 마감한 회차의 대상·스캔은 더 바뀌지 않아(Rules) 언제 열어도 마감 시점 그대로 계산된다.
 * 공간 이름은 마감 때 회차에 남긴 것(spaceNames)을 쓴다. 진행 중 회차는 '중간 보고서'로 본다.
 * 기관명·결재선·사람 이름도 마감 때 남긴 것(reportSnapshot, 2026-11-24)을 먼저 쓴다 — 나중에 결재선을 바꾸거나
 * 직원이 나가도 다시 출력한 보고서가 같다. 그 전에 마감한 회차와 진행 중 회차는 지금 값을 쓴다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import {
    getSurvey, getSurveyTargets, getScans, getSubmissions, getSpaces, getOrganization, getOrganizationMembers,
    getSyncTasks, setSyncTaskDone, getSurveyEvents, getBuildings,
} from '../lib/firestore';
import { buildReport, type SurveyReport } from '../lib/survey/report';
import { spaceNamesFor, spaceLocationsFor, reportOrderFor } from './useSurveyAdmin';
import { printSurveyReport } from '../lib/pdf/surveyReportPdf';
import { downloadSurveyReportExcel } from '../lib/excelExport';
import { NO_SPACE_KEY } from '../schemas';
import type { ReportContext } from '../lib/survey/reportTables';
import type { Survey, SyncTask, SurveyEvent } from '../types/survey';

export default function useSurveyReport(surveyId: string | undefined) {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const orgId = userData?.organizationId ?? null;
    const [survey, setSurvey] = useState<Survey | null>(null);
    const [report, setReport] = useState<SurveyReport | null>(null);
    const [spaceNames, setSpaceNames] = useState<Record<string, string>>({});
    const [spaceLocations, setSpaceLocations] = useState<Record<string, string>>({});
    const [names, setNames] = useState<Map<string, string>>(new Map());
    const [org, setOrg] = useState<{ name: string; approvalLine: Array<{ title: string }> }>({ name: '', approvalLine: [] });
    const [tasks, setTasks] = useState<SyncTask[]>([]);
    const [events, setEvents] = useState<SurveyEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [notFound, setNotFound] = useState(false);

    const load = useCallback(async () => {
        if (!orgId || !surveyId) return;
        setLoading(true);
        setError(false);
        try {
            const s = await getSurvey(surveyId);
            if (!s || s.organizationId !== orgId) { setNotFound(true); return; }
            setSurvey(s);
            // 이름도 함께 기다린다 — 따로 읽으면 화면이 뜬 직후 출력한 보고서에 '알 수 없음'이 찍혔다.
            // 못 읽어도 보고서는 연다(마감 때 남긴 이름이 있으면 그것으로 충분하다)
            const [targets, scans, subs, spaces, o, ev, buildings, members] = await Promise.all([
                getSurveyTargets(orgId, s.id), getScans(orgId, s.id), getSubmissions(orgId, s.id), getSpaces(orgId),
                getOrganization(orgId), getSurveyEvents(orgId, s.id), getBuildings(orgId),
                getOrganizationMembers(orgId).catch(() => []),
            ]);
            const sn = s.spaceNames ?? spaceNamesFor(s, spaces);
            setSpaceNames(sn);
            // 마감 회차는 마감 시점 위치, 진행 중이거나 건물 도입 전에 마감한 회차는 지금 위치
            setSpaceLocations(s.spaceLocations ?? (s.status === 'closed' ? {} : spaceLocationsFor(s, spaces, buildings)));
            setReport(buildReport(targets, scans, subs, reportOrderFor(s)));
            const snap = s.reportSnapshot;
            setOrg(snap
                ? { name: snap.orgName, approvalLine: snap.approvalLine }
                : { name: o?.name ?? '', approvalLine: o?.hideApprovalLine ? [] : (o?.approvalLine ?? []) });
            // 마감 때 남긴 이름이 지금 이름보다 먼저(마감 뒤 반영 완료 체크 등 남긴 적 없는 사람은 지금 이름)
            setNames(new Map([
                ...members.map((u) => [u.id, u.name || u.email || '(이름 없음)'] as [string, string]),
                ...Object.entries(snap?.personNames ?? {}),
            ]));
            setEvents(ev);
            setTasks(s.status === 'closed' ? await getSyncTasks(orgId, s.id) : []);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [orgId, surveyId]);

    useEffect(() => { void load(); }, [load]);

    const ctx = useMemo<ReportContext | null>(() => (survey && report ? {
        survey, report,
        spaceName: (key) => (key === null || key === NO_SPACE_KEY ? '공간 미지정' : spaceNames[key] ?? '(대상 밖 공간)'),
        spaceLocation: (key) => (key === null || key === NO_SPACE_KEY ? '' : spaceLocations[key] ?? ''),
        personName: (uid) => (uid ? names.get(uid) ?? '알 수 없음' : '-'),
    } : null), [survey, report, spaceNames, spaceLocations, names]);

    const fileBase = survey ? `재물조사_${survey.name}_${survey.endDate}`.replace(/[\\/:*?"<>|]/g, '_') : '재물조사';

    const printPdf = useCallback(() => {
        if (!ctx) return;
        printSurveyReport(ctx, org.name, org.approvalLine, (msg) => showToast(msg, 'error'));
    }, [ctx, org, showToast]);

    const downloadExcel = useCallback(async () => {
        if (!ctx) return;
        try {
            await downloadSurveyReportExcel(ctx, org.name, fileBase);
        } catch {
            showToast('엑셀 파일을 만들지 못했습니다.', 'error');
        }
    }, [ctx, org.name, fileBase, showToast]);

    const toggleTask = useCallback(async (task: SyncTask) => {
        const next = !task.done;
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)));
        try {
            await setSyncTaskDone(task, next);
        } catch {
            setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)));
            showToast('저장하지 못했습니다. 다시 시도해 주세요.', 'error');
        }
    }, [showToast]);

    return { survey, report, ctx, tasks, events, names, loading, error, notFound, reload: load, printPdf, downloadExcel, toggleTask };
}
