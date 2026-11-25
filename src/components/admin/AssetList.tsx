/**
 * AssetList — 관리자 재물 목록 (기획서 F08) · 라벨 인쇄할 재물 고르기 (F09)
 *
 * 넓은 화면은 표, 휴대폰은 카드. 검색·공간·상태·라벨·대장에 없음으로 거르고, 고른 재물을 한꺼번에
 * 라벨 인쇄한다(공간별 인쇄는 공간으로 거른 뒤 '모두 고르기'). 건물·층 단위로도 거를 수 있다(2026-11-22).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useAssetList, { buildingFilter, floorFilter, checkedAtOf, DEFAULT_FILTERS, filterAssets, type AssetFilters } from '../../hooks/useAssetList';
import { toLocalDateStr } from '../../lib/dateUtils';
import { groupSpacesByLocation } from '../../lib/spaceGroups';
import { StatusBadge, MissingBadge, UsefulLifeOverBadge } from '../common/AssetBadges';
import { isUsefulLifeOver, todayText, usefulLifeEnd } from '../../lib/usefulLife';
import LabelPrintDialog from './LabelPrintDialog';
import PanelModal from './space/PanelModal';
import SpacePickOptions from './space/SpacePickOptions';
import { SkeletonBox, SkeletonList, SkeletonTable } from '../common/Skeleton';
import { useToast } from '../../hooks/useToast';
import { moveAssetsToSpace } from '../../lib/firestore';
import type { Asset } from '../../types/asset';
import type { Space } from '../../types/space';
import type { Building } from '../../types/building';

const sub = 'text-xs text-surface-600 dark:text-surface-400';
const detailPath = (a: Asset) => `/admin/assets/${encodeURIComponent(a.id)}`;
const QUICK_VIEWS = [
    { label: '운영 전체', filters: DEFAULT_FILTERS, empty: '운영 중인 재물이 없습니다.' },
    { label: '공간 미지정', filters: { ...DEFAULT_FILTERS, space: 'none' }, empty: '공간을 지정할 재물이 없습니다.' },
    { label: '라벨 미발급', filters: { ...DEFAULT_FILTERS, label: 'untagged' }, empty: '라벨을 발급할 재물이 없습니다.' },
] satisfies { label: string; filters: AssetFilters; empty: string }[];

export default function AssetList() {
    const al = useAssetList();
    const [printing, setPrinting] = useState(false);
    // 고른 재물 공간 옮기기(2026-11-23)
    const [moving, setMoving] = useState(false);
    const unplacedCount = al.assets.filter((a) => !a.spaceId).length;
    const { filters, setFilter } = al;
    const quickViews = useMemo(() => QUICK_VIEWS.map((view) => ({
        ...view, count: filterAssets(al.assets, view.filters).length,
    })), [al.assets]);
    const currentView = quickViews.find(({ filters: view }) =>
        view.status === filters.status && view.space === filters.space && view.label === filters.label,
    );
    const today = todayText(); // 내용연수 지남 판단 기준일(한 번만 계산)

    const where = (a: Asset) => (a.spaceId ? al.spaceName.get(a.spaceId) ?? '(지운 공간)' : null);
    /** 마지막 확인 날짜 — 한 번도 확인하지 않았으면 null */
    const checked = (a: Asset) => { const at = checkedAtOf(al.checks, a.id); return at ? toLocalDateStr(at) : null; };
    const allVisibleSelected = al.visible.length > 0 && al.visible.every((a) => al.selected.has(a.id));
    const filteredSelected = al.filtered.filter((a) => al.selected.has(a.id)).length;
    const outsideResult = al.selected.size - filteredSelected;

    if (al.loading) {
        return (
            <div className="max-w-5xl mx-auto animate-fade-in space-y-4" role="status" aria-label="재물 목록을 불러오는 중">
                <div className="flex items-end justify-between gap-3">
                    <div>
                        <SkeletonBox className="h-7 w-28 mb-2" />
                        <SkeletonBox className="h-4 w-44" />
                    </div>
                    <div className="flex gap-2">
                        <SkeletonBox className="h-12 w-24 rounded-xl" />
                        <SkeletonBox className="h-12 w-28 rounded-xl" />
                    </div>
                </div>
                <div className="hidden md:block">
                    <SkeletonTable rows={6} cols={5} />
                </div>
                <div className="md:hidden">
                    <SkeletonList count={5} />
                </div>
            </div>
        );
    }
    if (al.error) {
        return (
            <div className="max-w-5xl mx-auto glass-card p-6 text-center">
                <p className="text-red-700 dark:text-red-300 mb-3" role="alert">재물 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.</p>
                <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void al.reload()}>다시 불러오기</button>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto animate-fade-in">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">재물 목록</h1>
                    <p className="text-sm text-surface-600 dark:text-surface-400 tabular-nums" aria-live="polite">
                        재물 {al.assets.length.toLocaleString('ko-KR')}건 중 {al.filtered.length.toLocaleString('ko-KR')}건 표시
                    </p>
                </div>
                <div className="flex gap-2">
                    <Link to="/admin/assets/new" className="btn-secondary min-h-[48px] px-4">재물 등록</Link>
                    <Link to="/admin/import" className="btn-secondary min-h-[48px] px-4">재물 가져오기</Link>
                </div>
            </div>

            {al.assets.length === 0 ? (
                <div className="glass-card p-8 text-center">
                    <p className="text-surface-700 dark:text-surface-300 font-medium mb-1">아직 재물이 없습니다</p>
                    <p className={`${sub} mb-4`}>희망이음 고정자산대장이나 기관 재물 대장 엑셀을 가져오거나, 한 건씩 등록하세요.</p>
                    <div className="flex flex-col sm:flex-row justify-center gap-2">
                        <Link to="/admin/import" className="btn-primary min-h-[48px] px-5">재물 가져오기</Link>
                        <Link to="/admin/assets/new" className="btn-secondary min-h-[48px] px-5">한 건씩 등록</Link>
                    </div>
                </div>
            ) : (
                <>
                    {al.checksError && (
                        // 확인 기록을 못 읽으면 모든 재물이 '한 번도 확인 안 됨'처럼 보인다 — 필터를 믿기 전에 알린다
                        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                            <span>마지막 확인 기록을 불러오지 못했습니다. 확인 날짜와 &lsquo;마지막 확인&rsquo; 필터 결과가 실제와 다를 수 있습니다.</span>
                            <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void al.reloadChecks()}>확인 기록 다시 불러오기</button>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div role="group" aria-label="운영 재물 빠른 보기" className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                            {quickViews.map((view) => (
                                <button key={view.label} type="button" aria-pressed={currentView === view}
                                    className={`${currentView === view ? 'btn-primary' : 'btn-secondary'} min-h-[48px] flex-col gap-0 px-1.5 py-1.5 text-sm sm:flex-row sm:gap-2 sm:px-3`}
                                    onClick={() => {
                                        al.replaceFilters(view.filters);
                                        al.clearSelection();
                                    }}>
                                    <span>{view.label}</span>{' '}<span className="text-xs tabular-nums sm:text-sm">{view.count.toLocaleString('ko-KR')}건</span>
                                </button>
                            ))}
                        </div>
                        {unplacedCount > 0 && (
                            <Link to="/admin/assets/unplaced" className="btn-ghost min-h-[48px] px-3 text-sm">위치별로 공간 정하기</Link>
                        )}
                    </div>
                    {filters.space === 'none' && al.filtered.length > 0 && (
                        <p className="mb-3 text-sm text-surface-600 dark:text-surface-400">공간을 정하면 운영 재물을 조사 대상에 넣을 수 있습니다.</p>
                    )}
                    <Filters filters={filters} setFilter={setFilter} spaces={al.spaces} buildings={al.buildings} onReset={al.resetFilters} />

                    <div className={`glass-card p-3 mb-3 flex flex-wrap items-center gap-2 sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-10 transition-colors ${al.selected.size > 0 ? 'border-primary-300 dark:border-primary-700 bg-primary-50/70 dark:bg-primary-950/30 shadow-glass-lg' : ''}`}>
                        <span className="text-sm font-medium text-surface-800 dark:text-surface-200 mr-auto" aria-live="polite">
                            {al.selected.size.toLocaleString('ko-KR')}건 고름
                            {outsideResult > 0 && ` · 현재 결과 밖 ${outsideResult.toLocaleString('ko-KR')}건 포함`}
                        </span>
                        <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={al.selectFiltered}
                            disabled={al.filtered.length === 0 || filteredSelected === al.filtered.length}>
                            걸러진 {al.filtered.length.toLocaleString('ko-KR')}건 모두 고르기
                        </button>
                        {al.selected.size > 0 && (
                            <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={al.clearSelection}>고르기 해제</button>
                        )}
                        {al.selected.size > 0 && (
                            <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={() => setMoving(true)}>공간 옮기기</button>
                        )}
                        <button type="button" className="btn-primary btn-sm min-h-[48px] px-4" onClick={() => setPrinting(true)} disabled={al.selected.size === 0}>
                            라벨 인쇄
                        </button>
                    </div>

                    {al.filtered.length === 0 ? (
                        <div className="glass-card p-6 text-center">
                            <p className="text-sm text-surface-700 dark:text-surface-300 mb-3">
                                {currentView?.count === 0 ? currentView.empty : '조건에 맞는 재물이 없습니다.'}
                            </p>
                            <button type="button" className="btn-secondary min-h-[48px] px-5" onClick={al.resetFilters}>거르기 조건 초기화</button>
                        </div>
                    ) : (
                        <>
                            {/* 넓은 화면: 표 */}
                            <div className="hidden md:block glass-card overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-surface-600 dark:text-surface-400 border-b border-surface-100 dark:border-surface-700">
                                        <tr>
                                            <th className="p-3 w-10">
                                                <input type="checkbox" className="w-5 h-5 accent-primary-600" aria-label="이 화면의 재물 모두 고르기" checked={allVisibleSelected}
                                                    onChange={() => al.setMany(al.visible.map((a) => a.id), !allVisibleSelected)} />
                                            </th>
                                            <th className="p-3 font-medium whitespace-nowrap">자산코드</th>
                                            <th className="p-3 font-medium whitespace-nowrap">품명</th>
                                            <th className="p-3 font-medium whitespace-nowrap">분류</th>
                                            <th className="p-3 font-medium whitespace-nowrap">공간</th>
                                            <th className="p-3 font-medium whitespace-nowrap">상태</th>
                                            <th className="p-3 font-medium whitespace-nowrap">라벨</th>
                                            <th className="p-3 font-medium whitespace-nowrap">마지막 확인</th>
                                            <th className="p-3 font-medium whitespace-nowrap">내용연수 끝</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-surface-100 dark:divide-surface-700">
                                        {al.visible.map((a) => (
                                            <tr key={a.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/60">
                                                <td className="p-3">
                                                    <input type="checkbox" className="w-5 h-5 accent-primary-600" aria-label={`${a.code} 고르기`} checked={al.selected.has(a.id)} onChange={() => al.toggle(a.id)} />
                                                </td>
                                                <td className="p-3 font-mono whitespace-nowrap">
                                                    <Link to={detailPath(a)} className="font-medium text-primary-700 dark:text-primary-300 underline underline-offset-2 decoration-primary-300 hover:decoration-primary-700">{a.code}</Link>
                                                </td>
                                                <td className="p-3 text-surface-900 dark:text-surface-100">
                                                    <span className="flex items-center gap-2">
                                                        <Thumb asset={a} size="w-9 h-9" />
                                                        <span className="break-keep">{a.name ?? '-'} {a.missingFromSource && <MissingBadge />} {isUsefulLifeOver(a, today) && <UsefulLifeOverBadge />}</span>
                                                    </span>
                                                </td>
                                                <td className="p-3 text-surface-600 dark:text-surface-300 whitespace-nowrap">{a.category ?? '-'}</td>
                                                <td className="p-3 text-surface-700 dark:text-surface-300 break-keep min-w-[10rem]">
                                                    {where(a) ?? <span className={sub}>미지정{a.locationRaw ? ` · ${a.locationRaw}` : ''}</span>}
                                                </td>
                                                <td className="p-3"><StatusBadge status={a.status} /></td>
                                                <td className="p-3 whitespace-nowrap">{a.tagId ? <span className="text-surface-700 dark:text-surface-300">있음</span> : <span className={sub}>없음</span>}</td>
                                                <td className="p-3 whitespace-nowrap">{checked(a) ?? <span className={sub}>없음</span>}</td>
                                                <td className="p-3 whitespace-nowrap tabular-nums"><LifeEnd asset={a} today={today} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* 휴대폰: 카드 */}
                            <ul className="md:hidden space-y-2">
                                {al.visible.map((a) => (
                                    <li key={a.id} className="glass-card p-2 pr-3 flex items-start gap-2">
                                        {/* 상자만 누르기엔 작아 칸 전체(44px)를 라벨로 감싼다 */}
                                        <label className="w-12 h-12 flex items-center justify-center flex-shrink-0 cursor-pointer">
                                            <input type="checkbox" className="w-5 h-5 accent-primary-600" aria-label={`${a.code} 고르기`} checked={al.selected.has(a.id)} onChange={() => al.toggle(a.id)} />
                                        </label>
                                        <Thumb asset={a} size="w-12 h-12" />
                                        <Link to={detailPath(a)} className="min-w-0 flex-1 flex items-center gap-2 py-1 rounded-lg focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
                                            <span className="min-w-0 flex-1 block">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono text-sm font-semibold text-surface-900 dark:text-surface-100">{a.code}</span>
                                                <StatusBadge status={a.status} />
                                                {a.missingFromSource && <MissingBadge />}
                                                {isUsefulLifeOver(a, today) && <UsefulLifeOverBadge />}
                                            </div>
                                            <p className="text-sm text-surface-800 dark:text-surface-200 line-clamp-2 break-keep">{a.name ?? '-'}</p>
                                            <p className={sub}>
                                                {where(a) ?? `미지정${a.locationRaw ? ` · ${a.locationRaw}` : ''}`} · 라벨 {a.tagId ? '있음' : '없음'} · 확인 {checked(a) ?? '없음'}
                                                {lifeEndOf(a) && ` · 내용연수 ${lifeEndOf(a)}까지`}
                                            </p>
                                            </span>
                                            <span aria-hidden="true" className="text-surface-500 text-lg flex-shrink-0">›</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>

                            {al.hasMore && (
                                <div className="text-center mt-4">
                                    <button type="button" className="btn-secondary min-h-[48px] px-5" onClick={al.showMore}>
                                        더 보기 ({al.visible.length.toLocaleString('ko-KR')} / {al.filtered.length.toLocaleString('ko-KR')})
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            <PanelModal open={moving} title={`재물 ${al.selected.size.toLocaleString('ko-KR')}건 공간 옮기기`} titleId="asset-move-title" onClose={() => setMoving(false)}>
                {moving && (
                    <MoveAssetsForm
                        al={al}
                        onDone={() => { setMoving(false); al.clearSelection(); }}
                        onCancel={() => setMoving(false)}
                    />
                )}
            </PanelModal>

            {printing && (
                <LabelPrintDialog
                    assets={al.selectedAssets}
                    orgId={al.orgId}
                    onClose={() => setPrinting(false)}
                    onTags={al.applyTags}
                    onReloadNeeded={() => void al.reload()}
                />
            )}
        </div>
    );
}

interface FiltersProps {
    filters: AssetFilters;
    setFilter: <K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) => void;
    spaces: Space[];
    buildings: Building[];
    onReset: () => void;
}

/** 공간 거르기 목록 — 건물을 등록했으면 건물 → 층 → 공간으로 묶고, 건물·층 전체도 고를 수 있다 */
function SpaceOptions({ spaces, buildings }: { spaces: Space[]; buildings: Building[] }) {
    const archived = spaces.filter((s) => s.archived);
    const archivedOptions = archived.map((s) => <option key={s.id} value={s.id}>{s.name} (삭제한 공간)</option>);
    if (!buildings.some((b) => !b.archived)) {
        return <>{spaces.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}{archivedOptions}</>;
    }
    return (
        <>
            {groupSpacesByLocation(spaces.filter((s) => !s.archived), buildings).map((g) => (
                <optgroup key={g.buildingId ?? 'none'} label={g.label}>
                    {g.buildingId && <option value={buildingFilter(g.buildingId)}>{g.label} 전체</option>}
                    {g.floors.map((f) => [
                        g.buildingId && f.floor
                            ? <option key={`f-${f.floor}`} value={floorFilter(g.buildingId, f.floor)}>{g.label} {f.label} 전체</option>
                            : null,
                        ...f.spaces.map((s) => (
                            <option key={s.id} value={s.id}>{g.buildingId ? `· ${f.floor ? `${f.label} ` : ''}${s.name}` : s.name}</option>
                        )),
                    ])}
                </optgroup>
            ))}
            {archived.length > 0 && <optgroup label="삭제한 공간">{archivedOptions}</optgroup>}
        </>
    );
}

/** 기본값과 다른 거르기 조건 수(검색 제외) — 접힌 [거르기] 버튼에 보인다 */
function activeFilterCount(f: AssetFilters): number {
    return (['space', 'status', 'label', 'checked', 'onlyMissing', 'onlyLifeOver'] as const).filter((k) => (f[k] ?? false) !== (DEFAULT_FILTERS[k] ?? false)).length;
}

function Filters({ filters, setFilter, spaces, buildings, onReset }: FiltersProps) {
    const label = 'text-xs text-surface-600 dark:text-surface-300';
    // 휴대폰에서 칸 다섯 개가 화면을 다 차지해 목록이 보이지 않았다(2026-11-22 점검) — 검색만 두고 나머지는 접는다
    const [open, setOpen] = useState(false);
    const active = activeFilterCount(filters);
    const changed = active > 0 || filters.search !== DEFAULT_FILTERS.search;
    return (
        <div className="glass-card p-4 mb-3">
            <div className="flex gap-2 items-end sm:hidden">
                <label className={`${label} flex-1 min-w-0`}>
                    검색
                    <input type="search" className="input min-h-[48px] mt-1" placeholder="자산코드·품명·위치"
                        value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
                </label>
                <button type="button" className="btn-secondary min-h-[48px] px-3 flex-shrink-0" aria-expanded={open} aria-controls="asset-filters"
                    onClick={() => setOpen((v) => !v)}>
                    거르기{active > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-primary-600 text-white text-xs tabular-nums">{active}</span>}
                    <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                </button>
            </div>
            <div id="asset-filters" className={`${open ? 'grid mt-3' : 'hidden'} sm:grid sm:mt-0 gap-3 sm:grid-cols-2 lg:grid-cols-5`}>
                <label className={`${label} hidden sm:block sm:col-span-2 lg:col-span-1`}>
                    검색
                    <input type="search" className="input min-h-[48px] mt-1" placeholder="자산코드·품명·위치"
                        value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
                </label>
                <label className={label}>
                    공간
                    <select className="input min-h-[48px] mt-1" value={filters.space} onChange={(e) => setFilter('space', e.target.value)}>
                        <option value="all">전체 공간</option>
                        <option value="none">공간 미지정</option>
                        <SpaceOptions spaces={spaces} buildings={buildings} />
                    </select>
                </label>
                <label className={label}>
                    상태
                    <select className="input min-h-[48px] mt-1" value={filters.status} onChange={(e) => setFilter('status', e.target.value as AssetFilters['status'])}>
                        <option value="active">운영</option>
                        <option value="inactive">불용</option>
                        <option value="disposed">폐기</option>
                        <option value="all">전체 상태</option>
                    </select>
                </label>
                <label className={label}>
                    라벨
                    <select className="input min-h-[48px] mt-1" value={filters.label} onChange={(e) => setFilter('label', e.target.value as AssetFilters['label'])}>
                        <option value="all">전체</option>
                        <option value="untagged">라벨 미발급</option>
                        <option value="tagged">라벨 발급됨</option>
                    </select>
                </label>
                <label className={label}>
                    마지막 확인
                    <select className="input min-h-[48px] mt-1" value={filters.checked} onChange={(e) => setFilter('checked', e.target.value as AssetFilters['checked'])}>
                        <option value="all">전체</option>
                        <option value="over6m">6개월 넘게 못 봄</option>
                        <option value="over1y">1년 넘게 못 봄</option>
                        <option value="never">한 번도 확인 안 됨</option>
                    </select>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-5">
                    <label className="flex items-center gap-2 min-h-[48px] text-sm text-surface-700 dark:text-surface-300">
                        <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={filters.onlyMissing} onChange={(e) => setFilter('onlyMissing', e.target.checked)} />
                        대장에 없음만
                    </label>
                    {/* 내용연수(내구연한)가 지난 것만 — 바꿀 때가 된 재물을 모아 본다(2026-11-22) */}
                    <label className="flex items-center gap-2 min-h-[48px] text-sm text-surface-700 dark:text-surface-300">
                        <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={!!filters.onlyLifeOver} onChange={(e) => setFilter('onlyLifeOver', e.target.checked)} />
                        내용연수 지난 것만
                    </label>
                    <button type="button" className="btn-secondary btn-sm min-h-[48px]" onClick={onReset} disabled={!changed}>조건 초기화</button>
                </div>
            </div>
        </div>
    );
}

/** 내용연수가 끝나는 날(취득일자+내용연수) — 계산할 수 없으면 null (2026-11-22) */
const lifeEndOf = (a: Asset): string | null => usefulLifeEnd(a.acquiredAt, a.usefulLife);

/** 표의 '내용연수 끝' 칸 — 지났으면 노란 글자로 */
function LifeEnd({ asset, today }: { asset: Asset; today: string }) {
    const end = lifeEndOf(asset);
    if (!end) return <span className={sub}>-</span>;
    return isUsefulLifeOver(asset, today)
        ? <span className="font-medium text-amber-800 dark:text-amber-300">{end}</span>
        : <span className="text-surface-700 dark:text-surface-300">{end}</span>;
}

/** 목록용 작은 사진(2026-11-22) — 없으면 같은 크기의 빈 칸으로 줄을 맞춘다 */
function Thumb({ asset, size }: { asset: Asset; size: string }) {
    return asset.photoThumbUrl
        ? <img src={asset.photoThumbUrl} alt="" loading="lazy" className={`${size} rounded-lg object-cover flex-shrink-0 bg-surface-100 dark:bg-surface-800`} />
        : <span aria-hidden="true" className={`${size} rounded-lg flex-shrink-0 bg-surface-100 dark:bg-surface-800`} />;
}

/** 고른 재물을 한 공간으로 옮기는 창(2026-11-23) — 변경 이력에 남긴다 */
function MoveAssetsForm({ al, onDone, onCancel }: {
    al: ReturnType<typeof useAssetList>;
    onDone: () => void;
    onCancel: () => void;
}) {
    const { showToast } = useToast();
    const [spaceId, setSpaceId] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(0);
    const picked = al.selectedAssets;
    const fromLedger = picked.filter((a) => !a.manual).length;
    const submit = async () => {
        if (!al.orgId || !spaceId) return;
        setBusy(true);
        try {
            const target = spaceId === NONE ? null : spaceId;
            const n = await moveAssetsToSpace({ orgId: al.orgId, assets: picked, spaceId: target, onProgress: (d) => setDone(d) });
            al.applySpace(new Set(picked.map((a) => a.id)), target);
            showToast(n > 0 ? `재물 ${n.toLocaleString('ko-KR')}건을 옮겼습니다.` : '이미 그 공간에 있습니다.', n > 0 ? 'success' : 'info');
            onDone();
        } catch {
            showToast('공간을 옮기지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
            void al.reload();
        } finally {
            setBusy(false);
        }
    };
    return (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div>
                <label htmlFor="asset-move-space" className="label">옮길 공간</label>
                <select id="asset-move-space" className="input min-h-[48px]" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} disabled={busy}>
                    <option value="">공간 고르기…</option>
                    <SpacePickOptions spaces={al.spaces} buildings={al.buildings} />
                    <option value={NONE}>공간 미지정으로</option>
                </select>
            </div>
            {fromLedger > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                    대장에서 가져온 재물 {fromLedger.toLocaleString('ko-KR')}건이 들어 있습니다. 다음에 대장을 다시 가져오면 대장의 위치에 따라 공간이 다시 정해집니다.
                    위치 이름 단위로 맞추려면 <Link to="/admin/assets/unplaced" className="underline underline-offset-2 font-medium">공간 미지정 정리</Link>나 가져오기의 &lsquo;위치 → 공간&rsquo; 연결을 쓰세요.
                </p>
            )}
            {busy && <p className="text-sm text-surface-700 dark:text-surface-300 tabular-nums" role="status">옮기는 중… {done.toLocaleString('ko-KR')} / {picked.length.toLocaleString('ko-KR')}건</p>}
            <div className="flex gap-2">
                <button type="button" className="btn-secondary flex-1 min-h-[48px]" onClick={onCancel} disabled={busy}>취소</button>
                <button type="submit" className="btn-primary flex-1 min-h-[48px]" disabled={busy || !spaceId}>옮기기</button>
            </div>
        </form>
    );
}

const NONE = '__none__';
