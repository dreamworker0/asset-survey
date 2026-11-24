/**
 * Firestore — 팀(teams) 도메인 함수 (2026-11-22)
 *
 * 쓰기는 기관 관리자만(firestore.rules `teams`), 모든 쓰기에 행위자 스탬프. 지우지 않고 숨긴다.
 */
import { collection, doc, query, where, getDocs, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, teamSchema, TEAM_NAME_MAX } from '../../schemas';
import { captureError } from '../monitoring';
import { actorStamp } from './actorStamp';
import type { Team, TeamPatch } from '../../types/team';

const converter = createZodConverter(teamSchema);

export const normalizeTeamName = (name: string) => name.trim().replace(/\s+/g, ' ');

/** 표시 순서 — order가 같으면 이름순 */
export const sortTeams = (teams: Team[]): Team[] =>
    [...teams].sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ko'));

/** 팀 이름 검사 — 문제가 없으면 null. 숨긴 팀과 겹치는 것도 막는다 */
export function validateTeamName(name: string, existing: Team[], selfId?: string): string | null {
    const n = normalizeTeamName(name);
    if (!n) return '팀 이름을 입력해주세요.';
    if (n.length > TEAM_NAME_MAX) return `팀 이름은 ${TEAM_NAME_MAX}자까지 쓸 수 있습니다.`;
    const dup = existing.find((t) => t.id !== selfId && normalizeTeamName(t.name) === n);
    if (dup) return dup.archived ? `숨긴 팀에 같은 이름(${n})이 있습니다. 숨김을 풀어 다시 쓰세요.` : `같은 이름의 팀(${n})이 이미 있습니다.`;
    return null;
}

/** 기관의 팀 목록 (숨긴 팀 포함, 표시 순서대로) */
export const getTeams = async (orgId: string): Promise<Team[]> => {
    try {
        const snap = await getDocs(query(collection(db, 'teams').withConverter(converter), where('organizationId', '==', orgId)));
        return sortTeams(snap.docs.map((d) => d.data() as Team));
    } catch (error) {
        captureError(error, { context: 'getTeams', orgId });
        throw error;
    }
};

/** 팀 추가 — 새 문서 ID */
export const createTeam = async (orgId: string, name: string, order: number): Promise<string> => {
    try {
        const ref = await addDoc(collection(db, 'teams'), {
            organizationId: orgId, name: normalizeTeamName(name), order, archived: false,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...actorStamp(),
        });
        return ref.id;
    } catch (error) {
        captureError(error, { context: 'createTeam', orgId });
        throw error;
    }
};

/** 팀 수정 (이름·순서·숨김) */
export const updateTeam = async (teamId: string, patch: TeamPatch): Promise<void> => {
    try {
        const data: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp(), ...actorStamp() };
        if (typeof patch.name === 'string') data.name = normalizeTeamName(patch.name);
        await updateDoc(doc(db, 'teams', teamId), data);
    } catch (error) {
        captureError(error, { context: 'updateTeam', teamId });
        throw error;
    }
};
