/**
 * firestore/assetChecks — 기관 전체 마지막 확인 읽기(getAssetChecks)
 *
 * 고정하는 계약(2026-11-24):
 *   - 조회는 organizationId로 거른다
 *   - 두 번째부터는 checkedAt이 마지막으로 본 시각(2분 겹침) 이후인 것만 읽어 기억한 기록에 더한다
 *   - 동시에 부르면 한 번만 읽고, 바뀐 것만 읽기가 실패하거나 30분이 지나면 전부 다시 읽는다
 *   - 매번 새 Map을 돌려준다(화면 상태 갱신)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => {
    const ref = { withConverter: () => ref };
    return {
        collection: vi.fn(() => ref),
        doc: vi.fn(() => ref),
        query: vi.fn((r: unknown, ...constraints: unknown[]) => ({ r, constraints })),
        where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
        getDocs: vi.fn(),
        getDoc: vi.fn(),
        setDoc: vi.fn(),
        serverTimestamp: vi.fn(() => '__ts__'),
        Timestamp: { fromMillis: (ms: number) => ({ ms }) },
    };
});
vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-1' } } }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import * as fs from 'firebase/firestore';
import { getAssetChecks, clearAssetCheckSnapshots, CHECK_FULL_REFRESH_MS } from '../../../lib/firestore/assetChecks';

const at = (ms: number) => ({ toMillis: () => ms });
const snapOf = (list: Array<{ id: string; checkedAt?: unknown; via?: string }>) => ({
    docs: list.map((c) => ({ id: c.id, data: () => ({ organizationId: 'org-A', assetId: c.id, checkedByUid: 'u1', via: c.via ?? 'qr', spaceId: null, surveyId: null, checkedAt: c.checkedAt }) })),
});

beforeEach(() => {
    vi.clearAllMocks();
    clearAssetCheckSnapshots();
});

describe('getAssetChecks', () => {
    it('organizationId로 거르고, 두 번째부터는 바뀐 기록만 읽어 더한다', async () => {
        vi.mocked(fs.getDocs)
            .mockResolvedValueOnce(snapOf([
                { id: 'org-A__1', checkedAt: at(4_000_000) },
                { id: 'org-A__2', checkedAt: at(5_000_000) },
            ]) as never)
            .mockResolvedValueOnce(snapOf([
                { id: 'org-A__1', checkedAt: at(6_000_000), via: 'survey' },
                { id: 'org-A__3', checkedAt: at(6_000_000) },
            ]) as never);

        const first = await getAssetChecks('org-A');
        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org-A');
        expect([...first.keys()]).toEqual(['org-A__1', 'org-A__2']);

        const second = await getAssetChecks('org-A');
        // 마지막으로 본 시각(5,000,000)에서 2분 겹쳐 그 뒤에 확인된 것만 묻는다
        expect(fs.where).toHaveBeenCalledWith('checkedAt', '>=', { ms: 5_000_000 - 120_000 });
        expect(fs.getDocs).toHaveBeenCalledTimes(2);
        expect(second.size).toBe(3);
        expect(second.get('org-A__1')?.via).toBe('survey');
        // 매번 새 Map — 앞서 돌려준 것은 그대로다
        expect(second).not.toBe(first);
        expect(first.size).toBe(2);
    });

    it('아직 서버 시각이 없는 기록(checkedAt 없음)은 기준 시각을 끌어내리지 않는다', async () => {
        vi.mocked(fs.getDocs)
            .mockResolvedValueOnce(snapOf([{ id: 'org-A__1', checkedAt: at(5_000_000) }, { id: 'org-A__2' }]) as never)
            .mockResolvedValueOnce(snapOf([]) as never);
        await getAssetChecks('org-A');
        await getAssetChecks('org-A');
        expect(fs.where).toHaveBeenCalledWith('checkedAt', '>=', { ms: 5_000_000 - 120_000 });
    });

    it('동시에 부르면 한 번만 읽고, 바뀐 것만 읽기가 실패하거나 30분이 지나면 전부 다시 읽는다', async () => {
        const many = (n: number) => snapOf(Array.from({ length: n }, (_, i) => ({ id: `org-A__${i}`, checkedAt: at(1000) })));
        vi.mocked(fs.getDocs).mockResolvedValue(many(2) as never);
        const [a, b] = await Promise.all([getAssetChecks('org-A'), getAssetChecks('org-A')]);
        expect(a.size).toBe(2);
        expect(b.size).toBe(2);
        expect(fs.getDocs).toHaveBeenCalledTimes(1);

        // 바뀐 것만 읽기가 실패(인덱스 생성 중 등) → 전부 읽기로 돌아간다
        vi.mocked(fs.getDocs).mockRejectedValueOnce(new Error('index building')).mockResolvedValueOnce(many(3) as never);
        expect((await getAssetChecks('org-A')).size).toBe(3);

        // 30분이 지나면 전부 다시 읽는다(조건에 checkedAt이 없다)
        const now = Date.now();
        const spy = vi.spyOn(Date, 'now').mockReturnValue(now + CHECK_FULL_REFRESH_MS + 1);
        vi.mocked(fs.where).mockClear();
        vi.mocked(fs.getDocs).mockResolvedValueOnce(many(1) as never);
        expect((await getAssetChecks('org-A')).size).toBe(1);
        expect(vi.mocked(fs.where).mock.calls.some((c) => c[0] === 'checkedAt')).toBe(false);
        spy.mockRestore();
    });

    it('전부 읽기가 실패하면 오류를 그대로 던진다(화면이 "확인 기록 못 읽음"을 알린다)', async () => {
        vi.mocked(fs.getDocs).mockRejectedValueOnce(new Error('unavailable'));
        await expect(getAssetChecks('org-A')).rejects.toThrow('unavailable');
    });
});
