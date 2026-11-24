/**
 * firestore/spaces 도메인 함수 단위 테스트 (기획서 F03)
 *
 * 고정하는 계약:
 *   - 조회는 항상 organizationId 필터를 건다 (기관 격리)
 *   - 쓰기는 행위자 스탬프·updatedAt을 함께 심는다 (Rules가 매번 요구)
 *   - 순서 다시 매기기는 바뀐 문서만 한 배치로 쓴다
 *   - 이름 검사: 빈 이름·너무 긴 이름·같은 이름(숨긴 공간 포함)을 막는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeRef = (label: string) => {
    const ref: { label: string; withConverter: (...a: unknown[]) => unknown } = {
        label,
        withConverter: () => ref,
    };
    return ref;
};

const mockBatch = { update: vi.fn(), commit: vi.fn() };

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, path: string) => makeRef(`col:${path}`)),
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(`doc:${path}/${id ?? ''}`)),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    getDocs: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(() => mockBatch),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));

vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-1' } } }));
vi.mock('../../../lib/monitoring', () => ({ captureError: vi.fn() }));

import * as fs from 'firebase/firestore';
import { captureError } from '../../../lib/monitoring';
import {
    getSpaces, getMySpaces, createSpace, updateSpace, reorderSpaces,
    sortSpaces, normalizeSpaceName, validateSpaceName,
} from '../../../lib/firestore/spaces';
import type { Space } from '../../../types/space';

const space = (over: Partial<Space>): Space => ({
    id: 's1', organizationId: 'org-A', name: '공간', order: 0, managerUids: [], teamIds: [], archived: false, buildingId: null, floor: null, ...over,
});

const snapOf = (spaces: Space[]) => ({ docs: spaces.map((s) => ({ id: s.id, data: () => s })) });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('spaces — 조회', () => {
    it('getSpaces는 organizationId로 거르고 순서·이름순으로 정렬한다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf([
            space({ id: 'b', name: '나', order: 1 }),
            space({ id: 'a', name: '가', order: 1 }),
            space({ id: 'c', name: '다', order: 0 }),
        ]) as never);

        const list = await getSpaces('org-A');

        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org-A');
        expect(list.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    });

    it('getMySpaces는 내 팀이 담당하는 공간도 합친다(겹치면 한 번만, 2026-11-22)', async () => {
        vi.mocked(fs.getDocs)
            .mockResolvedValueOnce(snapOf([space({ id: 'a', managerUids: ['u1'] })]) as never)
            .mockResolvedValueOnce(snapOf([space({ id: 'a', teamIds: ['t1'] }), space({ id: 'c', order: 1, teamIds: ['t1'] })]) as never);
        const list = await getMySpaces('org-A', 'u1', 't1');
        expect(fs.where).toHaveBeenCalledWith('teamIds', 'array-contains', 't1');
        expect(list.map((s) => s.id)).toEqual(['a', 'c']);
    });

    it('getMySpaces는 기관 + 담당자 조건으로 찾고 숨긴 공간은 뺀다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf([
            space({ id: 'a', managerUids: ['u1'] }),
            space({ id: 'b', managerUids: ['u1'], archived: true }),
        ]) as never);

        const list = await getMySpaces('org-A', 'u1');

        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org-A');
        expect(fs.where).toHaveBeenCalledWith('managerUids', 'array-contains', 'u1');
        expect(list.map((s) => s.id)).toEqual(['a']);
    });

    it('조회 실패는 보고한 뒤 다시 던진다', async () => {
        vi.mocked(fs.getDocs).mockRejectedValue(new Error('denied'));
        await expect(getSpaces('org-A')).rejects.toThrow('denied');
        expect(captureError).toHaveBeenCalled();
    });
});

describe('spaces — 쓰기', () => {
    it('createSpace는 정리한 이름·빈 담당자·숨김 아님과 스탬프를 심는다', async () => {
        vi.mocked(fs.addDoc).mockResolvedValue({ id: 'new-id' } as never);

        const id = await createSpace('org-A', '  2층   사무실 ', 3);

        expect(id).toBe('new-id');
        expect(vi.mocked(fs.addDoc).mock.calls[0][1]).toEqual({
            organizationId: 'org-A', name: '2층 사무실', order: 3, managerUids: [], teamIds: [], archived: false, buildingId: null, floor: null,
            createdAt: '__serverTimestamp__', updatedAt: '__serverTimestamp__', lastEditedByUid: 'admin-1',
        });
    });

    it('updateSpace는 바꾼 필드에 updatedAt·스탬프를 붙이고 이름은 정리한다', async () => {
        vi.mocked(fs.updateDoc).mockResolvedValue(undefined);

        await updateSpace('s1', { name: ' 창고 ', managerUids: ['u1'] });

        expect(vi.mocked(fs.updateDoc).mock.calls[0][1]).toEqual({
            name: '창고', managerUids: ['u1'], updatedAt: '__serverTimestamp__', lastEditedByUid: 'admin-1',
        });
    });

    it('updateSpace 실패는 보고한 뒤 다시 던진다', async () => {
        vi.mocked(fs.updateDoc).mockRejectedValue(new Error('denied'));
        await expect(updateSpace('s1', { archived: true })).rejects.toThrow('denied');
        expect(captureError).toHaveBeenCalled();
    });

    it('reorderSpaces는 순서가 바뀐 문서만 한 배치로 쓴다', async () => {
        await reorderSpaces([
            space({ id: 'a', order: 0 }),
            space({ id: 'b', order: 2 }),
            space({ id: 'c', order: 1 }),
        ]);

        expect(mockBatch.update).toHaveBeenCalledTimes(2);
        expect(vi.mocked(mockBatch.update).mock.calls.map((c) => [(c[0] as { label: string }).label, (c[1] as { order: number }).order]))
            .toEqual([['doc:spaces/b', 1], ['doc:spaces/c', 2]]);
        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('reorderSpaces는 바뀐 것이 없으면 커밋하지 않는다', async () => {
        await reorderSpaces([space({ id: 'a', order: 0 }), space({ id: 'b', order: 1 })]);
        expect(mockBatch.commit).not.toHaveBeenCalled();
    });
});

describe('spaces — 이름 검사', () => {
    const existing = [space({ id: 'a', name: '2층 사무실' }), space({ id: 'b', name: '옛 창고', archived: true })];

    it('공백을 정리한다', () => {
        expect(normalizeSpaceName('  1층   상담실 ')).toBe('1층 상담실');
    });

    it('빈 이름과 51자 이상은 막는다', () => {
        expect(validateSpaceName('   ', existing)).toMatch(/입력/);
        expect(validateSpaceName('가'.repeat(51), existing)).toMatch(/50자/);
        expect(validateSpaceName('가'.repeat(50), existing)).toBeNull();
    });

    it('같은 이름은 막고, 삭제한(숨긴) 공간과 겹치면 되살리라고 안내한다', () => {
        expect(validateSpaceName('2층  사무실', existing)).toMatch(/이미 있습니다/);
        expect(validateSpaceName('옛 창고', existing)).toMatch(/삭제한 공간/);
    });

    it('자기 자신과는 겹친다고 보지 않는다 (이름 바꾸기)', () => {
        expect(validateSpaceName('2층 사무실', existing, 'a')).toBeNull();
    });

    it('sortSpaces는 원본을 바꾸지 않는다', () => {
        const list = [space({ id: 'b', order: 1 }), space({ id: 'a', order: 0 })];
        const sorted = sortSpaces(list);
        expect(sorted.map((s) => s.id)).toEqual(['a', 'b']);
        expect(list.map((s) => s.id)).toEqual(['b', 'a']);
    });
});
