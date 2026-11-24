/**
 * FAQ 데이터 — shared/faqData.ts에서 re-export
 * 프론트엔드와 백엔드(Cloud Functions)에서 단일 소스를 공유합니다.
 */
export {
    FAQ_ITEMS, FAQ_CATEGORIES, buildFaqPromptText,
    EMPLOYEE_QUICK_GUIDE, EMPLOYEE_QUICK_GUIDE_TITLE, EMPLOYEE_QUICK_GUIDE_TIP,
} from '../../shared/faqData';
export type { FAQItem, FaqCategory, QuickGuideStep } from '../../shared/faqData';
