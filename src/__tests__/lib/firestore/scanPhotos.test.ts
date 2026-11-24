/**
 * 조사 현장 사진 (2026-11-22) — 올린 사람을 남기고, 스캔 문서에 붙이고, 옛 사진을 지운다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploads: Array<{ path: string; meta: { customMetadata?: Record<string, string> } }> = [];
const deleted: string[] = [];
const updates: Record<string, unknown>[] = [];

vi.mock('browser-image-compression', () => ({ default: vi.fn(async (f: File) => f) }));
vi.mock('firebase/storage', () => ({
    ref: vi.fn((_s: unknown, path: string) => ({ path })),
    uploadBytes: vi.fn(async (r: { path: string }, _f: unknown, meta: { customMetadata?: Record<string, string> }) => { uploads.push({ path: r.path, meta }); }),
    getDownloadURL: vi.fn(async (r: { path: string }) => `https://dl/${r.path}`),
    deleteObject: vi.fn(async (r: { path: string }) => { deleted.push(r.path); }),
}));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})), collection: vi.fn(() => ({})), serverTimestamp: vi.fn(() => '__ts__'),
    writeBatch: vi.fn(), updateDoc: vi.fn(async (_r: unknown, data: Record<string, unknown>) => { updates.push(data); }),
}));
vi.mock('../../../lib/firebase', () => ({ db: {}, storage: {}, auth: { currentUser: { uid: 'emp-1' } } }));
vi.mock('../../../lib/monitoring', () => ({ captureError: vi.fn() }));

import { uploadScanPhoto, removeScanPhoto } from '../../../lib/firestore/scanPhotos';

const scan = { id: 'sv1__org-A__1', organizationId: 'org-A', surveyId: 'sv1', photoPath: 'old.jpg', photoThumbPath: 'old-t.jpg' };
const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });

beforeEach(() => { uploads.length = 0; deleted.length = 0; updates.length = 0; });

describe('uploadScanPhoto', () => {
    it('회차 폴더에 올린 사람을 남겨 두 장 올리고, 스캔 문서에 붙인 뒤 옛 사진을 지운다', async () => {
        await uploadScanPhoto(scan, file);
        expect(uploads).toHaveLength(2);
        expect(uploads.every((u) => u.path.startsWith('organizations/org-A/scans/sv1/') && u.meta.customMetadata?.uploadedBy === 'emp-1')).toBe(true);
        expect(updates[0]).toMatchObject({ photoUrl: expect.stringContaining('https://dl/'), lastEditedByUid: 'emp-1' });
        await vi.waitFor(() => expect(deleted).toEqual(['old.jpg', 'old-t.jpg']));
    });

    it('지우면 사진 값을 비운다', async () => {
        await removeScanPhoto(scan);
        expect(updates[0]).toMatchObject({ photoUrl: null, photoThumbUrl: null, photoPath: null, photoThumbPath: null });
    });
});
