/**
 * ScanPage — 현장 스캔 (기획서 F11·F12)
 *
 * 공간을 고르고 라벨 QR을 연속으로 찍는다. 카메라가 안 되면 자산코드를 직접 입력한다(바코드 스캐너도
 * 키보드처럼 입력되므로 같은 칸을 쓴다). 찍을 때마다 판정을 크게 보여 주고, 예외면 물건 상태·메모를 남긴다.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useScanner, { type LastScan } from '../../hooks/useScanner';
import usePendingSyncCount from '../../hooks/usePendingSyncCount';
import { hasDurableLocalCache } from '../../lib/firebase';
import QrCamera, { type CameraState } from './QrCamera';
import { SCAN_RESULT_LABEL, CONDITION_LABEL } from '../../lib/survey/judge';
import { SCAN_MEMO_MAX } from '../../schemas';
import { uploadScanPhoto, removeScanPhoto, PHOTO_SOURCE_MAX_BYTES } from '../../lib/firestore';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import type { Scan, ScanCondition, ScanResult, SurveySubmission } from '../../types/survey';

const sub = 'text-xs text-surface-600 dark:text-surface-400';

const RESULT_STYLE: Record<ScanResult | 'duplicate', string> = {
    ok: 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200',
    otherSpace: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200',
    unregistered: 'bg-red-50 border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200',
    outOfScope: 'bg-surface-100 border-surface-300 text-surface-800 dark:bg-surface-800 dark:border-surface-600 dark:text-surface-200',
    duplicate: 'bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-200',
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

    if (sc.loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 spinner" /></div>;
    if (sc.error) return <Notice icon="⚠️" title="조사 정보를 불러오지 못했습니다" text="인터넷 연결을 확인한 뒤 다시 불러오세요." retry />;
    if (!sc.survey) return <Notice icon="📋" title="진행 중인 재물조사가 없습니다" text="재물 담당자가 조사를 시작하면 이 탭에서 라벨의 QR을 찍어 조사합니다." />;
    if (sc.mySpaces.length === 0) {
        return (
            <Notice icon="🏢" title="찍을 수 있는 공간이 없습니다"
                text={sc.survey.mode === 'solo'
                    ? '이번 조사는 \'혼자 조사\' 방식이라 재물 담당자가 직접 찍습니다.'
                    : '이번 조사에서 내가 담당하는 공간이 없습니다. 재물 담당자에게 공간 지정을 요청하세요.'} />
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
                            <button type="button" className="glass-card w-full text-left p-4 min-h-[56px] font-medium text-surface-900 dark:text-surface-100 flex items-center gap-2 hover:ring-2 hover:ring-primary-200 dark:hover:ring-primary-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500" onClick={() => sc.setSpaceId(s.id)}>
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
    const submitManual = (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim()) return;
        if (sc.handle(code, 'manual')) setCode('');
        inputRef.current?.focus();
    };

    return (
        <div className="max-w-lg mx-auto animate-fade-in space-y-3">
            <SurveyHeader name={sc.survey.name} start={sc.survey.startDate} end={sc.survey.endDate} />

            {sc.mySpaces.length > 1 && (
                <label className="block text-sm text-surface-700 dark:text-surface-300">
                    조사하는 공간
                    <select className="input min-h-[48px] mt-1" value={sc.spaceId} onChange={(e) => { sc.setSpaceId(e.target.value); sc.clearLast(); }}>
                        {sc.mySpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </label>
            )}

            <section className="glass-card p-4" aria-label="진행">
                <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-surface-900 dark:text-surface-100">{sc.spaceName.get(sc.spaceId)}</span>
                    <span className="text-sm text-surface-700 dark:text-surface-300">
                        <strong className="text-lg text-surface-900 dark:text-surface-100">{sc.found}</strong> / {sc.target}건 확인
                    </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={sc.target} aria-valuenow={sc.found} aria-label="확인한 비율">
                    <div className="h-full bg-primary-600 dark:bg-primary-400" style={{ width: `${pct}%` }} />
                </div>
            </section>

            {sc.paused && (
                <section className="rounded-2xl border-2 p-4 bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200" role="alert">
                    <p className="font-bold">재물 담당자가 조사를 마감하는 중입니다</p>
                    <p className="text-sm">지금은 스캔과 제출을 할 수 없습니다. 이미 찍은 기록은 그대로 결과에 들어갑니다. 마감이 취소되면 다시 찍을 수 있습니다.</p>
                </section>
            )}

            {sc.survey.mode === 'delegated' && !sc.paused && (
                <SubmissionPanel submission={sc.submission} pending={sc.submissionPending} remaining={sc.remaining.length} submitting={sc.submitting}
                    onSubmit={() => void sc.submit(sc.remaining.length)} />
            )}

            {!inputLocked && (<>
            <div className="flex gap-2" role="group" aria-label="입력 방법">
                {(['camera', 'manual'] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                        className={`flex-1 min-h-[48px] rounded-xl text-sm font-medium ${mode === m
                            ? 'bg-primary-600 text-white dark:bg-primary-500'
                            : 'bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-700'}`}>
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
                        <button type="button" className="btn-primary w-full min-h-[56px] text-base" onClick={() => setCameraOn(true)}>📷 카메라 켜고 찍기</button>
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

            <div className="flex gap-2 pt-2" role="group" aria-label="목록 고르기">
                <TabButton active={tab === 'remaining'} onClick={() => setTab('remaining')}>남은 재물 {sc.remaining.length}</TabButton>
                <TabButton active={tab === 'done'} onClick={() => setTab('done')}>여기서 찍은 기록 {sc.here.length}</TabButton>
            </div>
            {tab === 'remaining' ? (
                sc.remaining.length === 0 ? (
                    <p className="glass-card p-4 text-sm text-center text-surface-600 dark:text-surface-300">이 공간의 대상을 모두 확인했습니다 🎉</p>
                ) : (
                    <ul className="glass-card divide-y divide-surface-100 dark:divide-surface-700">
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
                <ul className="glass-card divide-y divide-surface-100 dark:divide-surface-700">
                    {sc.here.map((s) => (
                        <li key={s.id} className="px-4 py-2.5 text-sm">
                            <button type="button" className="w-full text-left min-h-[48px] flex items-start gap-2" onClick={() => setEditing(editing === s.id ? null : s.id)} aria-expanded={editing === s.id}>
                                <span className="flex-1 min-w-0">
                                <span className="font-mono font-medium text-surface-900 dark:text-surface-100">{s.code}</span>
                                <span className="text-surface-600 dark:text-surface-300"> · {s.name ?? '-'}</span>
                                <span className="block mt-0.5">
                                    <ResultChip result={s.result} />{s.method === 'manual' && <span className={`${sub} ml-1`}>직접 입력</span>}
                                    {s.condition !== 'normal' && <span className="ml-1 text-xs text-red-700 dark:text-red-300">{CONDITION_LABEL[s.condition]}</span>}
                                    {s.photoUrl && <span className="ml-1 text-xs" aria-label="사진 있음">📷</span>}
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
                <p className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200 mb-4">
                    ⚠️ 이 브라우저는 기록을 기기에 보관하지 못합니다(사생활 보호 모드 등). 인터넷이 약한 곳에서는 앱을 닫지 말고,
                    연결된 곳에서 '보내지 못한 기록'이 없어진 것을 확인하세요.
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
            <section className="rounded-2xl border-2 p-4 bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-200" role="status">
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
            <section className="rounded-2xl border-2 p-4 bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200" role="status">
                <p className="font-bold">승인됐습니다{submission.proxyApproved ? ' (재물 담당자 대신 승인)' : ''}</p>
                <p className="text-sm">이 공간의 조사가 끝났습니다. 수고하셨습니다.</p>
            </section>
        );
    }
    return (
        <section className="glass-card p-4">
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

function Notice({ icon, title, text, retry = false }: { icon: string; title: string; text: string; retry?: boolean }) {
    return (
        <div className="max-w-lg mx-auto glass-card p-6 text-center animate-fade-in">
            <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
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
                {busy ? '올리는 중…' : scan.photoUrl ? '📷 사진 바꾸기' : '📷 사진 찍기'}
            </button>
            {scan.photoUrl && (
                <button type="button" className="btn-secondary min-h-[48px] px-3 text-sm" disabled={busy} onClick={() => void remove()}>사진 지우기</button>
            )}
        </div>
    );
}
