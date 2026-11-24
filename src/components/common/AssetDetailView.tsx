/**
 * AssetDetailView — 재물 한 건 (기획서 F08)
 *
 * 관리자(`/admin/assets/:assetId`)와 직원(`/employee/assets/:assetId`)이 함께 쓴다.
 * 라벨 QR을 휴대폰 기본 카메라로 찍으면 `/t/태그ID` → 이 화면으로 온다.
 * 금액·변경 이력·라벨 인쇄는 관리자에게만 보인다(사용자 결정 2026-11-21: 금액은 관리자만).
 */
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import useAssetDetail from '../../hooks/useAssetDetail';
import { StatusBadge, MissingBadge, UsefulLifeOverBadge } from './AssetBadges';
import { usefulLifeEnd, isUsefulLifeOver } from '../../lib/usefulLife';
import AssetPhoto from './AssetPhoto';
import { COMPARE_FIELD_LABEL, type CompareField } from '../../lib/import/diff';
import { ASSET_STATUS_LABEL } from '../../lib/import/values';
import { toDateOrNull, toLocalDateStr } from '../../lib/dateUtils';
import type { Asset, HistoryEntry } from '../../types/asset';
import type { Space } from '../../types/space';
import type { AssetCheck } from '../../types/assetCheck';

const sub = 'text-xs text-surface-600 dark:text-surface-400';
const won = (n: number | null | undefined) => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`);

function when(ts: HistoryEntry['at']): string {
    const d = toDateOrNull(ts ?? null);
    if (!d) return '-';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function showValue(field: string, value: unknown, spaces: Space[]): string {
    if (value == null || value === '') return '(빈 칸)';
    if (field === 'spaceId') return spaces.find((s) => s.id === value)?.name ?? '(지운 공간)';
    if (field === 'status') return ASSET_STATUS_LABEL[value as keyof typeof ASSET_STATUS_LABEL] ?? String(value);
    if (field === 'missingFromSource') return value ? '예' : '아니오';
    if (field === 'amount' || field === 'depreciation' || field === 'residual') return won(value as number);
    return String(value);
}

const HISTORY_TYPE_LABEL: Record<HistoryEntry['type'], string> = {
    'import-change': '다시 가져오기로 바뀜',
    'import-missing': '대장에서 빠짐',
    'manual-create': '직접 등록',
    'manual-edit': '직접 고침',
};

/** 라벨 인쇄 대화상자 — 관리자 화면이 넘겨준다(공용 화면이 관리자 컴포넌트를 직접 부르지 않게) */
export type RenderLabelPrint = (p: {
    assets: Asset[];
    orgId: string | null;
    onClose: () => void;
    onTags: (tags: Map<string, string>) => void;
    onReloadNeeded: () => void;
}) => ReactNode;

interface Props {
    /** 관리자 화면 — 금액·변경 이력을 읽는다 */
    admin: boolean;
    /** 있으면 라벨 인쇄 버튼을 보인다 */
    renderLabelPrint?: RenderLabelPrint;
}

/** 마지막 확인 한 줄 — "2026-11-22 · QR" / "2026-11-20 · 조사(본관 2층 상담실)" */
function checkText(check: AssetCheck | null, spaces: Space[]): string | null {
    const at = check ? toDateOrNull(check.checkedAt ?? null) : null;
    if (!check || !at) return null;
    const where = check.spaceId ? spaces.find((s) => s.id === check.spaceId)?.name : undefined;
    const via = check.via === 'survey' ? `조사${where ? `(${where})` : ''}` : 'QR';
    return `${toLocalDateStr(at)} · ${via}`;
}

export default function AssetDetailView({ admin, renderLabelPrint }: Props) {
    const { assetId } = useParams<{ assetId: string }>();
    const d = useAssetDetail(assetId, { admin });
    // 라벨 QR로 열었으면(TagRedirect) 방금 확인 기록을 남겼다 — 서버 시각이 돌아오기 전이라 따로 알린다
    const justChecked = (useLocation().state as { justChecked?: boolean } | null)?.justChecked === true;
    const [printing, setPrinting] = useState(false);
    const listPath = admin ? '/admin/assets' : '/employee/assets';

    if (d.loading) return <div className="flex justify-center py-20" role="status" aria-label="재물 정보를 불러오는 중"><div className="w-8 h-8 spinner" aria-hidden="true" /></div>;
    if (d.error || d.notFound || !d.asset) {
        return (
            <div className="max-w-lg mx-auto glass-card p-6 text-center">
                {/* 무엇을 하면 되는지까지 적는다 — 글자만 있으면 다음 할 일을 몰랐다 */}
                <p className="text-surface-700 dark:text-surface-300 mb-4 break-keep" role="alert">
                    {d.notFound
                        ? '이 기관에 없는 재물입니다. 지운 재물이거나 다른 기관의 라벨일 수 있어요. 재물 목록에서 찾아보세요.'
                        : '재물 정보를 불러오지 못했습니다. 인터넷 연결을 확인하고 [다시 불러오기]를 눌러 주세요.'}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                    {!d.notFound && <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void d.reload()}>다시 불러오기</button>}
                    <Link to={listPath} className="btn-primary min-h-[48px] px-5">목록으로</Link>
                </div>
            </div>
        );
    }

    const a = d.asset;
    const lifeOver = isUsefulLifeOver(a);
    const rows: Array<[string, string | null]> = [
        ['분류', a.category],
        ['규격', a.spec],
        ['취득일자', a.acquiredAt],
        ['수량', a.quantity == null ? null : `${a.quantity}${a.acquiredQuantity != null && a.acquiredQuantity !== a.quantity ? ` (취득 ${a.acquiredQuantity})` : ''}`],
        // 내용연수 — 취득일자가 있으면 끝나는 날도 함께(2026-11-22)
        ['내용연수', a.usefulLife == null ? null : (() => {
            const end = usefulLifeEnd(a.acquiredAt, a.usefulLife);
            return `${a.usefulLife}년${end ? ` (${end}까지${lifeOver ? ' · 지났습니다' : ''})` : ''}`;
        })()],
        ['공간', d.space ? `${d.spaceLocation ? `${d.spaceLocation} ` : ''}${d.space.name}${d.space.archived ? ' (삭제한 공간)' : ''}` : a.spaceId ? '(지운 공간)' : '미지정'],
        ['대장의 위치', a.locationRaw],
        ['마지막 확인', justChecked ? '방금 (QR)' : checkText(d.check, d.spaces)],
        ['대장의 상태', a.statusRaw],
        ['부서', a.department],
        ['용도', a.usage],
    ];

    return (
        <div className="max-w-2xl mx-auto animate-fade-in space-y-4">
            <div className="flex items-center justify-between gap-2">
                <Link to={listPath} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 dark:text-primary-300 min-h-[48px] pr-2">
                    <span aria-hidden="true">←</span> 재물 목록
                </Link>
                {admin && (
                    <Link to={`/admin/assets/${encodeURIComponent(a.id)}/edit`} className="btn-secondary btn-sm min-h-[48px] px-4">고치기</Link>
                )}
            </div>

            <section className="glass-card p-5">
                <AssetPhoto asset={a} admin={admin} onChanged={d.applyPhoto} />
                <div className="flex flex-wrap items-center gap-2 mb-1">
                    <StatusBadge status={a.status} />
                    {a.missingFromSource && <MissingBadge />}
                    {lifeOver && <UsefulLifeOverBadge />}
                </div>
                <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 break-keep">{a.name ?? '(품명 없음)'}</h1>
                <p className="font-mono text-surface-700 dark:text-surface-300">{a.code}</p>
                {justChecked && (
                    <p className="mt-3 text-sm text-green-800 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-xl p-3" role="status">
                        ✅ 확인 기록을 남겼습니다. 재물 목록에서 마지막 확인 날짜로 오래 못 본 재물을 찾을 수 있어요.
                    </p>
                )}
                {a.missingFromSource && (
                    <p className="mt-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                        마지막으로 가져온 대장 파일에 이 재물이 없었습니다. 실제로 없어진 것인지 확인해 주세요.
                    </p>
                )}
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    {rows.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-surface-600 dark:text-surface-400">{label}</dt>
                            <dd className="text-surface-900 dark:text-surface-100 break-words">{value ?? '-'}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            {admin && (
                <section className="glass-card p-5" aria-labelledby="asset-money">
                    <h2 id="asset-money" className="font-semibold text-surface-900 dark:text-surface-100 mb-1">금액</h2>
                    <p className={`${sub} mb-3`}>희망이음 대장의 값을 그대로 보여 줍니다. 관리자만 볼 수 있습니다.</p>
                    {/* 휴대폰에서는 한 줄에 하나 — 세 칸이면 큰 금액이 칸을 넘어 화면이 옆으로 밀렸다 */}
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                        {([['자산금액', d.accounting?.amount], ['감가상각충당금', d.accounting?.depreciation], ['잔존가액', d.accounting?.residual]] as const).map(([label, v]) => (
                            <div key={label} className="rounded-xl bg-surface-50 dark:bg-surface-800 p-3">
                                <dt className={sub}>{label}</dt>
                                <dd className="font-semibold text-surface-900 dark:text-surface-100 tabular-nums">{won(v)}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}

            <section className="glass-card p-5" aria-labelledby="asset-label">
                <h2 id="asset-label" className="font-semibold text-surface-900 dark:text-surface-100 mb-1">QR 라벨</h2>
                <p className="text-sm text-surface-700 dark:text-surface-300">
                    {a.tagId ? <>라벨 있음 · 라벨 번호 <span className="font-mono">{a.tagId}</span></> : '아직 라벨이 없습니다.'}
                </p>
                {renderLabelPrint && (
                    <button type="button" className="btn-secondary min-h-[48px] px-4 mt-3" onClick={() => setPrinting(true)}>
                        {a.tagId ? '라벨 다시 인쇄' : '라벨 인쇄'}
                    </button>
                )}
                {renderLabelPrint && a.tagId && <p className={`${sub} mt-2`}>다시 인쇄해도 같은 QR이 나옵니다(훼손된 라벨 바꿔 붙이기).</p>}
            </section>

            {admin && (
                <section className="glass-card p-5" aria-labelledby="asset-history">
                    <h2 id="asset-history" className="font-semibold text-surface-900 dark:text-surface-100 mb-3">변경 이력</h2>
                    {d.history.length === 0 ? (
                        <p className="text-sm text-surface-600 dark:text-surface-400">처음 가져온 뒤 바뀐 내용이 없습니다.</p>
                    ) : (
                        <ol className="space-y-3">
                            {d.history.map((h) => (
                                <li key={h.id} className="text-sm">
                                    <p className="text-surface-900 dark:text-surface-100 font-medium">
                                        {HISTORY_TYPE_LABEL[h.type]} <span className={`${sub} font-normal`}>{when(h.at)}</span>
                                    </p>
                                    <ul className="mt-1 space-y-0.5 text-surface-700 dark:text-surface-300 break-words">
                                        {Object.entries(h.changes).map(([f, ch]) => (
                                            <li key={f}>
                                                {COMPARE_FIELD_LABEL[f as CompareField] ?? (f === 'photo' ? '사진' : f)}: {showValue(f, ch.before, d.spaces)} → {showValue(f, ch.after, d.spaces)}
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            )}

            {printing && renderLabelPrint?.({
                assets: [a], orgId: d.orgId, onClose: () => setPrinting(false), onTags: d.applyTags, onReloadNeeded: () => void d.reload(),
            })}
        </div>
    );
}
