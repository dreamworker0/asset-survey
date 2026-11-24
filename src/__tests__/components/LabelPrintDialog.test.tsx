/**
 * LabelPrintDialog — 라벨지 회사 → 모델 고르기
 *
 * 저장값은 labelSize 하나라, 회사를 바꿨다 돌아오면 고르던 모델로 돌아오는지가 핵심이다.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LABEL_PRESETS, specOf, type LabelSize } from '../../lib/labels/layout';

vi.mock('../../hooks/useLabelPrint', () => ({
    default: () => {
        // eslint-disable-next-line react-hooks/rules-of-hooks -- 목 훅도 컴포넌트 렌더 안에서만 불린다
        const [size, setSize] = useState<LabelSize>('medium');
        const { label: _l, model: _m, ...custom } = LABEL_PRESETS.medium;
        return {
            orgName: '기관', managersText: '', showManagers: false, setShowManagers: vi.fn(),
            size, setSize, custom, setCustom: vi.fn(), customError: null, spec: specOf(size, custom),
            startCell: 1, setStartCell: vi.fn(), cutLines: false, setCutLines: vi.fn(),
            busy: null, progress: null, error: null, prepare: vi.fn(), items: null, pages: null, pageCount: 1,
            finish: vi.fn(), previewQr: '',
        };
    },
}));
vi.mock('../../components/admin/LabelSheet', () => ({ default: () => null }));

import LabelPrintDialog from '../../components/admin/LabelPrintDialog';

const asset = { id: 'a1', code: '0010000000001', name: '책상' } as never;

describe('LabelPrintDialog 라벨지 회사', () => {
    it('기본은 폼텍, 모델은 포장지 번호로 보인다', () => {
        render(<LabelPrintDialog assets={[asset]} orgId="org-A" onClose={vi.fn()} />);
        expect(screen.getByRole('radio', { name: '폼텍' })).toBeChecked();
        expect(screen.getByRole('radio', { name: /3105/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /3100/ })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /3114/ })).toBeInTheDocument();
        expect(screen.queryByText('라벨 너비', { exact: false })).not.toBeInTheDocument();
    });

    it('다른 회사를 고르면 직접 치수, 폼텍으로 돌아오면 고르던 모델', () => {
        render(<LabelPrintDialog assets={[asset]} orgId="org-A" onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('radio', { name: /3114/ }));
        fireEvent.click(screen.getByRole('radio', { name: '다른 회사' }));
        expect(screen.getByText('라벨 너비', { exact: false })).toBeInTheDocument();
        expect(screen.getByText(/애니라벨\(아이라벨\)은 실제 라벨지로 위치를 확인한 뒤/)).toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: /3105/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: '폼텍' }));
        expect(screen.getByRole('radio', { name: /3114/ })).toBeChecked();
    });
});
