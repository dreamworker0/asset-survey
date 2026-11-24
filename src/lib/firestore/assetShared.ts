/**
 * 재물 도메인 공용 — 문서 변환기와 배치 크기.
 * assets.ts(읽기)·assetImport.ts(가져오기 확정)·assetEdit.ts(직접 등록·수정)가 함께 쓴다(2026-11-24 분리).
 */
import {
    createZodConverter, assetSchema, assetAccountingSchema, importRecordSchema, historySchema,
} from '../../schemas';

export const assetConverter = createZodConverter(assetSchema);
export const accountingConverter = createZodConverter(assetAccountingSchema);
export const importConverter = createZodConverter(importRecordSchema);
export const historyConverter = createZodConverter(historySchema);

/** 한 배치에 넣는 쓰기 수 — Firestore 상한(500)보다 여유를 둔다 */
export const BATCH_SIZE = 400;
