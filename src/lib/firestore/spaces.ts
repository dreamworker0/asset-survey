/**
 * Firestore — 공간(spaces) 도메인 함수 (기획서 F03)
 *
 * 쓰기는 기관 관리자만 한다(firestore.rules `spaces`). 모든 쓰기에 행위자 스탬프를 심는다 —
 * 이 컬렉션의 Rules는 스탬프를 **매번** 요구한다(새 컬렉션이라 스탬프를 빠뜨리는 옛 경로가 없다).
 *
 * 공간은 지우지 않고 숨긴다(`archived`). 2단계부터 재물·조사 기록이 공간을 가리키므로
 * 지우면 그 기록이 고아가 된다.
 */
import {
    collection, doc, query, where, getDocs, addDoc, updateDoc, writeBatch,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, spaceSchema, SPACE_NAME_MAX } from '../../schemas';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Space, SpacePatch } from '../../types/space';

const spaceConverter = createZodConverter(spaceSchema);

/** 표시 순서 — order가 같으면 이름순(한글) */
export function sortSpaces(spaces: Space[]): Space[] {
    return [...spaces].sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ko'));
}

/** 이름 앞뒤 공백을 지우고 연속 공백을 하나로 줄인다 */
export function normalizeSpaceName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
}

/**
 * 공간 이름 검사 — 문제가 없으면 null, 있으면 안내 문구.
 * 같은 기관 안에서 이름이 겹치면 엑셀 위치 대응(2단계)과 보고서에서 구분할 수 없으므로 막는다.
 * 숨긴 공간과 겹치는 것도 막는다 — 숨김을 풀면 같은 이름이 둘이 된다.
 */
export function validateSpaceName(name: string, existing: Space[], selfId?: string): string | null {
    const normalized = normalizeSpaceName(name);
    if (!normalized) return '공간 이름을 입력해주세요.';
    if (normalized.length > SPACE_NAME_MAX) return `공간 이름은 ${SPACE_NAME_MAX}자까지 쓸 수 있습니다.`;
    const dup = existing.find((s) => s.id !== selfId && normalizeSpaceName(s.name) === normalized);
    if (dup) return dup.archived ? `삭제한 공간에 같은 이름(${normalized})이 있습니다. 목록 아래 '삭제한 공간'에서 되살려 쓰세요.` : `같은 이름의 공간(${normalized})이 이미 있습니다.`;
    return null;
}

/** 기관의 공간 목록 (숨긴 공간 포함, 표시 순서대로) */
export const getSpaces = async (orgId: string): Promise<Space[]> => {
    try {
        const q = query(
            collection(db, 'spaces').withConverter(spaceConverter),
            where('organizationId', '==', orgId),
        );
        const snap = await getDocs(q);
        return sortSpaces(snap.docs.map((d) => d.data() as Space));
    } catch (error) {
        captureError(error, { context: 'getSpaces', orgId });
        throw error;
    }
};

/**
 * 내가 담당하는 공간 (숨긴 공간 제외, 표시 순서대로) — 개인으로 지정된 공간과
 * 내 팀이 담당하는 공간(2026-11-22)을 합친다. 두 조건을 한 쿼리로 묶을 수 없어 두 번 읽는다.
 */
export const getMySpaces = async (orgId: string, uid: string, teamId?: string | null): Promise<Space[]> => {
    try {
        const col = collection(db, 'spaces').withConverter(spaceConverter);
        const [byMe, byTeam] = await Promise.all([
            getDocs(query(col, where('organizationId', '==', orgId), where('managerUids', 'array-contains', uid))),
            teamId
                ? getDocs(query(col, where('organizationId', '==', orgId), where('teamIds', 'array-contains', teamId)))
                : Promise.resolve(null),
        ]);
        const byId = new Map<string, Space>();
        for (const d of [...byMe.docs, ...(byTeam?.docs ?? [])]) byId.set(d.id, d.data() as Space);
        return sortSpaces([...byId.values()].filter((s) => !s.archived));
    } catch (error) {
        captureError(error, { context: 'getMySpaces', orgId });
        throw error;
    }
};

/** 공간이 있는 곳 — 건물을 등록하지 않은 기관은 둘 다 null */
export interface SpaceLocation {
    buildingId: string | null;
    floor: string | null;
}

/** 공간 추가 — 새 문서 ID를 돌려준다 */
export const createSpace = async (
    orgId: string, name: string, order: number,
    location: SpaceLocation = { buildingId: null, floor: null },
): Promise<string> => {
    try {
        const ref = await addDoc(collection(db, 'spaces'), {
            organizationId: orgId,
            name: normalizeSpaceName(name),
            order,
            managerUids: [],
            teamIds: [],
            archived: false,
            buildingId: location.buildingId,
            floor: location.buildingId ? location.floor : null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...actorStamp(),
        });
        return ref.id;
    } catch (error) {
        captureError(error, { context: 'createSpace', orgId });
        throw error;
    }
};

/** 공간 수정 (이름·순서·담당자·숨김·건물·층) */
export const updateSpace = async (spaceId: string, patch: SpacePatch): Promise<void> => {
    try {
        const data: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp(), ...actorStamp() };
        if (typeof patch.name === 'string') data.name = normalizeSpaceName(patch.name);
        await updateDoc(doc(db, 'spaces', spaceId), data);
    } catch (error) {
        captureError(error, { context: 'updateSpace', spaceId });
        throw error;
    }
};

/** 한 배치에 담는 쓰기 수 — Firestore 한도(500)보다 넉넉히 작게 */
const BATCH_LIMIT = 400;

/**
 * 여러 공간을 한꺼번에 고친다(2026-11-22) — 담당 지정·위치 옮기기·삭제(숨김)를 여러 곳에 한 번에.
 * 400건씩 배치로 나눠 쓴다(공간이 수백 곳이어도 일부만 바뀐 채 남는 범위를 배치 하나로 줄인다).
 */
export const updateSpacesBatch = async (patches: Array<{ id: string; patch: SpacePatch }>): Promise<void> => {
    try {
        for (let i = 0; i < patches.length; i += BATCH_LIMIT) {
            const batch = writeBatch(db);
            for (const { id, patch } of patches.slice(i, i + BATCH_LIMIT)) {
                batch.update(doc(db, 'spaces', id), { ...patch, updatedAt: serverTimestamp(), ...actorStamp() });
            }
            await batch.commit();
        }
    } catch (error) {
        captureError(error, { context: 'updateSpacesBatch', count: patches.length });
        throw error;
    }
};

/**
 * 여러 공간을 한꺼번에 만든다(2026-11-22) — 이름 목록을 붙여 넣어 추가할 때. 이름은 미리 검사해 넘긴다.
 * @returns 만든 순서대로의 문서 ID
 */
export const createSpacesBatch = async (
    orgId: string, names: string[], startOrder: number,
    location: SpaceLocation = { buildingId: null, floor: null },
): Promise<string[]> => {
    try {
        const ids: string[] = [];
        for (let i = 0; i < names.length; i += BATCH_LIMIT) {
            const batch = writeBatch(db);
            names.slice(i, i + BATCH_LIMIT).forEach((name, j) => {
                const ref = doc(collection(db, 'spaces'));
                ids.push(ref.id);
                batch.set(ref, {
                    organizationId: orgId,
                    name: normalizeSpaceName(name),
                    order: startOrder + i + j,
                    managerUids: [],
                    teamIds: [],
                    archived: false,
                    buildingId: location.buildingId,
                    floor: location.buildingId ? location.floor : null,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    ...actorStamp(),
                });
            });
            await batch.commit();
        }
        return ids;
    } catch (error) {
        captureError(error, { context: 'createSpacesBatch', orgId, count: names.length });
        throw error;
    }
};

/**
 * 순서 다시 매기기 — 화면에 보이는 순서대로 0, 1, 2…를 준다.
 * 바뀐 문서만 한 배치로 쓴다(일부만 바뀐 채 남지 않게).
 */
export const reorderSpaces = async (ordered: Space[]): Promise<void> => {
    try {
        const batch = writeBatch(db);
        let changed = 0;
        ordered.forEach((space, index) => {
            if (space.order === index) return;
            batch.update(doc(db, 'spaces', space.id), { order: index, updatedAt: serverTimestamp(), ...actorStamp() });
            changed++;
        });
        if (changed > 0) await batch.commit();
    } catch (error) {
        captureError(error, { context: 'reorderSpaces', count: ordered.length });
        throw error;
    }
};
