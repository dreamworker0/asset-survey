# 📅 운영 점검 계획표

> **아직 운영 전입니다.** 서비스를 공개한 뒤 차량운행일지의 계획표(1인 관리자 안정 운영)를 바탕으로 채웁니다.

| 주기 | 점검 | 근거 |
|---|---|---|
| 매월 | 기관 관리자의 접속기록 점검 안내 (개인정보 안전성 확보조치 기준 제16조 ②) | [AuditLogViewer](src/components/admin/AuditLogViewer.tsx) |
| 매일 | 야간 백업 결과 확인 (실패·경고는 운영자 메일로 온다) | [dailyNightlyBatch.ts](functions/src/handlers/scheduled/dailyNightlyBatch.ts) |
| 매주 | 해지 기관 파기·증빙 이미지 정리 결과 | [weeklyMaintenanceBatch.ts](functions/src/handlers/scheduled/weeklyMaintenanceBatch.ts) |
| 연 1회 조사 시즌 전 | 사용량·비용 예상 점검 (조사 대상 수 × 기관 수) | [기획서.md](기획서.md) 10장 |

긴급 되돌리기는 [ROLLBACK.md](ROLLBACK.md)를 따른다.
