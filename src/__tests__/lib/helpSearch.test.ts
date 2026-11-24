import { describe, it, expect } from 'vitest';
import { FAQ_CATEGORIES, FAQ_ITEMS, type FAQItem } from '@/lib/faqData';
import {
    EMPLOYEE_PRIORITY_CATEGORIES, groupFaqs, matchesFaq, normalizeForSearch, orderedCategories,
} from '@/lib/helpSearch';

/**
 * 앱 안 도움말의 검색·분류 묶기.
 * 현장 직원은 띄어쓰기·대소문자를 들쭉날쭉 치므로 둘 다 무시해야 하고,
 * 직원 화면은 현장 분류(스캔·제출·설치)가 먼저 와야 한다.
 */
const item = (over: Partial<FAQItem>): FAQItem => ({
    id: 'x', category: '설치·화면', question: '질문', answer: ['답'], ...over,
});

describe('normalizeForSearch', () => {
    it('공백을 모두 지우고 소문자로 바꾼다', () => {
        expect(normalizeForSearch('  QR 라벨\t인쇄 \n')).toBe('qr라벨인쇄');
    });
});

describe('matchesFaq', () => {
    const faq = item({ question: 'QR 라벨은 어떻게 뽑나요?', answer: ['[재물 목록]에서 라벨 인쇄를 누르세요.'] });

    it('빈 검색어는 모두 맞는다', () => {
        expect(matchesFaq(faq, '   ')).toBe(true);
    });

    it('띄어쓰기를 무시한다', () => {
        expect(matchesFaq(faq, '라벨인쇄')).toBe(true);
        expect(matchesFaq(faq, '재 물 목 록')).toBe(true);
    });

    it('대소문자를 무시한다', () => {
        expect(matchesFaq(faq, 'qr')).toBe(true);
    });

    it('질문뿐 아니라 답변도 본다', () => {
        expect(matchesFaq(faq, '누르세요')).toBe(true);
    });

    it('어디에도 없으면 맞지 않는다', () => {
        expect(matchesFaq(faq, '차량 예약')).toBe(false);
    });
});

describe('orderedCategories', () => {
    it('관리자는 FAQ 분류 순서 그대로다', () => {
        expect(orderedCategories('admin')).toEqual([...FAQ_CATEGORIES]);
    });

    it('직원은 현장 스캔 → 제출·승인·마감 → 설치·화면이 먼저이고 나머지는 원래 순서다', () => {
        const order = orderedCategories('employee');
        expect(order.slice(0, 3)).toEqual(['재물조사·현장 스캔', '제출·승인·마감', '설치·화면']);
        expect(order.slice(3)).toEqual(FAQ_CATEGORIES.filter((c) => !EMPLOYEE_PRIORITY_CATEGORIES.includes(c)));
        expect([...order].sort()).toEqual([...FAQ_CATEGORIES].sort());
    });
});

describe('groupFaqs', () => {
    it('검색어가 없으면 실제 FAQ 전부를 분류별로 빠짐없이 묶는다', () => {
        const groups = groupFaqs('admin', '');
        expect(groups.flatMap((g) => g.items)).toHaveLength(FAQ_ITEMS.length);
        for (const g of groups) {
            expect(g.items.every((i) => i.category === g.category)).toBe(true);
        }
    });

    it('직원은 첫 묶음이 현장 스캔이다', () => {
        expect(groupFaqs('employee', '')[0].category).toBe('재물조사·현장 스캔');
        expect(groupFaqs('admin', '')[0].category).toBe('설치·화면');
    });

    it('결과가 없는 분류는 빼고, 분류 안 순서는 FAQ 순서를 지킨다', () => {
        const items = [
            item({ id: 'a', category: '계정·기관', question: '라벨 A' }),
            item({ id: 'b', category: '재물조사·현장 스캔', question: '카메라' }),
            item({ id: 'c', category: '계정·기관', question: '라벨 C' }),
        ];
        const groups = groupFaqs('employee', '라벨', items);
        expect(groups).toEqual([{ category: '계정·기관', items: [items[0], items[2]] }]);
    });

    it('아무것도 맞지 않으면 빈 배열이다', () => {
        expect(groupFaqs('employee', '없는낱말zzz')).toEqual([]);
    });
});
