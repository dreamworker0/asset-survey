/**
 * Firestore — 사전 등록 직원 (preRegistered) 관련 함수
 */
import {
    collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
    serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions } from '../firebase';
import { captureError } from '../monitoring';

export interface PreRegisteredEmployee {
    id: string;
    name: string;
    email: string;
    /** 가입하면 이 팀으로 들어간다(2026-11-22) */
    teamId?: string | null;
    createdAt: unknown;
    /** 초대 메일을 마지막으로 보낸 때(2026-11-23, 서버 함수만 쓴다) */
    invitedAt?: { toDate?: () => Date } | null;
    /** 초대 메일을 보낸 횟수 */
    inviteCount?: number;
}

/** 초대 메일 한 번 호출에 담는 최대 인원 — 서버(sendInviteEmails)의 INVITE_MAX와 같다 */
const INVITE_CHUNK = 100;

export interface InviteEmailResult { sent: number; skipped: number; failed: number }

/**
 * 가입 대기 직원에게 초대 메일 보내기(2026-11-23) — `sendInviteEmails` 콜러블.
 * 받는 주소는 서버가 사전 등록 문서에서 읽는다. 100명씩 나눠 부르고 결과를 더한다.
 * 재시도를 걸지 않는다 — 같은 사람에게 두 번 가지 않게 서버가 10분 안의 재발송을 건너뛴다.
 */
export const sendInviteEmails = async (orgId: string, preRegIds: string[]): Promise<InviteEmailResult> => {
    const call = httpsCallable<{ organizationId: string; preRegIds: string[] }, InviteEmailResult>(firebaseFunctions, 'sendInviteEmails');
    const total: InviteEmailResult = { sent: 0, skipped: 0, failed: 0 };
    try {
        for (let i = 0; i < preRegIds.length; i += INVITE_CHUNK) {
            const { data } = await call({ organizationId: orgId, preRegIds: preRegIds.slice(i, i + INVITE_CHUNK) });
            total.sent += data.sent;
            total.skipped += data.skipped;
            total.failed += data.failed;
        }
        return total;
    } catch (error) {
        captureError(error, { context: 'sendInviteEmails', orgId });
        throw error;
    }
};

// 사전 등록 직원 목록 조회
export const getPreRegisteredEmployees = async (orgId: string): Promise<PreRegisteredEmployee[]> => {
    try {
        const snap = await getDocs(collection(db, 'organizations', orgId, 'preRegistered'));
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() } as PreRegisteredEmployee))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (error) {
        captureError(error, { context: 'getPreRegisteredEmployees', orgId });
        throw error;
    }
};

// 사전 등록 직원 추가
export const addPreRegisteredEmployee = async (
    orgId: string,
    name: string,
    email: string,
    teamId: string | null = null,
): Promise<void> => {
    try {
        await addDoc(collection(db, 'organizations', orgId, 'preRegistered'), {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            teamId,
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error, { context: 'addPreRegisteredEmployee', orgId });
        throw error;
    }
};

/** 사전 등록 직원의 팀 바꾸기(2026-11-22) — 예전엔 지우고 다시 등록해야 했다 */
export const updatePreRegisteredTeam = async (orgId: string, preRegId: string, teamId: string | null): Promise<void> => {
    try {
        await updateDoc(doc(db, 'organizations', orgId, 'preRegistered', preRegId), { teamId });
    } catch (error) {
        captureError(error, { context: 'updatePreRegisteredTeam', orgId });
        throw error;
    }
};

// 사전 등록 직원 삭제
export const deletePreRegisteredEmployee = async (orgId: string, preRegId: string): Promise<void> => {
    try {
        await deleteDoc(doc(db, 'organizations', orgId, 'preRegistered', preRegId));
    } catch (error) {
        captureError(error, { context: 'deletePreRegisteredEmployee', orgId, preRegId });
        throw error;
    }
};

/** 한 배치에 담는 쓰기 수 — Firestore 한도(500)보다 넉넉히 작게 */
const BATCH_LIMIT = 400;

async function inBatches<T>(items: T[], write: (batch: ReturnType<typeof writeBatch>, item: T) => void): Promise<void> {
    for (let i = 0; i < items.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        items.slice(i, i + BATCH_LIMIT).forEach((item) => write(batch, item));
        await batch.commit();
    }
}

/** 여러 명 한꺼번에 미리 등록(2026-11-23) — 이름·이메일은 미리 검사해 넘긴다 */
export const addPreRegisteredBatch = async (
    orgId: string, rows: Array<{ name: string; email: string; teamId: string | null }>,
): Promise<void> => {
    try {
        await inBatches(rows, (batch, r) => {
            batch.set(doc(collection(db, 'organizations', orgId, 'preRegistered')), {
                name: r.name.trim(), email: r.email.trim().toLowerCase(), teamId: r.teamId, createdAt: serverTimestamp(),
            });
        });
    } catch (error) {
        captureError(error, { context: 'addPreRegisteredBatch', orgId, count: rows.length });
        throw error;
    }
};

/** 가입 대기 여러 명의 팀을 한꺼번에(2026-11-23) */
export const updatePreRegisteredTeamBatch = async (orgId: string, ids: string[], teamId: string | null): Promise<void> => {
    try {
        await inBatches(ids, (batch, id) => batch.update(doc(db, 'organizations', orgId, 'preRegistered', id), { teamId }));
    } catch (error) {
        captureError(error, { context: 'updatePreRegisteredTeamBatch', orgId, count: ids.length });
        throw error;
    }
};

/** 가입 대기 여러 명을 한꺼번에 취소(2026-11-23) */
export const deletePreRegisteredBatch = async (orgId: string, ids: string[]): Promise<void> => {
    try {
        await inBatches(ids, (batch, id) => batch.delete(doc(db, 'organizations', orgId, 'preRegistered', id)));
    } catch (error) {
        captureError(error, { context: 'deletePreRegisteredBatch', orgId, count: ids.length });
        throw error;
    }
};
