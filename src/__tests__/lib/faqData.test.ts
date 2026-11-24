import { describe, it, expect } from 'vitest';
import { FAQ_ITEMS, FAQ_CATEGORIES, EMPLOYEE_QUICK_GUIDE } from '@/lib/faqData';

/**
 * FAQ 데이터 계약.
 *
 * 이 파일은 사람이 손으로 늘려 가는 목록이고(현재 59개), 프론트 화면과 Cloud Functions의
 * AI 답변이 **같은 배열**을 쓴다. 모양이 깨지면 화면이 비거나 AI가 엉뚱한 안내를 한다.
 *
 * releaseNotes.json이 잘못된 `type` 하나로 사용자 화면을 죽인 적이 있다(2026-09-05).
 * 그쪽은 검사를 붙였는데 이쪽은 없어서, 같은 종류의 사고를 여기서 막는다.
 */
describe('FAQ 데이터 계약', () => {
    it('항목이 비어 있지 않다', () => {
        expect(FAQ_ITEMS.length).toBeGreaterThan(0);
    });

    it('id가 모두 고유하다 — 딥링크(#id)와 렌더 key가 이것으로 갈린다', () => {
        const ids = FAQ_ITEMS.map(item => item.id);
        const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(duplicates).toEqual([]);
    });

    it('id가 URL 해시로 쓸 수 있는 모양이다', () => {
        const bad = FAQ_ITEMS.filter(item => !/^[a-z0-9-]+$/.test(item.id));
        expect(bad.map(item => item.id)).toEqual([]);
    });

    it('질문과 답변이 모두 채워져 있다', () => {
        const empty = FAQ_ITEMS.filter(item =>
            !item.question?.trim() || !Array.isArray(item.answer) || item.answer.length === 0
        );
        expect(empty.map(item => item.id)).toEqual([]);
    });

    it('모든 항목이 정해진 분류 중 하나에 속한다 — 도움말이 분류별로 묶는다', () => {
        const bad = FAQ_ITEMS.filter(item => !(FAQ_CATEGORIES as readonly string[]).includes(item.category));
        expect(bad.map(item => item.id)).toEqual([]);
    });

    it('비어 있는 분류가 없다', () => {
        const empty = FAQ_CATEGORIES.filter(c => !FAQ_ITEMS.some(item => item.category === c));
        expect(empty).toEqual([]);
    });

    it('직원용 첫 사용 안내는 8단계이고 비어 있지 않다', () => {
        expect(EMPLOYEE_QUICK_GUIDE).toHaveLength(8);
        expect(EMPLOYEE_QUICK_GUIDE.every(step => step.text.trim().length > 0)).toBe(true);
    });

    it('답변에 빈 문단이 없다 — 화면에 빈 줄로 남는다', () => {
        const blank = FAQ_ITEMS.filter(item => item.answer.some(line => !line?.trim()));
        expect(blank.map(item => item.id)).toEqual([]);
    });
});
