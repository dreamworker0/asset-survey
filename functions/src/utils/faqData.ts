/**
 * FAQ 데이터 — shared/faqData.ts에서 re-export
 * 프론트엔드와 백엔드(Cloud Functions)에서 단일 소스를 공유한다(tsconfig include에 ../shared가 있다).
 * askAI가 이 글만 근거로 답한다.
 */
export { FAQ_ITEMS, buildFaqPromptText, buildQuickGuidePromptText } from "../../../shared/faqData";
export type { FAQItem } from "../../../shared/faqData";
