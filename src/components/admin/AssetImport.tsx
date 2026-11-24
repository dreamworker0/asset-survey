/**
 * AssetImport — 재물 엑셀 가져오기 (기관 관리자 전용, 기획서 F04~F07)
 *
 * 상태와 저장은 useAssetImport가 맡고, 여기는 표시만 한다.
 * 파일은 브라우저에서 읽고 서버로 보내지 않는다 — 값만 저장한다.
 */
import { useState, type ChangeEvent } from 'react';
import { groupSpacesByLocation } from '../../lib/spaceGroups';
import { useNavigate } from 'react-router-dom';
import useAssetImport from '../../hooks/useAssetImport';
import { IMPORT_FIELDS, FIELD_DEF, missingRecommended, type ImportField } from '../../lib/import/columns';
import { ASSET_STATUS_LABEL } from '../../lib/import/values';
import { downloadImportTemplate } from '../../lib/import/template';
import { useToast } from '../../hooks/useToast';
import { COMPARE_FIELD_LABEL as COMPARE_LABEL, type CompareField, type ChangedAsset } from '../../lib/import/diff';
import type { Space } from '../../types/space';

const won = (n: number | null | undefined) => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`);


function showValue(field: CompareField, value: unknown, spaces: Space[]): string {
    if (value == null || value === '') return '(빈 칸)';
    if (field === 'spaceId') return spaces.find((s) => s.id === value)?.name ?? '(알 수 없는 공간)';
    if (field === 'status') return ASSET_STATUS_LABEL[value as keyof typeof ASSET_STATUS_LABEL] ?? String(value);
    if (field === 'missingFromSource') return value ? '예' : '아니오';
    if (field === 'amount' || field === 'depreciation' || field === 'residual') return won(value as number);
    return String(value);
}

const card = 'glass-card p-5 mb-4';
const h2 = 'text-lg font-semibold text-surface-900 dark:text-surface-100 mb-1';
const sub = 'text-xs text-surface-600 dark:text-surface-400';

/** 단계 표시 — 몇 단계 중 어디인지 몰라 '다음'을 누를 때마다 무엇이 나올지 알 수 없었다(2026-11-22 점검) */
const STEPS = [
    { key: 'pick', label: '파일 고르기' },
    { key: 'map', label: '열 연결·검사' },
    { key: 'compare', label: '공간·바뀌는 내용' },
    { key: 'done', label: '저장' },
] as const;

function StepIndicator({ step }: { step: string }) {
    const current = step === 'saving' ? 3 : Math.max(0, STEPS.findIndex((x) => x.key === step));
    return (
        <ol className="flex gap-1 mb-5" aria-label="가져오기 단계">
            {STEPS.map((x, i) => {
                const state = i < current ? 'done' : i === current ? 'current' : 'todo';
                return (
                    <li key={x.key} aria-current={state === 'current' ? 'step' : undefined}
                        className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs font-medium border ${state === 'current'
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : state === 'done'
                                ? 'bg-primary-50 border-primary-200 text-primary-800 dark:bg-primary-900/30 dark:border-primary-800 dark:text-primary-200'
                                : 'bg-white border-surface-300 text-surface-600 dark:bg-surface-800 dark:border-surface-600 dark:text-surface-400'}`}>
                        <span className="tabular-nums">{state === 'done' ? '✓' : i + 1}</span>
                        <span className="hidden sm:inline"> {x.label}</span>
                        <span className="sr-only sm:hidden"> {x.label}{state === 'done' ? ' (마침)' : ''}</span>
                    </li>
                );
            })}
        </ol>
    );
}

export default function AssetImport() {
    const navigate = useNavigate();
    const im = useAssetImport();
    const { showToast } = useToast();

    const handleTemplate = async () => {
        try {
            await downloadImportTemplate();
        } catch {
            showToast('양식 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
        }
    };

    const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) im.pickFile(file);
    };

    return (
        <div className="max-w-3xl mx-auto animate-fade-in">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">재물 가져오기</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">
                희망이음에서 내려받은 고정자산대장이나 기관이 쓰는 재물 대장 엑셀을 올립니다. 파일은 서버로 보내지 않고
                이 브라우저에서 읽으며, 확인을 마친 값만 저장합니다. 다시 올리면 바뀐 것만 반영합니다.
            </p>

            <StepIndicator step={im.step} />
            {/* 휴대폰에서는 단계 이름을 숨겨 칸만 보이므로 지금 단계 이름을 따로 적는다 */}
            <p className="sm:hidden -mt-3 mb-4 text-sm font-medium text-primary-700 dark:text-primary-300" aria-hidden="true">
                {STEPS[im.step === 'saving' ? 3 : Math.max(0, STEPS.findIndex((x) => x.key === im.step))].label}
            </p>

            {im.error && (
                <div role="alert" className="mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-300">
                    {im.error}
                </div>
            )}

            {im.step === 'pick' && (
                <div className={card}>
                    <label htmlFor="import-file" className="block font-semibold text-surface-900 dark:text-surface-100 mb-2">엑셀 파일 고르기</label>
                    <input id="import-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={im.working}
                        className="block w-full text-sm text-surface-700 dark:text-surface-300 min-h-[48px] file:mr-3 file:min-h-[48px] file:px-4 file:rounded-xl file:border-0 file:bg-primary-600 file:text-white file:font-semibold file:cursor-pointer hover:file:bg-primary-700 disabled:opacity-50" />
                    {im.working && <p className={`${sub} mt-2`}>파일을 읽는 중입니다…</p>}
                    <ul className={`${sub} mt-4 space-y-1 list-disc pl-5`}>
                        <li>머리글(자산코드·품명 등) 줄은 자동으로 찾습니다. 제목 줄·합계 줄이 있어도 됩니다.</li>
                        <li>열 이름이 달라도 이름으로 맞추고, 못 알아본 열은 다음 화면에서 직접 고릅니다.</li>
                        <li>사람 이름이 든 열(현 사용자 등)은 가져오지 않습니다.</li>
                    </ul>
                    {/* 대장 엑셀이 없는 기관용 — 채워서 그대로 올리면 열이 저절로 맞는다 (2026-11-22) */}
                    <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700 flex flex-col sm:flex-row sm:items-center gap-3">
                        <p className="text-sm text-surface-700 dark:text-surface-300 flex-1">
                            희망이음이나 기관 대장 엑셀이 없나요? 빈 양식을 내려받아 채워서 올리세요.
                        </p>
                        <button type="button" onClick={() => void handleTemplate()} className="btn-secondary min-h-[48px] px-4 flex-shrink-0">
                            양식 내려받기
                        </button>
                    </div>
                </div>
            )}

            {(im.step === 'map' || im.step === 'compare') && im.table && (
                <MapSection im={im} locked={im.step === 'compare'} />
            )}
            {(im.step === 'map' || im.step === 'compare') && !im.table && (
                <HeaderRowPicker im={im} />
            )}

            {im.step === 'map' && im.blockers.length > 0 && (
                <p className="text-sm text-red-700 dark:text-red-300 text-right mb-2">위 &lsquo;검사 결과&rsquo;의 빨간 문제를 고쳐야 다음으로 갈 수 있습니다.</p>
            )}
            {im.step === 'map' && (
                <div className="flex flex-col sm:flex-row gap-2 justify-end mb-8">
                    <button type="button" onClick={im.reset} className="btn-secondary min-h-[48px] px-4">다른 파일 고르기</button>
                    <button type="button" onClick={im.goCompare} disabled={im.working || im.blockers.length > 0 || !im.parsed}
                        className="btn-primary min-h-[48px] px-5">
                        {im.working ? '불러오는 중…' : '다음: 위치와 바뀌는 내용 보기'}
                    </button>
                </div>
            )}

            {im.step === 'compare' && <CompareSection im={im} />}

            {im.step === 'saving' && (
                <div className={card} aria-live="polite">
                    <h2 className={h2}>저장하는 중</h2>
                    <p className={sub}>창을 닫지 마세요. {im.progress && im.progress.total > 0 ? `${im.progress.done} / ${im.progress.total}건` : ''}</p>
                    <div className="mt-3 h-2 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden"
                        role="progressbar" aria-label="저장 진행" aria-valuemin={0} aria-valuemax={im.progress?.total || 100} aria-valuenow={im.progress?.done ?? 0}>
                        <div className="h-full bg-primary-600 dark:bg-primary-400 transition-all"
                            style={{ width: `${im.progress && im.progress.total > 0 ? Math.round((im.progress.done / im.progress.total) * 100) : 5}%` }} />
                    </div>
                </div>
            )}

            {im.step === 'done' && im.result && (
                <div className={card}>
                    <div className="text-4xl mb-2" aria-hidden="true">✅</div>
                    <h2 className={h2}>가져오기를 마쳤습니다</h2>
                    <p className="text-sm text-surface-700 dark:text-surface-300 tabular-nums">
                        새로 등록 {im.result.added}건 · 바뀜 {im.result.changed}건 · 그대로 {im.result.unchanged}건
                        {im.result.missing > 0 && ` · 대장에 없음 표시 ${im.result.missing}건`}
                    </p>
                    <p className={`${sub} mt-2`}>재물 목록에서 공간으로 거른 뒤 &lsquo;모두 고르기&rsquo; → [라벨 인쇄]로 QR 라벨을 뽑을 수 있습니다.</p>
                    <div className="flex flex-col sm:flex-row gap-2 mt-4">
                        <button type="button" onClick={() => navigate('/admin/assets')} className="btn-primary min-h-[48px] px-4">재물 목록 보기</button>
                        <button type="button" onClick={im.reset} className="btn-secondary min-h-[48px] px-4">다른 파일 가져오기</button>
                    </div>
                </div>
            )}
        </div>
    );
}

type Im = ReturnType<typeof useAssetImport>;

function HeaderRowPicker({ im }: { im: Im }) {
    const [row, setRow] = useState('1');
    return (
        <div className={card}>
            <h2 className={h2}>머리글 줄 고르기</h2>
            <p className={`${sub} mb-3`}>자산코드·품명 같은 열 이름이 적힌 줄 번호를 엑셀에서 확인해 적어 주세요.</p>
            <div className="flex flex-wrap gap-2">
                <label htmlFor="header-row" className="sr-only">머리글 줄 번호</label>
                <input id="header-row" type="number" min={1} value={row} onChange={(e) => setRow(e.target.value)} className="input w-28 min-h-[48px]" />
                <button type="button" onClick={() => im.selectHeaderRow(Number(row) || 1)} className="btn-secondary min-h-[48px] px-4">이 줄로</button>
                <button type="button" onClick={im.reset} className="btn-secondary min-h-[48px] px-4">다른 파일</button>
            </div>
        </div>
    );
}

function MapSection({ im, locked }: { im: Im; locked: boolean }) {
    const table = im.table!;
    const parsed = im.parsed;
    const firstRow = table.dataRows.find((r) => r.cells.some((c) => String(c ?? '').trim() !== ''));
    const sample = (header: string | undefined) => {
        if (!header || !firstRow) return '';
        const v = firstRow.cells[table.headers.indexOf(header)];
        return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
    };
    const usedHeaders = new Set(Object.values(im.columnMap));
    const unusedHeaders = table.headers.filter((h) => !usedHeaders.has(h));
    const totalMatches = im.reportedTotal != null && parsed ? im.reportedTotal === parsed.amountTotals.all : null;

    return (
        <>
            <div className={card}>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h2 className={h2}>파일</h2>
                        <p className="text-sm text-surface-700 dark:text-surface-300 break-all">{im.fileName}</p>
                        <p className={sub}>머리글: {table.headerRowIndex + 1}번째 줄 · 데이터 {table.dataRows.length}줄</p>
                    </div>
                    {!locked && <button type="button" onClick={im.reset} className="btn-secondary btn-sm min-h-[48px] px-3 flex-shrink-0">다른 파일</button>}
                </div>
                {im.sheets.length > 1 && (
                    <div className="mt-3">
                        <label htmlFor="import-sheet" className={`${sub} block mb-1`}>시트</label>
                        <select id="import-sheet" value={im.sheetIndex} onChange={(e) => im.selectSheet(Number(e.target.value))}
                            disabled={locked} className="input w-full min-h-[48px]">
                            {im.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                        </select>
                    </div>
                )}
                {!locked && (
                    <details className="mt-3 group">
                        <summary className="btn-secondary btn-sm min-h-[48px] list-none [&::-webkit-details-marker]:hidden inline-flex cursor-pointer"><span aria-hidden="true" className="group-open:rotate-90 transition-transform">▸</span> 머리글 줄이 틀렸나요?</summary>
                        <HeaderRowPicker im={im} />
                    </details>
                )}
            </div>

            <div className={card}>
                <h2 className={h2}>열 연결</h2>
                <p className={`${sub} mb-3`}>엑셀의 어느 열을 무엇으로 쓸지 정합니다. <span className="text-red-700 dark:text-red-300">*</span> 표시는 꼭 연결해야 하는 칸입니다. 정한 연결은 다음 가져오기 때 다시 씁니다. 금액은 관리자만 봅니다.</p>
                <ul className="divide-y divide-surface-100 dark:divide-surface-700">
                    {IMPORT_FIELDS.map((def) => {
                        const header = im.columnMap[def.field];
                        const id = `col-${def.field}`;
                        return (
                            <li key={def.field} className="py-2 grid grid-cols-1 sm:grid-cols-[9rem_1fr_9rem] gap-1 sm:gap-3 sm:items-center">
                                <label htmlFor={id} className="text-sm font-medium text-surface-800 dark:text-surface-200">
                                    {def.label}{def.required && <><span className="text-red-700 dark:text-red-300" aria-hidden="true"> *</span><span className="sr-only"> (필수)</span></>}
                                    {def.accounting && <span className={`${sub} ml-1`}>(관리자만)</span>}
                                </label>
                                <select id={id} value={header ?? ''} disabled={locked}
                                    onChange={(e) => im.setColumn(def.field as ImportField, e.target.value)}
                                    className="input w-full min-h-[48px]">
                                    <option value="">(가져오지 않음)</option>
                                    {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                                </select>
                                <span className={`${sub} line-clamp-2 break-all`}>{sample(header) && `예: ${sample(header)}`}</span>
                            </li>
                        );
                    })}
                </ul>
                {unusedHeaders.length > 0 && (
                    <p className={`${sub} mt-3`}>가져오지 않는 열: {unusedHeaders.join(', ')}</p>
                )}
                {/* 자주 쓰는 열을 빠뜨렸으면 미리 알린다(다음 단계로 갈 때도 한 번 묻는다) */}
                {!locked && missingRecommended(im.columnMap).length > 0 && (
                    <p className="mt-3 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                        <span aria-hidden="true">⚠️ </span>
                        <b>{missingRecommended(im.columnMap).map((f) => FIELD_DEF[f].label).join(', ')}</b> 열을 연결하지 않았습니다.
                        엑셀에 이런 열이 있으면 위에서 골라 주세요. 없으면 그대로 두셔도 됩니다.
                    </p>
                )}
            </div>

            {parsed && (
                <div className={card}>
                    <h2 className={h2}>검사 결과</h2>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
                        {([['전체', parsed.counts.total], ['운영', parsed.counts.active], ['불용', parsed.counts.inactive], ['폐기', parsed.counts.disposed]] as const).map(([label, n]) => (
                            <div key={label} className="rounded-xl bg-surface-50 dark:bg-surface-800 p-3">
                                <dt className={sub}>{label}</dt>
                                <dd className="text-lg font-bold text-surface-900 dark:text-surface-100 tabular-nums">{n.toLocaleString('ko-KR')}건</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="text-sm text-surface-700 dark:text-surface-300">
                        자산금액 합 {won(parsed.amountTotals.all)} (운영 {won(parsed.amountTotals.active)})
                    </p>
                    {totalMatches != null && (
                        <p className={`text-sm mt-1 ${totalMatches ? 'text-accent-700 dark:text-accent-300' : 'text-amber-800 dark:text-amber-300'}`}>
                            {totalMatches
                                ? `✓ 대장 합계 줄(${won(im.reportedTotal)})과 같습니다.`
                                : `⚠ 대장 합계 줄은 ${won(im.reportedTotal)}입니다. 차이 ${won(Math.abs((im.reportedTotal ?? 0) - parsed.amountTotals.all))} — 빠진 줄이나 금액을 읽지 못한 칸이 있는지 확인해 주세요.`}
                        </p>
                    )}
                    {(parsed.noCodeRows.length > 0 || parsed.totalRows.length > 0 || parsed.blankRows > 0) && (
                        <p className={`${sub} mt-2`}>
                            세지 않은 줄: 합계·소계 {parsed.totalRows.length}줄, 코드 없음 {parsed.noCodeRows.length}줄
                            {parsed.noCodeRows.length > 0 && ` (${parsed.noCodeRows.slice(0, 10).join(', ')}${parsed.noCodeRows.length > 10 ? '…' : ''}번째 줄)`},
                            빈 줄 {parsed.blankRows}줄
                        </p>
                    )}
                    {parsed.duplicates.length > 0 && (
                        <div className="mt-3 text-sm text-red-700 dark:text-red-300">
                            <p className="font-medium">자산코드가 겹칩니다 — 엑셀에서 고친 뒤 다시 올려 주세요.</p>
                            <ul className="list-disc pl-5">
                                {parsed.duplicates.slice(0, 10).map((d) => <li key={d.code}>{d.code}: {d.rowNumbers.join(', ')}번째 줄</li>)}
                                {parsed.duplicates.length > 10 && <li>…외 {parsed.duplicates.length - 10}개 코드</li>}
                            </ul>
                        </div>
                    )}
                    {parsed.problems.length > 0 && (
                        <details className="mt-3 group">
                            <summary className="btn-secondary btn-sm min-h-[48px] list-none [&::-webkit-details-marker]:hidden inline-flex cursor-pointer text-amber-800 dark:text-amber-300">
                                <span aria-hidden="true" className="group-open:rotate-90 transition-transform">▸</span> 확인할 것 {parsed.problems.length}건 (저장은 됩니다)
                            </summary>
                            <ul className={`${sub} space-y-1 mt-1`}>
                                {parsed.problems.slice(0, 50).map((p, i) => (
                                    <li key={i}>{p.rowNumber}번째 줄 · {p.message}{p.value && ` (원문: ${p.value})`}</li>
                                ))}
                                {parsed.problems.length > 50 && <li>…외 {parsed.problems.length - 50}건</li>}
                            </ul>
                        </details>
                    )}
                    {im.blockers.length > 0 && (
                        <ul className="mt-3 text-sm text-red-700 dark:text-red-300 list-disc pl-5">
                            {im.blockers.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                    )}
                </div>
            )}
        </>
    );
}

function CompareSection({ im }: { im: Im }) {
    const diff = im.diff;
    const activeSpaces = im.spaces.filter((s) => !s.archived);
    // 건물을 등록했으면 공간 고르기를 건물·층으로 묶는다
    const spaceGroups = im.buildings.some((b) => !b.archived) ? groupSpacesByLocation(activeSpaces, im.buildings) : null;
    const [showChanged, setShowChanged] = useState(false);
    const [showMissing, setShowMissing] = useState(false);
    if (!diff) return null;

    return (
        <>
            <div className={card}>
                <h2 className={h2}>위치 → 공간</h2>
                <p className={`${sub} mb-3`}>
                    대장의 위치를 앱의 공간에 연결합니다. 이름이 같은 공간은 미리 골라 두었습니다. 정한 연결은 다음 가져오기 때 다시 씁니다.
                </p>
                <ul className="divide-y divide-surface-100 dark:divide-surface-700">
                    {im.locations.map((loc) => {
                        const id = `loc-${loc.key}`;
                        return (
                            <li key={loc.key} className="py-2 grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-2 sm:items-center">
                                <label htmlFor={id} className="text-sm text-surface-800 dark:text-surface-200 break-keep">
                                    {loc.location ?? '(위치 없음)'} <span className={sub}>{loc.count}건</span>
                                </label>
                                <div className="flex gap-2">
                                    <select id={id} value={im.locationMap[loc.key] ?? ''} onChange={(e) => im.setLocationSpace(loc.key, e.target.value)}
                                        className="input flex-1 min-h-[48px]">
                                        <option value="">(공간 정하지 않음)</option>
                                        {spaceGroups ? spaceGroups.filter((g) => g.count > 0).map((g) => (
                                            <optgroup key={g.buildingId ?? 'none'} label={g.label}>
                                                {g.floors.flatMap((f) => f.spaces.map((s) => (
                                                    <option key={s.id} value={s.id}>{g.buildingId ? `${g.label}${f.floor ? ` ${f.label}` : ""} ${s.name}` : s.name}</option>
                                                )))}
                                            </optgroup>
                                        )) : activeSpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    {loc.location && !im.locationMap[loc.key] && (
                                        <button type="button" onClick={() => im.createSpaceFor(loc.key, loc.location)} disabled={im.working}
                                            className="btn-secondary min-h-[48px] px-3 text-sm flex-shrink-0" aria-label={`${loc.location} 이름으로 공간 만들기`}>
                                            공간 만들기
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div className={card}>
                <h2 className={h2}>바뀌는 내용</h2>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
                    {([['새로 등록', diff.added.length], ['바뀜', diff.changed.length], ['대장에 없음', diff.missing.length], ['그대로', diff.unchanged]] as const).map(([label, n]) => (
                        <div key={label} className="rounded-xl bg-surface-50 dark:bg-surface-800 p-3">
                            <dt className={sub}>{label}</dt>
                            <dd className="text-lg font-bold text-surface-900 dark:text-surface-100 tabular-nums">{n.toLocaleString('ko-KR')}건</dd>
                        </div>
                    ))}
                </dl>
                {diff.changed.length > 0 && (
                    <div className="mb-2">
                        <button type="button" onClick={() => setShowChanged((v) => !v)} aria-expanded={showChanged}
                            className="btn-secondary btn-sm min-h-[48px]">
                            <span aria-hidden="true">{showChanged ? '▾' : '▸'}</span> 바뀌는 재물 보기
                        </button>
                        {showChanged && <div className="mt-2"><ChangedList items={diff.changed} spaces={im.spaces} /></div>}
                    </div>
                )}
                {diff.missing.length > 0 && (
                    <div>
                        <p className="text-sm text-amber-800 dark:text-amber-300">
                            이번 파일에 없는 재물 {diff.missing.length}건은 지우지 않고 &lsquo;대장에 없음&rsquo;으로 표시합니다.
                        </p>
                        <button type="button" onClick={() => setShowMissing((v) => !v)} aria-expanded={showMissing}
                            className="btn-secondary btn-sm min-h-[48px] mt-2">
                            <span aria-hidden="true">{showMissing ? '▾' : '▸'}</span> 대장에 없는 재물 보기
                        </button>
                        {showMissing && (
                            <ul className={`${sub} space-y-1 mt-2`}>
                                {diff.missing.slice(0, 100).map((a) => <li key={a.id}>{a.code} · {a.name ?? '(품명 없음)'}</li>)}
                                {diff.missing.length > 100 && <li>…외 {diff.missing.length - 100}건</li>}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-end mb-8">
                <button type="button" onClick={im.backToMap} className="btn-secondary min-h-[48px] px-4">열 연결로 돌아가기</button>
                <button type="button" onClick={im.confirmImport}
                    disabled={im.working || (diff.added.length + diff.changed.length + diff.missing.length === 0)}
                    className="btn-primary min-h-[48px] px-5">
                    {diff.added.length + diff.changed.length + diff.missing.length === 0 ? '바뀐 것이 없습니다' : '가져오기 확정'}
                </button>
            </div>
        </>
    );
}

function ChangedList({ items, spaces }: { items: ChangedAsset[]; spaces: Space[] }) {
    return (
        <ul className="space-y-2">
            {items.slice(0, 100).map((c) => (
                <li key={c.draft.id} className="rounded-xl bg-surface-50 dark:bg-surface-800 p-3 text-sm">
                    <p className="font-medium text-surface-900 dark:text-surface-100">{c.draft.fields.code} · {c.draft.fields.name ?? '(품명 없음)'}</p>
                    <ul className={`${sub} mt-1`}>
                        {(Object.entries(c.changes) as Array<[CompareField, { before: unknown; after: unknown }]>).map(([f, ch]) => (
                            <li key={f}>{COMPARE_LABEL[f]}: {showValue(f, ch.before, spaces)} → {showValue(f, ch.after, spaces)}</li>
                        ))}
                    </ul>
                </li>
            ))}
            {items.length > 100 && <li className={sub}>…외 {items.length - 100}건</li>}
        </ul>
    );
}
