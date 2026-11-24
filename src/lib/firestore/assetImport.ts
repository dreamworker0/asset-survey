/**
 * 재물 가져오기 확정 — 대장 비교 결과(신규·바뀜·사라짐)를 재물·금액·이력 문서로 저장하고 가져오기 기록을 남긴다.
 * assets.ts에서 나눴다(2026-11-24). 부르는 쪽은 './assets'에서 가져온다(그대로 다시 내보낸다).
 */
import {
    collection, doc, query, where, getDoc, getDocs, writeBatch, serverTimestamp, orderBy, limit,
    type DocumentReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { ImportRecord } from '../../types/asset';
import type { ImportDiff, LocationSpaceMap } from '../import/diff';
import type { ColumnMap } from '../import/columns';
import type { ParseResult } from '../import/parseSheet';
import { importConverter, BATCH_SIZE } from './assetShared';

/** 최근 가져오기 기록 */
export const getRecentImports = async (orgId: string, max = 5): Promise<ImportRecord[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'imports').withConverter(importConverter),
            where('organizationId', '==', orgId),
            orderBy('confirmedAt', 'desc'),
            limit(max),
        ));
        return snap.docs.map((d) => d.data() as ImportRecord);
    } catch (error) {
        captureError(error, { context: 'getRecentImports', orgId });
        throw error;
    }
};

export interface CommitImportInput {
    orgId: string;
    fileName: string;
    sheetName: string;
    columnMap: ColumnMap;
    locationMap: LocationSpaceMap;
    parsed: ParseResult;
    diff: ImportDiff;
    /** 대장 합계 줄 금액(있으면) */
    reportedTotal: number | null;
    /**
     * 가져오기 기록 ID — 멈춘 가져오기를 다시 확정할 때 처음 ID를 넘긴다(2026-11-24). 두 번에 나눠 저장된 재물·이력이
     * 같은 기록을 가리키게 한다. 없으면 새로 만든다.
     */
    importId?: string;
    /**
     * 기록에 남길 비교 건수 — 다시 확정할 때는 남은 것만 비교되므로 처음 확정한 건수를 넘긴다. 없으면 `diff`의 건수.
     */
    recordDiff?: ImportDiffCounts;
    onProgress?: (done: number, total: number) => void;
}

/** 가져오기 기록의 비교 건수 */
export interface ImportDiffCounts { added: number; changed: number; missing: number; unchanged: number }

/** 가져오기 기록 ID를 미리 정한다(다시 확정할 때 같은 ID를 쓰려고) */
export const newImportId = (): string => doc(collection(db, 'imports')).id;

/**
 * 가져오기 기록이 이미 있는가 — 마지막 배치가 서버에 저장됐는데 응답만 못 받은 경우를 가린다.
 * 기록은 수정이 막혀 있어(Rules) 같은 ID로 다시 쓰면 거부되므로, 있으면 다시 쓰지 않는다.
 */
export const importRecordExists = async (importId: string): Promise<boolean> => {
    try {
        return (await getDoc(doc(db, 'imports', importId))).exists();
    } catch (error) {
        captureError(error, { context: 'importRecordExists', importId });
        throw error;
    }
};

type Op = { ref: DocumentReference; kind: 'set' | 'update'; data: Record<string, unknown> };

/**
 * 가져오기 확정 — 신규·바뀜·사라짐을 저장하고 가져오기 기록을 남긴다.
 *
 * 400건씩 나눠 배치로 쓴다. 중간 배치가 실패해도 **다시 확정하면 이어진다** — 문서 ID가
 * 자산코드로 정해져 있어 이미 쓴 재물은 '그대로'로 비교되기 때문이다. 가져오기 기록과 열·위치
 * 연결은 마지막 배치에 넣어, 기록이 있으면 전부 저장됐다는 뜻이 되게 한다.
 *
 * 한 재물의 재물·금액·이력 문서는 **같은 배치**에 넣는다(2026-11-24) — 나뉘면 멈춘 뒤 다시 비교할 때
 * 방금 새로 넣은 재물이 '금액 바뀜'으로 잡혀 이력이 하나 더 생겼다. 다시 확정할 때는 처음 기록 ID(`importId`)와
 * 처음 건수(`recordDiff`)를 넘겨, 두 번에 걸쳐 쓴 재물·이력·기록이 한 가져오기로 이어지게 한다.
 *
 * @returns 가져오기 기록 ID
 */
export const commitImport = async (input: CommitImportInput): Promise<string> => {
    const { orgId, diff, parsed } = input;
    const stamp = actorStamp();
    const importRef = input.importId ? doc(db, 'imports', input.importId) : doc(collection(db, 'imports'));
    const now = serverTimestamp();
    // 재물 하나에 딸린 문서 묶음 — 묶음은 배치 사이로 나누지 않는다
    const groups: Op[][] = [];
    let ops: Op[] = [];
    const endGroup = () => { if (ops.length > 0) groups.push(ops); ops = []; };

    const assetRef = (id: string) => doc(db, 'assets', id);
    const accRef = (id: string) => doc(db, 'assetAccounting', id);
    const historyOp = (assetId: string, code: string, type: 'import-change' | 'import-missing', changes: Record<string, unknown>) =>
        ops.push({ ref: doc(collection(db, 'history')), kind: 'set', data: {
            organizationId: orgId, assetId, code, type, changes, importId: importRef.id, at: now, ...stamp,
        } });

    for (const d of diff.added) {
        endGroup();
        ops.push({ ref: assetRef(d.id), kind: 'set', data: {
            organizationId: orgId, ...d.fields, missingFromSource: false, lastImportId: importRef.id,
            createdAt: now, updatedAt: now, ...stamp,
        } });
        if (d.accounting.amount != null || d.accounting.depreciation != null || d.accounting.residual != null) {
            ops.push({ ref: accRef(d.id), kind: 'set', data: { organizationId: orgId, ...d.accounting, updatedAt: now, ...stamp } });
        }
    }
    for (const c of diff.changed) {
        endGroup();
        if (c.assetChanged) {
            // 직접 등록한 재물이 대장에 나타났으면 이제 대장이 관리한다(manual: false)
            ops.push({ ref: assetRef(c.draft.id), kind: 'update', data: {
                ...c.draft.fields, missingFromSource: false, manual: false, lastImportId: importRef.id, updatedAt: now, ...stamp,
            } });
        }
        if (c.accountingChanged) {
            // 금액 문서가 아직 없을 수 있어 전체를 set으로 쓴다
            ops.push({ ref: accRef(c.draft.id), kind: 'set', data: { organizationId: orgId, ...c.draft.accounting, updatedAt: now, ...stamp } });
        }
        historyOp(c.draft.id, c.draft.fields.code, 'import-change', c.changes);
    }
    for (const a of diff.missing) {
        endGroup();
        ops.push({ ref: assetRef(a.id), kind: 'update', data: { missingFromSource: true, lastImportId: importRef.id, updatedAt: now, ...stamp } });
        historyOp(a.id, a.code, 'import-missing', { missingFromSource: { before: false, after: true } });
    }
    endGroup();

    const columnMap = Object.fromEntries(Object.entries(input.columnMap).filter(([, v]) => !!v)) as Record<string, string>;
    const finalOps: Op[] = [
        { ref: doc(db, 'organizations', orgId), kind: 'update', data: { importColumnMap: columnMap, locationSpaceMap: input.locationMap } },
        { ref: importRef, kind: 'set', data: {
            organizationId: orgId, fileName: input.fileName, sheetName: input.sheetName, columnMap,
            counts: parsed.counts,
            diff: input.recordDiff ?? { added: diff.added.length, changed: diff.changed.length, missing: diff.missing.length, unchanged: diff.unchanged },
            amountTotal: parsed.amountTotals.all,
            reportedTotal: input.reportedTotal,
            confirmedAt: now,
            lastEditedByUid: stamp.lastEditedByUid ?? '',
        } },
    ];

    const chunks: Op[][] = [];
    for (const g of groups) {
        const last = chunks[chunks.length - 1];
        if (last && last.length + g.length <= BATCH_SIZE) last.push(...g);
        else chunks.push([...g]);
    }
    // 마지막 배치에 기록을 붙인다 (자리가 없으면 따로 한 배치)
    if (chunks.length > 0 && chunks[chunks.length - 1].length + finalOps.length <= BATCH_SIZE) chunks[chunks.length - 1].push(...finalOps);
    else chunks.push(finalOps);

    const total = groups.reduce((n, g) => n + g.length, 0);
    let done = 0;
    try {
        for (const chunk of chunks) {
            const batch = writeBatch(db);
            for (const op of chunk) {
                if (op.kind === 'set') batch.set(op.ref, op.data);
                else batch.update(op.ref, op.data);
            }
            await batch.commit();
            done = Math.min(total, done + chunk.length);
            input.onProgress?.(done, total);
        }
        return importRef.id;
    } catch (error) {
        captureError(error, { context: 'commitImport', orgId, done, total });
        throw error;
    }
};
