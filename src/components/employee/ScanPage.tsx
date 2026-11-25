/**
 * ScanPage — 현장 스캔 (기획서 F11·F12)
 *
 * 공간을 고르고 라벨 QR을 연속으로 찍는다. 카메라가 안 되면 자산코드를 직접 입력한다(바코드 스캐너도
 * 키보드처럼 입력되므로 같은 칸을 쓴다). 찍을 때마다 판정을 크게 보여 주고, 예외면 물건 상태·메모를 남긴다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useScanner, { type LastScan } from '../../hooks/useScanner';
import usePendingSyncCount from '../../hooks/usePendingSyncCount';
import { hasDurableLocalCache } from '../../lib/firebase';
import QrCamera, { type CameraState } from './QrCamera';
import { SCAN_RESULT_LABEL, CONDITION_LABEL } from '../../lib/survey/judge';
import { SCAN_MEMO_MAX } from '../../schemas';
import { uploadScanPhoto, removeScanPhoto, PHOTO_SOURCE_MAX_BYTES } from '../../lib/firestore';
import { SkeletonBox, SkeletonCard, SkeletonList } from '../common/Skeleton';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import type { Scan, ScanCondition, ScanResult, SurveySubmission } from '../../types/survey';

const sub = 'text-xs text-surface-600 dark:text-surface-400';

const RESULT_STYLE: Record<ScanResult | 'duplicate', string> = {
    ok: 'bg-accent-50 border-accent-300 text-accent-800 dark:bg-accent-900/30 dark:border-accent-700 dark:text-accent-200',
    otherSpace: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200',
    unregistered: 'bg-red-50 border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200',
    outOfScope: 'bg-surface-100 border-surface-300 text-surface-800 dark:bg-surface-800 dark:border-surface-600 dark:text-surface-200',
    duplicate: 'bg-primary-50 border-primary-300 text-primary-900 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-200',
};

const RESULT_HELP: Record<ScanResult, string> = {
    ok: '이 공간의 재물입니다.',
    otherSpace: '목록상 다른 공간의 재물입니다. 실제로 옮겨졌는지 확인해 주세요.',
    unregistered: '이 기관 재물 목록에 없는 라벨·코드입니다.',
    outOfScope: '이번 조사 대상이 아닌 재물입니다(불용·폐기이거나 대상 공간 밖).',
};

export default function ScanPage() {
    const [params, setParams] = useSearchParams();
    const sc = useScanner(params.get('space'));
    const [mode, setMode] = useState<'camera' | 'manual'>('camera');
    const [cameraOn, setCameraOn] = useState(false);
    const [camState, setCamState] = useState<CameraState>('starting');
    const [code, setCode] = useState('');
    const [tab, setTab] = useState<'remaining' | 'done'>('remaining');
    const [editing, setEditing] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingCount = usePendingSyncCount();

    // 공간을 바꾸면 주소에도 남긴다(새로고침·뒤로 가기에도 같은 공간)
    useEffect(() => {
        if (sc.spaceId && params.get('space') !== sc.spaceId) setParams({ space: sc.spaceId }, { replace: true });
    }, [sc.spaceId, params, setParams]);

    if (sc.loading) {
        return (
            <div className="max-w-lg mx-auto animate-fade-in space-y-3" role="status" aria-label="스캔 화면을 불러오는 중">
                <SkeletonCard />
                <SkeletonBox className="h-12 w-full rounded-xl" />
                <SkeletonList count={3} />
            </div>
        );
    }
    if (sc.error) {
        return (
            <Notice
                icon={
                    <svg className="w-7 h-7 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                }
                title="조사 정보를 불러오지 못했습니다"
                text="인터넷 연결을 확인한 뒤 다시 불러오세요."
                retry
            />
        );
    }
    if (!sc.survey) {
        return (
            <Notice
                icon={
                    <svg className="w-7 h-7 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                    </svg>
                }
                title="진행 중인 재물조사가 없습니다"
                text="재물 담당자가 조사를 시작하면 이 탭에서 라벨의 QR을 찍어 조사합니다."
            />
        );
    }
    if (sc.mySpaces.length === 0) {
        return (
            <Notice
                icon={
                    <svg className="w-7 h-7 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                    </svg>
                }
                title="찍을 수 있는 공간이 없습니다"
                text={sc.survey.mode === 'solo'
                    ? '이번 조사는 \'혼자 조사\' 방식이라 재물 담당자가 직접 찍습니다.'
                    : '이번 조사에서 내가 담당하는 공간이 없습니다. 재물 담당자에게 공간 지정을 요청하세요.'}
            />
        );
    }

    if (!sc.spaceId) {
        return (
            <div className="max-w-lg mx-auto animate-fade-in space-y-3">
                <SurveyHeader name={sc.survey.name} start={sc.survey.startDate} end={sc.survey.endDate} />
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">어느 공간을 조사할까요?</p>
                <ul className="space-y-2">
                    {sc.mySpaces.map((s) => (
                        <li key={s.id}>
                            <button type="button" className="glass-card w-full text-left p-4 min-h-[56px] font-medium text-surface-900 dark:text-surface-100 flex items-center gap-2 hover:border-primary-300 dark:hover:border-primary-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500" onClick={() => sc.setSpaceId(s.id)}>
                                <span className="flex-1 break-keep">{s.name}</span>
                                <span aria-hidden="true" className="text-surface-500 text-lg">›</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    const pct = sc.target > 0 ? Math.round((sc.found / sc.target) * 100) : 0;
    /** 입력을 막는 경우 — 이 공간을 제출했거나, 재물 담당자가 마감을 시작했거나 */
    const inputLocked = sc.locked || sc.paused;
    const isSubmittedOrReviewed = sc.submission?.state === 'submitted' || sc.submission?.state === 'approved' || sc.submission?.state === 'rejected';
    const submitManual = (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim()) return;
        if (sc.handle(code, 'manual')) setCode('');
        inputRef.current?.focus();
    };

    return (
        <div className="max-w-lg mx-auto animate-fade-in space-y-3">
            {/* 상단 콤팩트 현황 카드: 회차 제목·기간 + 공간(선택) + 진행 건수·비율 */}
            <section className="glass-card p-3.5" aria-label="진행">
                <div className="flex items-baseline justify-between gap-2">
                    <h1 className="text-base font-bold text-surface-900 dark:text-surface-100 truncate">{sc.survey.name}</h1>
                    <span className={`${sub} tabular-nums shrink-0`}>{sc.survey.startDate} ~ {sc.survey.endDate}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                    {sc.mySpaces.length > 1 ? (
                        <select
                            aria-label="조사하는 공간"
                            className="input w-auto max-w-[58%] py-1.5 px-2.5 min-h-[40px] text-sm font-semibold"
                            value={sc.spaceId}
                            onChange={(e) => { sc.setSpaceId(e.target.value); sc.clearLast(); }}
                        >
                            {sc.mySpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    ) : (
                        <span className="font-semibold text-surface-900 dark:text-surface-100 truncate">{sc.spaceName.get(sc.spaceId)}</span>
                    )}
                    <span className="text-sm text-surface-700 dark:text-surface-300 shrink-0 tabular-nums">
                        <strong className="text-base text-surface-900 dark:text-surface-100">{sc.found}</strong> / {sc.target}건 확인
                        <span className="ml-1.5 text-xs font-semibold text-primary-700 dark:text-primary-300">{pct}%</span>
                    </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={sc.target} aria-valuenow={sc.found} aria-label="확인한 비율">
                    <div className="h-full bg-primary-600 dark:bg-primary-400 transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
            </section>

            {sc.paused && (
                <section className="rounded-2xl border-2 p-4 bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200" role="alert">
                    <p className="font-bold">재물 담당자가 조사를 마감하는 중입니다</p>
                    <p className="text-sm">지금은 스캔과 제출을 할 수 없습니다. 이미 찍은 기록은 그대로 결과에 들어갑니다. 마감이 취소되면 다시 찍을 수 있습니다.</p>
                </section>
            )}

            {/* 제출 완료·승인·반려 상태 배너는 상단에 즉시 노출 */}
            {sc.survey.mode === 'delegated' && !sc.paused && isSubmittedOrReviewed && (
                <SubmissionPanel submission={sc.submission} pending={sc.submissionPending} remaining={sc.remaining.length} submitting={sc.submitting}
                    onSubmit={() => void sc.submit(sc.remaining.length)} />
            )}

            {!inputLocked && (<>
            <div className="flex gap-2" role="group" aria-label="입력 방법">
                {(['camera', 'manual'] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                        className={`flex-1 min-h-[48px] rounded-xl text-sm font-medium transition-colors ${mode === m
                            ? 'bg-primary-600 text-white dark:bg-primary-500 shadow-sm'
                            : 'bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700'}`}>
                        {m === 'camera' ? 'QR 카메라' : '코드 직접 입력'}
                    </button>
                ))}
            </div>

            {mode === 'camera' ? (
                <section className="glass-card p-3">
                    {cameraOn ? (
                        <>
                            <QrCamera onScan={(t) => sc.handle(t, 'qr')} onStateChange={setCamState} />
                            {camState === 'denied' && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">카메라 사용이 막혀 있습니다. 브라우저 설정에서 카메라를 허용하거나 '코드 직접 입력'을 쓰세요.</p>}
                            {camState === 'unsupported' && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">이 브라우저에서는 카메라를 쓸 수 없습니다. '코드 직접 입력'을 쓰세요.</p>}
                            <button type="button" className="btn-secondary w-full min-h-[48px] mt-2" onClick={() => setCameraOn(false)}>카메라 끄기</button>
                        </>
                    ) : (
                        <button type="button" className="btn-primary w-full min-h-[56px] text-base" onClick={() => setCameraOn(true)}>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                            </svg>
                            <span>카메라 켜고 찍기</span>
                        </button>
                    )}
                </section>
            ) : (
                <form className="glass-card p-3 flex gap-2" onSubmit={submitManual}>
                    <label htmlFor="manual-code" className="sr-only">자산코드</label>
                    <input id="manual-code" ref={inputRef} className="input min-h-[48px] flex-1" placeholder="라벨의 자산코드" autoComplete="off"
                        value={code} onChange={(e) => setCode(e.target.value)} />
                    <button type="submit" className="btn-primary min-h-[48px] px-4" disabled={!code.trim() || sc.checking}>확인</button>
                </form>
            )}
            </>)}

            {sc.checking && <p className={sub} role="status">확인하는 중…</p>}
            {sc.last && !inputLocked && <ResultCard last={sc.last} spaceName={sc.spaceName} scan={sc.last.kind === 'saved' ? sc.scanMap.get(sc.last.draft.scanId) : undefined}
                onCondition={sc.setCondition} onUndo={sc.undo} onBeforePhoto={() => setCameraOn(false)} />}

            {/* 미제출 상태일 때는 스캔 영역 아래에 제출 패널을 두어 첫 화면에서 바로 카메라/입력칸이 보이게 한다 */}
            {sc.survey.mode === 'delegated' && !sc.paused && !isSubmittedOrReviewed && (
                <SubmissionPanel submission={sc.submission} pending={sc.submissionPending} remaining={sc.remaining.length} submitting={sc.submitting}
                    onSubmit={() => void sc.submit(sc.remaining.length)} />
            )}

            <div className="flex gap-2 pt-1" role="group" aria-label="목록 고르기">
                <TabButton active={tab === 'remaining'} onClick={() => setTab('remaining')}>남은 재물 {sc.remaining.length}</TabButton>
                <TabButton active={tab === 'done'} onClick={() => setTab('done')}>여기서 찍은 기록 {sc.here.length}</TabButton>
            </div>
            {tab === 'remaining' ? (
                sc.remaining.length === 0 ? (
                    <div className="glass-card p-4 text-sm text-center text-surface-700 dark:text-surface-200 flex items-center justify-center gap-2">
                        <svg className="w-5 h-5 text-accent-600 dark:text-accent-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        <span>이 공간의 대상을 모두 확인했습니다</span>
                    </div>
                ) : (
                    <ul className="glass-card divide-y divide-surface-100 dark:divide-surface-800">
                        {sc.remaining.map((i) => (
                            <li key={i.id} className="px-4 py-2.5 text-sm">
                                <span className="font-mono font-medium text-surface-900 dark:text-surface-100">{i.code}</span>
                                <span className="text-surface-600 dark:text-surface-300"> · {i.name ?? '-'}</span>
                            </li>
                        ))}
                    </ul>
                )
            ) : sc.here.length === 0 ? (
                <p className="glass-card p-4 text-sm text-center text-surface-600 dark:text-surface-400">아직 이 공간에서 찍은 것이 없습니다.</p>
            ) : (
                <ul className="glass-card divide-y divide-surface-100 dark:divide-surface-800">
                    {sc.here.map((s) => (
                        <li key={s.id} className="px-4 py-2.5 text-sm">
                            <button type="button" className="w-full text-left min-h-[48px] flex items-start gap-2" onClick={() => setEditing(editing === s.id ? null : s.id)} aria-expanded={editing === s.id}>
                                <span className="flex-1 min-w-0">
                                <span className="font-mono font-medium text-surface-900 dark:text-surface-100">{s.code}</span>
                                <span className="text-surface-600 dark:text-surface-300"> · {s.name ?? '-'}</span>
                                <span className="flex flex-wrap items-center gap-1 mt-0.5">
                                    <ResultChip result={s.result} />
                                    {s.method === 'manual' && <span className={sub}>직접 입력</span>}
                                    {s.condition !== 'normal' && <span className="text-xs text-red-700 dark:text-red-300">{CONDITION_LABEL[s.condition]}</span>}
                                    {s.photoUrl && (
                                        <span className="inline-flex items-center gap-0.5 text-xs text-surface-600 dark:text-surface-400" aria-label="사진 있음">
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                                            </svg>
                                        </span>
                                    )}
                                </span>
                                </span>
                                {/* 누르면 상태·사진·지우기가 펼쳐진다는 표시(예전엔 평범한 글자 줄이라 찾을 수 없었다) */}
                                {!inputLocked && (
                                    <span className="flex-shrink-0 self-center text-xs font-medium text-primary-700 dark:text-primary-300 border border-surface-300 dark:border-surface-600 rounded-lg px-2 py-1">
                                        고치기 <span aria-hidden="true">{editing === s.id ? '▴' : '▾'}</span>
                                    </span>
                                )}
                            </button>
                            {editing === s.id && !inputLocked && <ConditionEditor scan={s} onSave={sc.setCondition} onUndo={sc.undo} />}
                        </li>
                    ))}
                </ul>
            )}
            {pendingCount > 0 && (
                <p className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200" role="status">
                    아직 보내지 못한 기록 <strong>{pendingCount}건</strong> — 인터넷에 연결되면 자동으로 보냅니다. 다 보내기 전에는 로그아웃하지 마세요.
                </p>
            )}
            {hasDurableLocalCache() ? (
                <p className={`${sub} text-center pb-4`}>인터넷이 끊겨도 찍은 기록은 이 기기에 남았다가 연결되면 저장됩니다.</p>
            ) : (
                <p className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200 mb-4 flex items-start gap-2">
                    <svg className="w-5 h-5 shrink-0 text-amber-700 dark:text-amber-300 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                    <span>
                        이 브라우저는 기록을 기기에 보관하지 못합니다(사생활 보호 모드 등). 인터넷이 약한 곳에서는 앱을 닫지 말고,
                        연결된 곳에서 '보내지 못한 기록'이 없어진 것을 확인하세요.
                    </span>
                </p>
            )}
        </div>
    );
}

function SubmissionPanel({ submission, pending, remaining, submitting, onSubmit }: {
    submission: SurveySubmission | null; pending: boolean; remaining: number; submitting: boolean; onSubmit: () => void;
}) {
    if (submission?.state === 'submitted') {
        return (
            <section className="rounded-2xl border-2 p-4 bg-primary-50 border-primary-300 text-primary-900 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-200" role="status">
                <p className="font-bold">{pending ? '제출 전송 대기 중' : '제출했습니다'}</p>
                <p className="text-sm">
                    {pending
                        ? '인터넷에 연결되면 제출이 전송됩니다. 그동안 이 공간은 스캔이 잠깁니다.'
                        : '재물 담당자가 확인하는 동안 이 공간은 스캔이 잠깁니다. 반려되면 다시 열립니다.'}
                </p>
            </section>
        );
    }
    if (submission?.state === 'approved') {
        return (
            <section className="rounded-2xl border-2 p-4 bg-accent-50 border-accent-300 text-accent-900 dark:bg-accent-900/30 dark:border-accent-700 dark:text-accent-200" role="status">
                <p className="font-bold">승인됐습니다{submission.proxyApproved ? ' (재물 담당자 대신 승인)' : ''}</p>
                <p className="text-sm">이 공간의 조사가 끝났습니다. 수고하셨습니다.</p>
            </section>
        );
    }
    return (
        <section className="glass-card p-3.5">
            {submission?.state === 'rejected' && (
                <div className="mb-3 rounded-xl bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-200" role="alert">
                    <p className="font-semibold">반려됐습니다 — 다시 확인해 주세요</p>
                    <p>사유: {submission.reason}</p>
                </div>
            )}
            <p className="text-sm text-surface-700 dark:text-surface-300 mb-2">
                이 공간을 다 찍었으면 제출하세요.{remaining > 0 && <> 남은 재물 <strong>{remaining}건</strong>은 '미발견'으로 보고됩니다.</>}
            </p>
            <button type="button" className={`${remaining === 0 || submission?.state === 'rejected' ? 'btn-primary' : 'btn-secondary'} w-full min-h-[48px]`} onClick={onSubmit} disabled={submitting}>
                {submitting ? '제출하는 중…' : submission?.state === 'rejected' ? '다시 제출' : '이 공간 조사 제출'}
            </button>
        </section>
    );
}

function SurveyHeader({ name, start, end }: { name: string; start: string; end: string }) {
    return (
        <div>
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">{name}</h1>
            <p className={sub}>{start} ~ {end}</p>
        </div>
    );
}

function Notice({ icon, title, text, retry = false }: { icon: ReactNode; title: string; text: string; retry?: boolean }) {
    return (
        <div className="max-w-lg mx-auto glass-card p-6 text-center animate-fade-in">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center" aria-hidden="true">{icon}</div>
            <p className="text-surface-800 dark:text-surface-200 font-medium">{title}</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">{text}</p>
            <div className="flex justify-center gap-2 mt-4">
                {retry && <button type="button" className="btn-primary min-h-[48px] px-5" onClick={() => window.location.reload()}>다시 불러오기</button>}
                <Link to="/employee/home" className="btn-secondary min-h-[48px] px-5">홈으로</Link>
            </div>
        </div>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" aria-pressed={active} onClick={onClick}
            className={`flex-1 min-h-[48px] rounded-xl text-sm font-medium ${active
                ? 'bg-surface-800 text-white dark:bg-surface-200 dark:text-surface-900'
                : 'bg-white text-surface-700 border border-surface-300 dark:bg-surface-800 dark:text-surface-200 dark:border-surface-600'}`}>
            {children}
        </button>
    );
}

function ResultChip({ result }: { result: ScanResult }) {
    return <span className={`inline-block px-1.5 py-0.5 rounded-md border text-xs font-medium ${RESULT_STYLE[result]}`}>{SCAN_RESULT_LABEL[result]}</span>;
}

interface ResultCardProps {
    last: LastScan;
    spaceName: Map<string, string>;
    scan: Scan | undefined;
    onCondition: (scanId: string, c: ScanCondition, memo: string) => void;
    onUndo: (scanId: string) => void;
    /** 현장 사진 찍기 직전 — QR 카메라를 먼저 끈다(휴대폰 카메라를 둘이 동시에 쥐지 않게) */
    onBeforePhoto?: () => void;
}

function ResultCard({ last, spaceName, scan, onCondition, onUndo, onBeforePhoto }: ResultCardProps) {
    if (last.kind === 'lookupFailed') {
        return (
            <section className={`rounded-2xl border-2 p-4 ${RESULT_STYLE.unregistered}`} role="alert" key={last.at}>
                <p className="text-lg font-bold">확인 못 함 · 저장 안 됨</p>
                <p className="font-mono">{last.code}</p>
                <p className="text-sm mt-1">조사 목록에 없는 라벨이라 대장에서 찾아야 하는데, 인터넷 연결이 불안정해 찾지 못했습니다. 연결된 곳에서 이 물건을 다시 찍어 주세요.</p>
            </section>
        );
    }
    if (last.kind === 'duplicate') {
        const j = last.judgement;
        return (
            <section className={`rounded-2xl border-2 p-4 ${RESULT_STYLE.duplicate}`} role="status" aria-live="assertive" key={last.at}>
                <p className="text-lg font-bold">이미 찍은 재물</p>
                <p className="font-mono">{j.code} <span className="font-sans">{j.name ?? ''}</span></p>
                <p className="text-sm mt-1">
                    {j.existing ? `${spaceName.get(j.existing.spaceId) ?? '다른 공간'}에서 '${SCAN_RESULT_LABEL[j.existing.result]}'(으)로 확인됨` : '이번 조사에서 이미 확인됐습니다'} — 수는 늘지 않습니다.
                </p>
            </section>
        );
    }
    const { draft, method } = last;
    return (
        <section className={`rounded-2xl border-2 p-4 ${RESULT_STYLE[draft.result]}`} role="status" aria-live="assertive" key={last.at}>
            <p className="text-lg font-bold">
                {SCAN_RESULT_LABEL[draft.result]}{method === 'manual' && <span className="text-sm font-medium"> · 직접 입력(재확인 대상)</span>}
            </p>
            <p className="font-mono">{draft.code} <span className="font-sans">{draft.name ?? ''}</span></p>
            <p className="text-sm mt-1">{RESULT_HELP[draft.result]}</p>
            {draft.result === 'otherSpace' && (
                <p className="text-sm mt-1">목록상 공간: <strong>{draft.expectedSpaceId ? spaceName.get(draft.expectedSpaceId) ?? '(지운 공간)' : '공간 미지정'}</strong></p>
            )}
            {scan && <ConditionEditor scan={scan} onSave={onCondition} onUndo={onUndo} onBeforePhoto={onBeforePhoto} compact />}
        </section>
    );
}

function ConditionEditor({ scan, onSave, onUndo, onBeforePhoto, compact = false }: {
    scan: Scan; onSave: (scanId: string, c: ScanCondition, memo: string) => void; onUndo: (scanId: string) => void; onBeforePhoto?: () => void; compact?: boolean;
}) {
    const [condition, setCondition] = useState<ScanCondition>(scan.condition);
    const [memo, setMemo] = useState(scan.memo);
    const dirty = condition !== scan.condition || memo !== scan.memo;
    return (
        <div className={compact ? 'mt-3 pt-3 border-t border-current/20' : 'mt-2 pb-1'}>
            <p className="text-sm font-medium mb-1">물건 상태</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="물건 상태">
                {(Object.keys(CONDITION_LABEL) as ScanCondition[]).map((c) => (
                    <button key={c} type="button" aria-pressed={condition === c} onClick={() => setCondition(c)}
                        className={`px-3 min-h-[48px] rounded-xl text-sm font-medium border ${condition === c
                            ? 'bg-surface-900 text-white border-surface-900 dark:bg-surface-100 dark:text-surface-900'
                            : 'bg-white/70 dark:bg-surface-900/40 border-surface-300 dark:border-surface-600 text-surface-800 dark:text-surface-200'}`}>
                        {CONDITION_LABEL[c]}
                    </button>
                ))}
            </div>
            {(condition !== 'normal' || memo) && (
                <label className="block mt-2 text-sm">
                    메모 <span className="opacity-70">(예외만 짧게)</span>
                    <input className="input min-h-[48px] mt-1" maxLength={SCAN_MEMO_MAX} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 다리 한쪽 부러짐" />
                </label>
            )}
            <ScanPhoto scan={scan} onBeforePick={onBeforePhoto} />
            <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" className="btn-primary min-h-[48px] px-4 text-sm" disabled={!dirty} onClick={() => onSave(scan.id, condition, memo)}>상태 저장</button>
                {/* 지우기는 저장과 떨어뜨리고(ml-auto) 묻고 지운다 — 휴대폰에서 잘못 누르기 쉬웠다 */}
                <button type="button" className="btn-secondary min-h-[48px] px-3 text-sm text-red-700 dark:text-red-300 ml-auto" onClick={() => onUndo(scan.id)}>잘못 찍음 · 지우기</button>
            </div>
        </div>
    );
}

/**
 * 현장 사진(2026-11-22) — 파손·라벨 훼손 등을 보여 줄 사진 한 장. 휴대폰에서는 바로 카메라가 열린다.
 * 사진은 인터넷이 필요하다(스캔은 끊긴 곳에서도 되지만 사진은 연결됐을 때 올린다).
 * 올린 뒤에는 실시간 구독이 스캔 문서를 다시 받아 작은 사진이 보인다.
 */
function ScanPhoto({ scan, onBeforePick }: { scan: Scan; onBeforePick?: () => void }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const pick = async (file: File | undefined) => {
        if (!file) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            showToast('사진은 인터넷이 연결됐을 때 올릴 수 있어요. 스캔 기록은 그대로 남아 있습니다.', 'warning');
            return;
        }
        if (!file.type.startsWith('image/') || file.size > PHOTO_SOURCE_MAX_BYTES) { showToast('사진 파일을 골라 주세요.', 'warning'); return; }
        setBusy(true);
        try {
            await uploadScanPhoto(scan, file);
            showToast('현장 사진을 붙였습니다.', 'success');
        } catch {
            showToast('사진을 올리지 못했습니다. 인터넷 연결을 확인하고 다시 찍어 주세요.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        const ok = await confirm({ title: '현장 사진을 지울까요?', message: '스캔 기록은 그대로 남습니다.', confirmText: '사진 지우기', confirmColor: 'danger' });
        if (!ok) return;
        setBusy(true);
        try { await removeScanPhoto(scan); } catch { showToast('사진을 지우지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error'); } finally { setBusy(false); }
    };

    return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
            {scan.photoThumbUrl && (
                <a href={scan.photoUrl ?? scan.photoThumbUrl} target="_blank" rel="noopener noreferrer" aria-label="현장 사진 크게 보기">
                    <img src={scan.photoThumbUrl} alt="현장 사진" className="w-14 h-14 rounded-lg object-cover" />
                </a>
            )}
            <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
                aria-label="현장 사진 찍기" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />
            <button type="button" className="btn-secondary min-h-[48px] px-3 text-sm" disabled={busy} onClick={() => { onBeforePick?.(); inputRef.current?.click(); }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                </svg>
                <span>{busy ? '올리는 중…' : scan.photoUrl ? '사진 바꾸기' : '사진 찍기'}</span>
            </button>
            {scan.photoUrl && (
                <button type="button" className="btn-secondary min-h-[48px] px-3 text-sm" disabled={busy} onClick={() => void remove()}>사진 지우기</button>
            )}
        </div>
    );
}
