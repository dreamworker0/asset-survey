/**
 * 조사 현장 사진 (2026-11-22) — 스캔 기록마다 사진 한 장(파손·라벨 훼손·미등록 등을 보여 주려고)
 *
 * - 저장 위치: Storage `organizations/{기관}/scans/{회차}/` — 기관 해지 파기 범위에 든다.
 * - 재물 사진과 같이 줄여서 두 장(1280px·320px) 올린다(assetPhotos의 shrinkPhoto).
 * - 찍은 사람(공간 담당 직원 포함)이 올린다. 스캔 문서에 사진 값을 쓰는 것은 firestore.rules가
 *   '물건 상태·메모'와 같은 경계(열린 회차·제출 전·담당자)로 막는다. Storage는 올린 사람을 메타데이터로 남겨
 *   본인이나 관리자만 지우게 한다.
 * - 인터넷이 필요하다 — 스캔 자체는 끊긴 곳에서도 되지만 사진은 연결됐을 때 올린다(화면이 안내한다).
 */
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage, auth } from '../firebase';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import { shrinkPhoto, PHOTO_SOURCE_MAX_BYTES, type AssetPhotoFields } from './assetPhotos';
import type { Scan } from '../../types/survey';

export type ScanPhotoFields = AssetPhotoFields;
type ScanRef = Pick<Scan, 'id' | 'organizationId' | 'surveyId'> & Partial<ScanPhotoFields>;

function removeFiles(paths: Array<string | null | undefined>) {
    for (const p of paths) {
        if (p) deleteObject(ref(storage, p)).catch((e) => captureError(e, { context: 'removeScanPhotoFile' }));
    }
}

/** 파일 이름에 쓸 수 있게 스캔 ID를 정리한다(경로 구분자 등) */
const safeName = (id: string) => id.replace(/[^0-9A-Za-z_%-]/g, '_');

/** 현장 사진 올리기(바꾸기) */
export async function uploadScanPhoto(scan: ScanRef, file: File): Promise<ScanPhotoFields> {
    if (!file.type.startsWith('image/')) throw new Error('사진 파일이 아닙니다.');
    if (file.size > PHOTO_SOURCE_MAX_BYTES) throw new Error('파일이 너무 큽니다.');
    const uid = auth.currentUser?.uid ?? '';
    try {
        const [main, thumb] = await Promise.all([shrinkPhoto(file, 1280, 0.6), shrinkPhoto(file, 320, 0.05)]);
        const stamp = Date.now();
        const dir = `organizations/${scan.organizationId}/scans/${scan.surveyId}`;
        const photoPath = `${dir}/${safeName(scan.id)}-${stamp}.jpg`;
        const photoThumbPath = `${dir}/${safeName(scan.id)}-${stamp}-thumb.jpg`;
        // 올린 사람을 남긴다 — Storage Rules가 본인·관리자만 지우게 한다
        const meta = { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000', customMetadata: { uploadedBy: uid } };
        await Promise.all([uploadBytes(ref(storage, photoPath), main, meta), uploadBytes(ref(storage, photoThumbPath), thumb, meta)]);
        const [photoUrl, photoThumbUrl] = await Promise.all([getDownloadURL(ref(storage, photoPath)), getDownloadURL(ref(storage, photoThumbPath))]);
        const next: ScanPhotoFields = { photoUrl, photoThumbUrl, photoPath, photoThumbPath };
        try {
            await updateDoc(doc(db, 'scans', scan.id), { ...next, updatedAt: serverTimestamp(), ...actorStamp() });
        } catch (e) {
            removeFiles([photoPath, photoThumbPath]);
            throw e;
        }
        removeFiles([scan.photoPath, scan.photoThumbPath]);
        return next;
    } catch (error) {
        captureError(error, { context: 'uploadScanPhoto', surveyId: scan.surveyId });
        throw error;
    }
}

/** 현장 사진 지우기 */
export async function removeScanPhoto(scan: ScanRef): Promise<void> {
    try {
        await updateDoc(doc(db, 'scans', scan.id), {
            photoUrl: null, photoThumbUrl: null, photoPath: null, photoThumbPath: null,
            updatedAt: serverTimestamp(), ...actorStamp(),
        });
        removeFiles([scan.photoPath, scan.photoThumbPath]);
    } catch (error) {
        captureError(error, { context: 'removeScanPhoto', surveyId: scan.surveyId });
        throw error;
    }
}
