/**
 * LabelPrintDialog — QR 라벨 인쇄 (기획서 F09)
 *
 * 목록에서 고른 재물(또는 상세의 1건)을 A4 라벨지에 인쇄한다. 라벨지 회사 → 모델(폼텍 3종) 또는 다른 회사(직접 치수), 시작 칸(쓰다 남은
 * 라벨지), 재단선. [인쇄]를 누르면 태그가 없는 재물에 태그를 발급하고 인쇄 창을 연다.
 *
 * 인쇄 영역은 body 바로 아래에 따로 그리고(포털), 인쇄하는 동안만 나머지 화면을 숨긴다(index.css의
 * `body.label-printing`). A4·여백 0 설정도 이 대화상자가 열린 동안만 넣는다 — 다른 화면 인쇄에 영향 없음.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useLabelPrint from '../../hooks/useLabelPrint';
import {
    DEFAULT_LABEL_SIZE, LABEL_BRANDS, LABEL_PRESETS, brandOf, perPage, type LabelBrand, type LabelPreset, type LabelSpec,
} from '../../lib/labels/layout';
import LabelSheet from './LabelSheet';
import type { Asset } from '../../types/asset';

interface Props {
    assets: Asset[];
    orgId: string | null;
    onClose: () => void;
    onTags?: (tags: Map<string, string>) => void;
    onReloadNeeded?: () => void;
}

const PREVIEW_SCALE = 0.42;

const CUSTOM_FIELDS: Array<{ key: keyof LabelSpec; label: string; step: string }> = [
    { key: 'w', label: '라벨 너비', step: '0.1' },
    { key: 'h', label: '라벨 높이', step: '0.1' },
    { key: 'cols', label: '가로 칸 수', step: '1' },
    { key: 'rows', label: '세로 줄 수', step: '1' },
    { key: 'left', label: '왼쪽 여백', step: '0.05' },
    { key: 'top', label: '위쪽 여백', step: '0.05' },
    { key: 'hpitch', label: '가로 간격(칸 시작~다음 칸 시작)', step: '0.05' },
    { key: 'vpitch', label: '세로 간격(줄 시작~다음 줄 시작)', step: '0.05' },
];

export default function LabelPrintDialog({ assets, orgId, onClose, onTags, onReloadNeeded }: Props) {
    const lp = useLabelPrint(assets, { orgId, onTags, onReloadNeeded });
    const closeRef = useRef<HTMLButtonElement>(null);
    const { items, finish } = lp;

    // 열려 있는 동안 A4·여백 0 — 라벨 위치가 mm 단위로 맞으려면 브라우저 여백이 없어야 한다
    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = '@page { size: A4 portrait; margin: 0; }';
        document.head.appendChild(style);
        closeRef.current?.focus();
        return () => { style.remove(); };
    }, []);

    // Esc로 닫기
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lp.busy) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, lp.busy]);

    // 인쇄 영역이 그려지면 QR 이미지가 다 풀린 뒤 인쇄 창을 연다. 인쇄 창이 닫히면 인쇄 영역을 걷는다.
    useEffect(() => {
        if (!items) return;
        document.body.classList.add('label-printing');
        const after = () => finish();
        window.addEventListener('afterprint', after);
        let cancelled = false;
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.label-print-root img'));
        Promise.all(imgs.map((img) => img.decode().catch(() => undefined))).then(() => {
            if (!cancelled) window.print();
        });
        return () => {
            cancelled = true;
            window.removeEventListener('afterprint', after);
            document.body.classList.remove('label-printing');
        };
    }, [items, finish]);

    const per = perPage(lp.spec);
    const previewCells = assets.slice(0, Math.max(0, per - (Math.min(lp.startCell, per) - 1))).map((a, i) => ({
        cell: Math.min(lp.startCell, per) - 1 + i,
        item: { id: a.id, code: a.code, name: a.name ?? '', qr: lp.previewQr },
    }));
    const sub = 'text-xs text-surface-600 dark:text-surface-400';

    // 회사를 바꿨다가 돌아오면 그 회사에서 고르던 모델로 — 저장값(labelSize)은 하나라 마지막 모델만 기억해 둔다
    const brand = brandOf(lp.size);
    const lastPreset = useRef<LabelPreset>(DEFAULT_LABEL_SIZE);
    useEffect(() => { if (lp.size !== 'custom') lastPreset.current = lp.size; }, [lp.size]);
    const chooseBrand = (b: LabelBrand) => {
        if (b === brand) return;
        lp.setSize(b === 'other' ? 'custom' : lastPreset.current);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !lp.busy && onClose()} role="presentation">
            {/* Esc 닫기는 위 effect가 맡는다 (ConfirmModal과 같은 방식) */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <div
                className="glass-card w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto p-5 rounded-b-none sm:rounded-2xl animate-scale-in"
                role="dialog" aria-modal="true" aria-labelledby="label-print-title"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <h2 id="label-print-title" className="text-lg font-bold text-surface-900 dark:text-surface-100">QR 라벨 인쇄</h2>
                        <p className={sub}>{assets.length.toLocaleString('ko-KR')}건 · A4 {lp.pageCount}장</p>
                    </div>
                    <button ref={closeRef} type="button" onClick={onClose} disabled={!!lp.busy} className="btn-icon min-h-[48px] min-w-[48px]" aria-label="닫기">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="grid gap-5 md:grid-cols-[1fr_auto]">
                    <div className="space-y-4 min-w-0">
                        <fieldset>
                            <legend className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">라벨지 회사</legend>
                            <div className="grid grid-cols-2 gap-2">
                                {LABEL_BRANDS.map((b) => (
                                    <label
                                        key={b.id}
                                        className={`flex items-center justify-center gap-2 min-h-[48px] rounded-xl border text-sm font-medium cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500 ${brand === b.id
                                            ? 'border-primary-600 bg-primary-50 text-primary-800 dark:border-primary-400 dark:bg-primary-900/40 dark:text-primary-100'
                                            : 'border-surface-300 text-surface-800 dark:border-surface-600 dark:text-surface-200'}`}
                                    >
                                        <input type="radio" name="label-brand" className="sr-only" checked={brand === b.id} onChange={() => chooseBrand(b.id)} />
                                        {b.name}
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        {brand === 'formtec' ? (
                            <fieldset>
                                <legend className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">
                                    모델 <span className={`font-normal ${sub}`}>(포장지에 적힌 번호 — 앞의 LS·LQ 등은 매수 차이)</span>
                                </legend>
                                <div className="space-y-2">
                                    {(LABEL_BRANDS.find((b) => b.id === 'formtec')?.presets ?? []).map((k) => {
                                        const p = LABEL_PRESETS[k];
                                        return (
                                            <label key={k} className="flex items-center gap-3 min-h-[44px] text-sm text-surface-800 dark:text-surface-200">
                                                <input type="radio" name="label-size" checked={lp.size === k} onChange={() => lp.setSize(k)} className="w-5 h-5 accent-primary-600 flex-shrink-0" />
                                                <span><strong>{p.model}</strong> · {p.label} {p.w}×{p.h}mm <span className={sub}>(A4 {p.cols * p.rows}칸)</span></span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        ) : (
                            <div>
                                <p className="text-sm text-surface-800 dark:text-surface-200 mb-2">
                                    포장지에 적힌 치수를 넣어 주세요. <span className={sub}>애니라벨(아이라벨)은 실제 라벨지로 위치를 확인한 뒤 목록에 넣을 예정이에요.</span>
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    {CUSTOM_FIELDS.map((f) => (
                                        <label key={f.key} className="text-xs text-surface-600 dark:text-surface-300">
                                            {f.label} {f.key !== 'cols' && f.key !== 'rows' && '(mm)'}
                                            <input
                                                type="number" inputMode="decimal" step={f.step} min="0"
                                                className="input min-h-[44px] mt-1"
                                                value={Number.isFinite(lp.custom[f.key]) ? lp.custom[f.key] : ''}
                                                onChange={(e) => lp.setCustom({ ...lp.custom, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })}
                                            />
                                        </label>
                                    ))}
                                </div>
                                {lp.customError && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{lp.customError}</p>}
                            </div>
                        )}

                        <label className="block text-sm text-surface-800 dark:text-surface-200">
                            시작 칸 <span className={sub}>(쓰다 남은 라벨지 — 왼쪽 위부터 가로 순서)</span>
                            <select className="input min-h-[48px] mt-1" value={Math.min(lp.startCell, per)} onChange={(e) => lp.setStartCell(Number(e.target.value))}>
                                {Array.from({ length: per }, (_, i) => (
                                    <option key={i + 1} value={i + 1}>{i + 1}번째 칸{i === 0 ? ' (첫 칸)' : ''}</option>
                                ))}
                            </select>
                        </label>

                        {lp.managersText && (
                            <label className="flex items-center gap-3 min-h-[44px] text-sm text-surface-800 dark:text-surface-200">
                                <input type="checkbox" checked={lp.showManagers} onChange={(e) => lp.setShowManagers(e.target.checked)} className="w-5 h-5 accent-primary-600 flex-shrink-0" />
                                관리 책임자 넣기 <span className={sub}>({lp.managersText} · 작은 라벨에서는 빠져요)</span>
                            </label>
                        )}

                        <label className="flex items-center gap-3 min-h-[44px] text-sm text-surface-800 dark:text-surface-200">
                            <input type="checkbox" checked={lp.cutLines} onChange={(e) => lp.setCutLines(e.target.checked)} className="w-5 h-5 accent-primary-600 flex-shrink-0" />
                            재단선 표시 <span className={sub}>(일반 종이에 뽑아 자를 때. 칸이 나뉜 라벨지는 끄세요)</span>
                        </label>

                        <div className="rounded-xl bg-surface-50 dark:bg-surface-800 p-3 text-sm text-surface-700 dark:text-surface-300 space-y-1">
                            <p className="font-medium">인쇄 창에서 꼭 확인하세요</p>
                            <ul className="list-disc pl-5 space-y-0.5">
                                <li>용지 A4, 배율 <strong>실제 크기(100%)</strong></li>
                                <li>여백 <strong>없음</strong>, 머리글·바닥글 끄기</li>
                                <li>처음에는 일반 종이 1장에 뽑아 라벨지에 겹쳐 보고 맞으면 라벨지에 인쇄</li>
                            </ul>
                        </div>
                    </div>

                    <div className="md:w-[calc(210mm*0.42)]">
                        <p className={`${sub} mb-1`}>미리보기 (첫 장)</p>
                        <div
                            className="border border-surface-200 dark:border-surface-600 rounded-md overflow-hidden mx-auto"
                            style={{ width: `calc(210mm * ${PREVIEW_SCALE})`, height: `calc(297mm * ${PREVIEW_SCALE})` }}
                            aria-hidden="true"
                        >
                            <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
                                <LabelSheet spec={lp.spec} cells={previewCells} orgName={lp.orgName} managers={lp.showManagers ? lp.managersText : ''} cutLines={lp.cutLines} />
                            </div>
                        </div>
                        <p className={`${sub} mt-1 text-center`}>미리보기의 QR은 모양만 보여 줍니다</p>
                    </div>
                </div>

                {lp.error && <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">{lp.error}</p>}
                {lp.busy && (
                    <p className="mt-4 text-sm text-surface-600 dark:text-surface-300" role="status">
                        {lp.busy === 'issuing'
                            ? `라벨 번호를 저장하는 중${lp.progress ? ` (${lp.progress.done}/${lp.progress.total})` : ''}…`
                            : 'QR을 만드는 중…'}
                    </p>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end mt-5">
                    <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={onClose} disabled={!!lp.busy}>닫기</button>
                    <button type="button" className="btn-primary min-h-[48px] px-5" onClick={() => void lp.prepare()}
                        disabled={!!lp.busy || assets.length === 0 || !!lp.customError}>
                        {assets.length.toLocaleString('ko-KR')}장 인쇄
                    </button>
                </div>
            </div>

            {lp.pages && createPortal(
                <div className="label-print-root" aria-hidden="true">
                    {lp.pages.map((cells, i) => (
                        <LabelSheet key={i} spec={lp.spec} cells={cells} orgName={lp.orgName} managers={lp.showManagers ? lp.managersText : ''} cutLines={lp.cutLines} />
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
}
