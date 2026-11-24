/**
 * 라벨 배치 계산 (기획서 F09) — 칸 위치·쪽 나누기·직접 치수 검사·라벨 안 글자 크기
 */
import { describe, it, expect } from 'vitest';
import {
    LABEL_BRANDS, LABEL_PRESETS, brandOf, cellPos, labelLayout, paginate, perPage, specOf, validateSpec, textEm, A4,
    type LabelSpec,
} from '../../../lib/labels/layout';

const { label: _l, model: _m, ...MEDIUM } = LABEL_PRESETS.medium;

describe('기본 3종', () => {
    it('모두 A4 안에 들어가고 직접 치수 검사를 통과한다', () => {
        for (const p of Object.values(LABEL_PRESETS)) {
            expect(validateSpec(p)).toBeNull();
            expect(p.left + (p.cols - 1) * p.hpitch + p.w).toBeLessThanOrEqual(A4.w + 0.5);
            expect(p.top + (p.rows - 1) * p.vpitch + p.h).toBeLessThanOrEqual(A4.h + 0.5);
        }
        expect([perPage(LABEL_PRESETS.small), perPage(LABEL_PRESETS.medium), perPage(LABEL_PRESETS.large)]).toEqual([65, 21, 8]);
    });
});

describe('cellPos', () => {
    it('왼쪽 위에서 가로 순서로 칸 위치를 낸다', () => {
        expect(cellPos(MEDIUM, 0)).toEqual({ left: 7.25, top: 15.15 });
        expect(cellPos(MEDIUM, 2)).toEqual({ left: 7.25 + 2 * 66, top: 15.15 });
        expect(cellPos(MEDIUM, 3)).toEqual({ left: 7.25, top: 15.15 + 38.1 });
    });
});

describe('paginate', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    it('한 장 21칸씩 나눈다', () => {
        const pages = paginate(items, MEDIUM);
        expect(pages.map((p) => p.length)).toEqual([21, 4]);
        expect(pages[1][0]).toEqual({ cell: 0, item: 21 });
    });
    it('시작 칸을 고르면 첫 장만 그 칸부터 채운다(쓰다 남은 라벨지)', () => {
        const pages = paginate(items, MEDIUM, 20);
        expect(pages[0]).toEqual([{ cell: 19, item: 0 }, { cell: 20, item: 1 }]);
        expect(pages.map((p) => p.length)).toEqual([2, 21, 2]);
    });
    it('시작 칸이 범위를 넘으면 끝 칸으로 맞춘다', () => {
        expect(paginate([1], MEDIUM, 99)[0][0].cell).toBe(20);
        expect(paginate([1], MEDIUM, 0)[0][0].cell).toBe(0);
    });
    it('빈 목록은 빈 쪽', () => {
        expect(paginate([], MEDIUM)).toEqual([]);
    });
});

describe('validateSpec — 직접 치수', () => {
    const ok: LabelSpec = { w: 70, h: 37, cols: 3, rows: 8, top: 0, left: 0, hpitch: 70, vpitch: 37 };
    it('A4에 꽉 차는 3×8(70×37mm)은 통과', () => {
        expect(validateSpec(ok)).toBeNull();
    });
    it.each([
        [{ ...ok, w: NaN }, /빈 칸/],
        [{ ...ok, cols: 2.5 }, /정수/],
        [{ ...ok, w: 15 }, /너무 작습니다/],
        [{ ...ok, hpitch: 60 }, /가로 간격/],
        [{ ...ok, vpitch: 30 }, /세로 간격/],
        [{ ...ok, cols: 4 }, /A4 가로/],
        [{ ...ok, rows: 9 }, /A4 세로/],
    ])('%o → 안내 문장', (spec, re) => {
        expect(validateSpec(spec)).toMatch(re);
    });
});

describe('라벨지 회사', () => {
    it('폼텍 모델은 기본 3종을 빠짐없이 한 번씩 담고, 카탈로그 번호와 같다', () => {
        const formtec = LABEL_BRANDS.find((b) => b.id === 'formtec');
        expect(formtec?.presets).toEqual(['small', 'medium', 'large']);
        expect([LABEL_PRESETS.small.model, LABEL_PRESETS.medium.model, LABEL_PRESETS.large.model]).toEqual(['3100', '3105', '3114']);
    });
    it('직접 치수는 다른 회사, 기본 3종은 폼텍', () => {
        expect(brandOf('custom')).toBe('other');
        expect(['small', 'medium', 'large'].map((k) => brandOf(k as 'small'))).toEqual(['formtec', 'formtec', 'formtec']);
    });
});

describe('specOf', () => {
    it('기본은 중간, 직접 치수가 틀리면 중간으로 돌아간다', () => {
        expect(specOf(undefined, undefined)).toBe(LABEL_PRESETS.medium);
        expect(specOf('small', undefined)).toBe(LABEL_PRESETS.small);
        expect(specOf('custom', { ...MEDIUM, w: 1 })).toBe(LABEL_PRESETS.medium);
        const custom = { ...MEDIUM, cols: 2 };
        expect(specOf('custom', custom)).toBe(custom);
    });
});

describe('labelLayout', () => {
    it('QR은 라벨 높이에 맞추되 너비의 45%를 넘지 않고, 글자 칸은 남은 너비', () => {
        for (const p of Object.values(LABEL_PRESETS)) expect(labelLayout(p, '1').qr).toBeCloseTo(Math.min(p.h - 4, p.w * 0.45));
        expect(labelLayout({ ...MEDIUM, w: 120 }, '1').qr).toBeCloseTo(38.1 - 4); // 넓은 라벨은 높이로 정해짐
        const l = labelLayout(MEDIUM, '1-1-1');
        expect(l.qr).toBeCloseTo(63.5 * 0.45); // 너비로 정해짐
        expect(l.textW).toBeCloseTo(63.5 - 2 - l.qr - 1.5 - 2);
        expect(l.showOrg).toBe(true);
    });
    it('긴 자산코드는 한 줄에 들어가게 글자를 줄인다', () => {
        const short = labelLayout(LABEL_PRESETS.small, '1-1');
        const long = labelLayout(LABEL_PRESETS.small, '2021-비품-000123');
        expect(long.code).toBeLessThan(short.code);
        expect(long.code * textEm('2021-비품-000123')).toBeLessThanOrEqual(long.textW + 1e-9);
        expect(short.showOrg).toBe(false);
    });
});
