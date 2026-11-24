/**
 * 재물조사 현황판 — 남은 기간·진행률·공간별 진행과 제출 상태·승인·반려·최근 스캔·마감.
 * SurveyManager.tsx에서 나눴다(2026-11-24).
 */
import { Link } from 'react-router-dom';
import type useSurveyAdmin from '../../../hooks/useSurveyAdmin';
import { NO_SPACE_KEY } from '../../../schemas';
import { SCAN_RESULT_LABEL } from '../../../lib/survey/judge';
import { daysLeft } from '../../../lib/survey/report';
import { orderSpacesByLocation, spaceLocationMap } from '../../../lib/spaceGroups';
import type { SurveySubmission } from '../../../types/survey';
import { sub, card, MODE_LABEL } from './surveyStyles';

export type Admin = ReturnType<typeof useSurveyAdmin>;

function SubmissionBadge({ sub: x, names }: { sub: SurveySubmission | null; names: Map<string, string> }) {
    if (!x) return <span className="text-xs text-surface-600 dark:text-surface-400">조사 중 · 제출 전</span>;
    const who = (uid: string | null) => (uid ? names.get(uid) ?? '알 수 없음' : '');
    if (x.state === 'submitted') return <span className="text-xs font-medium text-primary-700 dark:text-primary-300">제출됨 · {who(x.submittedByUid)}</span>;
    // 사유는 마우스 말풍선(title)이 아니라 글자로 — 휴대폰·키보드로는 볼 수 없었다(2026-11-22 점검)
    if (x.state === 'rejected') {
        return (
            <span className="text-xs font-medium text-red-700 dark:text-red-300">
                반려 · 다시 제출 기다림{x.reason && <span className="block font-normal">사유: {x.reason}</span>}
            </span>
        );
    }
    return (
        <span className="text-xs font-medium text-accent-700 dark:text-accent-300">
            승인{x.proxyApproved ? '(대신)' : x.selfApproved ? '(본인)' : ''} · {who(x.reviewedByUid)}
            {x.reason && <span className="block font-normal text-surface-600 dark:text-surface-400">사유: {x.reason}</span>}
        </span>
    );
}

export function Dashboard({ s, onReview, onClose }: {
    s: Admin;
    onReview: (spaceId: string, name: string, decision: 'approved' | 'rejected', current: SurveySubmission | null) => Promise<void>;
    onClose: () => void;
}) {
    const open = s.open!;
    // 건물 → 층 → 공간 순서. 회차 대상인데 지금은 숨긴 공간도 빠지지 않게 뒤에 붙인다
    const ordered = orderSpacesByLocation(s.spaces, s.buildings);
    const inSurvey = [
        ...ordered.filter((x) => open.spaceIds.includes(x.id)),
        ...s.spaces.filter((x) => x.archived && open.spaceIds.includes(x.id)),
    ];
    const locationOf = spaceLocationMap(s.spaces, s.buildings);
    const rows = [
        ...inSurvey.map((x) => ({ key: x.id, name: x.name, location: locationOf[x.id] ?? '' })),
        ...(open.includesUnassigned ? [{ key: NO_SPACE_KEY, name: '공간 미지정', location: '' }] : []),
    ];
    const nameOf = (key: string) => rows.find((r) => r.key === key)?.name ?? '(지운 공간)';
    const pct = s.totals.target > 0 ? Math.round((s.totals.found / s.totals.target) * 100) : 0;
    const left = daysLeft(open.endDate);
    const delegated = open.mode === 'delegated';

    return (
        <>
            <section className={card} aria-labelledby="open-title">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <h2 id="open-title" className="text-lg font-semibold text-surface-900 dark:text-surface-100">{open.name}</h2>
                        <p className={sub}>{open.startDate} ~ {open.endDate} · {MODE_LABEL[open.mode]}</p>
                    </div>
                    <div className="flex gap-2">
                        <Link to={`/admin/surveys/${open.id}`} className="btn-secondary btn-sm min-h-[48px] px-3">중간 보고서</Link>
                        <Link to="/employee/scan" className="btn-primary btn-sm min-h-[48px] px-4">직접 스캔</Link>
                    </div>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    <Stat label="남은 기간" value={left > 0 ? `D-${left}` : left === 0 ? 'D-DAY' : `${-left}일 지남`} warn={left < 0} />
                    <Stat label="확인" value={`${s.totals.found.toLocaleString('ko-KR')} / ${s.totals.target.toLocaleString('ko-KR')}`} />
                    <Stat label="진행률" value={`${pct}%`} />
                    <Stat label="미등록" value={`${s.totals.unregistered}건`} warn={s.totals.unregistered > 0} />
                </dl>
                <div className="mt-3 h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={s.totals.target} aria-valuenow={s.totals.found} aria-label="전체 진행률">
                    <div className="h-full bg-primary-600 dark:bg-primary-400" style={{ width: `${pct}%` }} />
                </div>

                <details className="mt-4 group">
                    <summary className="btn-secondary btn-sm min-h-[48px] list-none [&::-webkit-details-marker]:hidden inline-flex cursor-pointer">
                        <span aria-hidden="true" className="group-open:rotate-90 transition-transform">▸</span> 숫자가 무슨 뜻인가요?
                    </summary>
                    <dl className="mt-2 grid gap-1 text-sm text-surface-700 dark:text-surface-300 sm:grid-cols-2">
                        <div><dt className="inline font-semibold">확인</dt> <dd className="inline">— 이 공간 대상 중 찾은 수 / 대상 수</dd></div>
                        <div><dt className="inline font-semibold">다른 곳</dt> <dd className="inline">— 이 공간 대상인데 다른 공간에서 찾음</dd></div>
                        <div><dt className="inline font-semibold">예외</dt> <dd className="inline">— 이 공간에서 찍었는데 다른 공간 것·대장에 없는 것·대상 밖</dd></div>
                        <div><dt className="inline font-semibold">상태 이상</dt> <dd className="inline">— 고장·파손 등으로 표시한 것</dd></div>
                        <div><dt className="inline font-semibold">미등록</dt> <dd className="inline">— 찍었지만 재물 대장에 없는 코드</dd></div>
                    </dl>
                </details>

                {/* 휴대폰: 공간마다 카드 — 7열 표가 넘쳐 승인·반려 버튼이 화면 밖에 있었다(2026-11-22 점검) */}
                <ul className="sm:hidden mt-4 space-y-2" aria-label="공간별 진행">
                    {rows.map((r) => {
                        const p = s.progress.get(r.key);
                        const x = s.submissionOf.get(r.key) ?? null;
                        const isNone = r.key === NO_SPACE_KEY;
                        return (
                            <li key={r.key} className="rounded-xl border border-surface-200 dark:border-surface-700 p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-medium text-surface-900 dark:text-surface-100 break-keep">{r.name}</p>
                                        {r.location && <p className={sub}>{r.location}</p>}
                                    </div>
                                    <p className="text-sm font-semibold tabular-nums text-surface-900 dark:text-surface-100 whitespace-nowrap">{p?.found ?? 0} / {p?.target ?? 0}</p>
                                </div>
                                <p className={`${sub} mt-1`}>다른 곳 {p?.elsewhere ?? 0} · 예외 {p?.foreign ?? 0} · 상태 이상 {p?.issues ?? 0}</p>
                                {delegated && (
                                    <div className="mt-2">
                                        {isNone ? <span className={sub}>관리자 확인</span> : <SubmissionBadge sub={x} names={s.names} />}
                                        {!isNone && x?.state === 'submitted' && (
                                            <div className="flex gap-2 mt-2">
                                                <button type="button" className="btn-primary min-h-[48px] px-4 flex-1" onClick={() => void onReview(r.key, r.name, 'approved', x)}>승인</button>
                                                <button type="button" className="btn-secondary min-h-[48px] px-4 flex-1" onClick={() => void onReview(r.key, r.name, 'rejected', x)}>반려</button>
                                            </div>
                                        )}
                                        {!isNone && !x && (
                                            <button type="button" className="btn-secondary min-h-[48px] px-4 mt-2 w-full" onClick={() => void onReview(r.key, r.name, 'approved', null)}>대신 승인</button>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
                <div className="hidden sm:block overflow-x-auto mt-4">
                    <table className="w-full text-sm">
                        <thead className="text-left text-surface-600 dark:text-surface-400 border-b border-surface-100 dark:border-surface-700">
                            <tr>
                                <th className="py-2 pr-3 font-medium">공간</th>
                                <th className="py-2 pr-3 font-medium">확인</th>
                                <th className="py-2 pr-3 font-medium">다른 곳</th>
                                <th className="py-2 pr-3 font-medium">예외</th>
                                <th className="py-2 pr-3 font-medium">상태 이상</th>
                                {delegated && <th className="py-2 pr-3 font-medium">제출</th>}
                                {delegated && <th className="py-2 font-medium"><span className="sr-only">처리</span></th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-100 dark:divide-surface-700">
                            {rows.map((r) => {
                                const p = s.progress.get(r.key);
                                const x = s.submissionOf.get(r.key) ?? null;
                                const isNone = r.key === NO_SPACE_KEY;
                                return (
                                    <tr key={r.key}>
                                        <td className="py-2 pr-3 text-surface-900 dark:text-surface-100">
                                            {r.name}
                                            {r.location && <span className={`${sub} block`}>{r.location}</span>}
                                        </td>
                                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{p?.found ?? 0} / {p?.target ?? 0}</td>
                                        <td className="py-2 pr-3 tabular-nums">{p?.elsewhere ?? 0}</td>
                                        <td className="py-2 pr-3 tabular-nums">{p?.foreign ?? 0}</td>
                                        <td className="py-2 pr-3 tabular-nums">{p?.issues ?? 0}</td>
                                        {delegated && <td className="py-2 pr-3">{isNone ? <span className={sub}>관리자 확인</span> : <SubmissionBadge sub={x} names={s.names} />}</td>}
                                        {delegated && (
                                            <td className="py-2 whitespace-nowrap">
                                                {!isNone && x?.state === 'submitted' && (
                                                    <span className="flex gap-1">
                                                        <button type="button" className="btn-primary btn-sm min-h-[48px] px-3" onClick={() => void onReview(r.key, r.name, 'approved', x)}>승인</button>
                                                        <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={() => void onReview(r.key, r.name, 'rejected', x)}>반려</button>
                                                    </span>
                                                )}
                                                {!isNone && !x && (
                                                    <button type="button" className="btn-secondary btn-sm min-h-[48px] px-3" onClick={() => void onReview(r.key, r.name, 'approved', null)}>대신 승인</button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="mt-5 pt-4 border-t border-surface-100 dark:border-surface-700">
                    {open.status === 'closing' ? (
                        // 지난 마감이 끝나지 않음 — 찍기·제출은 멈춰 있다. 이어서 닫거나 취소해 다시 연다
                        <div role="alert" className="mb-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                            마감이 끝나지 않았습니다. 지금은 찍기·제출·승인이 멈춰 있습니다. [이어서 마감]을 누르거나, 더 찍어야 하면 [마감 취소]로 다시 여세요.
                        </div>
                    ) : s.blockers.length > 0 ? (
                        <p className="text-sm text-surface-700 dark:text-surface-300 mb-2">
                            마감하려면 모든 공간이 승인돼야 합니다. 남은 공간 {s.blockers.length}곳: <strong>{s.blockers.map(nameOf).join(', ')}</strong>
                            <span className={`${sub} block`}>담당자가 제출하지 못하는 공간은 '대신 승인'(사유 필수)으로 처리할 수 있습니다.</span>
                        </p>
                    ) : (
                        <p className="text-sm text-surface-700 dark:text-surface-300 mb-2">마감하면 더는 찍거나 고칠 수 없고, 결과 보고서와 희망이음 반영 목록이 만들어집니다.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-primary min-h-[48px] px-5" onClick={onClose}
                            disabled={(open.status !== 'closing' && s.blockers.length > 0) || s.closing}>
                            {s.closing ? '마감하는 중…' : open.status === 'closing' ? '이어서 마감' : '조사 마감'}
                        </button>
                        {open.status === 'closing' && (
                            <button type="button" className="btn-secondary min-h-[48px] px-5" onClick={() => void s.cancelClose()} disabled={s.closing}>
                                마감 취소
                            </button>
                        )}
                    </div>
                </div>
            </section>

            <section className={card} aria-labelledby="recent-title">
                <h2 id="recent-title" className="font-semibold text-surface-900 dark:text-surface-100 mb-2">최근 스캔</h2>
                {s.recent.length === 0 ? (
                    <p className={sub}>아직 찍은 것이 없습니다.</p>
                ) : (
                    <ul className="divide-y divide-surface-100 dark:divide-surface-700 text-sm">
                        {s.recent.map((x) => (
                            <li key={x.id} className="py-2 flex flex-wrap items-center gap-x-2">
                                <span className="font-mono text-surface-900 dark:text-surface-100">{x.code}</span>
                                <span className="text-surface-600 dark:text-surface-300">{x.name ?? ''}</span>
                                <span className={sub}>· {nameOf(x.spaceId)} · {SCAN_RESULT_LABEL[x.result]}{x.method === 'manual' ? ' · 직접 입력' : ''}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </>
    );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
    return (
        <div className="rounded-xl bg-surface-50 dark:bg-surface-800 p-3">
            <dt className={sub}>{label}</dt>
            <dd className={`text-lg font-bold tabular-nums ${warn ? 'text-red-700 dark:text-red-300' : 'text-surface-900 dark:text-surface-100'}`}>{value}</dd>
        </div>
    );
}
