/**
 * OrgEditForm — 기관명·주소 인라인 편집 폼
 */
import { memo, useId, useState } from 'react';

interface Props {
    orgId: string;
    initialName: string;
    initialAddress: string;
    onSave: (orgId: string, updates: { name: string; address: string }) => Promise<void>;
    onCancel: () => void;
}

export default memo(function OrgEditForm({ orgId, initialName, initialAddress, onSave, onCancel }: Props) {
    const [form, setForm] = useState({ name: initialName, address: initialAddress });
    const [saving, setSaving] = useState(false);
    // 라벨과 입력칸을 이어 화면 읽기 프로그램이 칸 이름을 읽게 한다
    const nameId = useId();
    const addressId = useId();

    const handleSave = async () => {
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            await onSave(orgId, {
                name: form.name.trim(),
                address: form.address.trim(),
            });
        } catch {
            // 에러는 부모에서 toast 처리
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <div>
                <label htmlFor={nameId} className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1 block">
                    기관명 <span className="text-red-700 dark:text-red-300">(필수)</span>
                </label>
                <input
                    id={nameId}
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    className="input text-sm"
                    placeholder="기관명"
                    required
                />
            </div>
            <div>
                <label htmlFor={addressId} className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1 block">주소</label>
                <input
                    id={addressId}
                    type="text"
                    value={form.address}
                    onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                    className="input text-sm"
                    placeholder="주소"
                />
            </div>
            {!form.name.trim() && (
                <p className="text-xs text-red-700 dark:text-red-300">기관명을 입력해야 저장할 수 있습니다.</p>
            )}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => { void handleSave(); }}
                    disabled={saving || !form.name.trim()}
                    className="btn-primary btn-sm min-h-[48px]"
                >
                    {saving ? (<><div className="w-3 h-3 spinner" aria-hidden="true" />저장 중...</>) : '저장'}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="btn-secondary btn-sm min-h-[48px]"
                >
                    취소
                </button>
            </div>
        </div>
    );
});
