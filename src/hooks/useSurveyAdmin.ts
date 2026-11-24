/**
 * useSurveyAdmin — 관리자 재물조사 (기획서 F10·F13·F14·F15)
 *
 * - 새 회차 시작(이름·기간·대상 공간 → 대상 고정)
 * - 진행 중 회차의 현황판: 스캔·제출 상태를 실시간으로 받아 화면에서 계산한다(사용자 결정 2026-11-21 —
 *   현황판을 연 동안만 스캔 수만큼 읽는다. 기관이 늘면 서버 집계로 바꾼다).
 * - 공간 제출 승인·반려, 제출 없는 공간 대신 승인(사유 필수)
 * - 마감: '나눠서 조사'는 대상 공간이 모두 승인돼야 한다(사용자 결정 2026-11-21). 마감하면 희망이음 반영
 *   목록을 만들고 공간 이름·요약을 회차에 남긴다.
 * - 건물·층(2026-11-22): 대상 공간은 건물 → 층 → 공간 순서로 담고(보고서도 이 순서), 마감 때 위치도 남긴다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import { useConfirm } from './useConfirm';
import { useToast } from './useToast';
import {
    getSurveys, getSurveyTargets, getSpaces, getAssets, getOrganization, startSurvey, groupTargets,
    subscribeSurveyScans, subscribeSubmissions, reviewSpace, closeSurvey, getOrganizationMembers, getBuildings,
    beginClosing, cancelClosing, getScans, getSubmissions, getSurveyEvents,
} from '../lib/firestore';
import { orderSpacesByLocation, spaceLocationMap } from '../lib/spaceGroups';
import { progressBySpace, type SpaceProgress } from '../lib/survey/judge';
import { buildReport, buildSyncTasks, closeBlockers } from '../lib/survey/report';
import { DEFAULT_SURVEY_MODE, SURVEY_NAME_MAX, NO_SPACE_KEY } from '../schemas';
import { toLocalDateStr } from '../lib/dateUtils';
import type { Survey, SurveyTarget, Scan, SurveySubmission, SurveyEvent } from '../types/survey';
import type { Organization } from '../types/organization';
import type { Asset } from '../types/asset';
import type { Space } from '../types/space';
import type { Building } from '../types/building';
import type { SurveyMode } from '../types';

export interface StartForm {
    name: string;
    startDate: string;
    endDate: string;
    spaceIds: string[];
    includesUnassigned: boolean;
}

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function defaultStartForm(spaces: Space[], today = new Date(), buildings: Building[] = []): StartForm {
    return {
        name: `${today.getFullYear()}년 정기 재물조사`,
        startDate: toLocalDateStr(today),
        endDate: toLocalDateStr(addDays(today, 14)),
        spaceIds: orderSpacesByLocation(spaces, buildings).map((s) => s.id),
        includesUnassigned: true,
    };
}

export function validateStartForm(f: StartForm): string | null {
    const name = f.name.trim();
    if (!name) return '회차 이름을 넣어 주세요.';
    if (name.length > SURVEY_NAME_MAX) return `회차 이름은 ${SURVEY_NAME_MAX}자까지입니다.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(f.endDate)) return '기간을 골라 주세요.';
    if (f.endDate < f.startDate) return '끝나는 날이 시작하는 날보다 빠릅니다.';
    if (f.spaceIds.length === 0 && !f.includesUnassigned) return '조사할 공간을 하나 이상 골라 주세요.';
    return null;
}

/** 공간 이름 표 — 마감 때 회차에 남긴다(보고서가 나중에도 마감 시점 이름으로 나오게) */
export function spaceNamesFor(survey: Pick<Survey, 'spaceIds' | 'includesUnassigned'>, spaces: Space[]): Record<string, string> {
    const names: Record<string, string> = {};
    for (const id of survey.spaceIds) names[id] = spaces.find((s) => s.id === id)?.name ?? '(지운 공간)';
    if (survey.includesUnassigned) names[NO_SPACE_KEY] = '공간 미지정';
    return names;
}

/** 마감 시점 공간 위치 표 — 대상 공간만("본관 2층", 건물이 없으면 빈 글자) */
export function spaceLocationsFor(survey: Pick<Survey, 'spaceIds'>, spaces: Space[], buildings: Building[]): Record<string, string> {
    const all = spaceLocationMap(spaces, buildings);
    const out: Record<string, string> = {};
    for (const id of survey.spaceIds) out[id] = all[id] ?? '';
    return out;
}

/**
 * 보고서 공간 순서 — 회차의 spaceIds 순서(시작할 때 건물 → 층 → 공간으로 담는다), 공간 미지정은 맨 끝.
 * 예전에는 spaceNames의 키 순서를 썼는데, Firestore는 map 키를 정렬해 돌려주므로 마감한 회차는
 * 공간 ID 순서(사실상 뒤죽박죽)로 나왔다(2026-11-22).
 */
export function reportOrderFor(survey: Pick<Survey, 'spaceIds' | 'includesUnassigned'>): string[] {
    return [...survey.spaceIds, ...(survey.includesUnassigned ? [NO_SPACE_KEY] : [])];
}

/** 검토 요청 — 승인·반려·대신 승인 */
export interface ReviewRequest {
    spaceId: string;
    decision: 'approved' | 'rejected';
    reason: string;
}

export default function useSurveyAdmin() {
    const { user, userData } = useAuth();
    const { confirm } = useConfirm();
    const { showToast } = useToast();
    const orgId = userData?.organizationId ?? null;
    const uid = user?.uid ?? null;
    const [surveys, setSurveys] = useState<Survey[]>([]);
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [mode, setMode] = useState<SurveyMode>(DEFAULT_SURVEY_MODE);
    const [targets, setTargets] = useState<SurveyTarget[]>([]);
    const [scans, setScans] = useState<Scan[]>([]);
    const [submissions, setSubmissions] = useState<SurveySubmission[]>([]);
    const [names, setNames] = useState<Map<string, string>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [form, setForm] = useState<StartForm | null>(null);
    const [starting, setStarting] = useState(false);
    const [closing, setClosing] = useState(false);

    // 진행 중 회차 — '마감 중'(멈춘 뒤 닫기 전)도 여기서 이어서 마감하거나 취소한다
    const open = surveys.find((s) => s.status !== 'closed') ?? null;

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(false);
        try {
            const [list, sp, org, bd] = await Promise.all([
                getSurveys(orgId), getSpaces(orgId), getOrganization(orgId), getBuildings(orgId),
            ]);
            setSurveys(list);
            setSpaces(sp);
            setBuildings(bd);
            setMode(org?.surveyMode ?? DEFAULT_SURVEY_MODE);
            const current = list.find((s) => s.status !== 'closed');
            setTargets(current ? await getSurveyTargets(orgId, current.id) : []);
            // 이름은 제출·승인한 사람 표시용 — 못 읽어도 화면은 그린다
            getOrganizationMembers(orgId)
                .then((members) => setNames(new Map(members.map((m) => [m.id, m.name || m.email || '(이름 없음)']))))
                .catch(() => { });
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    // 현황판 — 진행 중 회차의 스캔·제출을 실시간으로
    const openId = open?.id ?? null;
    useEffect(() => {
        if (!orgId || !openId) { setScans([]); setSubmissions([]); return; }
        const a = subscribeSurveyScans(orgId, openId, setScans, () => setError(true));
        const b = subscribeSubmissions(orgId, openId, setSubmissions, () => setError(true));
        return () => { a(); b(); };
    }, [orgId, openId]);

    /** 새 회차 양식 열기 — 대상 수를 보여 주려고 재물을 이때 읽는다 */
    const openForm = useCallback(async () => {
        if (!orgId) return;
        try {
            const list = await getAssets(orgId);
            setAssets(list);
            setForm(defaultStartForm(spaces, new Date(), buildings));
        } catch {
            showToast('재물 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
        }
    }, [orgId, spaces, buildings, showToast]);

    /** 양식 기준 공간별 대상 수 */
    const preview = useMemo(() => {
        if (!form) return null;
        const groups = groupTargets(assets, spaces.map((s) => s.id), true);
        const count = (key: string) => groups.get(key)?.length ?? 0;
        const total = form.spaceIds.reduce((n, id) => n + count(id), 0) + (form.includesUnassigned ? count(NO_SPACE_KEY) : 0);
        return { count, total, unassigned: count(NO_SPACE_KEY) };
    }, [form, assets, spaces]);

    const formError = form ? validateStartForm(form) : null;

    const start = useCallback(async () => {
        if (!orgId || !form || formError || starting || !preview) return;
        if (open) { showToast('이미 진행 중인 조사가 있습니다.', 'error'); return; }
        const ok = await confirm({
            title: '조사를 시작할까요?',
            message: `대상 ${preview.total.toLocaleString('ko-KR')}건을 지금 기준으로 고정합니다. 시작한 뒤 재물을 다시 가져와도 이번 조사 대상은 바뀌지 않습니다.`,
            confirmText: '조사 시작',
        });
        if (!ok) return;
        setStarting(true);
        try {
            await startSurvey({ orgId, ...form, name: form.name.trim(), mode, assets });
            showToast('조사를 시작했습니다. 공간 담당자 화면에 스캔이 열립니다.', 'success');
            setForm(null);
            await load();
        } catch {
            showToast('조사를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
        } finally {
            setStarting(false);
        }
    }, [orgId, form, formError, starting, preview, open, confirm, mode, assets, showToast, load]);

    const progress = useMemo<Map<string, SpaceProgress>>(() => progressBySpace(targets, scans), [targets, scans]);
    const totals = useMemo(() => {
        let target = 0; let found = 0;
        for (const p of progress.values()) { target += p.target; found += p.found; }
        return { target, found, unregistered: scans.filter((s) => s.result === 'unregistered').length };
    }, [progress, scans]);
    const submissionOf = useMemo(() => new Map(submissions.map((s) => [s.spaceId, s])), [submissions]);

    /** 최근 스캔(현황판) — 아직 전송 전 기록은 맨 위 */
    const recent = useMemo(() => {
        const time = (s: Scan) => {
            const ts = s.scannedAt as { toMillis?: () => number } | undefined;
            return typeof ts?.toMillis === 'function' ? ts.toMillis() : Number.MAX_SAFE_INTEGER;
        };
        return [...scans].sort((a, b) => time(b) - time(a)).slice(0, 8);
    }, [scans]);

    /** 승인·반려·대신 승인. 사유가 필요한 경우(반려·본인 승인·대신 승인)는 화면이 받아 넘긴다 */
    const review = useCallback(async ({ spaceId, decision, reason }: ReviewRequest): Promise<boolean> => {
        if (!orgId || !open) return false;
        const current = submissionOf.get(spaceId) ?? null;
        const needsReason = decision === 'rejected' || !current || current.submittedByUid === uid;
        if (needsReason && !reason.trim()) { showToast('사유를 적어 주세요.', 'error'); return false; }
        try {
            await reviewSpace({ orgId, surveyId: open.id, spaceId, decision, reason, current });
            showToast(decision === 'approved' ? '승인했습니다.' : '반려했습니다. 공간 담당자 화면에 사유가 보입니다.', 'success');
            return true;
        } catch {
            showToast('처리하지 못했습니다. 화면을 새로 열어 상태를 확인해 주세요.', 'error');
            return false;
        }
    }, [orgId, open, submissionOf, uid, showToast]);

    const blockers = useMemo(() => (open ? closeBlockers(open.mode, open.spaceIds, submissions) : []), [open, submissions]);

    /**
     * 마감 — 회차를 먼저 '마감 중'으로 멈추고(스캔·제출·승인이 막힌다), 스캔·제출을 서버에서 새로 읽어
     * 보고서·반영 목록을 만든 뒤 닫는다(2026-11-24). 확인창의 숫자는 화면 기준이라 그 사이 들어온 스캔이
     * 있으면 최종 숫자가 달라질 수 있어 결과를 알려 준다. '마감 중'에서 실패했으면 다시 누르면 이어서 한다.
     * @returns 마감한 회차 ID
     */
    const close = useCallback(async (): Promise<string | null> => {
        if (!orgId || !open || closing) return null;
        const resuming = open.status === 'closing';
        if (!resuming && blockers.length > 0) { showToast('승인되지 않은 공간이 있어 마감할 수 없습니다.', 'error'); return null; }
        const shown = buildReport(targets, scans, submissions, reportOrderFor(open)).summary;
        const ok = await confirm(resuming ? {
            title: '마감을 이어서 할까요?',
            message: '지난번 마감이 끝나지 않았습니다. 찍기·제출은 이미 멈춰 있고, 지금 서버의 결과로 보고서와 희망이음 반영 목록을 만들어 마감합니다.',
            confirmText: '이어서 마감',
            confirmColor: 'danger',
        } : {
            title: '조사를 마감할까요?',
            message: `지금 화면 기준 확인 ${shown.found}/${shown.target}건, 미발견 ${shown.missing}건. 마감을 누르면 찍기·제출이 바로 멈추고, 그때까지 저장된 결과로 보고서와 희망이음 반영 목록을 만듭니다. 마감하면 더는 찍거나 고칠 수 없습니다.`,
            confirmText: '마감',
            confirmColor: 'danger',
        });
        if (!ok) return null;
        setClosing(true);
        try {
            if (!resuming) await beginClosing(open.id);
            // 멈춘 뒤의 결과 — 캐시가 아니라 서버에서 읽는다(인터넷이 없으면 여기서 실패하고 '마감 중'으로 남는다)
            const [finalScans, finalSubs] = await Promise.all([
                getScans(orgId, open.id, { fromServer: true }),
                getSubmissions(orgId, open.id, { fromServer: true }),
            ]);
            // 확인창을 연 사이 다른 관리자가 반려했을 수 있다 — 멈춘 것을 풀고 알린다
            const late = closeBlockers(open.mode, open.spaceIds, finalSubs);
            if (late.length > 0) {
                await cancelClosing(open.id);
                showToast('그 사이 승인되지 않은 공간이 생겨 마감을 멈추고 다시 열었습니다. 현황판을 확인해 주세요.', 'error');
                await load();
                return null;
            }
            const report = buildReport(targets, finalScans, finalSubs, reportOrderFor(open));
            const tasks = buildSyncTasks(open.id, report);
            // 보고서 머리를 마감 시점으로 남긴다(2026-11-24) — 나중에 다시 출력해도 같은 기관명·결재선·이름
            const [org, members, events] = await Promise.all([
                getOrganization(orgId), getOrganizationMembers(orgId), getSurveyEvents(orgId, open.id),
            ]);
            const reportSnapshot = buildReportSnapshot(org, members, finalSubs, events, uid);
            await closeSurvey({
                orgId, surveyId: open.id, tasks,
                spaceNames: spaceNamesFor(open, spaces), spaceLocations: spaceLocationsFor(open, spaces, buildings),
                summary: report.summary, reportSnapshot,
            });
            const f = report.summary;
            showToast(!resuming && (f.found !== shown.found || f.target !== shown.target)
                ? `마감했습니다. 확인창 뒤에 들어온 스캔까지 반영해 확인 ${f.found}/${f.target}건입니다.`
                : '마감했습니다. 결과 보고서를 확인하세요.', 'success');
            const id = open.id;
            await load();
            return id;
        } catch {
            showToast('마감하지 못했습니다. 찍기·제출은 멈춘 상태이니, 인터넷 연결을 확인한 뒤 [이어서 마감]을 누르세요.', 'error');
            void load(); // '마감 중' 상태를 화면에 반영
            return null;
        } finally {
            setClosing(false);
        }
    }, [orgId, uid, open, closing, blockers, spaces, buildings, targets, scans, submissions, confirm, showToast, load]);

    /** 마감 취소 — '마감 중'에 멈춘 회차를 다시 열어 찍고 승인할 수 있게 한다 */
    const cancelClose = useCallback(async (): Promise<void> => {
        if (!open || open.status !== 'closing' || closing) return;
        setClosing(true);
        try {
            await cancelClosing(open.id);
            showToast('마감을 취소했습니다. 다시 찍고 제출할 수 있습니다.', 'success');
            await load();
        } catch {
            showToast('마감을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
        } finally {
            setClosing(false);
        }
    }, [open, closing, showToast, load]);

    return {
        orgId, uid, surveys, spaces, buildings, mode, open, loading, error, reload: load,
        form, setForm, openForm, closeForm: () => setForm(null), preview, formError, start, starting,
        progress, totals, scans, recent, submissions, submissionOf, names, review, blockers, close, cancelClose, closing,
    };
}

/**
 * 마감 시점 보고서 머리 — 기관명·결재선 칸(숨겼으면 빈 줄)과, 이 회차의 제출·승인·이력에 나온 사람과 마감한 사람의 이름.
 * 기관을 나가 목록에 없는 사람은 담지 않는다(보고서에 '알 수 없음').
 */
export function buildReportSnapshot(
    org: Pick<Organization, 'name' | 'approvalLine' | 'hideApprovalLine'> | null,
    members: Array<{ id: string; name?: string | null; email?: string | null }>,
    submissions: Array<Pick<SurveySubmission, 'submittedByUid' | 'reviewedByUid'>>,
    events: Array<Pick<SurveyEvent, 'byUid'>>,
    closerUid: string | null,
): NonNullable<Survey['reportSnapshot']> {
    const uids = new Set<string>();
    for (const x of submissions) { if (x.submittedByUid) uids.add(x.submittedByUid); if (x.reviewedByUid) uids.add(x.reviewedByUid); }
    for (const e of events) if (e.byUid) uids.add(e.byUid);
    if (closerUid) uids.add(closerUid);
    const personNames: Record<string, string> = {};
    for (const m of members) if (uids.has(m.id)) personNames[m.id] = m.name || m.email || '(이름 없음)';
    return {
        orgName: org?.name ?? '',
        approvalLine: org?.hideApprovalLine ? [] : (org?.approvalLine ?? []).map((a) => ({ title: a.title })),
        personNames,
    };
}

export type { SpaceProgress };
