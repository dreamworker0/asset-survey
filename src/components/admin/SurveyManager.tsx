/**
 * SurveyManager — 관리자 재물조사 (기획서 F10·F13·F14·F15)
 *
 * 진행 중 회차가 없으면 새 조사 시작, 있으면 현황판(남은 기간·진행률·공간별 진행과 제출 상태·최근 스캔)과
 * 승인·반려·대신 승인, 마감. 지난 조사는 결과 보고서로 연결한다.
 */
import { Link, useNavigate } from 'react-router-dom';
import useSurveyAdmin from '../../hooks/useSurveyAdmin';
import { useConfirm } from '../../hooks/useConfirm';
import { REASON_MAX } from '../../schemas';
import type { SurveySubmission } from '../../types/survey';
import { sub, card, MODE_LABEL } from './survey/surveyStyles';
import { Dashboard } from './survey/SurveyDashboard';
import { StartFormView } from './survey/SurveyStartForm';

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
