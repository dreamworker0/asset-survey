/**
 * ClientErrorLog — 앱 오류 기록 (슈퍼관리자 전용, 2026-11-23)
 *
 * Sentry를 쓰지 않아 사용자 화면의 오류가 보이지 않던 것을 메운다. 같은 오류는 한 줄로 묶어
 * 몇 번·언제 처음/마지막으로 났는지, 어느 화면·브라우저·버전·기관에서 났는지 보여 준다.
 * 30일 동안 다시 나지 않은 오류는 저절로 지워진다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentClientErrors, getOrganization } from '../../lib/firestore';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { ClientError } from '../../types/clientError';

const ROLE_LABEL: Record<string, string> = {
    admin: '기관 관리자', employee: '직원', superAdmin: '슈퍼관리자', guest: '로그인 전',
};
const DAY_MS = 86_400_000;

const msOf = (t: unknown): number => {
    const ts = t as { toMillis?: () => number } | undefined;
    return typeof ts?.toMillis === 'function' ? ts.toMillis() : 0;
};

export default function ClientErrorLog() {
    const [errors, setErrors] = useState<ClientError[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [orgNames, setOrgNames] = useState<Record<string, string>>({});
    const [recentOnly, setRecentOnly] = useState(false);
    /** 불러온 때 — '최근 24시간'의 기준(렌더 중에 시계를 읽지 않는다) */
    const [loadedAt, setLoadedAt] = useState(0);

    const load = useCallback(async () => {
        setLoadError(false);
        setErrors(null);
        try {
            const list = await getRecentClientErrors();
            setErrors(list);
            setLoadedAt(Date.now());
            // 기관 이름은 따로 읽는다 — 실패해도 목록은 보인다
            const ids = [...new Set(list.flatMap((e) => e.orgIds))];
            const entries = await Promise.all(ids.map(async (id) => {
                try {
                    const org = await getOrganization(id);
                    return [id, (org as { name?: string } | null)?.name || id] as const;
                } catch {
                    return [id, id] as const;
                }
            }));
            setOrgNames(Object.fromEntries(entries));
        } catch {
            setLoadError(true);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const shown = useMemo(() => {
        if (!errors) return [];
        if (!recentOnly) return errors;
        const since = loadedAt - DAY_MS;
        return errors.filter((e) => msOf(e.lastAt) >= since);
    }, [errors, recentOnly, loadedAt]);
    const total = errors?.reduce((n, e) => n + e.count, 0) ?? 0;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">오류 기록</h1>
                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 break-keep">
                    사용자 화면에서 난 오류를 같은 것끼리 묶어 보여 줍니다. 이름·이메일 같은 개인정보는 담지 않고,
                    30일 동안 다시 나지 않은 오류는 저절로 지워집니다.
                </p>
            </div>

            {loadError ? (
                <div className="glass-card p-6 text-center">
                    <p className="text-red-700 dark:text-red-300 mb-3" role="alert">오류 기록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.</p>
                    <button type="button" className="btn-secondary min-h-[48px] px-5" onClick={() => void load()}>다시 불러오기</button>
                </div>
            ) : errors === null ? (
                <div className="flex items-center justify-center py-20" role="status" aria-label="오류 기록 불러오는 중">
                    <div className="w-8 h-8 spinner" />
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <p className="text-sm text-surface-700 dark:text-surface-300 tabular-nums mr-auto" aria-live="polite">
                            오류 {errors.length}종 · 모두 {total.toLocaleString('ko-KR')}번
                        </p>
                        <label className="flex items-center gap-2 min-h-[48px] text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
                            <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
                            최근 24시간만
                        </label>
                        <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void load()}>새로 고침</button>
                    </div>

                    {shown.length === 0 ? (
                        <div className="glass-card p-8 text-center">
                            <div className="text-4xl mb-3" aria-hidden="true">✅</div>
                            <p className="text-surface-800 dark:text-surface-200 font-medium">
                                {recentOnly ? '최근 24시간 동안 난 오류가 없습니다' : '최근 30일 동안 기록된 오류가 없습니다'}
                            </p>
                        </div>
                    ) : (
                        <ul className="space-y-3" aria-label="오류 목록">
                            {shown.map((e) => (
                                <li key={e.id} className="glass-card p-4">
                                    <div className="flex items-start gap-3">
                                        <span className="badge-danger whitespace-nowrap tabular-nums flex-shrink-0">{e.count.toLocaleString('ko-KR')}번</span>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-surface-900 dark:text-surface-100 break-all">
                                                {e.name !== 'Error' && <span className="text-surface-600 dark:text-surface-400">{e.name}: </span>}
                                                {e.message}
                                            </p>
                                            <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 break-keep">
                                                {e.where && <>기능 <code className="font-mono">{e.where}</code> · </>}
                                                {e.code && <>코드 <code className="font-mono">{e.code}</code> · </>}
                                                마지막 {formatTimestampFull(e.lastAt as never) ?? '-'} · 처음 {formatTimestampFull(e.firstAt as never) ?? '-'}
                                            </p>
                                            <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5 break-all">
                                                화면 <code className="font-mono">{e.lastPath || '-'}</code>
                                                {e.lastBrowser && <> · <span className="whitespace-nowrap">{e.lastBrowser}</span></>}
                                                {e.lastRole && <> · <span className="whitespace-nowrap">{ROLE_LABEL[e.lastRole] ?? e.lastRole}</span></>}
                                                {e.lastVersion && <> · <span className="whitespace-nowrap">버전 <code className="font-mono">{e.lastVersion}</code></span></>}
                                            </p>
                                            {e.orgIds.length > 0 && (
                                                <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5 break-keep">
                                                    기관 {e.orgIds.map((id) => orgNames[id] || id).join(', ')}
                                                </p>
                                            )}
                                            {e.stack && (
                                                <details className="mt-2">
                                                    <summary className="text-xs text-primary-700 dark:text-primary-300 cursor-pointer min-h-[48px] inline-flex items-center">스택 보기</summary>
                                                    <pre className="mt-1 text-[11px] leading-relaxed whitespace-pre-wrap break-all bg-surface-50 dark:bg-surface-800 rounded-lg p-2 text-surface-700 dark:text-surface-300">{e.stack}</pre>
                                                </details>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}
