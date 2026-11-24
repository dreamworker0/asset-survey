/**
 * 재물 직접 등록·수정·공간 옮기기(2026-11-22~23) — 대장에 없는 재물을 화면에서 등록하거나 고친다.
 * assets.ts에서 나눴다(2026-11-24). 부르는 쪽은 './assets'에서 가져온다(그대로 다시 내보낸다).
 */
import { collection, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Asset, AssetAccounting } from '../../types/asset';
import { assetDocId, type LocationSpaceMap } from '../import/diff';
import { BATCH_SIZE } from './assetShared';

/** 화면에서 직접 고치는 재물 값 — 자산코드는 등록 때만 정한다(문서 ID라 바꾸지 않는다) */
export type ManualAssetFields = Pick<Asset,
    'name' | 'category' | 'spec' | 'acquiredAt' | 'quantity' | 'usefulLife' | 'status' | 'spaceId' | 'department' | 'usage'>;

/** 비교·이력에 쓰는 직접 수정 필드 */
export const MANUAL_EDIT_FIELDS = [
    'name', 'category', 'spec', 'acquiredAt', 'quantity', 'usefulLife', 'status', 'spaceId', 'department', 'usage',
] as const satisfies ReadonlyArray<keyof ManualAssetFields>;

/**
 * 자동 자산코드 — "올해-순번"(2026-001). 이미 있는 같은 해 코드의 가장 큰 순번 다음을 준다.
 * 기관 관리번호 체계가 있으면 사람이 직접 적는 것이 우선이고, 이것은 번호가 없는 기관을 위한 기본값이다.
 */
export function nextAssetCode(existingCodes: string[], now = new Date()): string {
    const year = now.getFullYear();
    const re = new RegExp(`^${year}-(\\d+)$`);
    let max = 0;
    for (const c of existingCodes) {
        const m = re.exec(c.trim());
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `${year}-${String(max + 1).padStart(3, '0')}`;
}

export class AssetCodeTakenError extends Error {
    constructor(code: string) {
        super(`이미 있는 자산코드: ${code}`);
        this.name = 'AssetCodeTakenError';
    }
}

/**
 * 재물 한 건 직접 등록 — 재물·금액(있으면)·이력을 한 배치로 쓴다.
 * 같은 자산코드가 이미 있으면 AssetCodeTakenError (Rules도 기존 문서를 create로 덮어쓰지 못한다).
 * @returns 재물 문서 ID
 */
export const createAssetManually = async (input: {
    orgId: string; code: string; fields: ManualAssetFields; amount: number | null;
}): Promise<string> => {
    const { orgId, fields } = input;
    const code = input.code.trim();
    const id = assetDocId(orgId, code);
    const stamp = actorStamp();
    const now = serverTimestamp();
    try {
        const existing = await getDoc(doc(db, 'assets', id));
        if (existing.exists()) throw new AssetCodeTakenError(code);
        const batch = writeBatch(db);
        batch.set(doc(db, 'assets', id), {
            organizationId: orgId, code, ...fields, acquiredQuantity: null, statusRaw: null, locationRaw: null,
            missingFromSource: false, manual: true, lastImportId: null, tagId: null,
            createdAt: now, updatedAt: now, ...stamp,
        });
        if (input.amount != null) {
            batch.set(doc(db, 'assetAccounting', id), {
                organizationId: orgId, amount: input.amount, depreciation: null, residual: null, updatedAt: now, ...stamp,
            });
        }
        batch.set(doc(collection(db, 'history')), {
            organizationId: orgId, assetId: id, code, type: 'manual-create', changes: {}, importId: null, at: now, ...stamp,
        });
        await batch.commit();
        return id;
    } catch (error) {
        if (!(error instanceof AssetCodeTakenError)) captureError(error, { context: 'createAssetManually', orgId });
        throw error;
    }
};

/**
 * 재물 직접 수정 — 바뀐 값만 쓰고 전·후 값을 이력에 남긴다. 바뀐 것이 없으면 아무것도 쓰지 않는다.
 * 금액은 자산금액만 고친다(감가상각·잔존가액은 대장 값 그대로 둔다).
 * @returns 바뀐 필드 수
 */
export const updateAssetManually = async (input: {
    asset: Asset; fields: ManualAssetFields; amount: number | null; accounting: AssetAccounting | null;
}): Promise<number> => {
    const { asset, fields } = input;
    const stamp = actorStamp();
    const now = serverTimestamp();
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const assetPatch: Record<string, unknown> = {};
    for (const f of MANUAL_EDIT_FIELDS) {
        const before = asset[f] ?? null;
        const after = fields[f] ?? null;
        if (before !== after) { changes[f] = { before, after }; assetPatch[f] = after; }
    }
    const amountBefore = input.accounting?.amount ?? null;
    const amountChanged = amountBefore !== input.amount;
    if (amountChanged) changes.amount = { before: amountBefore, after: input.amount };
    const count = Object.keys(changes).length;
    if (count === 0) return 0;
    try {
        const batch = writeBatch(db);
        if (Object.keys(assetPatch).length > 0) {
            batch.update(doc(db, 'assets', asset.id), { ...assetPatch, updatedAt: now, ...stamp });
        }
        if (amountChanged) {
            // 금액 문서가 아직 없을 수 있어 전체를 set으로 쓴다
            batch.set(doc(db, 'assetAccounting', asset.id), {
                organizationId: asset.organizationId, amount: input.amount,
                depreciation: input.accounting?.depreciation ?? null, residual: input.accounting?.residual ?? null,
                updatedAt: now, ...stamp,
            });
        }
        batch.set(doc(collection(db, 'history')), {
            organizationId: asset.organizationId, assetId: asset.id, code: asset.code, type: 'manual-edit',
            changes, importId: null, at: now, ...stamp,
        });
        await batch.commit();
        return count;
    } catch (error) {
        captureError(error, { context: 'updateAssetManually', assetId: asset.id });
        throw error;
    }
};

/**
 * 여러 재물을 한 공간으로 옮긴다(2026-11-23) — 재물 목록의 '공간 옮기기'와 '공간 미지정 정리'가 쓴다.
 * 재물마다 바뀐 공간을 변경 이력(manual-edit)에 남긴다. 이미 그 공간인 재물은 건너뛴다.
 * locationLinks가 있으면 기관의 '대장 위치 → 공간' 연결에 더한다 — 다음에 대장을 다시 가져와도
 * 같은 위치가 그 공간으로 들어가 이번 정리가 되돌아가지 않게.
 * @returns 실제로 옮긴 재물 수
 */
export const moveAssetsToSpace = async (input: {
    orgId: string;
    assets: Asset[];
    spaceId: string | null;
    locationLinks?: LocationSpaceMap;
    onProgress?: (done: number, total: number) => void;
}): Promise<number> => {
    const { orgId, spaceId } = input;
    const moving = input.assets.filter((a) => (a.spaceId ?? null) !== spaceId);
    const stamp = actorStamp();
    const now = serverTimestamp();
    try {
        // 재물 1건 = 쓰기 2번(재물·이력)이라 200건씩
        const per = Math.floor(BATCH_SIZE / 2);
        for (let i = 0; i < moving.length; i += per) {
            const batch = writeBatch(db);
            for (const a of moving.slice(i, i + per)) {
                batch.update(doc(db, 'assets', a.id), { spaceId, updatedAt: now, ...stamp });
                batch.set(doc(collection(db, 'history')), {
                    organizationId: orgId, assetId: a.id, code: a.code, type: 'manual-edit',
                    changes: { spaceId: { before: a.spaceId ?? null, after: spaceId } }, importId: null, at: now, ...stamp,
                });
            }
            await batch.commit();
            input.onProgress?.(Math.min(moving.length, i + per), moving.length);
        }
        if (input.locationLinks && Object.keys(input.locationLinks).length > 0) {
            const orgRef = doc(db, 'organizations', orgId);
            const current = ((await getDoc(orgRef)).data()?.locationSpaceMap ?? {}) as LocationSpaceMap;
            const batch = writeBatch(db);
            batch.update(orgRef, { locationSpaceMap: { ...current, ...input.locationLinks } });
            await batch.commit();
        }
        return moving.length;
    } catch (error) {
        captureError(error, { context: 'moveAssetsToSpace', orgId, count: moving.length });
        throw error;
    }
};
