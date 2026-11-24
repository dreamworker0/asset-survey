/**
 * firestore/surveys — 회차 시작(대상 고정)·스캔 저장 (기획서 F10~F12)
 *
 * 고정하는 계약:
 *   - 대상은 운영 재물만, 고른 공간(+미지정)만 공간별 묶음으로 회차와 한 배치에 쓴다
 *   - 스캔은 회차+재물 문서 ID로, 기다리지 않고 저장하며 거절되면 알린다
 *   - 조회·구독은 organizationId로 거른다
 *   - 마감 계산용 조회(fromServer)는 캐시가 아니라 서버 값을 읽는다
 *   - 구독은 상태·'보내는 중' 표시를 그대로 넘기고, 오류는 보고한 뒤 화면에 알린다 (2026-11-25 보강)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ops: Array<{ kind: string; path: string; data: Record<string, unknown> }> = [];
vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, path: string) => ({ path, withConverter() { return this; } })),
    doc: vi.fn((first: { path?: string }, path?: string, id?: string) => {
        if (path === undefined) return { path: `${first.path}/auto`, id: 'auto' };
        return { path: `${path}/${id}`, id, withConverter() { return this; } };
    }),
    query: vi.fn((...a: unknown[]) => a),
    where: vi.fn((f: string, op: string, v: unknown) => ({ f, op, v })),
    orderBy: vi.fn(), limit: vi.fn(),
    getDoc: vi.fn(), getDocs: vi.fn(), getDocsFromServer: vi.fn(),
    onSnapshot: vi.fn(() => () => { }),
    writeBatch: vi.fn(() => ({
        set: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ kind: 'set', path: ref.path, data }),
        update: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ kind: 'update', path: ref.path, data }),
        commit: vi.fn().mockResolvedValue(undefined),
    })),
    setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => '__ts__'),
}));
vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
const captureError = vi.fn();
vi.mock('../../../lib/monitoring', () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
const trackWrite = vi.fn(async () => undefined);
vi.mock('../../../lib/offline/syncQueue', () => ({ trackWrite: (...a: unknown[]) => trackWrite(...(a as [])) }));

import * as fs from 'firebase/firestore';
import {
    groupTargets, findOversizedTarget, MAX_TARGETS_PER_SPACE, startSurvey, saveScan, peekScan, subscribeSpaceScans, submitSpace, reviewSpace, closeSurvey, setSyncTaskDone,
    getSurveys, getSurvey, getOpenSurvey, getSurveyTargets, getScans, getSubmissions, getSyncTasks, getSurveyEvents,
    subscribeSurveyStatus, subscribeSurveyScans, subscribeSubmissions, subscribeSubmission,
    updateScanCondition, deleteScan, beginClosing, cancelClosing,
} from '../../../lib/firestore/surveys';
import type { Asset } from '../../../types/asset';

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
    id, organizationId: 'org-A', code: id, name: 'TV', category: null, spec: null, acquiredAt: null, acquiredQuantity: null,
    quantity: 1, status: 'active', statusRaw: null, locationRaw: null, spaceId: 'sp-1', department: null, usage: null,
    missingFromSource: false, manual: false, lastImportId: null, tagId: null, ...over,
});
const ASSETS = [
    asset('a1'), asset('a2', { spaceId: 'sp-2' }), asset('a3', { spaceId: null, tagId: 'AAAAAAAAA3' }),
    asset('a4', { status: 'disposed' }), asset('a5', { spaceId: 'sp-hidden' }),
];

beforeEach(() => { vi.clearAllMocks(); ops.length = 0; });

// 회차 시작은 한 배치라 공간 묶음 하나만 문서 한도를 넘어도 통째로 거부된다 — 어느 공간인지 미리 찾는다
describe('findOversizedTarget', () => {
    const item = (i: number, name = 'TV') => ({ id: `org__${i}`, code: String(i), name, tagId: null });
    it('모든 묶음이 담기면 null', () => {
        const g = new Map([['sp-1', [item(1)]], ['_none', [item(2)]]]);
        expect(findOversizedTarget(g, ['sp-1', '_none'])).toBeNull();
    });
    it('건수 한도(Rules와 같은 3,000건)를 넘는 공간을 찾는다', () => {
        const g = new Map([['sp-1', [item(1)]], ['sp-2', Array.from({ length: MAX_TARGETS_PER_SPACE + 1 }, (_, i) => item(i))]]);
        expect(findOversizedTarget(g, ['sp-1', 'sp-2'])).toEqual({ key: 'sp-2', count: MAX_TARGETS_PER_SPACE + 1, reason: 'count' });
    });
    it('건수 안이어도 품명이 길어 문서 크기를 넘으면 찾는다', () => {
        const long = '가'.repeat(150); // UTF-8 450바이트
        const g = new Map([['sp-1', Array.from({ length: 2500 }, (_, i) => item(i, long))]]);
        expect(findOversizedTarget(g, ['sp-1'])).toEqual({ key: 'sp-1', count: 2500, reason: 'bytes' });
    });
    it('고르지 않은 공간은 보지 않는다', () => {
        const g = new Map([['sp-9', Array.from({ length: MAX_TARGETS_PER_SPACE + 1 }, (_, i) => item(i))]]);
        expect(findOversizedTarget(g, ['sp-1'])).toBeNull();
    });
});

describe('groupTargets', () => {
    it('운영 재물만, 고른 공간만, 미지정은 넣을 때만', () => {
        const g = groupTargets(ASSETS, ['sp-1', 'sp-2'], true);
        expect([...g.entries()].map(([k, v]) => [k, v.map((i) => i.id)])).toEqual([['sp-1', ['a1']], ['sp-2', ['a2']], ['_none', ['a3']]]);
        expect(g.get('_none')?.[0]).toEqual({ id: 'a3', code: 'a3', name: 'TV', tagId: 'AAAAAAAAA3' });
        expect(groupTargets(ASSETS, ['sp-1'], false).has('_none')).toBe(false);
    });
    it('내용연수가 있는 재물만 취득일자·내용연수를 함께 남긴다(2026-11-22)', () => {
        const g = groupTargets([asset('a1', { acquiredAt: '2020-01-01', usefulLife: 5 }), asset('a2')], ['sp-1'], false);
        expect(g.get('sp-1')).toEqual([
            expect.objectContaining({ id: 'a1', acquiredAt: '2020-01-01', usefulLife: 5 }),
            expect.not.objectContaining({ usefulLife: expect.anything() }),
        ]);
    });
});

describe('startSurvey', () => {
    it('회차와 공간별 대상 묶음을 한 배치로 쓴다', async () => {
        const id = await startSurvey({
            orgId: 'org-A', name: ' 2026 조사 ', startDate: '2026-11-21', endDate: '2026-12-05',
            spaceIds: ['sp-1', 'sp-2'], includesUnassigned: false, mode: 'delegated', assets: ASSETS,
        });
        expect(id).toBe('auto');
        expect(ops.map((o) => o.path)).toEqual(['surveys/auto', 'surveyEvents/auto', 'surveyTargets/auto__sp-1', 'surveyTargets/auto__sp-2']);
        expect(ops[1].data).toMatchObject({ type: 'start', surveyId: 'auto', byUid: 'u1', reason: '대상 2건' });
        expect(ops[0].data).toMatchObject({ name: '2026 조사', status: 'open', targetCount: 2, mode: 'delegated', lastEditedByUid: 'u1' });
        expect(ops[2].data).toMatchObject({ surveyId: 'auto', spaceId: 'sp-1', organizationId: 'org-A' });
    });
});

describe('saveScan', () => {
    it('회차+재물 ID로 쓰고 기다리지 않으며, 거절되면 알린다', async () => {
        let reject!: (e: unknown) => void;
        vi.mocked(fs.setDoc).mockReturnValue(new Promise((_, r) => { reject = r; }));
        const onRejected = vi.fn();
        saveScan({
            orgId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', method: 'manual', onRejected,
            draft: { scanId: 'sv1__a1', assetId: 'a1', code: 'a1', name: 'TV', expectedSpaceId: 'sp-1', result: 'ok' },
        });
        const [ref, data] = vi.mocked(fs.setDoc).mock.calls[0] as unknown as [{ path: string }, Record<string, unknown>];
        expect(ref.path).toBe('scans/sv1__a1');
        // 쓰기 장부에 적는다 — 미전송 배너·로그아웃 경고·유실 안내 (6단계)
        expect(trackWrite).toHaveBeenCalledWith('CREATE', 'scans', 'sv1__a1', data, expect.any(Promise), { callerAwaits: false });
        expect(data).toMatchObject({
            organizationId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', method: 'manual', result: 'ok', condition: 'normal', memo: '',
            scannedByUid: 'u1', lastEditedByUid: 'u1', scannedAt: '__ts__', updatedAt: '__ts__',
        });
        reject(new Error('permission-denied'));
        await new Promise((r) => setTimeout(r, 0));
        expect(onRejected).toHaveBeenCalled();
    });
});

describe('조회', () => {
    it('peekScan — 있으면 문서, 없으면 null, 확인 못 하면 undefined', async () => {
        vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => false } as never);
        expect(await peekScan('x')).toBeNull();
        vi.mocked(fs.getDoc).mockRejectedValueOnce(new Error('offline'));
        expect(await peekScan('x')).toBeUndefined();
    });
    it('subscribeSpaceScans — 이 공간에서 찍은 것과 이 공간 대상 두 갈래를 기관으로 걸러 구독', () => {
        const stop = subscribeSpaceScans('org-A', 'sv1', 'sp-1', vi.fn());
        expect(fs.onSnapshot).toHaveBeenCalledTimes(2);
        expect(vi.mocked(fs.where).mock.calls.filter((c) => c[0] === 'organizationId')).toHaveLength(2);
        expect(fs.where).toHaveBeenCalledWith('spaceId', '==', 'sp-1');
        expect(fs.where).toHaveBeenCalledWith('expectedSpaceId', '==', 'sp-1');
        stop();
    });
});

describe('제출·검토 (기획서 F13)', () => {
    it('제출은 회차__공간 문서를 처음 상태로 쓰고 이력을 남긴다', async () => {
        await submitSpace('org-A', 'sv1', 'sp-1');
        expect(ops.map((o) => `${o.kind} ${o.path}`)).toEqual(['set surveySubmissions/sv1__sp-1', 'set surveyEvents/auto']);
        expect(ops[0].data).toMatchObject({
            state: 'submitted', submittedByUid: 'u1', submittedAt: '__ts__', reviewedByUid: null, reviewedAt: null,
            reason: '', selfApproved: false, proxyApproved: false,
        });
        expect(ops[1].data).toMatchObject({ type: 'submit', spaceId: 'sp-1' });
        expect(trackWrite).toHaveBeenCalledWith('CREATE', 'surveySubmissions', 'sv1__sp-1', { spaceId: 'sp-1' }, expect.any(Promise), { callerAwaits: true });
    });

    it('제출 없는 공간은 대신 승인(사유 포함), 자기 제출 승인은 본인 승인으로 표시', async () => {
        await reviewSpace({ orgId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', decision: 'approved', reason: ' 담당자 휴가 ', current: null });
        expect(ops[0]).toMatchObject({ kind: 'set', data: { state: 'approved', proxyApproved: true, selfApproved: false, reason: '담당자 휴가', submittedByUid: null, reviewedByUid: 'u1' } });
        ops.length = 0;
        await reviewSpace({ orgId: 'org-A', surveyId: 'sv1', spaceId: 'sp-2', decision: 'approved', reason: '혼자 담당', current: { submittedByUid: 'u1' } as never });
        expect(ops[0]).toMatchObject({ kind: 'update', data: { state: 'approved', selfApproved: true, proxyApproved: false } });
        expect(ops[1].data).toMatchObject({ type: 'approve', reason: '혼자 담당' });
        ops.length = 0;
        await reviewSpace({ orgId: 'org-A', surveyId: 'sv1', spaceId: 'sp-2', decision: 'rejected', reason: '다시', current: { submittedByUid: 'u9' } as never });
        expect(ops[0].data).toMatchObject({ state: 'rejected', selfApproved: false });
        expect(ops[1].data).toMatchObject({ type: 'reject' });
    });
});

describe('마감·반영 목록 (기획서 F15·F16)', () => {
    const summary = { target: 2, found: 1, missing: 1, otherSpace: 0, unregistered: 0, outOfScope: 0, damaged: 0, labelDamaged: 0, manual: 0 };
    it('반영 목록을 먼저 쓰고, 마지막 배치에서 회차를 닫고 이력을 남긴다', async () => {
        const tasks = Array.from({ length: 401 }, (_, i) => ({
            id: `sv1__missing__a${i}`, kind: 'missing' as const, assetId: `a${i}`, code: `a${i}`, name: null, fromSpaceId: 'sp-1', toSpaceId: null, memo: '',
        }));
        await closeSurvey({ orgId: 'org-A', surveyId: 'sv1', tasks, spaceNames: { 'sp-1': '101호' }, summary });
        expect(fs.writeBatch).toHaveBeenCalledTimes(3); // 400 + 1 + 마감
        const last = ops.slice(-2);
        expect(last[0]).toMatchObject({ kind: 'update', path: 'surveys/sv1', data: { status: 'closed', closedByUid: 'u1', spaceNames: { 'sp-1': '101호' }, summary } });
        expect(last[1].data).toMatchObject({ type: 'close' });
        expect(ops[0]).toMatchObject({ path: 'syncTasks/sv1__missing__a0', data: { organizationId: 'org-A', surveyId: 'sv1', done: false, doneByUid: null, doneAt: null } });
        expect(ops[0].data).not.toHaveProperty('id');
    });

    it('반영 완료 체크·해제와 이력', async () => {
        const task = { id: 't1', organizationId: 'org-A', surveyId: 'sv1' } as never;
        await setSyncTaskDone(task, true);
        expect(ops[0]).toMatchObject({ kind: 'update', path: 'syncTasks/t1', data: { done: true, doneByUid: 'u1', doneAt: '__ts__' } });
        expect(ops[1].data).toMatchObject({ type: 'sync-done', targetId: 't1' });
        ops.length = 0;
        await setSyncTaskDone(task, false);
        expect(ops[0].data).toEqual({ done: false, doneByUid: null, doneAt: null });
    });
});

// ── 2026-11-25 보강: 함수 커버리지 32%였던 조회·구독·수정 함수 ──

/** getDocs 결과 모양 */
const docsOf = (rows: Array<Record<string, unknown>>) => ({ empty: rows.length === 0, docs: rows.map((r) => ({ id: r.id, data: () => r })) });
/** 마지막 query 호출에 들어간 where 조건들 */
/** 배열의 마지막 원소 — 이 프로젝트 tsconfig lib에 Array.prototype.at이 없다 */
const last = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];
const lastWheres = () => ((last(vi.mocked(fs.query).mock.calls) ?? []) as unknown[])
    .filter((w): w is { f: string; op: string; v: unknown } => !!w && typeof w === 'object' && 'f' in (w as object));

describe('조회 — 기관으로 거른다', () => {
    const cases: Array<[string, () => Promise<unknown>, Array<[string, string, unknown]>]> = [
        ['getSurveys', () => getSurveys('org-A'), [['organizationId', '==', 'org-A']]],
        ['getSurveyTargets', () => getSurveyTargets('org-A', 'sv1'), [['organizationId', '==', 'org-A'], ['surveyId', '==', 'sv1']]],
        ['getScans', () => getScans('org-A', 'sv1'), [['organizationId', '==', 'org-A'], ['surveyId', '==', 'sv1']]],
        ['getSubmissions', () => getSubmissions('org-A', 'sv1'), [['organizationId', '==', 'org-A'], ['surveyId', '==', 'sv1']]],
        ['getSyncTasks', () => getSyncTasks('org-A', 'sv1'), [['organizationId', '==', 'org-A'], ['surveyId', '==', 'sv1']]],
        ['getSurveyEvents', () => getSurveyEvents('org-A', 'sv1'), [['organizationId', '==', 'org-A'], ['surveyId', '==', 'sv1']]],
    ];
    it.each(cases)('%s', async (_name, call, conds) => {
        vi.mocked(fs.getDocs).mockResolvedValueOnce(docsOf([{ id: 'x1', organizationId: 'org-A' }]) as never);
        expect(await call()).toEqual([{ id: 'x1', organizationId: 'org-A' }]);
        for (const [f, op, v] of conds) expect(lastWheres()).toContainEqual({ f, op, v });
    });

    it('getOpenSurvey — 열린 회차와 마감 중 회차를 함께 찾고, 없으면 null', async () => {
        vi.mocked(fs.getDocs).mockResolvedValueOnce(docsOf([{ id: 'sv1', status: 'closing' }]) as never);
        expect(await getOpenSurvey('org-A')).toEqual({ id: 'sv1', status: 'closing' });
        expect(lastWheres()).toContainEqual({ f: 'status', op: 'in', v: ['open', 'closing'] });
        expect(lastWheres()).toContainEqual({ f: 'organizationId', op: '==', v: 'org-A' });
        vi.mocked(fs.getDocs).mockResolvedValueOnce(docsOf([]) as never);
        expect(await getOpenSurvey('org-A')).toBeNull();
    });

    it('getSurvey — 있으면 문서, 없으면 null', async () => {
        vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'sv1' }) } as never);
        expect(await getSurvey('sv1')).toEqual({ id: 'sv1' });
        vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => false } as never);
        expect(await getSurvey('nope')).toBeNull();
    });

    it('마감 계산용(fromServer)은 캐시가 아니라 서버에서 읽는다 — 인터넷이 없으면 실패해 마감이 멈춘다', async () => {
        vi.mocked(fs.getDocsFromServer).mockResolvedValue(docsOf([]) as never);
        await getScans('org-A', 'sv1', { fromServer: true });
        await getSubmissions('org-A', 'sv1', { fromServer: true });
        expect(fs.getDocsFromServer).toHaveBeenCalledTimes(2);
        expect(fs.getDocs).not.toHaveBeenCalled();
    });

    it('실패하면 보고하고 다시 던진다(화면이 오류를 안내한다)', async () => {
        const err = new Error('permission-denied');
        vi.mocked(fs.getDocs).mockRejectedValueOnce(err);
        await expect(getSurveys('org-A')).rejects.toBe(err);
        expect(captureError).toHaveBeenCalledWith(err, { context: 'getSurveys', orgId: 'org-A' });
        vi.mocked(fs.getDocsFromServer).mockRejectedValueOnce(err);
        await expect(getScans('org-A', 'sv1', { fromServer: true })).rejects.toBe(err);
    });
});

describe('구독', () => {
    /** 마지막 onSnapshot 호출의 (다음, 오류) 콜백과 인자 */
    const lastSnapshot = () => {
        const args = last(vi.mocked(fs.onSnapshot).mock.calls as unknown[]) as unknown[];
        const fns = args.filter((a) => typeof a === 'function') as Array<(x: unknown) => void>;
        return { next: fns[0], error: fns[1], args };
    };

    it('subscribeSurveyStatus — 회차 상태를 넘기고, 문서가 사라지면 null', () => {
        const got: unknown[] = [];
        subscribeSurveyStatus('sv1', (st) => got.push(st));
        const { next, error } = lastSnapshot();
        next({ exists: () => true, data: () => ({ status: 'closing' }) });
        next({ exists: () => false });
        expect(got).toEqual(['closing', null]);
        error(new Error('x'));
        expect(captureError).toHaveBeenCalledWith(expect.any(Error), { context: 'subscribeSurveyStatus', surveyId: 'sv1' });
    });

    it('subscribeSurveyScans·subscribeSubmissions — 기관·회차로 거르고 목록을 넘기며, 오류는 보고 뒤 화면에 알린다', () => {
        for (const subscribe of [subscribeSurveyScans, subscribeSubmissions]) {
            const onChange = vi.fn();
            const onError = vi.fn();
            subscribe('org-A', 'sv1', onChange as never, onError);
            expect(lastWheres()).toEqual(expect.arrayContaining([
                { f: 'organizationId', op: '==', v: 'org-A' }, { f: 'surveyId', op: '==', v: 'sv1' },
            ]));
            const { next, error } = lastSnapshot();
            next(docsOf([{ id: 'a' }, { id: 'b' }]));
            expect(onChange).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]);
            error(new Error('offline'));
            expect(onError).toHaveBeenCalledTimes(1);
        }
        expect(captureError).toHaveBeenCalledTimes(2);
    });

    it("subscribeSubmission — 회차__공간 문서를 보고, 이 기기에서 아직 안 보낸 제출이면 '보내는 중'(pending)을 넘긴다", () => {
        const got: unknown[] = [];
        subscribeSubmission('sv1', 'sp-1', (sub, pending) => got.push([sub, pending]));
        const { next, args } = lastSnapshot();
        expect((args[0] as { path: string }).path).toBe('surveySubmissions/sv1__sp-1');
        expect(args[1]).toEqual({ includeMetadataChanges: true });
        next({ exists: () => true, data: () => ({ state: 'submitted' }), metadata: { hasPendingWrites: true } });
        next({ exists: () => false, metadata: { hasPendingWrites: false } });
        expect(got).toEqual([[{ state: 'submitted' }, true], [null, false]]);
    });
});

describe('스캔 고치기·지우기', () => {
    it('updateScanCondition — 메모는 200자로 자르고, 기다리지 않고 장부에 적으며, 거절되면 알린다', async () => {
        const err = new Error('rejected');
        vi.mocked(fs.updateDoc).mockReturnValueOnce(Promise.reject(err) as never);
        const onRejected = vi.fn();
        updateScanCondition('sv1__a1', 'damaged', 'x'.repeat(300), onRejected);
        const [ref, data] = vi.mocked(fs.updateDoc).mock.calls[0] as unknown as [{ path: string }, Record<string, unknown>];
        expect(ref.path).toBe('scans/sv1__a1');
        expect(data).toMatchObject({ condition: 'damaged', updatedAt: '__ts__', lastEditedByUid: 'u1' });
        expect((data.memo as string).length).toBe(200);
        expect(trackWrite).toHaveBeenCalledWith('UPDATE', 'scans', 'sv1__a1', data, expect.any(Promise), { callerAwaits: false });
        await new Promise((r) => setTimeout(r, 0));
        expect(onRejected).toHaveBeenCalledWith(err);
        expect(captureError).toHaveBeenCalledWith(err, { context: 'updateScanCondition' });
    });

    it('deleteScan — 그 스캔 문서만 지우고, 실패하면 보고 뒤 다시 던진다', async () => {
        vi.mocked(fs.deleteDoc).mockResolvedValueOnce(undefined);
        await deleteScan('sv1__a1');
        expect((vi.mocked(fs.deleteDoc).mock.calls[0][0] as unknown as { path: string }).path).toBe('scans/sv1__a1');
        const err = new Error('permission-denied');
        vi.mocked(fs.deleteDoc).mockRejectedValueOnce(err);
        await expect(deleteScan('sv1__a2')).rejects.toBe(err);
        expect(captureError).toHaveBeenCalledWith(err, { context: 'deleteScan' });
    });
});

describe('마감 시작·취소 (2026-11-24 마감 동시성)', () => {
    it("beginClosing은 '마감 중'으로, cancelClosing은 다시 '열림'으로 바꾸고 누가 했는지 남긴다", async () => {
        vi.mocked(fs.updateDoc).mockResolvedValue(undefined);
        await beginClosing('sv1');
        await cancelClosing('sv1');
        const calls = vi.mocked(fs.updateDoc).mock.calls as unknown as Array<[{ path: string }, Record<string, unknown>]>;
        expect(calls.map(([r, d]) => [r.path, d])).toEqual([
            ['surveys/sv1', { status: 'closing', lastEditedByUid: 'u1' }],
            ['surveys/sv1', { status: 'open', lastEditedByUid: 'u1' }],
        ]);
    });

    it('실패하면 보고 뒤 다시 던진다(마감 버튼이 오류를 안내한다)', async () => {
        const err = new Error('failed-precondition');
        vi.mocked(fs.updateDoc).mockRejectedValueOnce(err).mockRejectedValueOnce(err);
        await expect(beginClosing('sv1')).rejects.toBe(err);
        await expect(cancelClosing('sv1')).rejects.toBe(err);
        expect(captureError).toHaveBeenCalledWith(err, { context: 'beginClosing', surveyId: 'sv1' });
        expect(captureError).toHaveBeenCalledWith(err, { context: 'cancelClosing', surveyId: 'sv1' });
    });
});
