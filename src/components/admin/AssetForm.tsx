/**
 * AssetForm — 재물 한 건 직접 등록·고치기 (관리자, 2026-11-22)
 *
 * /admin/assets/new — 새로 등록(자산코드는 직접 적거나 [자동 번호])
 * /admin/assets/:assetId/edit — 고치기(자산코드는 바꿀 수 없다 — 문서 ID·라벨과 묶여 있다)
 * 상태와 저장은 useAssetForm이 맡는다.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useAssetForm, { ASSET_LIMITS, formatAmountInput, type AssetFormValues } from '../../hooks/useAssetForm';
import { groupSpacesByLocation } from '../../lib/spaceGroups';
import { ASSET_STATUS_LABEL } from '../../lib/import/values';
import type { AssetStatus } from '../../types/asset';

const sub = 'text-xs text-surface-600 dark:text-surface-400';
const labelCls = 'block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1';

export default function AssetForm() {
    const { assetId } = useParams<{ assetId: string }>();
    const navigate = useNavigate();
    const f = useAssetForm(assetId);
    const v = f.values;
    // 저장이 막히면 틀린 칸으로 초점을 옮긴다 — 오류 문구만 폼 끝에 뜨면 어느 칸인지 찾아야 했다
    useEffect(() => {
        if (f.errorField) document.getElementById(`asset-${f.errorField}`)?.focus();
    }, [f.error, f.errorField]);

    if (f.loading) return <div className="flex justify-center py-20" role="status" aria-label="재물 정보를 불러오는 중"><div className="w-8 h-8 spinner" aria-hidden="true" /></div>;
    if (f.loadError) {
        return (
            <div className="max-w-lg mx-auto glass-card p-6 text-center">
                <p className="text-surface-700 dark:text-surface-300 mb-4 break-keep" role="alert">재물 정보를 불러오지 못했습니다. 인터넷 연결을 확인하고 [다시 불러오기]를 눌러 주세요.</p>
                <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => void f.reload()}>다시 불러오기</button>
                    <Link to="/admin/assets" className="btn-primary min-h-[48px] px-5">목록으로</Link>
                </div>
            </div>
        );
    }

    const detailPath = (id: string) => `/admin/assets/${encodeURIComponent(id)}`;
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const id = await f.save();
        if (id) navigate(detailPath(id));
    };
    const activeSpaces = f.spaces.filter((s) => !s.archived);
    const groups = f.buildings.some((b) => !b.archived) ? groupSpacesByLocation(activeSpaces, f.buildings) : null;

    const text = (key: keyof AssetFormValues & keyof typeof ASSET_LIMITS, label: string, placeholder = '', required = false) => (
        <Field id={`asset-${key}`} label={label} required={required}>
            <input id={`asset-${key}`} type="text" className="input w-full min-h-[48px]" value={v[key]} maxLength={ASSET_LIMITS[key]}
                placeholder={placeholder} onChange={(e) => f.set(key, e.target.value)}
                aria-required={required || undefined} aria-invalid={f.errorField === key || undefined} />
        </Field>
    );

    return (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <Link to={f.isNew ? '/admin/assets' : detailPath(assetId!)} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 dark:text-primary-300 min-h-[48px] pr-2">
                <span aria-hidden="true">←</span> {f.isNew ? '재물 목록' : '재물 정보'}
            </Link>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-1 mb-2">{f.isNew ? '재물 등록' : '재물 고치기'}</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">
                {f.isNew
                    ? '대장 엑셀에 없는 물건을 한 건씩 등록합니다. 여러 건이면 [재물 가져오기]로 엑셀을 올리는 편이 빠릅니다.'
                    : '고친 내용은 변경 이력에 남습니다.'}
            </p>
            {f.fromLedger && (
                <p className="mb-4 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                    대장 엑셀에서 가져온 재물입니다. 여기서 고쳐도 다음에 대장을 다시 가져오면 대장 값으로 바뀝니다. 희망이음·기관 대장도 함께 고쳐 주세요.
                </p>
            )}

            <form onSubmit={handleSubmit} className="glass-card p-5 space-y-4" noValidate>
                {f.isNew ? (
                    <Field id="asset-code" label="자산코드" required hint="라벨에 크게 찍힙니다. 등록한 뒤에는 바꿀 수 없어요.">
                        <div className="flex gap-2">
                            <input id="asset-code" type="text" className="input flex-1 min-h-[48px] font-mono" value={v.code}
                                aria-required="true" aria-describedby="asset-code-hint" aria-invalid={f.errorField === 'code' || undefined}
                                maxLength={ASSET_LIMITS.code} placeholder="기관 관리번호 (예: A-2024-001)" onChange={(e) => f.set('code', e.target.value)} />
                            <button type="button" className="btn-secondary min-h-[48px] px-3 flex-shrink-0" onClick={f.autoCode}>자동 번호</button>
                        </div>
                    </Field>
                ) : (
                    <div>
                        <p className={labelCls}>자산코드</p>
                        <p className="font-mono text-surface-900 dark:text-surface-100">{v.code}</p>
                    </div>
                )}
                {text('name', '품명', '예: 사무용 책상', true)}

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="asset-space" label="공간">
                        <select id="asset-space" className="input w-full min-h-[48px]" value={v.spaceId} onChange={(e) => f.chooseSpace(e.target.value)}>
                            <option value="">공간 미지정</option>
                            {groups ? groups.filter((g) => g.count > 0).map((g) => (
                                <optgroup key={g.buildingId ?? 'none'} label={g.label}>
                                    {g.floors.flatMap((fl) => fl.spaces.map((s) => (
                                        <option key={s.id} value={s.id}>{g.buildingId ? `${g.label}${fl.floor ? ` ${fl.label}` : ""} ${s.name}` : s.name}</option>
                                    )))}
                                </optgroup>
                            )) : activeSpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </Field>
                    <Field id="asset-status" label="상태">
                        <select id="asset-status" className="input w-full min-h-[48px]" value={v.status} onChange={(e) => f.set('status', e.target.value as AssetStatus)}>
                            {(Object.keys(ASSET_STATUS_LABEL) as AssetStatus[]).map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
                        </select>
                    </Field>
                    {text('category', '분류', '예: 집기')}
                    {text('spec', '규격', '모델명·크기')}
                    <Field id="asset-acquiredAt" label="취득일자">
                        <input id="asset-acquiredAt" type="date" className="input w-full min-h-[48px]" value={v.acquiredAt} aria-invalid={f.errorField === 'acquiredAt' || undefined} onChange={(e) => f.set('acquiredAt', e.target.value)} />
                    </Field>
                    <Field id="asset-quantity" label="현재수량">
                        <input id="asset-quantity" type="number" min={0} inputMode="numeric" className="input w-full min-h-[48px]" value={v.quantity} aria-invalid={f.errorField === 'quantity' || undefined} onChange={(e) => f.set('quantity', e.target.value)} />
                    </Field>
                    <Field id="asset-usefulLife" label="내용연수(년)" hint="쓸 수 있는 햇수. 취득일자와 함께 넣으면 지난 재물을 표시합니다.">
                        <input id="asset-usefulLife" type="number" min={0} max={100} step="any" inputMode="decimal" className="input w-full min-h-[48px]" value={v.usefulLife}
                            placeholder="예: 5" aria-describedby="asset-usefulLife-hint" aria-invalid={f.errorField === 'usefulLife' || undefined}
                            onChange={(e) => f.set('usefulLife', e.target.value)} />
                    </Field>
                    <Field id="asset-amount" label="자산금액(원)" hint="관리자만 봅니다.">
                        <input id="asset-amount" type="text" inputMode="numeric" className="input w-full min-h-[48px] tabular-nums" value={v.amount}
                            aria-describedby="asset-amount-hint" aria-invalid={f.errorField === 'amount' || undefined} placeholder="예: 250,000" onChange={(e) => f.set('amount', formatAmountInput(e.target.value))} />
                    </Field>
                    <DepartmentField value={v.department} options={f.departments} onChange={(d) => f.set('department', d)} fromSpace={f.departmentFromSpace} />
                </div>
                {text('usage', '용도', '쓰는 곳·메모')}
                {f.isNew && <PhotoPicker file={f.photo} onChange={f.setPhoto} />}

                {f.error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{f.error}</p>}

                <div className="flex flex-col sm:flex-row gap-2 justify-end pt-2">
                    {f.isNew && (
                        <button type="button" className="btn-secondary min-h-[48px] px-4" disabled={f.saving} onClick={() => void f.save(true)}>
                            저장하고 하나 더
                        </button>
                    )}
                    <button type="submit" className="btn-primary min-h-[48px] px-5" disabled={f.saving}>
                        {f.saving ? '저장하는 중…' : f.isNew ? '등록' : '저장'}
                    </button>
                </div>
            </form>
        </div>
    );
}

function Field({ id, label, required, hint, children }: { id: string; label: string; required?: boolean; hint?: string; children: ReactNode }) {
    return (
        <div>
            <label htmlFor={id} className={labelCls}>
                {label}{required && <span className="text-red-700 dark:text-red-300" aria-hidden="true"> *</span>}
            </label>
            {children}
            {hint && <p id={`${id}-hint`} className={`${sub} mt-1`}>{hint}</p>}
        </div>
    );
}

const DIRECT = '__direct__';

/**
 * 부서 고르기(2026-11-22) — 팀 이름과 이미 쓰인 부서 이름 중에서 고르고, 없으면 [직접 입력]으로 적는다.
 * 목록에 없는 값이 이미 들어 있으면(대장에서 가져온 값) 처음부터 직접 입력 칸으로 보인다.
 */
function DepartmentField({ value, options, onChange, fromSpace }: { value: string; options: string[]; onChange: (v: string) => void; fromSpace: boolean }) {
    const [direct, setDirect] = useState(() => value !== '' && !options.includes(value));
    const inList = options.includes(value);
    const hint = fromSpace
        ? '공간의 담당 팀으로 채웠어요. 다르면 바꾸세요.'
        : options.length === 0 ? '공간에 담당 팀을 지정하면 공간을 고를 때 자동으로 채워져요.' : '선택 — 공간에 담당 팀이 있으면 자동으로 채워져요.';
    return (
        <Field id="asset-department" label="부서" hint={hint}>
            {!direct && options.length > 0 ? (
                <select id="asset-department" className="input w-full min-h-[48px]" value={inList ? value : ''} aria-describedby="asset-department-hint"
                    onChange={(e) => {
                        if (e.target.value === DIRECT) { setDirect(true); onChange(''); return; }
                        onChange(e.target.value);
                    }}>
                    <option value="">부서 없음</option>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    <option value={DIRECT}>직접 입력…</option>
                </select>
            ) : (
                <div className="flex gap-2">
                    <input id="asset-department" type="text" className="input flex-1 min-h-[48px]" value={value} maxLength={ASSET_LIMITS.department} aria-describedby="asset-department-hint"
                        placeholder="부서 이름" onChange={(e) => onChange(e.target.value)} />
                    {options.length > 0 && (
                        <button type="button" className="btn-secondary min-h-[48px] px-3 flex-shrink-0" onClick={() => { setDirect(false); onChange(''); }}>목록에서 고르기</button>
                    )}
                </div>
            )}
        </Field>
    );
}

/**
 * 사진 고르기(2026-11-22, 사용자 의견) — 기본 파일 칸은 글자처럼 보여 버튼으로 바꾸고, 고른 사진을 바로 보여 준다.
 * 휴대폰에서는 '사진 찍기'와 '갤러리'를 함께 고를 수 있다.
 */
function PhotoPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<string | null>(null);
    useEffect(() => {
        if (!file) { setPreview(null); return; }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);
    return (
        <div>
            <p className={labelCls}>사진 <span className="text-xs font-normal text-surface-600 dark:text-surface-400">(선택)</span></p>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" aria-label="재물 사진 고르기"
                onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            {preview ? (
                <div className="flex items-end gap-3">
                    <img src={preview} alt="고른 사진 미리보기" className="w-32 h-32 object-cover rounded-xl border border-surface-200 dark:border-surface-700" />
                    <div className="flex flex-col gap-2">
                        <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => inputRef.current?.click()}>다른 사진</button>
                        <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => onChange(null)}>사진 빼기</button>
                    </div>
                </div>
            ) : (
                <button type="button" onClick={() => inputRef.current?.click()}
                    className="w-full min-h-[96px] rounded-xl border-2 border-dashed border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-300 flex flex-col items-center justify-center gap-1">
                    <span className="text-2xl" aria-hidden="true">📷</span>
                    <span className="font-medium">사진 고르기</span>
                    <span className="text-xs text-surface-600 dark:text-surface-400">휴대폰에서는 바로 찍을 수도 있어요</span>
                </button>
            )}
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">등록할 때 함께 올립니다. 사람이 찍히지 않게 물건만 찍어 주세요.</p>
        </div>
    );
}
