/**
 * ServiceDashboard — 시스템 관리자 운영 현황
 *
 * 차량운행일지의 서비스 운영 대시보드(운영 요약 탭)를 재물조사 지표로 옮겼다.
 * 서비스가 기관에 자리를 잡는지를 본다: 요약 숫자 → 도입 단계 퍼널(어디서 멈추나) →
 * 최근 30일 스캔 → 12개월 성장 → 기관별 표(누가 쓰고 누가 멈췄나).
 *
 * 숫자는 서버가 밤마다(02:20) 미리 집계한 문서 1건에서 온다. 차트 라이브러리를 들이지 않고
 * CSS 막대로 그린다 — 관리자 화면 하나 때문에 번들 예산을 쓰지 않으려는 것이다.
 */
import { useMemo, useState } from 'react';
import useServiceDashboard from '../../hooks/useServiceDashboard';
import { useToast } from '../../hooks/useToast';
import type { DashboardOrgRow, DashboardStats } from '../../schemas/dashboard';

const fmt = (v: number) => v.toLocaleString('ko-KR');

function formatDateTime(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string | null) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/** 지난달 대비 증감 표시 */
function Delta({ now, prev }: { now: number; prev: number }) {
    if (prev === 0) return null;
    const diff = Math.round(((now - prev) / prev) * 100);
    const up = diff >= 0;
    return (
        <span className={`text-xs font-medium ${up ? 'text-accent-700 dark:text-accent-300' : 'text-red-700 dark:text-red-300'}`}>
            지난달 대비 {up ? '+' : ''}{diff}%
        </span>
    );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
    return (
        <div className="glass-card p-4">
            <p className="text-xs font-medium text-surface-600 dark:text-surface-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
            {sub && <div className="mt-1 text-xs text-surface-600 dark:text-surface-400">{sub}</div>}
        </div>
    );
}

function Overview({ s }: { s: DashboardStats }) {
    const o = s.overview;
    const m = s.monthly;
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
                label="이용 기관"
                value={`${fmt(o.approvedOrgs)}곳`}
                sub={<>승인 대기 {fmt(o.pendingOrgs)} · 반려 {fmt(o.rejectedOrgs)} · 해지 {fmt(o.deletedOrgs)}</>}
            />
            <StatCard
                label="사용자"
                value={`${fmt(o.totalUsers)}명`}
                sub={<>기관 관리자 {fmt(o.adminCount)} · 직원 {fmt(o.employeeCount)}</>}
            />
            <StatCard label="등록 재물" value={`${fmt(o.totalAssets)}개`} sub={<>공간 {fmt(o.totalSpaces)}곳 (처분 재물 제외)</>} />
            <StatCard
                label="조사 회차"
                value={`${fmt(o.openSurveys + o.closedSurveys)}회`}
                sub={<>진행 중 {fmt(o.openSurveys)} · 마감 {fmt(o.closedSurveys)}</>}
            />
            <StatCard
                label={`${m.monthLabel} 스캔`}
                value={`${fmt(m.scans)}건`}
                sub={<Delta now={m.scans} prev={m.prevScans} />}
            />
            <StatCard label={`${m.monthLabel} 스캔한 사람`} value={`${fmt(m.activeUsers)}명`} />
            <StatCard
                label="최근 30일 스캔한 기관"
                value={`${fmt(m.activeOrgs30d)}곳`}
                sub={o.approvedOrgs > 0 ? <>이용 기관의 {Math.round((m.activeOrgs30d / o.approvedOrgs) * 100)}%</> : undefined}
            />
            <StatCard label="누적 스캔" value={`${fmt(o.totalScans)}건`} />
        </div>
    );
}

function Funnel({ s }: { s: DashboardStats }) {
    if (s.funnel.length === 0) return null;
    // 가장 크게 떨어지는 단계를 짚어 준다 — 다음에 손볼 곳
    const worst = s.funnel.slice(1).reduce<{ label: string; conv: number } | null>((acc, f) => (
        f.conversionFromPrev < (acc?.conv ?? 101) ? { label: f.label, conv: f.conversionFromPrev } : acc
    ), null);
    return (
        <section className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">도입 단계</h2>
            <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                기관이 신청부터 첫 조사 마감까지 어디서 멈추는지 봅니다(해지 기관 제외).
                {worst && s.funnel[0].value > 0 && <> 가장 많이 멈추는 곳은 <strong className="text-surface-700 dark:text-surface-200">{worst.label}</strong>({worst.conv}%만 넘어감)입니다.</>}
            </p>
            <ol className="mt-4 space-y-2.5">
                {s.funnel.map((f, i) => (
                    <li key={f.key}>
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="font-medium text-surface-700 dark:text-surface-200">{i + 1}. {f.label}</span>
                            <span className="text-surface-600 dark:text-surface-300">
                                <strong className="text-surface-900 dark:text-surface-100">{fmt(f.value)}곳</strong>
                                {i > 0 && <span className="ml-2 text-xs text-surface-600 dark:text-surface-400">앞 단계의 {f.conversionFromPrev}%</span>}
                            </span>
                        </div>
                        <div className="mt-1 h-2.5 w-full rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                            <div className="h-full rounded-full bg-primary-500 dark:bg-primary-400" style={{ width: `${f.rate}%` }} />
                        </div>
                    </li>
                ))}
            </ol>
            {s.firstEmployee && (
                <p className="mt-4 text-sm text-surface-600 dark:text-surface-300">
                    승인 뒤 첫 사용자 가입까지 평균 <strong>{s.firstEmployee.avgDays}일</strong>
                    (중앙값 {s.firstEmployee.medianDays}일, 승인 당일 가입 {s.firstEmployee.sameDayRate}%, {fmt(s.firstEmployee.count)}곳 기준)
                </p>
            )}
        </section>
    );
}

function DailyScans({ s }: { s: DashboardStats }) {
    const max = Math.max(1, ...s.dailyScans.map((d) => d.scans));
    const total = s.dailyScans.reduce((n, d) => n + d.scans, 0);
    // 막대 툴팁(title)은 휴대폰에서 볼 수 없어 가장 많은 날과 날짜별 표를 글로도 보여 준다
    const busiest = s.dailyScans.reduce<DashboardStats['dailyScans'][number] | null>((acc, d) => (!acc || d.scans > acc.scans ? d : acc), null);
    const scanDays = s.dailyScans.filter((d) => d.scans > 0);
    return (
        <section className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">최근 30일 스캔</h2>
            <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                합계 {fmt(total)}건{busiest && busiest.scans > 0 && <> · 가장 많은 날 {busiest.date.slice(5).replace('-', '/')} {fmt(busiest.scans)}건({fmt(busiest.users)}명)</>}
            </p>
            {total === 0 ? (
                <p className="mt-6 text-center text-sm text-surface-600 dark:text-surface-400">최근 30일 동안 스캔이 없습니다.</p>
            ) : (
                <div className="mt-4 flex h-36 items-end gap-[3px]" role="img" aria-label={`최근 30일 스캔 합계 ${total}건`}>
                    {s.dailyScans.map((d) => (
                        <div
                            key={d.date}
                            className="flex-1 rounded-t bg-primary-500/80 dark:bg-primary-400/80 hover:bg-primary-600 dark:hover:bg-primary-300 min-h-[2px]"
                            style={{ height: `${(d.scans / max) * 100}%` }}
                            title={`${d.date} · 스캔 ${d.scans}건 · ${d.users}명`}
                        />
                    ))}
                </div>
            )}
            {s.dailyScans.length > 0 && (
                <div className="mt-1 flex justify-between text-[11px] text-surface-600 dark:text-surface-400">
                    <span>{s.dailyScans[0].date.slice(5).replace('-', '/')}</span>
                    <span>{s.dailyScans[s.dailyScans.length - 1].date.slice(5).replace('-', '/')}</span>
                </div>
            )}
            {scanDays.length > 0 && (
                <details className="mt-3 group">
                    <summary className="btn-secondary btn-sm min-h-[48px] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <span aria-hidden="true" className="group-open:hidden">▸</span>
                        <span aria-hidden="true" className="hidden group-open:inline">▾</span>
                        날짜별 스캔 보기
                    </summary>
                    <table className="mt-2 w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-surface-600 dark:text-surface-400">
                                <th className="py-1.5 pr-3 font-medium">날짜</th>
                                <th className="py-1.5 pr-3 font-medium text-right">스캔</th>
                                <th className="py-1.5 font-medium text-right">스캔한 사람</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...scanDays].reverse().map((d) => (
                                <tr key={d.date} className="border-t border-surface-100 dark:border-surface-700 text-surface-700 dark:text-surface-200">
                                    <td className="py-1.5 pr-3">{d.date.slice(5).replace('-', '/')}</td>
                                    <td className="py-1.5 pr-3 text-right">{fmt(d.scans)}건</td>
                                    <td className="py-1.5 text-right">{fmt(d.users)}명</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </details>
            )}
        </section>
    );
}

function Growth({ s }: { s: DashboardStats }) {
    const max = Math.max(1, ...s.monthlyGrowth.map((g) => g.newOrgs));
    return (
        <section className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">최근 12개월 신규</h2>
            <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">승인된 달 기준 신규 기관과 새로 가입한 사용자입니다.</p>
            <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-surface-600 dark:text-surface-400">
                            <th className="py-1.5 pr-3 font-medium">월</th>
                            <th className="py-1.5 pr-3 font-medium">신규 기관</th>
                            <th className="py-1.5 pr-3 font-medium text-right">누적 기관</th>
                            <th className="py-1.5 font-medium text-right">신규 사용자</th>
                        </tr>
                    </thead>
                    <tbody>
                        {s.monthlyGrowth.map((g) => (
                            <tr key={g.month} className="border-t border-surface-100 dark:border-surface-700">
                                <td className="py-1.5 pr-3 text-surface-600 dark:text-surface-300 whitespace-nowrap">{g.month.replace('-', '.')}</td>
                                <td className="py-1.5 pr-3 w-1/2">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2 rounded-full bg-accent-500 dark:bg-accent-400" style={{ width: `${(g.newOrgs / max) * 100}%`, minWidth: g.newOrgs ? 4 : 0 }} />
                                        <span className="text-surface-700 dark:text-surface-200">{g.newOrgs}</span>
                                    </div>
                                </td>
                                <td className="py-1.5 pr-3 text-right text-surface-700 dark:text-surface-200">{fmt(g.cumulativeOrgs)}</td>
                                <td className="py-1.5 text-right text-surface-700 dark:text-surface-200">{fmt(g.newUsers)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

type SortKey = 'scans30d' | 'assets' | 'users' | 'name';

function OrgTable({ rows }: { rows: DashboardOrgRow[] }) {
    const [sortKey, setSortKey] = useState<SortKey>('scans30d');
    const sorted = useMemo(() => [...rows].sort((a, b) => (
        sortKey === 'name' ? a.name.localeCompare(b.name, 'ko') : b[sortKey] - a[sortKey]
    )), [rows, sortKey]);
    const idle = rows.filter((r) => r.scans30d === 0).length;

    return (
        <section className="glass-card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">기관별 현황</h2>
                    <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                        이용 기관 {fmt(rows.length)}곳 중 {fmt(idle)}곳은 최근 30일 스캔이 없습니다.
                    </p>
                </div>
                <label className="text-sm text-surface-600 dark:text-surface-300 flex items-center gap-2">
                    정렬
                    <select
                        className="input min-h-[48px] py-1.5 text-sm"
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value as SortKey)}
                    >
                        <option value="scans30d">최근 30일 스캔 많은 순</option>
                        <option value="assets">재물 많은 순</option>
                        <option value="users">사용자 많은 순</option>
                        <option value="name">기관 이름순</option>
                    </select>
                </label>
            </div>
            {rows.length === 0 ? (
                <p className="mt-6 text-center text-sm text-surface-600 dark:text-surface-400">아직 이용 중인 기관이 없습니다.</p>
            ) : (
                <>
                <p className="mt-3 text-xs text-surface-600 dark:text-surface-400 md:hidden">표를 옆으로 밀면 나머지 칸이 보입니다.</p>
                <div className="mt-2 md:mt-4 overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                        <thead>
                            <tr className="text-left text-xs text-surface-600 dark:text-surface-400">
                                <th className="py-2 pr-3 font-medium">기관</th>
                                <th className="py-2 pr-3 font-medium text-right">사용자</th>
                                <th className="py-2 pr-3 font-medium text-right">재물</th>
                                <th className="py-2 pr-3 font-medium text-right">공간</th>
                                <th className="py-2 pr-3 font-medium text-right">조사(진행/마감)</th>
                                <th className="py-2 pr-3 font-medium text-right">30일 스캔</th>
                                <th className="py-2 font-medium text-right">마지막 스캔</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((r) => (
                                <tr key={r.id} className="border-t border-surface-100 dark:border-surface-700">
                                    <td className="py-2 pr-3">
                                        <p className="font-medium text-surface-800 dark:text-surface-100">{r.name}</p>
                                        {r.approvedAt && <p className="text-xs text-surface-600 dark:text-surface-400">{formatDay(r.approvedAt)} 승인</p>}
                                    </td>
                                    <td className="py-2 pr-3 text-right text-surface-700 dark:text-surface-200">{fmt(r.users)}</td>
                                    <td className="py-2 pr-3 text-right text-surface-700 dark:text-surface-200">{fmt(r.assets)}</td>
                                    <td className="py-2 pr-3 text-right text-surface-700 dark:text-surface-200">{fmt(r.spaces)}</td>
                                    <td className="py-2 pr-3 text-right text-surface-700 dark:text-surface-200">{r.openSurveys}/{r.closedSurveys}</td>
                                    <td className={`py-2 pr-3 text-right font-medium ${r.scans30d === 0 ? 'text-amber-800 dark:text-amber-300' : 'text-surface-800 dark:text-surface-100'}`}>
                                        {fmt(r.scans30d)}
                                    </td>
                                    <td className="py-2 text-right text-surface-600 dark:text-surface-300 whitespace-nowrap">
                                        {r.lastScanAt ? formatDay(r.lastScanAt) : <span className="text-surface-600 dark:text-surface-400">30일 넘음</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}
        </section>
    );
}

export default function ServiceDashboard() {
    const { stats, loading, loadError, refreshing, load, refresh } = useServiceDashboard();
    const { showToast } = useToast();

    const handleRefresh = async () => {
        try {
            const r = await refresh();
            if (r.skipped) {
                const min = Math.max(1, Math.ceil((r.retryAfterSec ?? 600) / 60));
                showToast(`방금 갱신했습니다. 약 ${min}분 뒤에 다시 갱신할 수 있어요.`, 'info');
            } else {
                showToast('운영 현황을 새로 집계했습니다.', 'success');
            }
        } catch {
            showToast('통계를 갱신하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'error');
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center py-20" role="status" aria-label="운영 현황 불러오는 중"><div className="w-8 h-8 spinner" /></div>;
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">운영 현황</h1>
                    <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                        {stats?.lastUpdatedAt
                            ? <>{formatDateTime(stats.lastUpdatedAt)} 기준 · 매일 새벽 자동 집계</>
                            : '매일 새벽 자동으로 집계합니다.'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="btn-secondary min-h-[48px] px-4 text-sm flex items-center gap-1.5 self-start sm:self-auto"
                >
                    <svg className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                    </svg>
                    {refreshing ? '집계하는 중…' : '지금 갱신'}
                </button>
            </div>

            {loadError && (
                <div className="glass-card p-5 border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20">
                    <p className="font-semibold text-red-700 dark:text-red-300">통계를 불러오지 못했습니다</p>
                    <p className="mt-1 text-sm text-red-700/90 dark:text-red-200/90">
                        네트워크 문제이거나 시스템 관리자 권한이 아직 반영되지 않았을 수 있습니다. 다시 시도하거나 새로고침해 주세요.
                    </p>
                    <button type="button" onClick={() => void load()} className="btn-secondary mt-3 text-sm min-h-[48px] px-4">다시 시도</button>
                </div>
            )}

            {!loadError && !stats && (
                <div className="glass-card p-8 text-center">
                    <p className="font-semibold text-surface-800 dark:text-surface-100">아직 집계된 통계가 없습니다</p>
                    <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
                        <strong>지금 갱신</strong>을 누르면 처음 집계합니다. 그 뒤로는 매일 새벽 자동으로 갱신됩니다.
                    </p>
                </div>
            )}

            {stats && (
                <>
                    <Overview s={stats} />
                    <Funnel s={stats} />
                    <div className="grid gap-6 lg:grid-cols-2">
                        <DailyScans s={stats} />
                        <Growth s={stats} />
                    </div>
                    <OrgTable rows={stats.orgs} />
                </>
            )}
        </div>
    );
}
