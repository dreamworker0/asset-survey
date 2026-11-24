/**
 * OrgRestoreForm — 삭제된 계정 복원 섹션
 */
import { memo, useId, useState } from 'react';

interface Props {
    orgId: string;
    onRestoreUser: (email: string, orgId: string, name: string) => Promise<void>;
}

const RESTORE_ICON = 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.18';

export default memo(function OrgRestoreForm({ orgId, onRestoreUser }: Props) {
    const [showRestore, setShowRestore] = useState(false);
    const [form, setForm] = useState({ email: '', name: '' });
    const [restoring, setRestoring] = useState(false);
    const nameId = useId();
    const emailId = useId();

    if (!showRestore) {
        return (
            <button
                type="button"
                onClick={() => setShowRestore(true)}
                aria-expanded={false}
                className="btn-secondary btn-sm min-h-[48px]"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={RESTORE_ICON} />
                </svg>
                삭제된 계정 복원
            </button>
        );
    }

    const handleRestore = async () => {
        if (!form.email.trim()) return;
        setRestoring(true);
        try {
            await onRestoreUser(form.email.trim(), orgId, form.name.trim());
            setForm({ email: '', name: '' });
            setShowRestore(false);
        } catch (err) {
            console.error('계정 복원 중 에러:', err);
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d={RESTORE_ICON} />
                    </svg>
                    계정 복원
                </h4>
                <button
                    type="button"
                    onClick={() => { setShowRestore(false); setForm({ email: '', name: '' }); }}
                    aria-expanded={true}
                    className="btn-secondary btn-sm min-h-[48px]"
                >
                    닫기
                </button>
            </div>
            <p className="text-xs text-surface-600 dark:text-surface-400">
                삭제(비활성화)된 직원의 이메일을 입력하면 계정을 복원합니다.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="sm:flex-[1]">
                    <label htmlFor={nameId} className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1 block">이름 (선택)</label>
                    <input
                        id={nameId}
                        type="text"
                        value={form.name}
                        onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                        className="input text-sm min-h-[48px]"
                        placeholder="이름"
                    />
                </div>
                <div className="sm:flex-[2]">
                    <label htmlFor={emailId} className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1 block">이메일 (필수)</label>
                    <input
                        id={emailId}
                        type="email"
                        value={form.email}
                        onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                        className="input text-sm min-h-[48px]"
                        placeholder="이메일"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => { void handleRestore(); }}
                    disabled={restoring || !form.email.trim()}
                    className="btn-primary btn-sm min-h-[48px] whitespace-nowrap"
                >
                    {restoring ? <><div className="w-3 h-3 spinner" aria-hidden="true" />복원 중...</> : '복원'}
                </button>
            </div>
        </div>
    );
});
