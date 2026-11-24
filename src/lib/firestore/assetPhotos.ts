/**
 * 재물 사진 (2026-11-22) — 재물마다 대표 사진 한 장
 *
 * - 저장 위치: Storage `organizations/{기관}/assets/{재물 문서 ID}/` — 기관 해지 파기가 이 접두사를 통째로 지운다
 *   (functions purgeOrganizationData의 storagePrefix).
 * - 올리기 전에 브라우저에서 줄인다: 사진(긴 변 1280px, JPEG)과 목록용 작은 사진(긴 변 320px).
 *   휴대폰 원본(3~8MB)을 그대로 올리면 저장·내려받기 비용이 커지고 목록이 느려진다.
 * - 재물 문서에 내려받기 주소와 저장 경로를 함께 둔다 — 목록이 사진마다 주소를 따로 묻지 않게.
 * - 파일 이름에 시각을 넣어 바꿀 때마다 새 파일로 올리고, 옛 파일은 지운다(실패해도 화면은 진행).
 * - 쓰기는 관리자만(storage.rules·firestore.rules). 바뀐 것은 변경 이력(manual-edit)에 남긴다.
 */
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, collection, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Asset } from '../../types/asset';

/** 원본 파일 상한 — 이보다 크면 줄이기 전에 막는다(사진이 아닌 파일을 고른 경우) */
export const PHOTO_SOURCE_MAX_BYTES = 30 * 1024 * 1024;

export interface AssetPhotoFields {
    photoUrl: string | null;
    photoThumbUrl: string | null;
    photoPath: string | null;
    photoThumbPath: string | null;
}

const EMPTY: AssetPhotoFields = { photoUrl: null, photoThumbUrl: null, photoPath: null, photoThumbPath: null };

/** 사진 줄이기 — 라이브러리는 이때만 불러온다(번들 분리). 현장 사진(scanPhotos)도 쓴다 */
export async function shrinkPhoto(file: File, maxSide: number, maxSizeMB: number): Promise<File> {
    const { default: imageCompression } = await import('browser-image-compression');
    // 작업자(worker)는 쓰지 않는다 — blob: 워커가 보안 정책(CSP script-src)에 막힌다. 사진 한 장이라 화면에서 줄여도 충분하다
    return imageCompression(file, { maxWidthOrHeight: maxSide, maxSizeMB, useWebWorker: false, fileType: 'image/jpeg', initialQuality: 0.8 });
}

/** 기관·재물 사진 폴더 */
export const assetPhotoDir = (asset: Pick<Asset, 'id' | 'organizationId'>) =>
    `organizations/${asset.organizationId}/assets/${asset.id}`;

/** 옛 파일 지우기 — 실패해도 진행한다(남은 파일은 기관 해지 때 함께 지워진다) */
function removeFiles(paths: Array<string | null | undefined>) {
    for (const p of paths) {
        if (p) deleteObject(ref(storage, p)).catch((e) => captureError(e, { context: 'removeAssetPhotoFile' }));
    }
}

/** 재물 문서에 사진 값을 쓰고 이력을 남긴다 */
async function writePhotoFields(asset: Pick<Asset, 'id' | 'organizationId' | 'code'> & Partial<AssetPhotoFields>, next: AssetPhotoFields) {
    const stamp = actorStamp();
    const now = serverTimestamp();
    const batch = writeBatch(db);
    batch.update(doc(db, 'assets', asset.id), { ...next, updatedAt: now, ...stamp });
    batch.set(doc(collection(db, 'history')), {
        organizationId: asset.organizationId, assetId: asset.id, code: asset.code, type: 'manual-edit',
        changes: { photo: { before: asset.photoUrl ? '있음' : '없음', after: next.photoUrl ? (asset.photoUrl ? '바꿈' : '있음') : '없음' } },
        importId: null, at: now, ...stamp,
    });
    await batch.commit();
}

/**
 * 사진 올리기(바꾸기) — 줄여서 두 장 올리고 재물 문서를 고친 뒤 옛 사진을 지운다.
 * @returns 새 사진 값
 */
export async function uploadAssetPhoto(
    asset: Pick<Asset, 'id' | 'organizationId' | 'code'> & Partial<AssetPhotoFields>,
    file: File,
): Promise<AssetPhotoFields> {
    if (!file.type.startsWith('image/')) throw new Error('사진 파일이 아닙니다.');
    if (file.size > PHOTO_SOURCE_MAX_BYTES) throw new Error('파일이 너무 큽니다.');
    try {
        const [main, thumb] = await Promise.all([shrinkPhoto(file, 1280, 0.6), shrinkPhoto(file, 320, 0.05)]);
        const stampName = Date.now();
        const dir = assetPhotoDir(asset);
        const photoPath = `${dir}/photo-${stampName}.jpg`;
        const photoThumbPath = `${dir}/thumb-${stampName}.jpg`;
        const meta = { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' };
        await Promise.all([
            uploadBytes(ref(storage, photoPath), main, meta),
            uploadBytes(ref(storage, photoThumbPath), thumb, meta),
        ]);
        const [photoUrl, photoThumbUrl] = await Promise.all([
            getDownloadURL(ref(storage, photoPath)), getDownloadURL(ref(storage, photoThumbPath)),
        ]);
        const next: AssetPhotoFields = { photoUrl, photoThumbUrl, photoPath, photoThumbPath };
        try {
            await writePhotoFields(asset, next);
        } catch (e) {
            removeFiles([photoPath, photoThumbPath]); // 문서를 못 고쳤으면 올린 파일을 거둔다
            throw e;
        }
        removeFiles([asset.photoPath, asset.photoThumbPath]);
        return next;
    } catch (error) {
        captureError(error, { context: 'uploadAssetPhoto', assetId: asset.id });
        throw error;
    }
}

/** 사진 지우기 */
export async function removeAssetPhoto(asset: Pick<Asset, 'id' | 'organizationId' | 'code'> & Partial<AssetPhotoFields>): Promise<void> {
    try {
        await writePhotoFields(asset, EMPTY);
        removeFiles([asset.photoPath, asset.photoThumbPath]);
    } catch (error) {
        captureError(error, { context: 'removeAssetPhoto', assetId: asset.id });
        throw error;
    }
}
