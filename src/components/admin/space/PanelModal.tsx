/**
 * PanelModal — 공간 관리 화면의 작은 입력 창(건물 고치기·공간 위치 바꾸기) 껍데기
 *
 * ESC·바깥 클릭·닫기(✕)로 닫힌다. 안의 첫 입력 칸에 초점을 주고, Tab은 창 안에서만 돈다.
 * 닫히면 창을 연 버튼으로 초점을 돌려준다(2026-11-22 점검: 초점이 창 밖으로 빠져 길을 잃었다).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
    open: boolean;
    title: string;
    titleId: string;
    onClose: () => void;
    children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function PanelModal({ open, title, titleId, onClose, children }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    // onClose는 부르는 쪽에서 매번 새로 만들어질 수 있다 — 효과가 다시 돌면 글자를 칠 때마다
    // 초점이 첫 칸·여는 버튼으로 튀므로, 최신 함수만 ref에 담고 효과는 open에만 묶는다
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement as HTMLElement | null;
        const timer = setTimeout(() => ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus(), 50);
        const onKey = (e: KeyboardEvent) => {
            // 창 안에서 연 확인 창(ConfirmModal)이 초점을 가진 동안은 그쪽에 맡긴다
            const otherDialog = (document.activeElement as HTMLElement | null)?.closest('[role="dialog"]');
            if (otherDialog && otherDialog !== ref.current) return;
            if (e.key === 'Escape') { onCloseRef.current(); return; }
            if (e.key !== 'Tab' || !ref.current) return;
            const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('keydown', onKey);
            opener?.focus?.();
        };
    }, [open]);

    if (!open) return null;

    // body에 바로 그린다 — 반투명 카드(glass-card의 backdrop-filter) 안에 놓이면 fixed가 화면이 아니라
    // 그 카드를 기준으로 잡혀, 창이 카드 안에 갇히고 아래 카드에 가려졌다(2026-11-22 팀 고치기 창)
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={onClose}>
            {/* ESC는 위 keydown이 처리한다 — 창 안 클릭이 바깥 닫기로 번지지 않게만 막는다 (ConfirmModal과 같은 방식) */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="glass-card w-full max-w-md p-5 animate-scale-in max-h-[90dvh] overflow-y-auto overscroll-contain"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-2 mb-4">
                    <h2 id={titleId} className="text-lg font-bold text-surface-900 dark:text-surface-100 pt-2">{title}</h2>
                    <button type="button" data-close className="btn-icon min-h-[48px] min-w-[48px] -mr-2" aria-label="창 닫기" onClick={onClose}>
                        <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {children}
            </div>
        </div>
    , document.body);
}
