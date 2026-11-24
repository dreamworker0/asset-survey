/**
 * SurveyManager — 관리자 재물조사 (기획서 F10·F13·F14·F15)
 *
 * 진행 중 회차가 없으면 새 조사 시작, 있으면 현황판(남은 기간·진행률·공간별 진행과 제출 상태·최근 스캔)과
 * 승인·반려·대신 승인, 마감. 지난 조사는 결과 보고서로 연결한다.
 */
import { Link, useNavigate } from 'react-router-dom';
import useSurveyAdmin, { type StartForm } from '../../hooks/useSurveyAdmin';
import { useConfirm } from '../../hooks/useConfirm';
import { NO_SPACE_KEY, REASON_MAX } from '../../schemas';
import { SCAN_RESULT_LABEL } from '../../lib/survey/judge';
import { daysLeft } from '../../lib/survey/report';
import { groupSpacesByLocation, orderSpacesByLocation, spaceLocationMap } from '../../lib/spaceGroups';
import type { Space } from '../../types/space';
import type { Building } from '../../types/building';
import type { SurveySubmission } from '../../types/survey';

const sub = 'text-xs text-surface-600 dark:text-surface-400';
const card = 'glass-card p-5 mb-4';
const MODE_LABEL = { delegated: '나눠서 조사', solo: '혼자 조사' } as const;

export default function SurveyManager() {
    const s = useSurveyAdmin();
    const { confirm } = useConfirm();
    const navigate = useNavigate();

    if (s.loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 spinner" /></div>;
    if (s.error) {
        return (
            <div className="max-w-3xl mx-auto glass-card p-6 text-center">
                <p className="text-red-700 dark:text-red-300 mb-3" role="alert">조사 정보를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.</p>
                <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void s.reload()}>다시 불러오기</button>
            </div>
        );
    }

    /** 사유를 받아 검토한다 — 반려·본인 승인·대신 승인은 사유 필수 */
    const askReview = async (spaceId: string, spaceName: string, decision: 'approved' | 'rejected', current: SurveySubmission | null) => {
        const self = !!current && current.submittedByUid === s.uid;
        const needsReason = decision === 'rejected' || !current || self;
        if (!needsReason) {
            const ok = await confirm({ title: `${spaceName} 승인`, message: '이 공간의 조사 결과를 승인할까요? 승인하면 이 공간은 스캔이 잠깁니다.', confirmText: '승인' });
            if (ok) await s.review({ spaceId, decision, reason: '' });
            return;
        }
        const title = decision === 'rejected' ? `${spaceName} 반려` : !current ? `${spaceName} 대신 승인` : `${spaceName} 본인 승인`;
        const message = decision === 'rejected'
            ? '반려 사유를 적어 주세요. 공간 담당자 화면에 그대로 보이고, 담당자가 다시 찍고 제출합니다.'
            : !current
                ? '담당자 제출 없이 승인합니다. 사유를 적어 주세요(보고서에 \'대신 승인\'으로 남습니다).'
                : '내가 제출한 공간을 내가 승인합니다. 사유를 적어 주세요(보고서에 \'본인 승인\'으로 남습니다).';
        const reason = await confirm({
            title, message, type: 'input', inputLabel: '사유', inputPlaceholder: decision === 'rejected' ? '예: 창고 안쪽 선반 다시 확인' : '예: 담당자 휴가',
            confirmText: decision === 'rejected' ? '반려' : '승인', confirmColor: decision === 'rejected' ? 'danger' : 'primary',
        });
        if (typeof reason !== 'string') return;
        await s.review({ spaceId, decision, reason: reason.slice(0, REASON_MAX) });
    };

    const closed = s.surveys.filter((x) => x.status === 'closed');
    const activeSpaceCount = s.spaces.filter((x) => !x.archived).length;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">재물조사</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mb-6">
                조사를 시작하면 그때의 운영 재물이 공간별 대상 목록으로 고정되고, 공간 담당자 화면의 스캔 탭이 열립니다.
            </p>

            {s.open ? (
                <Dashboard s={s} onReview={askReview} onClose={async () => { const id = await s.close(); if (id) navigate(`/admin/surveys/${id}`); }} />
            ) : s.form ? (
                <StartFormView
                    form={s.form} setForm={s.setForm} spaces={s.spaces} buildings={s.buildings} preview={s.preview} error={s.formError}
                    mode={s.mode} starting={s.starting} onStart={() => void s.start()} onCancel={s.closeForm}
                />
            ) : (
                <section className={`${card} text-center`}>
                    <p className="text-surface-700 dark:text-surface-300 font-medium mb-1">진행 중인 조사가 없습니다</p>
                    <p className={`${sub} mb-4`}>
                        조사 방식: {MODE_LABEL[s.mode]} · <Link to="/admin/settings" className="underline underline-offset-2 text-primary-700 dark:text-primary-300">설정에서 바꾸기</Link>
                    </p>
                    {activeSpaceCount === 0 ? (
                        <>
                            <p className="text-sm text-surface-700 dark:text-surface-300 mb-3">조사하려면 공간과 재물이 먼저 있어야 합니다.</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                <Link to="/admin/spaces" className="btn-primary min-h-[48px] px-5">공간 만들기</Link>
                                <Link to="/admin/import" className="btn-secondary min-h-[48px] px-5">재물 가져오기</Link>
                            </div>
                        </>
                    ) : (
                        <button type="button" className="btn-primary min-h-[48px] px-5" onClick={() => void s.openForm()}>새 조사 시작</button>
                    )}
                </section>
            )}

            {closed.length > 0 && (
                <section className={card}>
                    <h2 className="font-semibold text-surface-900 dark:text-surface-100 mb-2">지난 조사 · 결과 보고서</h2>
                    <ul className="divide-y divide-surface-100 dark:divide-surface-700">
                        {closed.map((x) => (
                            <li key={x.id}>
                                <Link to={`/admin/surveys/${x.id}`} className="flex items-center gap-2 py-3 min-h-[48px] text-sm rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
                                    <span className="flex-1 min-w-0 flex flex-wrap items-center justify-between gap-x-2">
                                        <span className="font-medium text-primary-700 dark:text-primary-300">{x.name}</span>
                                        <span className={`${sub} tabular-nums`}>
                                            {x.startDate} ~ {x.endDate}
                                            {x.summary && ` · 확인 ${x.summary.found}/${x.summary.target} · 미발견 ${x.summary.missing}`}
                                        </span>
                                    </span>
                                    <span aria-hidden="true" className="text-surface-500 text-lg">›</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

type Admin = ReturnType<typeof useSurveyAdmin>;

function SubmissionBadge({ sub: x, names }: { sub: SurveySubmission | null; names: Map<string, string> }) {
    if (!x) return <span className="text-xs text-surface-600 dark:text-surface-400">조사 중 · 제출 전</span>;
    const who = (uid: string | null) => (uid ? names.get(uid) ?? '알 수 없음' : '');
    if (x.state === 'submitted') return <span className="text-xs font-medium text-sky-700 dark:text-sky-300">제출됨 · {who(x.submittedByUid)}</span>;
    // 사유는 마우스 말풍선(title)이 아니라 글자로 — 휴대폰·키보드로는 볼 수 없었다(2026-11-22 점검)
    if (x.state === 'rejected') {
        return (
            <span className="text-xs font-medium text-red-700 dark:text-red-300">
                반려 · 다시 제출 기다림{x.reason && <span className="block font-normal">사유: {x.reason}</span>}
            </span>
        );
    }
    return (
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            승인{x.proxyApproved ? '(대신)' : x.selfApproved ? '(본인)' : ''} · {who(x.reviewedByUid)}
            {x.reason && <span className="block font-normal text-surface-600 dark:text-surface-400">사유: {x.reason}</span>}
        </span>
    );
}

function Dashboard({ s, onReview, onClose }: {
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

interface StartFormProps {
    form: StartForm;
    setForm: (f: StartForm) => void;
    spaces: Space[];
    buildings: Building[];
    preview: { count: (key: string) => number; total: number; unassigned: number } | null;
    error: string | null;
    mode: 'delegated' | 'solo';
    starting: boolean;
    onStart: () => void;
    onCancel: () => void;
}

function StartFormView({ form, setForm, spaces, buildings, preview, error, mode, starting, onStart, onCancel }: StartFormProps) {
    // 건물 → 층 → 공간 순서 — 고른 공간도 이 순서로 담아 보고서가 같은 순서로 나오게 한다
    const active = orderSpacesByLocation(spaces, buildings);
    const groups = groupSpacesByLocation(active, buildings);
    const hasBuildings = buildings.some((b) => !b.archived);
    const setIds = (ids: Set<string>) => setForm({ ...form, spaceIds: active.map((x) => x.id).filter((id) => ids.has(id)) });
    const toggle = (id: string) => {
        const next = new Set(form.spaceIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setIds(next);
    };
    /** 건물·층 묶음 한꺼번에 — 다 골라져 있으면 모두 빼고, 아니면 모두 고른다 */
    const toggleMany = (ids: string[]) => {
        const next = new Set(form.spaceIds);
        const all = ids.every((id) => next.has(id));
        for (const id of ids) { if (all) next.delete(id); else next.add(id); }
        setIds(next);
    };
    const spaceRow = (x: Space) => (
        <li key={x.id}>
            <label className="flex items-center gap-3 min-h-[48px] text-sm text-surface-800 dark:text-surface-200">
                <input type="checkbox" className="w-5 h-5 accent-primary-600 flex-shrink-0" checked={form.spaceIds.includes(x.id)} onChange={() => toggle(x.id)} />
                <span className="flex-1 break-keep">{x.name}</span>
                <span className={sub}>{preview?.count(x.id) ?? 0}건 · 담당 {x.managerUids.length}명{(x.teamIds ?? []).length > 0 ? ` · 팀 ${(x.teamIds ?? []).length}` : ''}</span>
            </label>
        </li>
    );
    // 담당 팀이 있으면 담당자가 있는 것으로 본다(2026-11-22)
    const noManager = active.filter((x) => form.spaceIds.includes(x.id) && x.managerUids.length === 0 && (x.teamIds ?? []).length === 0);
    return (
        <section className={card} aria-labelledby="start-title">
            <h2 id="start-title" className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-3">새 조사 시작</h2>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 text-sm text-surface-700 dark:text-surface-300">
                    회차 이름
                    <input className="input min-h-[48px] mt-1" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="text-sm text-surface-700 dark:text-surface-300">
                    시작
                    <input type="date" className="input min-h-[48px] mt-1" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </label>
                <label className="text-sm text-surface-700 dark:text-surface-300">
                    끝
                    <input type="date" className="input min-h-[48px] mt-1" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </label>
            </div>

            <fieldset className="mt-4">
                <legend className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">대상 공간 <span className={`${sub} font-normal`}>(운영 재물만 대상)</span></legend>
                {hasBuildings && active.length > 0 && (
                    <p className={`${sub} mb-1`}>건물·층 이름 옆 상자로 그 안의 공간을 한꺼번에 고르거나 뺄 수 있습니다.</p>
                )}
                <ul className="divide-y divide-surface-100 dark:divide-surface-700">
                    {!hasBuildings ? active.map(spaceRow) : groups.filter((g) => g.count > 0).map((g) => {
                        const ids = g.floors.flatMap((f) => f.spaces.map((x) => x.id));
                        const picked = ids.filter((id) => form.spaceIds.includes(id)).length;
                        return (
                            <li key={g.buildingId ?? 'none'} className="py-1">
                                <GroupCheck
                                    label={g.label} level="building" picked={picked} total={ids.length}
                                    onToggle={() => toggleMany(ids)}
                                />
                                <ul className="pl-4">
                                    {g.floors.map((f) => {
                                        const fids = f.spaces.map((x) => x.id);
                                        const fpicked = fids.filter((id) => form.spaceIds.includes(id)).length;
                                        return (
                                            <li key={f.floor ?? 'none'}>
                                                {f.label && g.buildingId && (
                                                    <GroupCheck
                                                        label={`${g.label} ${f.label}`} display={f.label} level="floor"
                                                        picked={fpicked} total={fids.length} onToggle={() => toggleMany(fids)}
                                                    />
                                                )}
                                                <ul className={f.label && g.buildingId ? 'pl-4' : ''}>{f.spaces.map(spaceRow)}</ul>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        );
                    })}
                    {(preview?.unassigned ?? 0) > 0 && (
                        <li>
                            <label className="flex items-center gap-3 min-h-[48px] text-sm text-surface-800 dark:text-surface-200">
                                <input type="checkbox" className="w-5 h-5 accent-primary-600 flex-shrink-0" checked={form.includesUnassigned} onChange={(e) => setForm({ ...form, includesUnassigned: e.target.checked })} />
                                <span className="flex-1">공간 미지정 재물</span>
                                <span className={sub}>{preview?.unassigned}건 · 어디서 찍든 '다른 공간'으로 나옴</span>
                            </label>
                        </li>
                    )}
                </ul>
            </fieldset>

            {mode === 'delegated' && noManager.length > 0 && (
                <p className="mt-3 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                    담당자가 없는 공간이 있습니다({noManager.map((x) => x.name).join(', ')}). 그 공간은 관리자가 찍고 승인합니다.
                </p>
            )}
            {mode === 'solo' && <p className={`${sub} mt-3`}>조사 방식이 '혼자 조사'라 관리자만 찍고, 제출·승인 없이 바로 마감합니다.</p>}
            {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}

            <div className="flex flex-col sm:flex-row gap-2 justify-end mt-4">
                <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={onCancel} disabled={starting}>취소</button>
                <button type="button" className="btn-primary min-h-[48px] px-5" onClick={onStart} disabled={!!error || starting || !preview || preview.total === 0}>
                    {starting ? '시작하는 중…' : `대상 ${(preview?.total ?? 0).toLocaleString('ko-KR')}건으로 시작`}
                </button>
            </div>
        </section>
    );
}

/** 건물·층 묶음 체크 상자 — 일부만 골랐으면 '일부 선택'(indeterminate)으로 보인다 */
function GroupCheck({ label, display, level, picked, total, onToggle }: {
    label: string; display?: string; level: 'building' | 'floor'; picked: number; total: number; onToggle: () => void;
}) {
    return (
        <label className={`flex items-center gap-3 min-h-[48px] text-sm ${level === 'building'
            ? 'font-semibold text-surface-900 dark:text-surface-100'
            : 'font-medium text-primary-700 dark:text-primary-300'}`}>
            <input
                type="checkbox"
                className="w-5 h-5 accent-primary-600 flex-shrink-0"
                checked={total > 0 && picked === total}
                ref={(el) => { if (el) el.indeterminate = picked > 0 && picked < total; }}
                onChange={onToggle}
                aria-label={`${label} 공간 모두 고르기`}
            />
            <span className="flex-1">{display ?? label}</span>
            <span className={sub}>{picked}/{total}곳</span>
        </label>
    );
}
