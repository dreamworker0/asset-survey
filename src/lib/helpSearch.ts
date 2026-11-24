/**
 * helpSearch — 앱 안 도움말(HelpModal)의 검색·분류 묶기 (순수 함수)
 *
 * - 검색은 질문과 답변을 함께 보고, 띄어쓰기·대소문자를 무시한다
 *   ("라벨 인쇄" = "라벨인쇄", "QR" = "qr"). 현장 직원은 띄어쓰기를 들쭉날쭉 친다.
 * - 직원 화면은 현장에서 쓰는 분류(스캔·제출·설치)를 먼저 보여 준다. 관리자는 FAQ 순서 그대로.
 */
import { FAQ_CATEGORIES, FAQ_ITEMS, type FAQItem, type FaqCategory } from './faqData';

export type HelpRole = 'admin' | 'employee';

/** 직원에게 먼저 보여 줄 분류 — 나머지는 기본 순서대로 뒤에 붙는다 */
export const EMPLOYEE_PRIORITY_CATEGORIES: readonly FaqCategory[] = [
    '재물조사·현장 스캔',
    '제출·승인·마감',
    '설치·화면',
];

/** 비교용으로 공백을 모두 지우고 소문자로 */
export function normalizeForSearch(text: string): string {
    return text.replace(/\s+/g, '').toLowerCase();
}

/** 검색어가 질문 또는 답변에 들어 있는가. 빈 검색어는 모두 맞는 것으로 본다. */
export function matchesFaq(item: FAQItem, query: string): boolean {
    const q = normalizeForSearch(query);
    if (!q) return true;
    return normalizeForSearch(item.question).includes(q)
        || item.answer.some((line) => normalizeForSearch(line).includes(q));
}

/** 역할에 맞춘 분류 순서 */
export function orderedCategories(role: HelpRole): FaqCategory[] {
    if (role !== 'employee') return [...FAQ_CATEGORIES];
    const rest = FAQ_CATEGORIES.filter((c) => !EMPLOYEE_PRIORITY_CATEGORIES.includes(c));
    return [...EMPLOYEE_PRIORITY_CATEGORIES, ...rest];
}

export interface FaqGroup {
    category: FaqCategory;
    items: FAQItem[];
}

/** 검색어로 거른 FAQ를 역할에 맞춘 분류 순서로 묶는다. 결과가 없는 분류는 뺀다. */
export function groupFaqs(role: HelpRole, query: string, items: readonly FAQItem[] = FAQ_ITEMS): FaqGroup[] {
    const matched = items.filter((item) => matchesFaq(item, query));
    return orderedCategories(role)
        .map((category) => ({ category, items: matched.filter((item) => item.category === category) }))
        .filter((group) => group.items.length > 0);
}
