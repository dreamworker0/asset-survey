/**
 * Firestore — 건물(buildings) 도메인 함수 (2026-11-22)
 *
 * 건물 → 층 → 공간 세 단계 중 위 단계다. 층은 건물 문서의 `floors` 목록이고, 공간이
 * `buildingId`·`floor`로 자기 위치를 가리킨다. 쓰기는 기관 관리자만(firestore.rules `buildings`),
 * 모든 쓰기에 행위자 스탬프를 심는다. 지우지 않고 숨긴다(`archived`) — 공간이 건물을 가리킨다.
 */
import {
    collection, doc, query, where, getDocs, addDoc, updateDoc, writeBatch,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, buildingSchema } from '../../schemas';
import { sortBuildings, normalizeBuildingText } from '../buildingFloors';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Building, BuildingPatch } from '../../types/building';

// 검사·층 파싱 같은 순수 함수는 Firebase 없이 쓰도록 lib/buildingFloors.ts에 있다
export {
    sortBuildings, normalizeBuildingText, validateBuildingName, validateBuildingAddress,
    parseFloors, floorsFromRange, validateFloors, floorLabel,
} from '../buildingFloors';

const buildingConverter = createZodConverter(buildingSchema);

/** 기관의 건물 목록 (숨긴 건물 포함, 표시 순서대로) */
export const getBuildings = async (orgId: string): Promise<Building[]> => {
    try {
        const q = query(
            collection(db, 'buildings').withConverter(buildingConverter),
            where('organizationId', '==', orgId),
        );
        const snap = await getDocs(q);
        return sortBuildings(snap.docs.map((d) => d.data() as Building));
    } catch (error) {
        captureError(error, { context: 'getBuildings', orgId });
        throw error;
    }
};

export type { BuildingInput } from '../buildingFloors';
import type { BuildingInput } from '../buildingFloors';

/** 건물 추가 — 새 문서 ID를 돌려준다 */
export const createBuilding = async (orgId: string, input: BuildingInput, order: number): Promise<string> => {
    try {
        const ref = await addDoc(collection(db, 'buildings'), {
            organizationId: orgId,
            name: normalizeBuildingText(input.name),
            address: normalizeBuildingText(input.address),
            floors: input.floors,
            order,
            archived: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...actorStamp(),
        });
        return ref.id;
    } catch (error) {
        captureError(error, { context: 'createBuilding', orgId });
        throw error;
    }
};

/** 건물 수정 (이름·주소·층·순서·숨김) */
export const updateBuilding = async (buildingId: string, patch: BuildingPatch): Promise<void> => {
    try {
        const data: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp(), ...actorStamp() };
        if (typeof patch.name === 'string') data.name = normalizeBuildingText(patch.name);
        if (typeof patch.address === 'string') data.address = normalizeBuildingText(patch.address);
        await updateDoc(doc(db, 'buildings', buildingId), data);
    } catch (error) {
        captureError(error, { context: 'updateBuilding', buildingId });
        throw error;
    }
};

/** 순서 다시 매기기 — 화면에 보이는 순서대로 0, 1, 2…. 바뀐 문서만 한 배치로 쓴다 */
export const reorderBuildings = async (ordered: Building[]): Promise<void> => {
    try {
        const batch = writeBatch(db);
        let changed = 0;
        ordered.forEach((building, index) => {
            if (building.order === index) return;
            batch.update(doc(db, 'buildings', building.id), { order: index, updatedAt: serverTimestamp(), ...actorStamp() });
            changed++;
        });
        if (changed > 0) await batch.commit();
    } catch (error) {
        captureError(error, { context: 'reorderBuildings', count: ordered.length });
        throw error;
    }
};
