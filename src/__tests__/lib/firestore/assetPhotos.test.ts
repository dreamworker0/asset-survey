/**
 * 재물 사진 (2026-11-22) — 줄여서 두 장 올리고, 문서를 고치고, 옛 사진을 지운다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploaded: string[] = [];
const deleted: string[] = [];
const batchOps: Array<{ kind: string; data: Record<string, unknown> }> = [];
let commitFails = false;

vi.mock('browser-image-compression', () => ({ default: vi.fn(async (f: File) => f) }));
vi.mock('firebase/storage', () => ({
    ref: vi.fn((_s: unknown, path: string) => ({ path })),
    uploadBytes: vi.fn(async (r: { path: string }) => { uploaded.push(r.path); }),
    getDownloadURL: vi.fn(async (r: { path: string }) => `https://dl/${r.path}`),
    deleteObject: vi.fn(async (r: { path: string }) => { deleted.push(r.path); }),
}));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})), collection: vi.fn(() => ({})), serverTimestamp: vi.fn(() => '__ts__'),
    writeBatch: vi.fn(() => ({
        update: (_r: unknown, data: Record<string, unknown>) => batchOps.push({ kind: 'update', data }),
        set: (_r: unknown, data: Record<string, unknown>) => batchOps.push({ kind: 'set', data }),
        commit: vi.fn(async () => { if (commitFails) throw new Error('denied'); }),
    })),
}));
vi.mock('../../../lib/firebase', () => ({ db: {}, storage: {}, auth: { currentUser: { uid: 'admin-1' } } }));
vi.mock('../../../lib/monitoring', () => ({ captureError: vi.fn() }));

import { uploadAssetPhoto, removeAssetPhoto } from '../../../lib/firestore/assetPhotos';

const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
const asset = {
    id: 'org-A__1', organizationId: 'org-A', code: '1',
    photoUrl: 'https://old', photoThumbUrl: 'https://old-t', photoPath: 'old/photo.jpg', photoThumbPath: 'old/thumb.jpg',
};

beforeEach(() => { uploaded.length = 0; deleted.length = 0; batchOps.length = 0; commitFails = false; });

describe('uploadAssetPhoto', () => {
    it('기관·재물 폴더에 사진·작은 사진을 올리고 문서·이력을 쓴 뒤 옛 파일을 지운다', async () => {
        const next = await uploadAssetPhoto(asset, file);
        expect(uploaded).toHaveLength(2);
        expect(uploaded.every((p) => p.startsWith('organizations/org-A/assets/org-A__1/'))).toBe(true);
        expect(next.photoUrl).toMatch(/^https:\/\/dl\/.*photo-/);
        expect(batchOps[0].data).toMatchObject({ photoUrl: next.photoUrl, photoThumbUrl: next.photoThumbUrl, lastEditedByUid: 'admin-1' });
        expect(batchOps[1].data).toMatchObject({ type: 'manual-edit', changes: { photo: { before: '있음', after: '바꿈' } } });
        await vi.waitFor(() => expect(deleted).toEqual(['old/photo.jpg', 'old/thumb.jpg']));
    });

    it('문서를 못 고치면 방금 올린 파일을 거두고 옛 사진은 남긴다', async () => {
        commitFails = true;
        await expect(uploadAssetPhoto(asset, file)).rejects.toThrow();
        await vi.waitFor(() => expect(deleted).toHaveLength(2));
        expect(deleted.every((p) => p.startsWith('organizations/org-A/assets/'))).toBe(true);
    });

    it('사진이 아닌 파일은 올리지 않는다', async () => {
        await expect(uploadAssetPhoto(asset, new File(['x'], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow();
        expect(uploaded).toHaveLength(0);
    });
});

describe('removeAssetPhoto', () => {
    it('문서의 사진 값을 비우고 파일을 지운다', async () => {
        await removeAssetPhoto(asset);
        expect(batchOps[0].data).toMatchObject({ photoUrl: null, photoThumbUrl: null, photoPath: null, photoThumbPath: null });
        await vi.waitFor(() => expect(deleted).toEqual(['old/photo.jpg', 'old/thumb.jpg']));
    });
});
