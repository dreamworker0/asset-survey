/**
 * EmployeeHome — 직원(공간 담당자) 첫 화면
 *
 * 진행 중인 재물조사가 있으면 스캔 카드를 최상단에 배치해 현장 진입을 1탭으로 줄인다.
 * 내가 담당하는 공간 목록과 그 공간의 재물 목록(`/employee/assets`)으로 연결한다.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getMySpaces, getOpenSurvey } from '../../lib/firestore';
import { SkeletonBox, SkeletonCard } from '../common/Skeleton';
import type { Space } from '../../types/space';
import type { Survey } from '../../types/survey';

export default function EmployeeHome() {
    const { user, userData } = useAuth();
    const orgId = userData?.organizationId ?? null;
    const uid = user?.uid ?? null;
    const teamId = userData?.teamId ?? null;
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [survey, setSurvey] = useState<Survey | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!orgId || !uid) return;
        let cancelled = false;
        setLoading(true);
        setError(false);
        // 진행 중 조사는 없어도 화면은 그린다(실패하면 조사 카드만 빠진다)
        getOpenSurvey(orgId).then((sv) => {
            if (cancelled) return;
            setSurvey(sv);
            // 진행 중 조사가 있으면 스캔 화면·카메라 코드를 미리 받아 둔다 — 지하·창고처럼 인터넷이 끊긴 곳에서
            // 스캔 탭을 처음 열어도 뜨게(서비스 워커의 /assets/ 런타임 캐시에 담긴다)
            if (sv) { void import('./ScanPage').catch(() => { }); void import('html5-qrcode').catch(() => { }); }
        }, () => { });
        getMySpaces(orgId, uid, teamId)
            .then((list) => { if (!cancelled) setSpaces(list); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [orgId, uid, teamId, reloadKey]);

    const surveyCard = survey ? (
        <section className="glass-card p-5 border-primary-200 dark:border-primary-800/70 bg-primary-50/40 dark:bg-primary-950/20" aria-labelledby="survey-heading">
            <div className="flex items-center gap-2 mb-1">
                <span className={survey.status === 'closing' ? 'badge-warning' : 'badge-primary'}>
                    {survey.status === 'closing' ? '마감 중' : '진행 중인 재물조사'}
                </span>
            </div>
            <h2 id="survey-heading" className="text-lg font-bold text-surface-900 dark:text-surface-100">{survey.name}</h2>
            <p className="text-sm text-surface-600 dark:text-surface-400 tabular-nums mt-0.5">{survey.startDate} ~ {survey.endDate}</p>
            {survey.status === 'closing' ? (
                <p className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-900 dark:text-amber-200" role="status">
                    재물 담당자가 조사를 마감하는 중입니다. 지금은 스캔할 수 없습니다.
                </p>
            ) : (
                <Link to="/employee/scan" className="btn-primary w-full min-h-[52px] mt-4">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                    </svg>
                    <span>스캔하러 가기</span>
                </Link>
            )}
        </section>
    ) : (
        <div className="glass-card p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 flex items-center justify-center" aria-hidden="true">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                </svg>
            </div>
            <p className="text-surface-800 dark:text-surface-200 font-medium">진행 중인 재물조사가 없습니다</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                재물 담당자가 조사를 시작하면 담당 공간의 조사 목록이 여기에 나옵니다.
            </p>
        </div>
    );

    const spacesCard = (
        <section className="glass-card p-5" aria-labelledby="my-spaces-heading">
            <h2 id="my-spaces-heading" className="font-semibold text-surface-900 dark:text-surface-100 mb-3">내 담당 공간</h2>
            {loading ? (
                <div className="space-y-2" role="status" aria-label="담당 공간을 불러오는 중">
                    <SkeletonBox className="h-10 w-2/3 rounded-xl" />
                    <SkeletonBox className="h-12 w-40 rounded-xl" />
                </div>
            ) : error ? (
                <div role="alert">
                    <p className="text-sm text-red-700 dark:text-red-300">담당 공간을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.</p>
                    <button type="button" className="btn-secondary btn-sm min-h-[48px] mt-3" onClick={() => setReloadKey((k) => k + 1)}>다시 불러오기</button>
                </div>
            ) : spaces.length === 0 ? (
                <p className="text-sm text-surface-600 dark:text-surface-400">
                    아직 담당 공간이 없습니다. 조사를 맡게 되면 재물 담당자가 공간을 지정해 줍니다.
                </p>
            ) : (
                <>
                    <ul className="flex flex-wrap gap-2">
                        {spaces.map((s) => (
                            <li key={s.id}>
                                <Link to={`/employee/assets?space=${encodeURIComponent(s.id)}`}
                                    className="inline-flex items-center px-3.5 min-h-[48px] rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/50 text-sm font-medium transition-colors">
                                    {s.name}
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <Link to="/employee/assets" className="btn-secondary btn-sm min-h-[48px] mt-3">
                        내 공간 재물 보기 <span aria-hidden="true">→</span>
                    </Link>
                </>
            )}
        </section>
    );

    return (
        <div className="max-w-lg mx-auto animate-fade-in space-y-4">
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {userData?.name ? `${userData.name}님, 안녕하세요` : '안녕하세요'}
            </h1>

            {loading ? (
                <>
                    <SkeletonCard />
                    {spacesCard}
                </>
            ) : survey ? (
                <>
                    {surveyCard}
                    {spacesCard}
                </>
            ) : (
                <>
                    {spacesCard}
                    {surveyCard}
                </>
            )}
        </div>
    );
}
