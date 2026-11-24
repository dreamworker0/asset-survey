/**
 * useScanner — 현장 스캔 (기획서 F11·F12)
 *
 * 흐름: 찍힌 글자 → 대상 목록에서 찾기(인터넷 없이) → 없으면 서버에서 재물 찾기 → 판정 → 이미 찍었는지
 * 확인 → 저장(기다리지 않음). 같은 물건은 다시 저장하지 않아 수가 늘지 않는다.
 *
 * 찍을 수 있는 공간: 관리자는 회차의 모든 공간, 직원은 '나눠서 조사' 회차에서 자기가 담당하는 공간만
 * (Rules도 같은 경계로 막는다). '혼자 조사' 회차는 관리자만 찍는다.
 *
 * '나눠서 조사' 회차는 공간을 다 찍으면 제출한다(기획서 F13). 제출·승인된 공간은 스캔이 잠기고(Rules),
 * 반려되면 사유와 함께 다시 열린다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import {
    getOpenSurvey, getSurveyTargets, getSpaces, findAssetByTag, findAssetByCode, peekScan, saveScan,
    updateScanCondition, deleteScan, subscribeSpaceScans, subscribeSubmission, submitSpace,
} from '../lib/firestore';
import {
    buildTargetIndex, findInTargets, judge, resolveInput, targetKey,
    type FoundAsset, type IndexedTarget, type Judgement, type ScanDraft,
} from '../lib/survey/judge';
import type { Survey, SurveyTarget, Scan, ScanCondition, ScanMethod, SurveySubmission } from '../types/survey';
import type { Space } from '../types/space';

export type LastScan =
    | { kind: 'saved'; draft: ScanDraft; method: ScanMethod; at: number }
    | { kind: 'duplicate'; judgement: Extract<Judgement, { kind: 'duplicate' }>; at: number }
    /** 대상 목록에 없는데 대장 조회도 실패 — 저장하지 않고 연결 뒤 다시 찍게 한다 */
    | { kind: 'lookupFailed'; code: string; at: number };

function vibrate(pattern: number | number[]) {
    try { navigator.vibrate?.(pattern); } catch { /* 진동 없는 기기 */ }
}

export default function useScanner(initialSpaceId: string | null) {
    const { user, userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const orgId = userData?.organizationId ?? null;
    const uid = user?.uid ?? null;
    const isAdmin = userData?.role === 'admin';

    const [survey, setSurvey] = useState<Survey | null>(null);
    const [targets, setTargets] = useState<SurveyTarget[]>([]);
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId);
    const [scans, setScans] = useState<Scan[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [last, setLast] = useState<LastScan | null>(null);
    const busy = useRef(false);
    const [checking, setChecking] = useState(false);
    const [submission, setSubmission] = useState<SurveySubmission | null>(null);
    const [submissionPending, setSubmissionPending] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(false);
            try {
                const open = await getOpenSurvey(orgId);
                if (cancelled) return;
                setSurvey(open);
                if (!open) return;
                const [t, sp] = await Promise.all([getSurveyTargets(orgId, open.id), getSpaces(orgId)]);
                if (cancelled) return;
                setTargets(t);
                setSpaces(sp);
            } catch {
                if (!cancelled) setError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [orgId]);

    /** 내가 찍을 수 있는 공간 — 회차 대상 공간 중에서, 공간 순서대로 */
    const mySpaces = useMemo(() => {
        if (!survey || !uid) return [];
        const inSurvey = spaces.filter((s) => survey.spaceIds.includes(s.id)).sort((a, b) => a.order - b.order);
        if (isAdmin) return inSurvey;
        if (survey.mode !== 'delegated') return [];
        // 개인으로 지정됐거나 내 팀이 담당하는 공간(2026-11-22) — Rules의 isSpaceManager와 같은 기준
        const teamId = userData?.teamId ?? null;
        return inSurvey.filter((s) => s.managerUids.includes(uid) || (!!teamId && (s.teamIds ?? []).includes(teamId)));
    }, [survey, spaces, uid, isAdmin, userData?.teamId]);

    // 고른 공간이 내 공간이 아니면(주소로 들어온 경우 등) 첫 공간으로
    useEffect(() => {
        if (mySpaces.length === 0) return;
        if (!spaceId || !mySpaces.some((s) => s.id === spaceId)) setSpaceId(mySpaces.length === 1 ? mySpaces[0].id : null);
    }, [mySpaces, spaceId]);

    // 이 공간에 관한 스캔 실시간
    useEffect(() => {
        if (!orgId || !survey || !spaceId) { setScans([]); return; }
        return subscribeSpaceScans(orgId, survey.id, spaceId, setScans, () => setError(true));
    }, [orgId, survey, spaceId]);

    // 이 공간의 제출 상태 실시간('나눠서 조사'만)
    useEffect(() => {
        setSubmission(null);
        setSubmissionPending(false);
        if (!survey || !spaceId || survey.mode !== 'delegated') return;
        return subscribeSubmission(survey.id, spaceId, (s, pending) => { setSubmission(s); setSubmissionPending(pending); });
    }, [survey, spaceId]);

    /** 제출·승인돼 스캔이 잠긴 공간 */
    const locked = !!submission && submission.state !== 'rejected';

    const index = useMemo(() => buildTargetIndex(targets), [targets]);
    const scanMap = useMemo(() => new Map(scans.map((s) => [s.id, s])), [scans]);
    const spaceName = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces]);

    /** 찍힌 글자 처리 — 처리 중이면 false(카메라가 다음 프레임에 다시 넘긴다) */
    const handle = useCallback((text: string, method: ScanMethod): boolean => {
        if (busy.current || !orgId || !survey || !spaceId) return false;
        if (locked) return true; // 잠긴 공간 — 화면이 입력을 숨기지만 카메라 콜백이 남아 있을 수 있다
        const lookup = resolveInput(text, method);
        if (!lookup) return true;
        busy.current = true;
        setChecking(true);
        void (async () => {
            try {
                let target: IndexedTarget | null = findInTargets(index, lookup);
                let found: FoundAsset | null = null;
                if (!target) {
                    try {
                        const asset = lookup.kind === 'tag' ? await findAssetByTag(orgId, lookup.tag) : await findAssetByCode(orgId, lookup.code);
                        // 회차 시작 뒤에 라벨을 뽑은 대상은 태그가 대상 목록에 없다 → 문서 ID로 다시 맞춘다
                        if (asset) target = index.byId.get(asset.id) ?? null;
                        if (asset && !target) found = { id: asset.id, code: asset.code, name: asset.name, status: asset.status };
                    } catch {
                        // 조회 실패(오프라인 등) — 미등록으로 남기면 시작 뒤에 다시 뽑은 라벨의 대상까지
                        // '미등록'+'못 찾음'으로 갈라진다. 저장하지 않고 연결 뒤 다시 찍게 한다(2026-11-24)
                        vibrate([200, 100, 200]);
                        setLast({ kind: 'lookupFailed', code: lookup.kind === 'tag' ? lookup.tag : lookup.code, at: Date.now() });
                        return;
                    }
                }
                let j = judge({ surveyId: survey.id, spaceId, lookup, target, found, existing: (id) => scanMap.get(id) ?? null });
                if (j.kind === 'save') {
                    // 다른 공간에서 이미 찍혔을 수 있다 — 서버에 한 번 물어본다(오프라인이면 건너뜀)
                    const prev = await peekScan(j.draft.scanId);
                    if (prev) j = { kind: 'duplicate', scanId: j.draft.scanId, existing: prev, code: j.draft.code, name: j.draft.name };
                }
                if (j.kind === 'duplicate') {
                    vibrate([60, 60, 60]);
                    setLast({ kind: 'duplicate', judgement: j, at: Date.now() });
                    return;
                }
                const draft = j.draft;
                vibrate(draft.result === 'ok' ? 80 : [80, 60, 80]);
                saveScan({
                    orgId, surveyId: survey.id, spaceId, method, draft,
                    onRejected: () => showToast(`${draft.code} 스캔이 저장되지 않았습니다. 이미 다른 곳에서 찍혔거나 조사가 끝났을 수 있습니다.`, 'error'),
                });
                setLast({ kind: 'saved', draft, method, at: Date.now() });
            } finally {
                busy.current = false;
                setChecking(false);
            }
        })();
        return true;
    }, [orgId, survey, spaceId, index, scanMap, showToast, locked]);

    const setCondition = useCallback((scanId: string, condition: ScanCondition, memo: string) => {
        updateScanCondition(scanId, condition, memo, () => showToast('물건 상태를 저장하지 못했습니다.', 'error'));
    }, [showToast]);

    /** 잘못 찍은 스캔 지우기 — 상태·메모·사진도 함께 사라지므로 묻는다(2026-11-22 점검: 확인 없이 지워졌다) */
    const undo = useCallback(async (scanId: string) => {
        const code = scanMap.get(scanId)?.code ?? '';
        const ok = await confirm({
            title: code ? `'${code}' 스캔을 지울까요?` : '이 스캔을 지울까요?',
            message: '물건 상태·메모·현장 사진도 함께 지워집니다. 다시 찍으면 새로 남습니다.',
            confirmText: '스캔 지우기', confirmColor: 'danger',
        });
        if (!ok) return;
        try {
            await deleteScan(scanId);
            setLast((prev) => (prev?.kind === 'saved' && prev.draft.scanId === scanId ? null : prev));
            showToast('스캔을 지웠습니다.', 'success');
        } catch {
            showToast('지우지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
        }
    }, [showToast, confirm, scanMap]);

    /** 이 공간의 진행 — 대상 중 찾은 것(어디서 찍혔든), 남은 것, 이 공간에서 찍은 최근 순 */
    const view = useMemo(() => {
        const bucket = targets.find((t) => targetKey(t.spaceId) === spaceId);
        const foundIds = new Set(scans
            .filter((s) => s.assetId && s.expectedSpaceId === spaceId && (s.result === 'ok' || s.result === 'otherSpace'))
            .map((s) => s.assetId as string));
        const remaining = (bucket?.items ?? []).filter((i) => !foundIds.has(i.id));
        const time = (s: Scan) => {
            const ts = s.scannedAt as { toMillis?: () => number } | undefined;
            return typeof ts?.toMillis === 'function' ? ts.toMillis() : Number.MAX_SAFE_INTEGER; // 아직 전송 전이면 맨 위
        };
        const here = scans.filter((s) => s.spaceId === spaceId).sort((a, b) => time(b) - time(a));
        return { target: bucket?.items.length ?? 0, found: foundIds.size, remaining, here };
    }, [targets, scans, spaceId]);

    /** 이 공간 제출 — 남은 재물이 있으면 미발견으로 보고된다고 알린다 */
    const submit = useCallback(async (remaining: number) => {
        if (!orgId || !survey || !spaceId || submitting) return;
        const ok = await confirm({
            title: '이 공간 조사를 제출할까요?',
            message: remaining > 0
                ? `아직 못 찾은 재물이 ${remaining}건 있습니다. 제출하면 이 공간은 스캔이 잠기고, 승인되면 남은 재물은 '미발견'으로 보고됩니다.`
                : '제출하면 이 공간은 스캔이 잠기고 재물 담당자가 확인합니다.',
            confirmText: '제출',
        });
        if (!ok) return;
        setSubmitting(true);
        try {
            await submitSpace(orgId, survey.id, spaceId);
            showToast('제출했습니다. 재물 담당자가 확인합니다.', 'success');
        } catch {
            showToast('제출하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', 'error');
        } finally {
            setSubmitting(false);
        }
    }, [orgId, survey, spaceId, submitting, confirm, showToast]);

    return {
        submission, submissionPending, locked, submit, submitting,
        loading, error, survey, isAdmin, mySpaces, spaceId, setSpaceId, spaceName,
        handle, checking, last, clearLast: () => setLast(null), scanMap, setCondition, undo, ...view,
    };
}
