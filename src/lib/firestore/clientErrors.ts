/**
 * Firestore — 앱 오류 기록 (superAdmin 전용, 읽기만, 2026-11-23)
 *
 * 쓰기는 `reportClientError`(Admin SDK)만 하고 Rules가 클라이언트 쓰기를 막는다.
 * 서비스 운영 기록이라 기관 경계가 없다(organizationId 필터 없음 — eslint 예외 목록에 있다).
 */
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, clientErrorSchema } from '../../schemas';
import type { ClientError } from '../../types/clientError';
import { captureError } from '../monitoring';

const clientErrorConverter = createZodConverter(clientErrorSchema);

/** 최근에 난 오류부터 — 30일이 지나면 저절로 지워지므로 목록이 끝없이 길어지지 않는다 */
export const getRecentClientErrors = async (max = 100): Promise<ClientError[]> => {
    try {
        const snap = await getDocs(query(
            collection(db, 'clientErrors').withConverter(clientErrorConverter),
            orderBy('lastAt', 'desc'),
            limit(max),
        ));
        return snap.docs.map((d) => ({ ...d.data(), id: d.id })) as ClientError[];
    } catch (error) {
        captureError(error, { context: 'getRecentClientErrors' });
        throw error;
    }
};
