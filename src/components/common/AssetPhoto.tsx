/**
 * AssetPhoto — 재물 상세의 대표 사진 칸 (2026-11-22)
 *
 * 모두 사진을 보고(누르면 크게), 관리자는 올리기·바꾸기·지우기를 한다.
 * 휴대폰에서는 파일 고르기 창이 '사진 찍기'와 '갤러리'를 함께 보여 준다.
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { uploadAssetPhoto, removeAssetPhoto, PHOTO_SOURCE_MAX_BYTES, type AssetPhotoFields } from '../../lib/firestore';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import type { Asset } from '../../types/asset';

interface Props {
    asset: Asset;
    admin: boolean;
    onChanged: (fields: AssetPhotoFields) => void;
}

export default function AssetPhoto({ asset, admin, onChanged }: Props) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { showToast('사진 파일을 골라 주세요.', 'warning'); return; }
        if (file.size > PHOTO_SOURCE_MAX_BYTES) { showToast('사진 파일이 너무 큽니다(30MB까지). 더 작은 사진을 골라 주세요.', 'warning'); return; }
        setBusy(true);
        try {
            onChanged(await uploadAssetPhoto(asset, file));
            showToast('사진을 올렸습니다.', 'success');
        } catch {
            showToast('사진을 올리지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async () => {
        const ok = await confirm({ title: '사진 지우기', message: '이 재물의 사진을 지울까요?', confirmText: '지우기', confirmColor: 'danger' });
        if (!ok) return;
        setBusy(true);
        try {
            await removeAssetPhoto(asset);
            onChanged({ photoUrl: null, photoThumbUrl: null, photoPath: null, photoThumbPath: null });
            showToast('사진을 지웠습니다.', 'success');
        } catch {
            showToast('사진을 지우지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
        } finally {
            setBusy(false);
        }
    };

    if (!asset.photoUrl && !admin) return null;

    return (
        <div className="mb-4">
            {asset.photoUrl ? (
                <a href={asset.photoUrl} target="_blank" rel="noopener noreferrer" className="block rounded-xl focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500" aria-label={`${asset.name ?? asset.code} 사진 크게 보기(새 창)`}>
                    <img src={asset.photoUrl} alt=""
                        className="w-full max-h-80 object-contain rounded-xl bg-surface-100 dark:bg-surface-800" />
                    {/* 사진이 눌리는 줄 몰랐다 — 누르면 크게 볼 수 있다고 글로 알린다 */}
                    <span className="block text-xs text-primary-700 dark:text-primary-300 mt-1 text-right" aria-hidden="true">누르면 크게 보기 ›</span>
                </a>
            ) : (
                <div className="w-full h-32 rounded-xl border-2 border-dashed border-surface-300 dark:border-surface-600 flex items-center justify-center text-sm text-surface-600 dark:text-surface-400">
                    아직 사진이 없습니다
                </div>
            )}
            {admin && (
                <div className="flex flex-wrap gap-2 mt-2">
                    <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleFile(e)} aria-label="재물 사진 고르기" />
                    <button type="button" className="btn-secondary btn-sm min-h-[48px] px-4" disabled={busy} onClick={() => inputRef.current?.click()}>
                        {busy ? '처리하는 중…' : asset.photoUrl ? '사진 바꾸기' : '사진 올리기'}
                    </button>
                    {asset.photoUrl && (
                        <button type="button" className="btn-secondary btn-sm min-h-[48px] px-4 text-red-700 dark:text-red-300" disabled={busy} onClick={() => void handleRemove()}>
                            사진 지우기
                        </button>
                    )}
                </div>
            )}
            {admin && <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">사람이 찍히지 않게 물건만 찍어 주세요.</p>}
        </div>
    );
}
