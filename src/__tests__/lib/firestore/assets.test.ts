/**
 * firestore/assets — 가져오기 확정(commitImport)과 조회 (기획서 F04~F07)
 *
 * 고정하는 계약:
 *   - 신규는 재물 + (금액이 있으면) 금액 문서를 만들고, 바뀜은 바뀐 쪽만 쓰고 이력을 남긴다
 *   - 사라진 재물은 지우지 않고 missingFromSource만 켠다
 *   - 가져오기 기록·열/위치 연결은 마지막 배치에 들어간다(기록이 있으면 전부 저장됐다는 뜻)
 *   - 400건씩 나눠 커밋하고 진행을 알린다
 *   - 조회는 organizationId로 거른다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeRef = (label: string) => {
    const ref: { label: string; id: string; withConverter: (...a: unknown[]) => unknown } = {
        label, id: label.split('/').pop() || 'auto', withConverter: () => ref,
    };
    return ref;
};
let autoId = 0;
const batches: Array<{ ops: Array<{ kind: string; label: string; data: Record<string, unknown> }> }> = [];

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, path: string) => makeRef(`col:${path}`)),
    doc: vi.fn((first: unknown, path?: string, id?: string) => {
        // doc(collectionRef) → 자동 ID
        if (first && typeof first === 'object' && 'label' in (first as object) && path === undefined) {
            autoId++;
            return makeRef(`${(first as { label: string }).label.replace('col:', 'doc:')}/auto${autoId}`);
        }
        return makeRef(`doc:${path}/${id ?? ''}`);
    }),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn(), limit: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    getCountFromServer: vi.fn(),
    writeBatch: vi.fn(() => {
        const b = { ops: [] as Array<{ kind: string; label: string; data: Record<string, unknown> }> };
        batches.push(b);
        return {
            set: (ref: { label: string }, data: Record<string, unknown>) => b.ops.push({ kind: 'set', label: ref.label, data }),
            update: (ref: { label: string }, data: Record<string, unknown>) => b.ops.push({ kind: 'update', label: ref.label, data }),
            commit: vi.fn().mockResolvedValue(undefined),
        };
    }),
    serverTimestamp: vi.fn(() => '__ts__'),
    Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-1' } } }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import * as fs from 'firebase/firestore';
import {
    commitImport, getAssets, getAssetCounts, issueTags, findAssetByTag, getAssetsBySpaces, getAssetHistory,
    createAssetManually, updateAssetManually, nextAssetCode, AssetCodeTakenError, moveAssetsToSpace,
    clearAssetSnapshots, ASSET_FULL_REFRESH_MS,
} from '../../../lib/firestore/assets';
import { diffAssets } from '../../../lib/import/diff';
import type { ParsedAsset, ParseResult } from '../../../lib/import/parseSheet';
import type { Asset } from '../../../types/asset';

const row = (code: string, over: Partial<ParsedAsset> = {}): ParsedAsset => ({
    rowNumber: 4, code, name: 'TV', category: null, spec: null, acquiredAt: null, acquiredQuantity: null, quantity: 1, usefulLife: null,
    status: 'active', statusRaw: null, location: '101호', department: null, usage: null,
    amount: 1000, depreciation: null, residual: null, ...over,
});
const parsedOf = (rows: ParsedAsset[]): ParseResult => ({
    assets: rows, blankRows: 0, noCodeRows: [], totalRows: [], duplicates: [], problems: [],
    counts: { total: rows.length, active: rows.length, inactive: 0, disposed: 0 },
    amountTotals: { all: rows.reduce((n, r) => n + (r.amount ?? 0), 0), active: 0 },
});

beforeEach(() => {
    vi.clearAllMocks();
    clearAssetSnapshots();
    batches.length = 0;
    autoId = 0;
});

describe('commitImport', () => {
    it('신규·바뀜·사라짐을 쓰고 마지막 배치에 기록과 연결을 넣는다', async () => {
        const existing: Asset[] = [
            { id: 'org-A__keep', organizationId: 'org-A', code: 'keep', name: '옛 이름', category: null, spec: null, acquiredAt: null,
                acquiredQuantity: null, quantity: 1, status: 'active', statusRaw: null, locationRaw: '101호', spaceId: 'sp1',
                department: null, usage: null, missingFromSource: false, manual: false, lastImportId: 'old', tagId: null },
            { id: 'org-A__gone', organizationId: 'org-A', code: 'gone', name: 'x', category: null, spec: null, acquiredAt: null,
                acquiredQuantity: null, quantity: 1, status: 'active', statusRaw: null, locationRaw: '101호', spaceId: 'sp1',
                department: null, usage: null, missingFromSource: false, manual: false, lastImportId: 'old', tagId: null },
        ];
        const rows = [row('new', { amount: null }), row('keep', { name: '새 이름' })];
        const diff = diffAssets('org-A', rows, { '101호': 'sp1' }, existing,
            new Map([['org-A__keep', { id: 'org-A__keep', organizationId: 'org-A', amount: 1000, depreciation: null, residual: null }]]));
        const onProgress = vi.fn();

        const id = await commitImport({
            orgId: 'org-A', fileName: '대장.xlsx', sheetName: '시트1', columnMap: { code: '자산코드', name: '' },
            locationMap: { '101호': 'sp1' }, parsed: parsedOf(rows), diff, reportedTotal: 2000, onProgress,
        });

        expect(batches).toHaveLength(1);
        const ops = batches[0].ops;
        const labels = ops.map((o) => `${o.kind} ${o.label.replace(/auto\d+/, 'auto')}`);
        expect(labels).toEqual([
            'set doc:assets/org-A__new',                 // 신규 — 금액이 없으면 금액 문서는 만들지 않는다
            'update doc:assets/org-A__keep',             // 바뀜
            'set doc:history/auto',
            'update doc:assets/org-A__gone',             // 사라짐 — 지우지 않고 표시
            'set doc:history/auto',
            'update doc:organizations/org-A',            // 마지막: 연결 저장
            'set doc:imports/auto',                      // 마지막: 기록
        ]);
        expect(ops[0].data).toMatchObject({ organizationId: 'org-A', code: 'new', missingFromSource: false, lastEditedByUid: 'admin-1', createdAt: '__ts__' });
        expect(ops[1].data).toMatchObject({ name: '새 이름', missingFromSource: false, manual: false, lastImportId: id });
        expect(ops[2].data).toMatchObject({ type: 'import-change', code: 'keep', changes: { name: { before: '옛 이름', after: '새 이름' } } });
        expect(ops[3].data).toEqual({ missingFromSource: true, lastImportId: id, updatedAt: '__ts__', lastEditedByUid: 'admin-1' });
        expect(ops[5].data).toEqual({ importColumnMap: { code: '자산코드' }, locationSpaceMap: { '101호': 'sp1' } });
        expect(ops[6].data).toMatchObject({
            fileName: '대장.xlsx', diff: { added: 1, changed: 1, missing: 1, unchanged: 0 }, reportedTotal: 2000, lastEditedByUid: 'admin-1',
        });
        expect(onProgress).toHaveBeenLastCalledWith(5, 5);
    });

    it('400건이 넘으면 나눠 커밋하고, 기록은 마지막 배치에 붙인다', async () => {
        const rows = Array.from({ length: 450 }, (_, i) => row(`c${i}`, { amount: null }));
        const diff = diffAssets('org-A', rows, {}, [], new Map());
        await commitImport({
            orgId: 'org-A', fileName: 'f', sheetName: 's', columnMap: {}, locationMap: {}, parsed: parsedOf(rows), diff, reportedTotal: null,
        });
        expect(batches.map((b) => b.ops.length)).toEqual([400, 52]);
        expect(batches[1].ops[batches[1].ops.length - 1].label).toMatch(/^doc:imports\//);
    });

    it('한 재물의 재물·금액·이력은 같은 배치에 넣는다 — 멈춘 뒤 다시 비교할 때 반쪽 저장이 없게(2026-11-24)', async () => {
        // 바뀜 1건 = 재물·금액·이력 3문서. 134건이면 402문서라, 400에서 자르면 마지막 재물이 갈라진다
        const n = 134;
        const existing = Array.from({ length: n }, (_, i) => ({
            id: `org-A__c${i}`, organizationId: 'org-A', code: `c${i}`, name: '옛 이름', category: null, spec: null, acquiredAt: null,
            acquiredQuantity: null, quantity: 1, status: 'active', statusRaw: null, locationRaw: '101호', spaceId: null,
            department: null, usage: null, missingFromSource: false, manual: false, lastImportId: 'old', tagId: null,
        })) as Asset[];
        const rows = existing.map((a) => row(a.code, { name: '새 이름', amount: 2000 }));
        const diff = diffAssets('org-A', rows, {}, existing, new Map());
        expect(diff.changed).toHaveLength(n);
        await commitImport({
            orgId: 'org-A', fileName: 'f', sheetName: 's', columnMap: {}, locationMap: {}, parsed: parsedOf(rows), diff, reportedTotal: null,
        });
        expect(batches.map((b) => b.ops.length)).toEqual([399, 5]);
        for (const b of batches) {
            const assets = b.ops.filter((o) => o.label.startsWith('doc:assets/')).length;
            const accounting = b.ops.filter((o) => o.label.startsWith('doc:assetAccounting/')).length;
            const history = b.ops.filter((o) => o.label.startsWith('doc:history/')).length;
            expect(accounting).toBe(assets);
            expect(history).toBe(assets);
        }
    });

    it('다시 확정할 때는 처음 기록 ID와 처음 건수로 기록을 남긴다 — 두 번에 나눠 쓴 재물·이력이 한 기록을 가리킨다', async () => {
        const rows = [row('a')];
        const diff = diffAssets('org-A', rows, {}, [], new Map());
        const id = await commitImport({
            orgId: 'org-A', fileName: 'f', sheetName: 's', columnMap: {}, locationMap: {}, parsed: parsedOf(rows), diff, reportedTotal: null,
            importId: 'imp-first', recordDiff: { added: 5, changed: 0, missing: 0, unchanged: 0 },
        });
        expect(id).toBe('imp-first');
        const ops = batches[0].ops;
        expect(ops[0].data).toMatchObject({ lastImportId: 'imp-first' });
        const record = ops.find((o) => o.label.startsWith('doc:imports/'))!;
        expect(record.label).toBe('doc:imports/imp-first');
        expect(record.data).toMatchObject({ diff: { added: 5, changed: 0, missing: 0, unchanged: 0 } });
    });

    it('커밋이 실패하면 보고한 뒤 다시 던진다', async () => {
        vi.mocked(fs.writeBatch).mockImplementationOnce(() => ({
            set: vi.fn(), update: vi.fn(), commit: vi.fn().mockRejectedValue(new Error('denied')),
        }) as never);
        const rows = [row('a')];
        await expect(commitImport({
            orgId: 'org-A', fileName: 'f', sheetName: 's', columnMap: {}, locationMap: {}, parsed: parsedOf(rows),
            diff: diffAssets('org-A', rows, {}, [], new Map()), reportedTotal: null,
        })).rejects.toThrow('denied');
    });
});

describe('조회', () => {
    it('getAssets는 organizationId로 거른다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue({ docs: [] } as never);
        await getAssets('org-A');
        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org-A');
    });

    it('getAssets는 두 번째부터 바뀐 재물만 읽어 기억한 목록에 더한다(2026-11-23)', async () => {
        const at = (ms: number) => ({ toMillis: () => ms });
        const snapOf = (list: Array<Record<string, unknown>>) => ({ docs: list.map((a) => ({ data: () => a })) });
        vi.mocked(fs.getDocs)
            .mockResolvedValueOnce(snapOf([
                { id: 'org-A__2', code: '2', name: '냉장고', updatedAt: at(5_000_000) },
                { id: 'org-A__1', code: '1', name: 'TV', updatedAt: at(4_000_000) },
            ]) as never)
            .mockResolvedValueOnce(snapOf([
                { id: 'org-A__1', code: '1', name: 'TV(고침)', updatedAt: at(6_000_000) },
                { id: 'org-A__3', code: '3', name: '책상', updatedAt: at(6_000_000) },
            ]) as never);

        const first = await getAssets('org-A');
        expect(first.map((a) => a.id)).toEqual(['org-A__1', 'org-A__2']);

        const second = await getAssets('org-A');
        // 두 번째는 마지막으로 본 시각(5,000,000)에서 2분 겹쳐 그 뒤에 바뀐 것만 묻는다
        expect(fs.where).toHaveBeenCalledWith('updatedAt', '>=', { ms: 5_000_000 - 120_000 });
        expect(second.map((a) => [a.id, a.name])).toEqual([['org-A__1', 'TV(고침)'], ['org-A__2', '냉장고'], ['org-A__3', '책상']]);
        expect(fs.getDocs).toHaveBeenCalledTimes(2);
    });

    it('getAssets: 동시에 부르면 한 번만 읽고, 바뀐 것만 읽기가 실패하거나 30분이 지나면 전부 다시 읽는다', async () => {
        const snapOf = (n: number) => ({ docs: Array.from({ length: n }, (_, i) => ({ data: () => ({ id: `org-A__${i}`, code: String(i), updatedAt: { toMillis: () => 1000 } }) })) });
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf(2) as never);
        const [a, b] = await Promise.all([getAssets('org-A'), getAssets('org-A')]);
        expect(a).toHaveLength(2);
        expect(b).toHaveLength(2);
        expect(fs.getDocs).toHaveBeenCalledTimes(1);

        // 바뀐 것만 읽기가 실패(인덱스 생성 중 등) → 전부 읽기로 돌아간다
        vi.mocked(fs.getDocs).mockRejectedValueOnce(new Error('index building')).mockResolvedValueOnce(snapOf(3) as never);
        expect(await getAssets('org-A')).toHaveLength(3);

        // 30분이 지나면 전부 다시 읽는다(조건에 updatedAt이 없다)
        const now = Date.now();
        const spy = vi.spyOn(Date, 'now').mockReturnValue(now + ASSET_FULL_REFRESH_MS + 1);
        vi.mocked(fs.where).mockClear();
        vi.mocked(fs.getDocs).mockResolvedValueOnce(snapOf(1) as never);
        expect(await getAssets('org-A')).toHaveLength(1);
        expect(vi.mocked(fs.where).mock.calls.some((c) => c[0] === 'updatedAt')).toBe(false);
        spy.mockRestore();
    });

    it('getAssetCounts는 상태별로 센다', async () => {
        vi.mocked(fs.getCountFromServer)
            .mockResolvedValueOnce({ data: () => ({ count: 10 }) } as never)
            .mockResolvedValueOnce({ data: () => ({ count: 2 }) } as never)
            .mockResolvedValueOnce({ data: () => ({ count: 3 }) } as never);
        expect(await getAssetCounts('org-A')).toEqual({ active: 10, inactive: 2, disposed: 3 });
        expect(fs.where).toHaveBeenCalledWith('status', '==', 'inactive');
    });
});

describe('라벨 태그 (기획서 F09)', () => {
    it('issueTags는 태그 없는 재물에만 발급하고 있던 태그는 그대로 돌려준다', async () => {
        const onProgress = vi.fn();
        const tags = await issueTags([{ id: 'org-A__a', tagId: 'ABCDEFGH23' }, { id: 'org-A__b', tagId: null }], onProgress);

        expect(tags.get('org-A__a')).toBe('ABCDEFGH23');
        expect(tags.get('org-A__b')).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
        expect(batches).toHaveLength(1);
        expect(batches[0].ops).toEqual([{
            kind: 'update', label: 'doc:assets/org-A__b',
            data: { tagId: tags.get('org-A__b'), updatedAt: '__ts__', lastEditedByUid: 'admin-1' },
        }]);
        expect(onProgress).toHaveBeenLastCalledWith(1, 1);
    });

    it('모두 태그가 있으면 아무것도 쓰지 않는다', async () => {
        await issueTags([{ id: 'x', tagId: 'ABCDEFGH23' }]);
        expect(batches).toHaveLength(0);
    });

    it('400건이 넘으면 나눠 쓴다', async () => {
        const list = Array.from({ length: 450 }, (_, i) => ({ id: `org-A__${i}`, tagId: null }));
        const tags = await issueTags(list);
        expect(batches.map((b) => b.ops.length)).toEqual([400, 50]);
        expect(new Set(tags.values()).size).toBe(450);
    });

    it('findAssetByTag는 내 기관 안에서만 찾는다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue({ empty: true, docs: [] } as never);
        expect(await findAssetByTag('org-A', 'ABCDEFGH23')).toBeNull();
        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org-A');
        expect(fs.where).toHaveBeenCalledWith('tagId', '==', 'ABCDEFGH23');
    });
});

describe('직원 목록·재물 이력', () => {
    it('getAssetsBySpaces는 공간 30개씩 나눠 묻고 기관으로 거른다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue({ docs: [] } as never);
        const ids = Array.from({ length: 35 }, (_, i) => `sp${i}`);
        await getAssetsBySpaces('org-A', ids);
        expect(fs.getDocs).toHaveBeenCalledTimes(2);
        expect(fs.where).toHaveBeenCalledWith('spaceId', 'in', ids.slice(0, 30));
        expect(fs.where).toHaveBeenCalledWith('spaceId', 'in', ids.slice(30));
        expect(vi.mocked(fs.where).mock.calls.filter((c) => c[0] === 'organizationId')).toHaveLength(2);
    });

    it('담당 공간이 없으면 묻지 않는다', async () => {
        expect(await getAssetsBySpaces('org-A', [])).toEqual([]);
        expect(fs.getDocs).not.toHaveBeenCalled();
    });

    it('getAssetHistory는 기관·재물로 거른다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue({ docs: [] } as never);
        await getAssetHistory('org-A', 'org-A__1');
        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org-A');
        expect(fs.where).toHaveBeenCalledWith('assetId', '==', 'org-A__1');
    });
});

describe('재물 직접 등록·수정 (2026-11-22)', () => {
    const fields = {
        name: '책상', category: '집기', spec: null, acquiredAt: '2024-03-15', quantity: 1, status: 'active' as const,
        spaceId: 'sp1', department: null, usage: null,
    };

    it('자동 번호는 올해-순번, 같은 해 가장 큰 번호 다음', () => {
        const now = new Date(2026, 10, 22);
        expect(nextAssetCode([], now)).toBe('2026-001');
        expect(nextAssetCode(['2026-009', '2026-010', '2025-500', 'A-1'], now)).toBe('2026-011');
    });

    it('등록은 재물(manual)·금액·이력을 한 배치로 쓴다', async () => {
        vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => false } as never);
        const id = await createAssetManually({ orgId: 'org-A', code: ' 2026-001 ', fields, amount: 250000 });
        expect(id).toBe('org-A__2026-001');
        const ops = batches[0].ops;
        expect(ops.map((o) => o.label)).toEqual(['doc:assets/org-A__2026-001', 'doc:assetAccounting/org-A__2026-001', 'doc:history/auto1']);
        expect(ops[0].data).toMatchObject({ code: '2026-001', name: '책상', manual: true, missingFromSource: false, tagId: null, lastEditedByUid: 'admin-1' });
        expect(ops[1].data).toMatchObject({ amount: 250000 });
        expect(ops[2].data).toMatchObject({ type: 'manual-create', importId: null });
    });

    it('같은 자산코드가 있으면 쓰지 않고 AssetCodeTakenError', async () => {
        vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => true } as never);
        await expect(createAssetManually({ orgId: 'org-A', code: 'X', fields, amount: null })).rejects.toBeInstanceOf(AssetCodeTakenError);
        expect(batches).toHaveLength(0);
    });

    it('수정은 바뀐 값만 쓰고 전·후 값을 이력에 남긴다, 바뀐 게 없으면 쓰지 않는다', async () => {
        const asset = {
            id: 'org-A__1', organizationId: 'org-A', code: '1', ...fields, acquiredQuantity: null, statusRaw: null, locationRaw: null,
            missingFromSource: false, manual: true, lastImportId: null, tagId: null,
        };
        expect(await updateAssetManually({ asset, fields, amount: null, accounting: null })).toBe(0);
        expect(batches).toHaveLength(0);

        const n = await updateAssetManually({ asset, fields: { ...fields, name: '큰 책상' }, amount: 300000, accounting: null });
        expect(n).toBe(2);
        const ops = batches[0].ops;
        expect(ops[0]).toMatchObject({ kind: 'update', label: 'doc:assets/org-A__1', data: { name: '큰 책상' } });
        expect(ops[1]).toMatchObject({ kind: 'set', label: 'doc:assetAccounting/org-A__1', data: { amount: 300000 } });
        expect(ops[2].data).toMatchObject({ type: 'manual-edit', changes: { name: { before: '책상', after: '큰 책상' }, amount: { before: null, after: 300000 } } });
    });
});

describe('재물 공간 옮기기 (2026-11-23)', () => {
    const a = (id: string, spaceId: string | null) => ({
        id: `org-A__${id}`, organizationId: 'org-A', code: id, name: 'TV', category: null, spec: null, acquiredAt: null,
        acquiredQuantity: null, quantity: 1, status: 'active' as const, statusRaw: null, locationRaw: '창고', spaceId,
        department: null, usage: null, missingFromSource: false, manual: false, lastImportId: null, tagId: null,
    });

    it('이미 그 공간인 재물은 건너뛰고, 재물마다 공간과 변경 이력을 함께 쓴다', async () => {
        batches.length = 0;
        const n = await moveAssetsToSpace({ orgId: 'org-A', assets: [a('1', null), a('2', 'sp1'), a('3', 'sp2')], spaceId: 'sp1' });
        expect(n).toBe(2);
        const ops = batches.flatMap((b) => b.ops);
        expect(ops.filter((o) => o.kind === 'update').map((o) => o.label)).toEqual(['doc:assets/org-A__1', 'doc:assets/org-A__3']);
        expect(ops.filter((o) => o.kind === 'update')[0].data).toMatchObject({ spaceId: 'sp1', updatedAt: '__ts__' });
        const hist = ops.filter((o) => o.kind === 'set');
        expect(hist).toHaveLength(2);
        expect(hist[1].data).toMatchObject({ type: 'manual-edit', importId: null, code: '3', changes: { spaceId: { before: 'sp2', after: 'sp1' } } });
    });

    it('위치 연결을 주면 기관의 위치→공간 연결에 더한다(있던 연결은 남긴다)', async () => {
        batches.length = 0;
        vi.mocked(fs.getDoc).mockResolvedValueOnce({ data: () => ({ locationSpaceMap: { '101호': 'sp9' } }) } as never);
        await moveAssetsToSpace({ orgId: 'org-A', assets: [a('1', null)], spaceId: 'sp1', locationLinks: { '창고': 'sp1' } });
        const orgOp = batches.flatMap((b) => b.ops).find((o) => o.label === 'doc:organizations/org-A');
        expect(orgOp?.data).toEqual({ locationSpaceMap: { '101호': 'sp9', '창고': 'sp1' } });
    });
});
