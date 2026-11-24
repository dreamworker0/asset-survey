import { test, expect, type Page, type Locator } from '@playwright/test';
import * as XLSX from 'xlsx';
import { TEST_ADMIN, TEST_EMPLOYEE, seedSurveyFlowSpaces, readSurveyResult } from './emulator/seed';

/**
 * 재물조사 한 바퀴 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * 관리자 가져오기 → 조사 시작('나눠서 조사') → 직원 스캔·제출 → 관리자 반려 → 직원 다시 제출 → 승인
 * → 다른 공간 대신 승인 → 마감 → 결과 보고서까지, 실제 화면으로 이어서 돈다. 단계마다 숫자가 다음 단계로
 * 그대로 넘어가는지(가져온 3건 = 조사 대상 3건 = 확인 1 + 미발견 2 = 반영 목록 미발견 2건)를 맞춰 본다.
 *
 * 다른 인증 E2E와 같은 기관(e2e-org)을 쓰므로 공간·자산코드·회차 이름에 실행마다 다른 꼬리표를 붙이고,
 * 조사 대상도 이번에 만든 공간 두 곳만 고른다. 끝나면 회차는 마감돼 열린 조사를 남기지 않는다.
 */

declare global {
    interface Window {
        __E2E_AUTH__?: {
            signIn: (email: string, password: string) => Promise<unknown>;
            signOut: () => Promise<void>;
        };
    }
}

async function signIn(page: Page, email: string, password: string) {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__E2E_AUTH__, null, { timeout: 15000 });
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

/** 확인창(ConfirmModal) — 제목으로 맞는 창인지 확인한 뒤 돌려준다 */
async function dialogTitled(page: Page, title: string | RegExp): Promise<Locator> {
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
    return dialog;
}

/** 종합 숫자 칸 하나(dt 이름 → dd 값) */
function overviewValue(overview: Locator, label: string): Locator {
    return overview.locator('div').filter({ has: overview.page().locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
}

/** 고정자산대장 엑셀 — 분류·현재수량·위치·상태만 두고 취득일자·자산금액은 일부러 뺀다(빠진 열 확인창을 거치게) */
function ledgerXlsx(rows: Array<{ code: string; name: string; location: string }>): Buffer {
    const aoa = [
        ['자산코드', '품명', '자산분류', '현재수량', '자산상태', '자산위치'],
        ...rows.map((r) => [r.code, r.name, '비품', 1, '운영', r.location]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '고정자산대장');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test.describe('재물조사 한 바퀴 (에뮬레이터)', () => {
    test('가져오기 → 나눠서 조사 → 스캔·제출·반려·재제출·승인·대신 승인 → 마감 → 보고서 숫자가 이어진다', async ({ page, browser }) => {
        test.setTimeout(240_000);

        const runId = Date.now().toString(36);
        const { managed, unmanaged } = await seedSurveyFlowSpaces(runId);
        const managedId = `e2e-space-101-${runId}`;
        const unmanagedId = `e2e-space-store-${runId}`;
        const surveyName = `E2E 조사 흐름 ${runId}`;
        const assets = [
            { code: `E2E-${runId}-001`, name: '사무용 책상', location: managed },
            { code: `E2E-${runId}-002`, name: '사무용 의자', location: managed },
            { code: `E2E-${runId}-003`, name: '접이식 탁자', location: unmanaged },
        ];
        const [found, missedInManaged, missedInStore] = assets;
        const rejectReason = `창고 안쪽 선반 다시 확인 ${runId}`;
        const proxyReason = `담당자 휴가 ${runId}`;

        // ── 1. 관리자: 대장 가져오기 ─────────────────────────────────────────
        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await page.goto('/admin/import');
        await page.locator('#import-file').setInputFiles({
            name: `대장-${runId}.xlsx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: ledgerXlsx(assets),
        });
        await expect(page.getByText('데이터 3줄')).toBeVisible({ timeout: 15000 });
        // 열은 이름으로 자동 연결된다
        await expect(page.locator('#col-code')).toHaveValue('자산코드');
        await expect(page.locator('#col-location')).toHaveValue('자산위치');

        await page.getByRole('button', { name: '다음: 위치와 바뀌는 내용 보기' }).click();
        // 취득일자·자산금액을 연결하지 않았다 — 한 번 묻는다
        await (await dialogTitled(page, '자주 쓰는 열을 연결하지 않았습니다')).getByRole('button', { name: '그대로 진행' }).click();

        // 위치 이름이 공간 이름과 같아 미리 이어진다
        await expect(page.getByRole('combobox', { name: new RegExp(`^${managed} 2건`) })).toHaveValue(managedId);
        await expect(page.getByRole('combobox', { name: new RegExp(`^${unmanaged} 1건`) })).toHaveValue(unmanagedId);
        const changes = page.locator('div.glass-card').filter({ has: page.getByRole('heading', { name: '바뀌는 내용' }) });
        await expect(overviewValue(changes, '새로 등록')).toHaveText('3건');

        await page.getByRole('button', { name: '가져오기 확정' }).click();
        const importDialog = await dialogTitled(page, '가져오기 확정');
        await expect(importDialog).toContainText('새로 등록 3건');
        await importDialog.getByRole('button', { name: '저장' }).click();
        await expect(page.getByRole('heading', { name: '가져오기를 마쳤습니다' })).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(/새로 등록 3건/)).toBeVisible();

        // ── 2. 관리자: '나눠서 조사'로 시작 — 이번에 만든 두 공간만 ─────────────────
        await page.goto('/admin/surveys');
        await expect(page.getByText('조사 방식: 나눠서 조사')).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: '새 조사 시작' }).click();
        await page.getByLabel('회차 이름').fill(surveyName);
        const scope = page.getByRole('group', { name: /대상 공간/ });
        const boxes = scope.getByRole('checkbox');
        await expect(boxes.first()).toBeVisible();
        for (const box of await boxes.all()) {
            const label = await box.evaluate((el) => el.closest('label')?.textContent ?? '');
            await box.setChecked(label.includes(runId));
        }
        // 가져온 수가 공간별 대상 수로 그대로 보인다
        await expect(scope.getByRole('checkbox', { name: new RegExp(`^${managed}`) })).toBeChecked();
        await expect(scope.locator('label', { hasText: managed })).toContainText('2건 · 담당 1명');
        await expect(scope.locator('label', { hasText: unmanaged })).toContainText('1건 · 담당 0명');

        await page.getByRole('button', { name: '대상 3건으로 시작' }).click();
        const startDialog = await dialogTitled(page, '조사를 시작할까요?');
        await expect(startDialog).toContainText('대상 3건');
        await startDialog.getByRole('button', { name: '조사 시작' }).click();

        await expect(page.getByRole('heading', { name: surveyName })).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/· 나눠서 조사$/)).toBeVisible();
        const managedRow = page.getByRole('row').filter({ hasText: managed });
        const unmanagedRow = page.getByRole('row').filter({ hasText: unmanaged });
        await expect(managedRow).toContainText('0 / 2');
        await expect(unmanagedRow).toContainText('0 / 1');

        // ── 3. 직원(다른 브라우저): 담당 공간에서 코드 직접 입력으로 1건 확인 → 제출 ──────
        const empContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        try {
            const emp = await empContext.newPage();
            await signIn(emp, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
            await emp.waitForURL(/\/employee/, { timeout: 25000 });
            await emp.goto('/employee/scan');
            await expect(emp.getByRole('heading', { name: surveyName })).toBeVisible({ timeout: 15000 });
            // 담당 공간이 하나라 바로 그 공간이 열린다
            const progress = emp.getByRole('region', { name: '진행' });
            await expect(progress).toContainText(managed);
            await expect(progress).toContainText('0 / 2건 확인');

            await emp.getByRole('button', { name: '코드 직접 입력' }).click();
            await emp.locator('#manual-code').fill(found.code);
            await emp.getByRole('button', { name: '확인', exact: true }).click();
            const result = emp.getByRole('status').filter({ hasText: found.code });
            await expect(result).toContainText('정상');
            await expect(result).toContainText('직접 입력(재확인 대상)');
            await expect(progress).toContainText('1 / 2건 확인');
            await expect(emp.getByRole('button', { name: '남은 재물 1' })).toBeVisible();

            await emp.getByRole('button', { name: '이 공간 조사 제출' }).click();
            const submitDialog = await dialogTitled(emp, '이 공간 조사를 제출할까요?');
            await expect(submitDialog).toContainText('아직 못 찾은 재물이 1건');
            await submitDialog.getByRole('button', { name: '제출' }).click();
            await expect(emp.getByText('제출했습니다', { exact: true })).toBeVisible({ timeout: 15000 });
            await expect(emp.locator('#manual-code')).toBeHidden();

            // ── 4. 관리자: 현황판에 실시간으로 — 반려 ───────────────────────────
            await expect(managedRow).toContainText('1 / 2', { timeout: 15000 });
            await expect(managedRow).toContainText(`제출됨 · ${TEST_EMPLOYEE.name}`);
            await expect(page.getByText(found.code)).toBeVisible(); // 최근 스캔
            await managedRow.getByRole('button', { name: '반려' }).click();
            const rejectDialog = await dialogTitled(page, `${managed} 반려`);
            await rejectDialog.getByRole('textbox').fill(rejectReason);
            await rejectDialog.getByRole('button', { name: '반려' }).click();
            await expect(managedRow).toContainText('반려 · 다시 제출 기다림');
            await expect(managedRow).toContainText(`사유: ${rejectReason}`);

            // 직원 화면이 다시 열리고 사유가 보인다 → 다시 제출
            const rejected = emp.getByRole('alert').filter({ hasText: '반려됐습니다' });
            await expect(rejected).toBeVisible({ timeout: 15000 });
            await expect(rejected).toContainText(`사유: ${rejectReason}`);
            await expect(emp.locator('#manual-code')).toBeVisible();
            await expect(progress).toContainText('1 / 2건 확인'); // 반려돼도 찍은 기록은 그대로
            await emp.getByRole('button', { name: '다시 제출' }).click();
            await (await dialogTitled(emp, '이 공간 조사를 제출할까요?')).getByRole('button', { name: '제출' }).click();
            await expect(emp.getByText('제출했습니다', { exact: true })).toBeVisible({ timeout: 15000 });

            // 관리자: 승인
            await expect(managedRow).toContainText(`제출됨 · ${TEST_EMPLOYEE.name}`, { timeout: 15000 });
            await managedRow.getByRole('button', { name: '승인' }).click();
            await (await dialogTitled(page, `${managed} 승인`)).getByRole('button', { name: '승인' }).click();
            await expect(managedRow).toContainText(`승인 · ${TEST_ADMIN.name}`);
            await expect(emp.getByText('승인됐습니다', { exact: true })).toBeVisible({ timeout: 15000 });
        } finally {
            await empContext.close();
        }

        // 담당자 없는 공간은 사유를 적고 대신 승인
        await expect(page.getByText(`남은 공간 1곳: ${unmanaged}`)).toBeVisible();
        await unmanagedRow.getByRole('button', { name: '대신 승인' }).click();
        const proxyDialog = await dialogTitled(page, `${unmanaged} 대신 승인`);
        await proxyDialog.getByRole('textbox').fill(proxyReason);
        await proxyDialog.getByRole('button', { name: '승인' }).click();
        await expect(unmanagedRow).toContainText(`승인(대신) · ${TEST_ADMIN.name}`);
        await expect(unmanagedRow).toContainText(`사유: ${proxyReason}`);

        // ── 5. 마감 → 결과 보고서 ────────────────────────────────────────────
        await page.getByRole('button', { name: '조사 마감' }).click();
        const closeDialog = await dialogTitled(page, '조사를 마감할까요?');
        await expect(closeDialog).toContainText('확인 1/3건, 미발견 2건');
        await closeDialog.getByRole('button', { name: '마감', exact: true }).click();
        await page.waitForURL(/\/admin\/surveys\/[^/]+$/, { timeout: 20000 });
        const surveyId = new URL(page.url()).pathname.split('/').pop()!;
        await expect(page.getByRole('heading', { name: '결과 보고서' })).toBeVisible({ timeout: 15000 });

        // ── 6. 숫자 맞추기 — 보고서 종합 · 희망이음 반영 목록 · 서버에 남은 값 ─────────
        const overview = page.getByRole('region', { name: '종합' });
        await expect(overviewValue(overview, '대상')).toHaveText('3');
        await expect(overviewValue(overview, '확인')).toHaveText('1');
        await expect(overviewValue(overview, '미발견')).toHaveText('2');
        await expect(overviewValue(overview, '다른 공간')).toHaveText('0');
        await expect(overviewValue(overview, '미등록')).toHaveText('0');
        await expect(overviewValue(overview, '직접 입력\\(재확인\\)')).toHaveText('1');

        const sync = page.getByRole('region', { name: '희망이음 반영 목록' });
        await expect(sync).toContainText('0 / 2 처리');
        await expect(sync.getByRole('heading', { name: /^미발견 확인 2건/ })).toBeVisible();
        await expect(sync.getByRole('checkbox')).toHaveCount(2);
        await expect(sync).toContainText(missedInManaged.code);
        await expect(sync).toContainText(`목록상 ${managed}`);
        await expect(sync).toContainText(missedInStore.code);
        await expect(sync).toContainText(`목록상 ${unmanaged}`);
        await expect(sync).not.toContainText(found.code);

        // 공간별 표 — 제출·승인 경위까지 보고서에 남는다
        // 칸: 공간 · 대상 · 확인 · 미발견 · 다른 곳에서 찾음 · 직접 입력 · 상태 이상 · 제출·승인 (건물 없는 기관)
        const bySpace = page.locator('section').filter({ has: page.getByRole('heading', { name: /^공간별/ }) });
        const cells = (name: string) => bySpace.getByRole('row').filter({ hasText: name }).getByRole('cell');
        await expect(cells(managed)).toHaveText([managed, '2', '1', '1', '0', '1', '0', /승인/]);
        await expect(cells(unmanaged)).toHaveText([unmanaged, '1', '0', '1', '0', '0', '0', /대신 승인/]);

        // 서버 쪽 — 회차 요약과 반영 목록이 화면과 같다
        const server = await readSurveyResult(surveyId);
        expect(server.status).toBe('closed');
        expect(server.summary).toMatchObject({ target: 3, found: 1, missing: 2, otherSpace: 0, unregistered: 0, manual: 1 });
        expect(server.tasks.map((t) => `${t.kind}:${t.code}`).sort())
            .toEqual([`missing:${missedInManaged.code}`, `missing:${missedInStore.code}`]);

        // 지난 조사 목록에도 같은 숫자로 남고, 열린 조사는 없다
        await page.goto('/admin/surveys');
        await expect(page.getByRole('link', { name: new RegExp(surveyName) })).toContainText('확인 1/3 · 미발견 2');
        await expect(page.getByRole('button', { name: '새 조사 시작' })).toBeVisible();
    });
});
