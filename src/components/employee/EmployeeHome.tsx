/**
 * EmployeeHome — 직원(공간 담당자) 첫 화면
 *
 * 1단계: 내가 담당하는 공간을 보여 준다(기획서 F03). 3단계: 공간을 누르면 그 공간의 재물 목록(F08).
 * 4단계: 진행 중인 조사가 있으면 스캔으로 가는 카드(F10·F11). 조사 대상·진행 상황은
 * F10~F13(조사 회차·스캔·제출)에서 이 화면에 더한다.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getMySpaces, getOpenSurvey } from '../../lib/firestore';
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

    return (
        <div className="max-w-lg mx-auto animate-fade-in space-y-4">
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {userData?.name ? `${userData.name}님, 안녕하세요` : '안녕하세요'}
            </h1>

            <section className="glass-card p-5" aria-labelledby="my-spaces-heading">
                <h2 id="my-spaces-heading" className="font-semibold text-surface-900 dark:text-surface-100 mb-3">내 담당 공간</h2>
                {loading ? (
                    <div className="flex justify-center py-4"><div className="w-6 h-6 spinner" /></div>
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
                                        className="inline-flex items-center px-3 min-h-[48px] rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium">
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

            {survey ? (
                <section className="glass-card p-5" aria-labelledby="survey-heading">
                    <p className="text-xs font-medium text-primary-700 dark:text-primary-300">진행 중인 재물조사</p>
                    <h2 id="survey-heading" className="font-semibold text-surface-900 dark:text-surface-100">{survey.name}</h2>
                    <p className="text-sm text-surface-600 dark:text-surface-400 tabular-nums">{survey.startDate} ~ {survey.endDate}</p>
                    {survey.status === 'closing' ? (
                        <p className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-900 dark:text-amber-200" role="status">
                            재물 담당자가 조사를 마감하는 중입니다. 지금은 스캔할 수 없습니다.
                        </p>
                    ) : (
                        <Link to="/employee/scan" className="btn-primary w-full min-h-[52px] mt-4">📷 스캔하러 가기</Link>
                    )}
                </section>
            ) : (
                <div className="glass-card p-6 text-center">
                    <div className="text-4xl mb-3" aria-hidden="true">📋</div>
                    <p className="text-surface-700 dark:text-surface-300 font-medium">진행 중인 재물조사가 없습니다</p>
                    <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                        재물 담당자가 조사를 시작하면 담당 공간의 조사 목록이 여기에 나옵니다.
                    </p>
                </div>
            )}
        </div>
    );
}
