/**
 * 결과 보고서 표 (기획서 F15) — PDF와 엑셀이 같은 표를 쓴다(내용이 어긋나지 않게).
 *
 * 화면·파일 형식과 떨어진 순수 변환이라 단위 테스트로 고정한다.
 * 사람 이름은 제출·승인한 사람만 담는다(누가 찍었는지는 담지 않는다 — 최소수집).
 */
import { CONDITION_LABEL, SCAN_RESULT_LABEL } from './judge';
import { isUsefulLifeOver, usefulLifeEnd } from '../usefulLife';
import type { SurveyReport, ReportSpace } from './report';
import type { Survey, Scan } from '../../types/survey';

export interface ReportTable {
    title: string;
    columns: string[];
    rows: Array<Array<string | number>>;
    /** 행이 없을 때 표 대신 쓸 문장 */
    empty: string;
}

export interface ReportContext {
    survey: Pick<Survey, 'name' | 'startDate' | 'endDate' | 'mode' | 'status'>;
    report: SurveyReport;
    /** 공간 키 → 이름(마감 회차는 survey.spaceNames) */
    spaceName: (key: string | null) => string;
    /** 공간 키 → 위치("본관 2층", 없으면 빈 글자). 건물을 등록하지 않은 기관은 비워 둔다 */
    spaceLocation?: (key: string | null) => string;
    /** uid → 이름 */
    personName: (uid: string | null) => string;
}

const MODE_LABEL = { delegated: '나눠서 조사', solo: '혼자 조사' } as const;

/** 공간별 제출·승인 상태 한 줄 */
export function submissionText(space: ReportSpace, mode: 'delegated' | 'solo', personName: (uid: string | null) => string): string {
    if (mode === 'solo') return '-';
    const x = space.submission;
    if (!x) return space.key === '_none' ? '관리자 확인' : '미제출';
    if (x.state === 'submitted') return `제출(${personName(x.submittedByUid)})`;
    if (x.state === 'rejected') return `반려 — ${x.reason}`;
    const kind = x.proxyApproved ? '대신 승인' : x.selfApproved ? '본인 승인' : '승인';
    return `${kind}(${personName(x.reviewedByUid)})${x.reason ? ` — ${x.reason}` : ''}`;
}

export function reportHeader(ctx: ReportContext): Array<[string, string]> {
    const { survey } = ctx;
    return [
        ['회차', survey.name],
        ['기간', `${survey.startDate} ~ ${survey.endDate}`],
        ['조사 방식', MODE_LABEL[survey.mode]],
        ['상태', survey.status === 'closed' ? '마감' : survey.status === 'closing' ? '마감 중(중간 보고서)' : '진행 중(중간 보고서)'],
    ];
}

/**
 * 건물·층별 합계 — 공간별 행을 위치("본관 2층")로 모은다. 순서는 공간별 표에 처음 나온 순서
 * (회차가 건물 → 층 → 공간 순서로 담으므로 건물·층 순서가 된다). 위치가 없는 공간은 '건물 미지정'.
 */
export function locationSummaryRows(ctx: ReportContext): Array<Array<string | number>> {
    const loc = ctx.spaceLocation ?? (() => '');
    const order: string[] = [];
    const sum = new Map<string, { spaces: number; target: number; found: number; missing: number; elsewhere: number; issues: number }>();
    for (const x of ctx.report.spaces) {
        const key = loc(x.key) || '건물 미지정';
        if (!sum.has(key)) { order.push(key); sum.set(key, { spaces: 0, target: 0, found: 0, missing: 0, elsewhere: 0, issues: 0 }); }
        const v = sum.get(key)!;
        v.spaces += 1; v.target += x.target; v.found += x.found; v.missing += x.missing; v.elsewhere += x.elsewhere; v.issues += x.issues;
    }
    return order.map((k) => {
        const v = sum.get(k)!;
        return [k, v.spaces, v.target, v.found, v.missing, v.elsewhere, v.issues];
    });
}

/** 내용연수 지난 재물 표 제목 */
export const LIFE_OVER_TABLE_TITLE = '내용연수 지난 재물';

/** 현장 사진 표 제목 — PDF·화면은 이 표를 주소 대신 사진으로 그린다 */
export const PHOTO_TABLE_TITLE = '현장 사진';

/** 현장 사진 한 장(PDF·화면용) */
export interface ReportPhoto {
    code: string;
    name: string;
    where: string;
    condition: string;
    memo: string;
    url: string;
    thumbUrl: string;
}

/** 현장 사진 목록(2026-11-22) — 자산코드 순 */
export function reportPhotos(ctx: ReportContext): ReportPhoto[] {
    const loc = ctx.spaceLocation ?? (() => '');
    return (ctx.report.photos ?? []).map((x) => {
        const l = loc(x.spaceId);
        return {
            code: x.code, name: x.name ?? '', where: l ? `${l} ${ctx.spaceName(x.spaceId)}` : ctx.spaceName(x.spaceId),
            condition: CONDITION_LABEL[x.condition], memo: x.memo,
            url: x.photoUrl ?? '', thumbUrl: x.photoThumbUrl ?? x.photoUrl ?? '',
        };
    });
}

export function buildReportTables(ctx: ReportContext): ReportTable[] {
    const { report, spaceName } = ctx;
    const s = report.summary;
    const scanRow = (x: Scan, extra: Array<string | number> = []) => [x.code, x.name ?? '', ...extra];
    // 건물을 등록한 기관만 위치 열·건물·층별 표를 더한다(없는 기관의 보고서는 예전과 같다)
    const loc = ctx.spaceLocation ?? (() => '');
    const hasLocation = report.spaces.some((x) => loc(x.key) !== '');
    const where = (key: string | null) => {
        const l = hasLocation ? loc(key) : '';
        return l ? `${l} ${spaceName(key)}` : spaceName(key);
    };
    // 내용연수 지난 대상(조사 끝 날 기준) — 내용연수를 적은 대상이 있는 회차만 종합·표에 더한다(2026-11-22)
    const hasLife = !!report.aged?.length;
    const lifeOver = (report.aged ?? []).filter((i) => isUsefulLifeOver(i, ctx.survey.endDate));

    return [
        {
            title: '종합',
            columns: ['대상', '확인', '미발견', '다른 공간', '미등록', '범위 밖', '파손·불용 필요', '라벨 훼손', '직접 입력(재확인)',
                ...(hasLife ? ['내용연수 지남'] : [])],
            rows: [[s.target, s.found, s.missing, s.otherSpace, s.unregistered, s.outOfScope, s.damaged, s.labelDamaged, s.manual,
                ...(hasLife ? [lifeOver.length] : [])]],
            empty: '',
        },
        ...(hasLocation ? [{
            title: '건물·층별',
            columns: ['건물·층', '공간 수', '대상', '확인', '미발견', '다른 곳에서 찾음', '상태 이상'],
            rows: locationSummaryRows(ctx),
            empty: '',
        }] : []),
        {
            title: '공간별',
            columns: [...(hasLocation ? ['건물·층'] : []), '공간', '대상', '확인', '미발견', '다른 곳에서 찾음', '직접 입력', '상태 이상', '제출·승인'],
            rows: report.spaces.map((x) => [
                ...(hasLocation ? [loc(x.key) || '-'] : []),
                spaceName(x.key), x.target, x.found, x.missing, x.elsewhere, x.manual, x.issues,
                submissionText(x, ctx.survey.mode, ctx.personName),
            ]),
            empty: '대상 공간이 없습니다.',
        },
        {
            title: '미발견',
            columns: ['자산코드', '품명', '목록상 공간'],
            rows: report.missing.map((m) => [m.code, m.name ?? '', where(m.spaceKey)]),
            empty: '모든 대상을 찾았습니다.',
        },
        {
            title: '위치 다름',
            columns: ['자산코드', '품명', '목록상 공간', '찾은 공간'],
            rows: report.otherSpace.map((x) => scanRow(x, [where(x.expectedSpaceId), where(x.spaceId)])),
            empty: '없음',
        },
        {
            title: '파손·불용 필요',
            columns: ['자산코드', '품명', '찾은 공간', '메모'],
            rows: report.damaged.map((x) => scanRow(x, [where(x.spaceId), x.memo])),
            empty: '없음',
        },
        {
            title: '라벨 훼손',
            columns: ['자산코드', '품명', '찾은 공간', '메모'],
            rows: report.labelDamaged.map((x) => scanRow(x, [where(x.spaceId), x.memo])),
            empty: '없음',
        },
        {
            title: '미등록',
            columns: ['읽힌 코드', '찾은 공간', '물건 상태', '메모'],
            rows: report.unregistered.map((x) => [x.code, where(x.spaceId), CONDITION_LABEL[x.condition], x.memo]),
            empty: '없음',
        },
        {
            title: '범위 밖(불용·폐기 등)',
            columns: ['자산코드', '품명', '찾은 공간', '메모'],
            rows: report.outOfScope.map((x) => scanRow(x, [where(x.spaceId), x.memo])),
            empty: '없음',
        },
        {
            title: '직접 입력(재확인 대상)',
            columns: ['자산코드', '품명', '찾은 공간', '판정'],
            rows: report.manual.map((x) => scanRow(x, [where(x.spaceId), SCAN_RESULT_LABEL[x.result]])),
            empty: '없음',
        },
        // 내용연수가 지난 대상(2026-11-22) — 조사 끝 날 기준. 내용연수를 적은 재물이 하나도 없으면 표를 빼
        // (쓰지 않는 기관·예전 회차의 보고서는 예전과 같다)
        ...(hasLife ? [{
            title: LIFE_OVER_TABLE_TITLE,
            columns: ['자산코드', '품명', '목록상 공간', '취득일자', '내용연수(년)', '끝난 날', '이번 조사'],
            rows: lifeOver
                .map((i) => [i.code, i.name ?? '', where(i.spaceKey), i.acquiredAt ?? '', i.usefulLife ?? '',
                    usefulLifeEnd(i.acquiredAt, i.usefulLife) ?? '', i.found ? '확인' : '미발견']),
            empty: `조사 끝 날(${ctx.survey.endDate}) 기준으로 내용연수가 지난 재물이 없습니다.`,
        }] : []),
        ...(ctx.report.photos?.length ? [{
            title: PHOTO_TABLE_TITLE,
            columns: ['자산코드', '품명', '찍은 공간', '물건 상태', '메모', '사진 주소'],
            rows: reportPhotos(ctx).map((p) => [p.code, p.name, p.where, p.condition, p.memo, p.url]),
            empty: '',
        }] : []),
    ];
}
