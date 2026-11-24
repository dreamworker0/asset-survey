/**
 * 라벨 배치 계산 (기획서 F09) — A4 라벨지의 칸 위치·쪽 나누기·라벨 안 글자 크기
 *
 * 화면과 떨어진 순수 계산이라 단위 테스트로 고정한다. 단위는 모두 mm.
 *
 * 기본 3종 치수는 공유패키지 앱(docs/재물관리앱-공유패키지)에서 실제로 인쇄·판독을 확인한 값이다
 * (사용자 결정 2026-11-21: 검증된 3종 + 직접 치수).
 */

export type LabelPreset = 'small' | 'medium' | 'large';
export type LabelSize = LabelPreset | 'custom';

export interface LabelSpec {
    /** 라벨 한 칸 너비·높이 */
    w: number; h: number;
    /** 가로 칸 수·세로 줄 수 */
    cols: number; rows: number;
    /** A4 왼쪽 위에서 첫 칸까지 */
    top: number; left: number;
    /** 칸 사이 간격(한 칸 시작에서 다음 칸 시작까지) */
    hpitch: number; vpitch: number;
}

export const A4 = { w: 210, h: 297 } as const;

/**
 * `model` — 칸 크기·칸 수가 같은 폼텍 제품 번호(공식 카탈로그 Formtec_Catalog_Kor.pdf, 2024-02 판에서 확인).
 * 카탈로그에 여백 수치가 없어 화면은 "일반 종이로 먼저 맞춰 보라"는 안내를 유지한다.
 */
export const LABEL_PRESETS: Record<LabelPreset, LabelSpec & { label: string; model: string }> = {
    small: { label: '작은', model: '3100', w: 38.1, h: 21.2, cols: 5, rows: 13, top: 10.7, left: 4.75, hpitch: 40.6, vpitch: 21.2 },
    medium: { label: '중간', model: '3105', w: 63.5, h: 38.1, cols: 3, rows: 7, top: 15.15, left: 7.25, hpitch: 66.0, vpitch: 38.1 },
    large: { label: '큰', model: '3114', w: 99.1, h: 67.7, cols: 2, rows: 4, top: 13.1, left: 4.65, hpitch: 101.6, vpitch: 67.7 },
};

/**
 * 라벨지 회사 — 담당자는 "어느 회사 몇 번"으로 라벨지를 사므로 회사를 먼저 고르고 모델을 고른다
 * (사용자 결정 2026-11-24). 저장값은 그대로 `labelSize` 하나이고 회사는 거기서 정해진다.
 *
 * 회사는 실제 라벨지로 시험 인쇄해 위치를 확인한 뒤에만 넣는다. 아이라벨(구 애니라벨) CL551·CL237·CL224는
 * 판매 페이지 규격표의 여백·칸 높이가 위 값과 달라(예: 65칸 위 여백 12mm, 칸 높이 21.07mm) 시험 인쇄 뒤 추가한다.
 */
export type LabelBrand = 'formtec' | 'other';

export const LABEL_BRANDS: Array<{ id: LabelBrand; name: string; presets: LabelPreset[] }> = [
    { id: 'formtec', name: '폼텍', presets: ['small', 'medium', 'large'] },
    { id: 'other', name: '다른 회사', presets: [] },
];

export const brandOf = (size: LabelSize): LabelBrand => (size === 'custom' ? 'other' : 'formtec');

export const DEFAULT_LABEL_SIZE: LabelPreset = 'medium';

/** 라벨 안쪽 여백·QR과 글자 사이 */
export const LABEL_PAD = 2;
export const LABEL_GAP = 1.5;
/** QR이 읽히는 최소 라벨 높이(작은 라벨 21.2mm보다 조금 작게까지 허용) */
const MIN_W = 20;
const MIN_H = 15;
/** 인쇄 오차 허용 */
const TOLERANCE = 0.5;

export const perPage = (s: LabelSpec): number => s.cols * s.rows;

export function specOf(size: LabelSize | undefined, custom: LabelSpec | undefined): LabelSpec {
    if (size === 'custom' && custom && !validateSpec(custom)) return custom;
    return LABEL_PRESETS[size && size !== 'custom' ? size : DEFAULT_LABEL_SIZE];
}

/** 직접 치수 검사 — 문제가 있으면 사람이 읽을 문장, 없으면 null */
export function validateSpec(s: LabelSpec): string | null {
    const nums = [s.w, s.h, s.cols, s.rows, s.top, s.left, s.hpitch, s.vpitch];
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return '치수에 빈 칸이나 음수가 있습니다.';
    if (!Number.isInteger(s.cols) || !Number.isInteger(s.rows) || s.cols < 1 || s.rows < 1 || s.cols > 10 || s.rows > 20) {
        return '가로 칸 수는 1~10, 세로 줄 수는 1~20 사이 정수로 넣어 주세요.';
    }
    if (s.w < MIN_W || s.h < MIN_H) return `라벨이 너무 작습니다. 너비 ${MIN_W}mm, 높이 ${MIN_H}mm 이상이어야 QR이 읽힙니다.`;
    if (s.cols > 1 && s.hpitch + TOLERANCE < s.w) return '가로 간격이 라벨 너비보다 좁습니다.';
    if (s.rows > 1 && s.vpitch + TOLERANCE < s.h) return '세로 간격이 라벨 높이보다 좁습니다.';
    if (s.left + (s.cols - 1) * s.hpitch + s.w > A4.w + TOLERANCE) return 'A4 가로(210mm)를 넘습니다. 왼쪽 여백·가로 간격·칸 수를 확인해 주세요.';
    if (s.top + (s.rows - 1) * s.vpitch + s.h > A4.h + TOLERANCE) return 'A4 세로(297mm)를 넘습니다. 위쪽 여백·세로 간격·줄 수를 확인해 주세요.';
    return null;
}

/** A4 안에서 i번째 칸(0부터, 왼쪽 위에서 가로 순서)의 위치 */
export function cellPos(s: LabelSpec, i: number): { left: number; top: number } {
    return { left: s.left + (i % s.cols) * s.hpitch, top: s.top + Math.floor(i / s.cols) * s.vpitch };
}

/**
 * 쪽 나누기 — 첫 장은 `startCell`(1부터)번째 칸부터 채운다(쓰다 남은 라벨지).
 * @returns 쪽마다 [칸 번호(0부터), 항목] 목록
 */
export function paginate<T>(items: T[], s: LabelSpec, startCell = 1): Array<Array<{ cell: number; item: T }>> {
    const n = perPage(s);
    const first = Math.min(Math.max(1, Math.floor(startCell)), n) - 1;
    const pages: Array<Array<{ cell: number; item: T }>> = [];
    let page: Array<{ cell: number; item: T }> = [];
    let cell = first;
    for (const item of items) {
        page.push({ cell, item });
        cell++;
        if (cell === n) { pages.push(page); page = []; cell = 0; }
    }
    if (page.length > 0) pages.push(page);
    return pages;
}

export interface LabelLayout {
    /** QR 한 변 */
    qr: number;
    /** 글자 칸 너비 */
    textW: number;
    /** 글자 크기 — 기관명·자산코드·품명 */
    org: number; code: number; name: number;
    /** 기관명을 넣을 자리가 있는가 */
    showOrg: boolean;
}

/** 글자 하나의 대략적인 너비(글자 크기 대비) — 한글은 1, 영문·숫자는 0.62 */
const charWidth = (ch: string) => (/[ㄱ-힝]/.test(ch) ? 1 : 0.62);
export const textEm = (text: string): number => [...text].reduce((n, ch) => n + charWidth(ch), 0);

/**
 * 라벨 안 배치 — 왼쪽에 QR(라벨 높이에 맞춤), 오른쪽에 기관명·자산코드(가장 크게)·품명.
 * 자산코드는 한 줄에 들어가게 글자 크기를 줄인다(현장에서 눈으로 대조하는 값이라 자르지 않는다).
 */
export function labelLayout(s: LabelSpec, code: string): LabelLayout {
    const qr = Math.min(s.h - 2 * LABEL_PAD, s.w * 0.45);
    const textW = Math.max(0, s.w - LABEL_PAD - qr - LABEL_GAP - LABEL_PAD);
    const showOrg = s.h >= 30;
    const em = Math.max(1, textEm(code));
    const codeSize = Math.min(s.h * (showOrg ? 0.24 : 0.3), textW / em, 9);
    return {
        qr, textW, showOrg,
        code: codeSize,
        org: Math.min(codeSize * 0.55, 3.2),
        name: Math.min(Math.max(codeSize * 0.6, 2.2), 4),
    };
}
