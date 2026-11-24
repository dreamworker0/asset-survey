/**
 * ApprovalLineSection — Settings의 결재 라인 설정 섹션(표시 전용)
 * PDF 결재란 표시 여부 토글 + 결재자(직급) 목록(최대 5명) 편집/저장.
 * 상태(form)와 저장 로직(handleSave)은 부모(useSettings)가 소유하고 props로 전달받는다.
 */
import Toggle from '../../common/Toggle';
import type { SettingsForm } from '../../../hooks/useSettings';

interface ApprovalLineSectionProps {
    form: SettingsForm;
    setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
    handleSave: (e?: React.FormEvent | null, overrides?: Partial<SettingsForm>) => void;
    saving: boolean;
}

export default function ApprovalLineSection({ form, setForm, handleSave, saving }: ApprovalLineSectionProps) {
    return (
        <div className="glass-card p-6 mb-6">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">결재 라인</h3>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className={`text-xs font-medium ${form.hideApprovalLine ? 'text-surface-600 dark:text-surface-400' : 'text-primary-700 dark:text-primary-300'}`}>
                        {form.hideApprovalLine ? 'PDF 결재란 숨김' : 'PDF 결재란 표시'}
                    </span>
                    <Toggle
                        label="PDF 결재란 표시"
                        checked={!form.hideApprovalLine}
                        onChange={(next) => setForm({ ...form, hideApprovalLine: !next })}
                    />
                </label>
            </div>
            <p className="text-xs text-surface-600 dark:text-surface-400 mb-4">재물조사 결과 보고서 PDF에 찍힐 결재란(종이로 결재할 때)입니다. 낮은 직급부터 적으세요(최대 5칸).</p>

            <div className={`space-y-2 mb-3 transition-opacity ${form.hideApprovalLine ? 'opacity-40 pointer-events-none' : ''}`}>
                {form.approvalLine.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                        <label htmlFor={`approver-${idx}`} className="sr-only">{idx + 1}번째 결재자 직급</label>
                        <input
                            id={`approver-${idx}`}
                            type="text"
                            value={item.title}
                            onChange={e => {
                                const next = [...form.approvalLine];
                                next[idx] = { ...next[idx], title: e.target.value };
                                setForm({ ...form, approvalLine: next });
                            }}
                            className="input text-sm flex-1 min-h-[48px]"
                            placeholder="직급 (예: 담당, 팀장)"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                const next = form.approvalLine.filter((_, i) => i !== idx);
                                setForm({ ...form, approvalLine: next });
                            }}
                            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors p-2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg focus:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500"
                            title="삭제"
                            aria-label={`${idx + 1}번째 결재자 삭제`}
                        >
                            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                ))}
            </div>

            {form.approvalLine.length < 5 && !form.hideApprovalLine && (
                <button
                    type="button"
                    onClick={() => setForm({ ...form, approvalLine: [...form.approvalLine, { title: '' }] })}
                    className="btn-secondary btn-sm min-h-[48px]"
                >
                    + 결재자 추가
                </button>
            )}

            <div className="flex justify-end mt-4">
                <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm min-h-[48px]">
                    {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '결재 라인 저장'}
                </button>
            </div>
        </div>
    );
}
