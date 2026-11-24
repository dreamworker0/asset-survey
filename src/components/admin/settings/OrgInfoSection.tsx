/**
 * OrgInfoSection — Settings의 기관 정보 입력 섹션(표시 전용)
 * 상태(form)와 저장 로직(handleSave)은 부모(useSettings)가 소유하고 props로 전달받는다.
 */
import type { SettingsForm } from '../../../hooks/useSettings';

interface OrgInfoSectionProps {
    form: SettingsForm;
    setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
    handlePhoneChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleSave: (e?: React.FormEvent | null, overrides?: Partial<SettingsForm>) => void;
    saving: boolean;
    onRequestFeedback: () => void;
}

export default function OrgInfoSection({
    form, setForm, handlePhoneChange, handleSave, saving, onRequestFeedback,
}: OrgInfoSectionProps) {
    return (
        <div className="glass-card p-6 mb-6">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">기관 정보</h3>
            <form onSubmit={handleSave} className="space-y-4">
                <div>
                    <label htmlFor="org-name" className="label">기관명</label>
                    <input id="org-name" type="text" value={form.name} readOnly aria-describedby="org-locked-hint"
                        className="input min-h-[48px] bg-surface-100 text-surface-700 dark:bg-surface-900 dark:text-surface-300" />
                </div>
                <div>
                    <label htmlFor="org-address" className="label">주소</label>
                    {form.address ? (
                        <input id="org-address" type="text" value={form.address} readOnly aria-describedby="org-locked-hint"
                            className="input min-h-[48px] bg-surface-100 text-surface-700 dark:bg-surface-900 dark:text-surface-300" />
                    ) : (
                        <input
                            id="org-address"
                            type="text"
                            value={form.address}
                            onChange={e => setForm({ ...form, address: e.target.value })}
                            className="input min-h-[48px]"
                            placeholder="예: 서울시 ○○구 ○○로 12"
                        />
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        <p id="org-locked-hint" className="text-xs text-surface-600 dark:text-surface-400 flex-1 min-w-[12rem]">
                            기관명과 주소 변경은 슈퍼관리자에게 요청하세요.
                        </p>
                        <button type="button" onClick={onRequestFeedback} className="btn-secondary btn-sm min-h-[48px]">변경 요청하기</button>
                    </div>
                </div>
                <div>
                    <label htmlFor="org-admin-email" className="label">관리자 이메일</label>
                    <input id="org-admin-email" type="email" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} className="input min-h-[48px]" />
                </div>
                <div>
                    <label htmlFor="org-phone" className="label">전화번호</label>
                    <input id="org-phone" type="tel" value={form.phone} onChange={handlePhoneChange} className="input min-h-[48px]" placeholder="010-0000-0000" />
                </div>
                <div className="flex justify-end">
                    <button type="submit" disabled={saving} className="btn-primary min-h-[48px]">
                        {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '변경사항 저장'}
                    </button>
                </div>
            </form>
        </div>
    );
}
