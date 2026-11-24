/** 공간 관리 화면 공용 상수 (SpaceManager·SpaceModals, 2026-11-24 분리) */
import type { SpaceLocation } from '../../../lib/firestore/spaces';

export const ROLE_LABEL: Record<string, string> = { admin: '관리자', employee: '직원' };
export const NO_LOCATION: SpaceLocation = { buildingId: null, floor: null };
