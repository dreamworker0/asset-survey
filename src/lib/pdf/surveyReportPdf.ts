/**
 * 재물조사 결과 보고서 PDF (기획서 F15) — A4 세로, 브라우저 인쇄
 *
 * 여러 표(종합·공간별·예외 목록)가 이어지는 문서라 표 하나짜리 pdfEngine 대신 직접 조립한다.
 * 표가 장을 넘으면 머리글 줄을 다음 장에 다시 찍고(thead 반복), 행은 장 사이에서 쪼개지 않는다.
 * 스타일·이스케이프·결재란은 pdfEngine과 같은 도구를 쓴다.
 */
import { buildApprovalHtml, escapeHtml, type ApprovalEntry } from './pdfEngine';
import { recordExport } from '../audit/recordExport';
import { buildReportTables, reportHeader, reportPhotos, PHOTO_TABLE_TITLE, type ReportContext } from '../survey/reportTables';

const styles = `
    @page { size: A4 portrait; margin: 14mm 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; font-size: 10px; color: #111; background: #fff; }
    .header-area { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .title { font-size: 20px; font-weight: 800; letter-spacing: 4px; padding-top: 6px; }
    .info { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 3px 10px; margin-bottom: 12px; font-size: 10.5px; }
    .info dt { font-weight: 700; }
    h2 { font-size: 12px; margin: 14px 0 5px; break-after: avoid; page-break-after: avoid; }
    table.t { width: 100%; border-collapse: collapse; table-layout: auto; }
    table.t th, table.t td { border: 1px solid #333; padding: 3px 5px; vertical-align: middle; word-break: break-all; }
    table.t thead { display: table-header-group; }
    table.t thead th { background: #e8e8e8; font-weight: 700; text-align: center; white-space: nowrap; }
    table.t tr { break-inside: avoid; page-break-inside: avoid; }
    .photos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .photos figure { margin: 0; break-inside: avoid; page-break-inside: avoid; font-size: 9px; }
    .photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border: 1px solid #999; }
    td.num { text-align: right; white-space: nowrap; }
    .empty { color: #555; padding: 2px 0 4px; }
    .foot { margin-top: 16px; font-size: 9px; color: #555; }
    .approval-table { border-collapse: collapse; }
    .approval-table td, .approval-table th { border: 1px solid #333; text-align: center; font-size: 9px; padding: 2px 6px; }
    .approval-header { background: #e8e8e8; font-weight: 700; width: 22px; line-height: 1.4; }
    .approval-title { background: #f5f5f5; font-weight: 600; min-width: 52px; height: 18px; }
    .approval-sign { height: 40px; min-width: 52px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    @media screen { body { padding: 24px; background: #eee; } .doc { background: #fff; max-width: 820px; margin: 0 auto; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,.15); } }
`;

/** 보고서 HTML — 단위 테스트에서 내용을 확인한다 */
export function buildSurveyReportHtml(ctx: ReportContext, orgName: string, approvalLine: ApprovalEntry[] = [], printedAt = new Date()): string {
    const tables = buildReportTables(ctx);
    const info = [['기관명', orgName], ...reportHeader(ctx), ['출력일', printedAt.toLocaleDateString('ko-KR')]];
    const cell = (v: string | number) => (typeof v === 'number'
        ? `<td class="num">${v.toLocaleString('ko-KR')}</td>`
        : `<td>${escapeHtml(v)}</td>`);
    // 현장 사진은 주소 표 대신 사진으로 그린다(2026-11-22)
    const photos = reportPhotos(ctx);
    const photoHtml = photos.length === 0 ? '' : `
        <h2>${escapeHtml(PHOTO_TABLE_TITLE)} (${photos.length}건)</h2>
        <div class="photos">${photos.map((p) => `
            <figure><img src="${escapeHtml(p.thumbUrl)}" alt="" /><figcaption><b>${escapeHtml(p.code)}</b> ${escapeHtml(p.name)}<br/>${escapeHtml(p.where)} · ${escapeHtml(p.condition)}${p.memo ? ` · ${escapeHtml(p.memo)}` : ''}</figcaption></figure>`).join('')}
        </div>`;
    const body = tables.filter((t) => t.title !== PHOTO_TABLE_TITLE).map((t) => `
        <h2>${escapeHtml(t.title)}${t.rows.length > 0 && t.title !== '종합' ? ` (${t.rows.length}건)` : ''}</h2>
        ${t.rows.length === 0 ? `<p class="empty">${escapeHtml(t.empty)}</p>` : `
        <table class="t">
            <thead><tr>${t.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
            <tbody>${t.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody>
        </table>`}`).join('');
    return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>재물조사 결과 보고서 - ${escapeHtml(ctx.survey.name)}</title><style>${styles}</style></head>
<body><div class="doc">
    <div class="header-area"><h1 class="title">재물조사 결과 보고서</h1>${buildApprovalHtml(approvalLine)}</div>
    <dl class="info">${info.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${body}
    ${photoHtml}
    <p class="foot">금액은 담지 않습니다. 희망이음 반영은 앱의 '희망이음 반영 목록'에서 처리 여부를 확인하세요.</p>
</div></body>
</html>`;
}

/**
 * 새 창의 그림(현장 사진)을 다 받은 뒤 인쇄한다.
 *
 * 예전에는 `document.close()` 뒤에 `w.onload`를 걸었는데, about:blank 창은 close 시점에 이미
 * load가 끝났을 수 있어 인쇄 창이 아예 안 뜨거나, 사진이 덜 받아진 채 인쇄됐다.
 * 라벨 인쇄(LabelPrintDialog)처럼 그림마다 decode를 기다리고, 실패한 그림은 건너뛰며,
 * 느린 연결에서도 끝없이 기다리지 않게 상한을 둔다.
 */
export function printWhenImagesReady(w: Window, timeoutMs = 8000): void {
    let done = false;
    const go = () => {
        if (done) return;
        done = true;
        // 레이아웃이 자리 잡을 짧은 여유
        setTimeout(() => { try { w.print(); } catch { /* 사용자가 창을 먼저 닫은 경우 */ } }, 300);
    };
    const pending = Array.from(w.document.images ?? []).filter((img) => !img.complete);
    if (pending.length === 0) { go(); return; }
    void Promise.all(pending.map((img) => img.decode().catch(() => undefined))).then(go);
    setTimeout(go, timeoutMs);
}

/** 새 창에 보고서를 열고 인쇄 창을 띄운다(PDF로 저장 가능) */
export function printSurveyReport(ctx: ReportContext, orgName: string, approvalLine: ApprovalEntry[], onError?: (msg: string) => void): boolean {
    const w = window.open('', '_blank', 'width=900,height=900');
    if (!w) {
        onError?.('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.');
        return false;
    }
    w.document.write(buildSurveyReportHtml(ctx, orgName, approvalLine));
    w.document.close();
    printWhenImagesReady(w);
    recordExport('pdf', 'surveyReport', ctx.report.summary.target);
    return true;
}
