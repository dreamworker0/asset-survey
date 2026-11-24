/**
 * BuildingForm — 건물 이름·주소·층 입력 (건물 추가 칸과 건물 고치기 창이 함께 쓴다)
 *
 * 층은 낮은 층부터 쉼표로 적는다(구글 워크스페이스 건물 설정과 같은 방식: "B1, 1, 2, 3, PH").
 * 지하·지상 층수를 넣고 [채우기]를 누르면 B2, B1, 1, 2, 3처럼 만들어 준다.
 */
import { useState, type FormEvent } from 'react';
import { parseFloors, floorsFromRange, floorLabel, type BuildingInput } from '../../../lib/buildingFloors';
import { BUILDING_NAME_MAX, BUILDING_ADDRESS_MAX } from '../../../schemas/building';

interface Props {
    idPrefix: string;
    initial?: BuildingInput;
    submitLabel: string;
    busy: boolean;
    /** 저장에 성공하면 true — 추가 칸이면 입력을 비운다 */
    onSubmit: (input: BuildingInput) => Promise<boolean>;
    onCancel?: () => void;
    resetOnSuccess?: boolean;
}

export default function BuildingForm({ idPrefix, initial, submitLabel, busy, onSubmit, onCancel, resetOnSuccess }: Props) {
    const [name, setName] = useState(initial?.name ?? '');
    const [address, setAddress] = useState(initial?.address ?? '');
    const [floorsText, setFloorsText] = useState((initial?.floors ?? []).join(', '));
    const [basement, setBasement] = useState('');
    const [above, setAbove] = useState('');

    const floors = parseFloors(floorsText);

    const fillRange = () => {
        const list = floorsFromRange(Number(basement) || 0, Number(above) || 0);
        if (list.length > 0) setFloorsText(list.join(', '));
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const ok = await onSubmit({ name, address, floors });
        if (ok && resetOnSuccess) {
            setName(''); setAddress(''); setFloorsText(''); setBasement(''); setAbove('');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div>
                <label htmlFor={`${idPrefix}-name`} className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    건물 이름 <span className="text-red-700 dark:text-red-300" aria-hidden="true">*</span>
                </label>
                <input
                    id={`${idPrefix}-name`}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={BUILDING_NAME_MAX}
                    placeholder="예: 본관, 별관, 보육원"
                    className="input w-full min-h-[48px]"
                    required
                />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-address`} className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    주소 <span className="text-xs font-normal text-surface-600 dark:text-surface-400">(선택)</span>
                </label>
                <input
                    id={`${idPrefix}-address`}
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    maxLength={BUILDING_ADDRESS_MAX}
                    placeholder="떨어진 시설이면 적어 두세요"
                    className="input w-full min-h-[48px]"
                />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-floors`} className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    층 <span className="text-xs font-normal text-surface-600 dark:text-surface-400">(낮은 층부터 쉼표로)</span>
                </label>
                <input
                    id={`${idPrefix}-floors`}
                    type="text"
                    value={floorsText}
                    onChange={(e) => setFloorsText(e.target.value)}
                    placeholder="예: B1, 1, 2, 3, 옥상"
                    aria-describedby={`${idPrefix}-floors-help`}
                    className="input w-full min-h-[48px]"
                />
                <div id={`${idPrefix}-floors-help`} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                    <span>층수로 채우기:</span>
                    <label className="inline-flex items-center gap-1">
                        지하
                        <input type="number" min={0} max={10} inputMode="numeric" value={basement}
                            onChange={(e) => setBasement(e.target.value)} className="input w-16 min-h-[48px]" aria-label="지하 층수" />
                    </label>
                    <label className="inline-flex items-center gap-1">
                        지상
                        <input type="number" min={0} max={40} inputMode="numeric" value={above}
                            onChange={(e) => setAbove(e.target.value)} className="input w-16 min-h-[48px]" aria-label="지상 층수" />
                    </label>
                    <button type="button" onClick={fillRange} disabled={!basement && !above} className="btn-secondary btn-sm min-h-[48px] px-3">
                        채우기
                    </button>
                </div>
                {floors.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="입력한 층">
                        {floors.map((f) => (
                            <li key={f} className="px-2.5 py-1 rounded-full bg-surface-100 dark:bg-surface-800 text-xs text-surface-700 dark:text-surface-300">
                                {floorLabel(f)}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="btn-secondary min-h-[48px] px-4">취소</button>
                )}
                <button type="submit" disabled={busy || !name.trim()} className="btn-primary min-h-[48px] px-5">
                    {submitLabel}
                </button>
            </div>
        </form>
    );
}
