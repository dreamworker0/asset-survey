/**
 * 재물 목록·조사 현황판 성능 측정 (가상 2,000건 기관) — `npm run perf:assets`
 *
 * 측정만 한다(합격선 없음). CI에서 돌지 않는다(playwright.perf.config.ts 머리말 참고).
 *
 * 읽기 수: 측정 빌드의 `firebase/firestore` 별칭(firestoreReadCounter.ts)이 서버에서 받은 문서 수를 컬렉션별로 센다.
 * 시간: 페이지에 심은 MutationObserver가 기준 시각부터 ① '재물 N건 중 M건 표시' 문구가 (바뀌어) 나타난 때,
 *   ② 화면에 보이는 첫 재물 줄이 나타난 때를 잰다. 'Paint'는 그 뒤 requestAnimationFrame 두 번(그린 뒤 근사)이다.
 *   - 전체 로드: 기준은 내비게이션 시작(performance.now() = 0)
 *   - 앱 안 이동: 기준은 이동을 일으킨 순간
 *   - 거르기: 기준은 input/change 이벤트의 timeStamp
 */
import { test, expect, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { TEST_ADMIN } from '../emulator/seed';
import {
    resetPerfAssets, touchPerfAssets, addPerfScans, deletePerfScans,
    PERF_ASSET_COUNT, PERF_FILTER_SPACE_ID, PERF_SEARCH_TERM,
} from './seedPerf';

const RUNS = 3;
const FILTER_RUNS = 5;
const OUT_DIR = path.join('test-results', 'perf');

interface Reads { total: number; byCollection: Record<string, number> }
/** readsDone: 목록에 쓰는 컬렉션(재물·확인 기록·공간·건물)의 마지막 응답이 도착한 때 — 이후는 변환·그리기 시간이다 */
interface Marks { count?: number; countPaint?: number; row?: number; rowPaint?: number; readsDone?: number }
const LIST_COLLECTIONS = ['assets', 'assetChecks', 'spaces', 'buildings'];
interface Sample { label: string; marks: Marks; reads: Reads; countText?: string }

type PerfWindow = Window & {
    __PERF_READS__?: Reads & { log: unknown[] };
    __PERF_READS_RESET__?: () => void;
    __PERF__?: { marks: Marks; countText?: string; t0: number };
    __perfArm?: (label: string, watchRow?: boolean) => void;
    __perfArmOnInput?: (label: string) => void;
    __E2E_AUTH__?: { signIn: (email: string, password: string) => Promise<unknown> };
};

/** 페이지에 심는 측정기 — 문서가 만들어지기 전에 돈다(addInitScript) */
function installPerfObserver() {
    const w = window as unknown as Record<string, unknown>;
    const COUNT_RE = /^재물 [\d,]+건 중 [\d,]+건 표시$/;
    const state = {
        label: 'load', t0: 0, marks: {} as Record<string, number>, countText: undefined as string | undefined,
        baseCount: null as string | null, watchRow: true, pendingInput: null as string | null,
    };
    w.__PERF__ = state;
    const countText = (): string | null => {
        for (const el of Array.from(document.querySelectorAll('p[aria-live="polite"]'))) {
            const t = (el.textContent ?? '').trim();
            if (COUNT_RE.test(t)) return t;
        }
        return null;
    };
    const firstVisibleRow = (): Element | null => {
        for (const a of Array.from(document.querySelectorAll('a[href^="/admin/assets/e2e-org"]'))) {
            if ((a as HTMLElement).offsetParent !== null) return a;
        }
        return null;
    };
    const mark = (name: string) => {
        if (state.marks[name] !== undefined) return;
        const t0 = state.t0;
        const marks = state.marks;
        marks[name] = performance.now() - t0;
        requestAnimationFrame(() => requestAnimationFrame(() => { marks[`${name}Paint`] = performance.now() - t0; }));
    };
    const check = () => {
        if (state.marks.count === undefined) {
            const c = countText();
            if (c !== null && c !== state.baseCount) { mark('count'); state.countText = c; }
        }
        if (state.watchRow && state.marks.row === undefined && firstVisibleRow()) mark('row');
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
    w.__perfArm = (label: string, watchRow = true) => {
        state.label = label; state.t0 = performance.now(); state.marks = {}; state.countText = undefined;
        state.baseCount = countText(); state.watchRow = watchRow;
    };
    w.__perfArmOnInput = (label: string) => { state.pendingInput = label; };
    const onInput = (e: Event) => {
        if (!state.pendingInput) return;
        state.label = state.pendingInput; state.pendingInput = null;
        state.t0 = e.timeStamp; state.marks = {}; state.countText = undefined;
        state.baseCount = countText(); state.watchRow = false;
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
}

const isMobile = (projectName: string) => projectName.startsWith('mobile');

async function newPerfContext(browser: Browser, projectName: string, baseURL: string): Promise<{ context: BrowserContext; page: Page }> {
    const device = isMobile(projectName) ? devices['Pixel 7'] : { viewport: { width: 1366, height: 900 } };
    // 빈 저장소에서 시작한다(새 컨텍스트 = IndexedDB·localStorage·HTTP 캐시 모두 빔)
    const context = await browser.newContext({ ...device, baseURL, serviceWorkers: 'block' });
    await context.addInitScript(installPerfObserver);
    const page = await context.newPage();
    if (isMobile(projectName)) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    return { context, page };
}

/** 같은 계산을 돌려 CPU 감속이 걸려 있는지 확인한다(데스크톱 대비 배수를 보고에 남긴다) */
async function cpuProbe(page: Page): Promise<number> {
    return page.evaluate(() => {
        const t = performance.now();
        let x = 0;
        for (let i = 0; i < 3_000_000; i++) x += Math.sqrt(i);
        return performance.now() - t + (x < 0 ? 1 : 0);
    });
}

async function signInAdmin(page: Page) {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as PerfWindow).__E2E_AUTH__, null, { timeout: 120_000 });
    await page.evaluate(([e, p]) => { void (window as unknown as PerfWindow).__E2E_AUTH__!.signIn(e, p); }, [TEST_ADMIN.email, TEST_ADMIN.password] as const)
        .catch(() => { /* 로그인 직후 리다이렉트로 컨텍스트가 바뀔 수 있다 */ });
    await page.waitForURL(/\/admin\//, { timeout: 120_000 });
}

async function readCounter(page: Page): Promise<Reads> {
    return page.evaluate(() => {
        const r = (window as unknown as PerfWindow).__PERF_READS__;
        return { total: r?.total ?? 0, byCollection: { ...(r?.byCollection ?? {}) } };
    });
}

/** 읽기 수가 quietMs 동안 그대로일 때까지 기다린다(늦게 끝나는 쿼리까지 세려고) */
async function waitReadsSettled(page: Page, quietMs = 2000, maxMs = 120_000): Promise<Reads> {
    const start = Date.now();
    let last = await readCounter(page);
    let stableSince = Date.now();
    while (Date.now() - start < maxMs) {
        await page.waitForTimeout(250);
        const now = await readCounter(page);
        if (now.total !== last.total) { last = now; stableSince = Date.now(); continue; }
        if (Date.now() - stableSince >= quietMs) return now;
    }
    return last;
}

async function resetReads(page: Page) {
    await page.evaluate(() => (window as unknown as PerfWindow).__PERF_READS_RESET__?.());
}

async function waitMarks(page: Page, keys: Array<keyof Marks>) {
    await page.waitForFunction((ks) => {
        const m = (window as unknown as PerfWindow).__PERF__?.marks as Record<string, number> | undefined;
        return !!m && ks.every((k) => m[k] !== undefined);
    }, keys as string[], { timeout: 120_000 });
    return page.evaluate((cols) => {
        const w = window as unknown as PerfWindow;
        const p = w.__PERF__;
        const marks = { ...(p?.marks ?? {}) } as Marks;
        const t0 = p?.t0 ?? 0;
        const log = (w.__PERF_READS__?.log ?? []) as Array<{ at: number; collection: string }>;
        const done = log.filter((e) => e.at >= t0 && cols.includes(e.collection)).map((e) => e.at - t0);
        if (done.length) marks.readsDone = Math.max(...done);
        return { marks, countText: p?.countText };
    }, LIST_COLLECTIONS);
}

/** 앱 안 이동(BrowserRouter는 popstate를 듣는다) — 새로 고침 없이 화면만 바꾼다 */
async function spaNavigate(page: Page, to: string) {
    await page.evaluate((p) => {
        history.pushState({}, '', p);
        dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, to);
}

const LOAD_MARKS: Array<keyof Marks> = ['countPaint', 'rowPaint'];

/** 이미 /admin/assets에 있는 상태에서 다른 화면을 거쳐 앱 안에서 다시 연다 */
async function spaRevisit(page: Page, label: string, beforeReturn?: () => Promise<void>): Promise<Sample> {
    await spaNavigate(page, '/admin/dashboard');
    await page.waitForURL(/\/admin\/dashboard/);
    await waitReadsSettled(page);
    if (beforeReturn) await beforeReturn();
    await resetReads(page);
    await page.evaluate((l) => (window as unknown as PerfWindow).__perfArm?.(l), label);
    await spaNavigate(page, '/admin/assets');
    const { marks, countText } = await waitMarks(page, LOAD_MARKS);
    const reads = await waitReadsSettled(page);
    return { label, marks, reads, countText };
}

const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function summarize(samples: Sample[]) {
    const pick = (k: keyof Marks) => samples.map((s) => s.marks[k]).filter((v): v is number => typeof v === 'number');
    const collections = [...new Set(samples.flatMap((s) => Object.keys(s.reads.byCollection)))].sort();
    return {
        runs: samples.length,
        countPaintMs: pick('countPaint').length ? Math.round(median(pick('countPaint'))) : null,
        rowPaintMs: pick('rowPaint').length ? Math.round(median(pick('rowPaint'))) : null,
        readsTotal: median(samples.map((s) => s.reads.total)),
        readsByCollection: Object.fromEntries(collections.map((c) => [c, median(samples.map((s) => s.reads.byCollection[c] ?? 0))])),
        readsDoneMs: pick('readsDone').length ? Math.round(median(pick('readsDone'))) : null,
        raw: samples.map((s) => ({
            countPaint: s.marks.countPaint && Math.round(s.marks.countPaint), rowPaint: s.marks.rowPaint && Math.round(s.marks.rowPaint),
            readsDone: s.marks.readsDone && Math.round(s.marks.readsDone), reads: s.reads.total,
        })),
    };
}

function writeResult(name: string, data: unknown) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[perf] ${file}\n${JSON.stringify(data, null, 2)}`);
}

/** 거르기 한 번 — 이벤트부터 건수 문구가 바뀌어 그려질 때까지. 끝나면 되돌린다(되돌리기는 재지 않는다) */
async function measureFilter(page: Page, label: string, apply: () => Promise<void>, undo: () => Promise<void>): Promise<Sample> {
    const before = await page.locator('p[aria-live="polite"]', { hasText: /^재물 .*건 표시$/ }).first().textContent();
    await page.evaluate((l) => (window as unknown as PerfWindow).__perfArmOnInput?.(l), label);
    await apply();
    const { marks, countText } = await waitMarks(page, ['countPaint']);
    await undo();
    await expect(page.locator('p[aria-live="polite"]', { hasText: /^재물 .*건 표시$/ }).first()).toHaveText(before ?? '');
    return { label, marks, reads: { total: 0, byCollection: {} }, countText };
}

test.describe('성능 측정 — 가상 2,000건 기관', () => {
    test('재물 목록: 첫 방문·다시 방문 읽기 수와 표시 시간, 거르기 반응', async ({ browser, baseURL }, testInfo) => {
        const project = testInfo.project.name;
        await resetPerfAssets();
        const results: Record<string, unknown> = { project, assets: PERF_ASSET_COUNT, cpuThrottle: isMobile(project) ? 4 : 1 };

        // (a) 첫 방문 — 매번 새 컨텍스트(저장소 빔). 로그인 뒤 /admin/assets를 새로 연다
        const cold: Sample[] = [];
        let keep: { context: BrowserContext; page: Page } | null = null;
        for (let r = 0; r < RUNS; r++) {
            const ctx = await newPerfContext(browser, project, baseURL!);
            await signInAdmin(ctx.page);
            await waitReadsSettled(ctx.page);
            await ctx.page.goto('/admin/assets');
            const { marks, countText } = await waitMarks(ctx.page, LOAD_MARKS);
            const reads = await waitReadsSettled(ctx.page);
            cold.push({ label: 'cold', marks, reads, countText });
            if (r < RUNS - 1) await ctx.context.close(); else keep = ctx;
        }
        const { context, page } = keep!;
        results.cpuProbeMs = Math.round(await cpuProbe(page));
        results.cold = summarize(cold);
        results.coldCountText = cold[0].countText;

        // (b-1) 같은 브라우저에서 새로 고침 — 탭 메모리 기억은 사라진다
        const reload: Sample[] = [];
        for (let r = 0; r < RUNS; r++) {
            await page.reload();
            const { marks, countText } = await waitMarks(page, LOAD_MARKS);
            reload.push({ label: 'reload', marks, reads: await waitReadsSettled(page), countText });
        }
        results.reload = summarize(reload);

        // (b-2) 같은 탭에서 다른 화면을 거쳐 다시 열기 — 탭 메모리의 재물 목록 기억이 쓰인다(바뀐 것만 읽기)
        const spa: Sample[] = [];
        for (let r = 0; r < RUNS; r++) spa.push(await spaRevisit(page, 'spa'));
        results.spaRevisit = summarize(spa);

        // (b-3) 다른 사람이 재물 10건을 고친 뒤 같은 탭에서 다시 열기
        const changed: Sample[] = [];
        for (let r = 0; r < RUNS; r++) {
            changed.push(await spaRevisit(page, 'spa-10-changed', () => touchPerfAssets(1 + r * 10, 10)));
        }
        results.spaRevisitAfter10Changed = summarize(changed);

        // 거르기 — 이 동안 서버 읽기가 있는지 따로 센다
        await resetReads(page);
        const search = page.locator('input[type="search"]:visible');
        const filterToggle = page.locator('button[aria-controls="asset-filters"]');
        if (await filterToggle.isVisible()) await filterToggle.click(); // 휴대폰: 접힌 거르기 펼치기
        const spaceSelect = page.locator('#asset-filters select').nth(0);
        const checkedSelect = page.locator('#asset-filters select').nth(3);
        await expect(spaceSelect).toBeVisible();
        const searchRuns: Sample[] = [];
        const spaceRuns: Sample[] = [];
        const checkedRuns: Sample[] = [];
        for (let r = 0; r < FILTER_RUNS; r++) {
            searchRuns.push(await measureFilter(page, 'search', () => search.fill(PERF_SEARCH_TERM), () => search.fill('')));
            spaceRuns.push(await measureFilter(page, 'space', async () => { await spaceSelect.selectOption(PERF_FILTER_SPACE_ID); }, async () => { await spaceSelect.selectOption('all'); }));
            checkedRuns.push(await measureFilter(page, 'checked', async () => { await checkedSelect.selectOption('over6m'); }, async () => { await checkedSelect.selectOption('all'); }));
        }
        results.filterSearch = { ...summarize(searchRuns), countText: searchRuns[0].countText };
        results.filterSpace = { ...summarize(spaceRuns), countText: spaceRuns[0].countText };
        results.filterChecked = { ...summarize(checkedRuns), countText: checkedRuns[0].countText };
        results.readsDuringFilters = await waitReadsSettled(page, 1000);

        writeResult(`asset-list-${project}`, results);
        await context.close();
    });

    test('조사 현황판: 대상 약 1,860건·스캔 500건 회차를 열 때 읽기 수', async ({ browser, baseURL }, testInfo) => {
        const project = testInfo.project.name;
        const { context, page } = await newPerfContext(browser, project, baseURL!);
        await signInAdmin(page);
        await waitReadsSettled(page);

        const loads: Reads[] = [];
        for (let r = 0; r < RUNS; r++) {
            await page.goto('/admin/surveys');
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 120_000 });
            loads.push(await waitReadsSettled(page, 3000));
        }
        const collections = [...new Set(loads.flatMap((l) => Object.keys(l.byCollection)))].sort();

        // 현황판을 연 채로 스캔 10건이 더 들어오면 — 리스너가 더 읽는 수
        await resetReads(page);
        const ids = await addPerfScans(1501, 10);
        await expect.poll(async () => (await readCounter(page)).byCollection.scans ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(ids.length);
        const live = await waitReadsSettled(page, 2000);
        await deletePerfScans(ids);

        writeResult(`survey-dashboard-${project}`, {
            project,
            readsTotal: median(loads.map((l) => l.total)),
            readsByCollection: Object.fromEntries(collections.map((c) => [c, median(loads.map((l) => l.byCollection[c] ?? 0))])),
            raw: loads.map((l) => l.total),
            liveAfter10Scans: live,
        });
        await context.close();
    });
});
