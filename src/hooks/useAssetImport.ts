/**
 * useAssetImport — 엑셀 가져오기 화면(기획서 F04~F07)의 상태와 동작
 *
 * 흐름: 파일 고르기 → 시트·머리글·열 연결 → 검사 → (다음) 위치→공간 대응·비교 → 확정
 * 계산은 lib/import의 순수 함수가 하고, 여기서는 상태를 이어 붙이고 저장만 부른다.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import {
    getOrganization, getSpaces, createSpace, getAssets, getAccountingMap, commitImport, newImportId, importRecordExists,
    validateSpaceName, normalizeSpaceName, getBuildings,
} from '../lib/firestore';
import { matchSpaceByLocation, parseLocation } from '../lib/import/locationMatch';
import { readWorkbook, toImportTable, parseAssets, blockingReasons, type SheetTable } from '../lib/import/parseSheet';
import { autoMapColumns, type ColumnMap, type ImportField, missingRecommended, FIELD_DEF } from '../lib/import/columns';
import { diffAssets, countByLocation, type LocationSpaceMap } from '../lib/import/diff';
import { captureError } from '../lib/sentry';
import type { Space } from '../types/space';
import type { Building } from '../types/building';
import type { Asset, AssetAccounting } from '../types/asset';
import type { Organization } from '../types/organization';
import type { ImportDiffCounts } from '../lib/firestore/assets';

export type ImportStep = 'pick' | 'map' | 'compare' | 'saving' | 'done';

/** 파일 크기 상한 — 대장 수천 건도 수 MB 안이다. 사진이 든 카드 파일을 잘못 고른 경우를 막는다 */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

/** 합계 줄 금액 — 소계가 여러 줄이면 가장 큰 값(총합계)을 대장 합계로 본다 */
export function reportedTotalOf(totalRows: Array<{ amount: number | null }>): number | null {
    const amounts = totalRows.map((r) => r.amount).filter((a): a is number => a != null);
    return amounts.length === 0 ? null : Math.max(...amounts);
}

/**
 * 위치 원문별 공간 자동 제안 — 지난번 연결(그 공간이 아직 보이면) → 이름이 같은 공간
 * → 건물·층을 붙여 부른 이름("본관 2층 상담실" = 본관·2층의 '상담실', 2026-11-22) → 미지정
 */
export function suggestLocationMap(
    locationKeys: string[], spaces: Space[], saved: Record<string, string> = {}, buildings: Building[] = [],
): LocationSpaceMap {
    const active = spaces.filter((s) => !s.archived);
    const map: LocationSpaceMap = {};
    for (const key of locationKeys) {
        const prev = saved[key];
        if (prev && active.some((s) => s.id === prev)) {
            map[key] = prev;
            continue;
        }
        const byName = active.find((s) => normalizeSpaceName(s.name) === normalizeSpaceName(key));
        if (byName) { map[key] = byName.id; continue; }
        const byPlace = matchSpaceByLocation(key, active, buildings);
        if (byPlace) map[key] = byPlace.id;
    }
    return map;
}

export default function useAssetImport() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const orgId = userData?.organizationId ?? null;

    const [step, setStep] = useState<ImportStep>('pick');
    const [fileName, setFileName] = useState('');
    const [sheets, setSheets] = useState<SheetTable[]>([]);
    const [sheetIndex, setSheetIndex] = useState(0);
    const [headerRowIndex, setHeaderRowIndex] = useState<number | null>(null);
    const [columnMap, setColumnMap] = useState<ColumnMap>({});
    const [org, setOrg] = useState<Organization | null>(null);
    const [error, setError] = useState('');
    const [working, setWorking] = useState(false);

    const [spaces, setSpaces] = useState<Space[]>([]);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [existing, setExisting] = useState<Asset[]>([]);
    const [accounting, setAccounting] = useState<Map<string, AssetAccounting>>(new Map());
    const [locationMap, setLocationMap] = useState<LocationSpaceMap>({});
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [importId, setImportId] = useState<string | null>(null);
    /**
     * 멈춘 가져오기 — 같은 파일·시트·열 연결로 다시 확정하면 처음 기록 ID와 처음 건수를 이어 쓴다(2026-11-24).
     * 파일을 다시 골라도 내용이 같으면 이어지도록 화면 상태(reset)와 따로 둔다.
     */
    const pending = useRef<{ key: string; id: string; counts: ImportDiffCounts } | null>(null);
    /** 확정한 결과 요약 — 비교(diff)는 비교 단계에서만 계산하므로 완료 화면용으로 따로 남긴다 */
    const [result, setResult] = useState<{ added: number; changed: number; missing: number; unchanged: number } | null>(null);

    const table = useMemo(() => {
        const sheet = sheets[sheetIndex];
        if (!sheet) return null;
        return headerRowIndex == null ? toImportTable(sheet) : toImportTable(sheet, headerRowIndex);
    }, [sheets, sheetIndex, headerRowIndex]);

    const parsed = useMemo(() => (table ? parseAssets(table, columnMap) : null), [table, columnMap]);
    const blockers = useMemo(() => (step === 'pick' ? [] : blockingReasons(columnMap, parsed)), [step, columnMap, parsed]);
    const reportedTotal = useMemo(() => (parsed ? reportedTotalOf(parsed.totalRows) : null), [parsed]);
    const locations = useMemo(() => (parsed ? countByLocation(parsed.assets) : []), [parsed]);
    const diff = useMemo(
        () => (step === 'compare' && parsed && orgId ? diffAssets(orgId, parsed.assets, locationMap, existing, accounting) : null),
        [step, parsed, orgId, locationMap, existing, accounting],
    );

    const reset = useCallback(() => {
        setStep('pick'); setFileName(''); setSheets([]); setSheetIndex(0); setHeaderRowIndex(null);
        setColumnMap({}); setError(''); setLocationMap({}); setProgress(null); setImportId(null); setResult(null);
    }, []);

    /** 시트를 바꾸면 머리글을 다시 찾고 열을 다시 맞춘다 */
    const applySheet = useCallback((list: SheetTable[], index: number, saved: ColumnMap) => {
        setSheetIndex(index);
        setHeaderRowIndex(null);
        const t = list[index] ? toImportTable(list[index]) : null;
        setColumnMap(t ? autoMapColumns(t.headers, saved) : {});
    }, []);

    const pickFile = useCallback(async (file: File) => {
        if (!orgId) return;
        setError('');
        if (file.size > MAX_IMPORT_FILE_BYTES) {
            setError('파일이 너무 큽니다(20MB 초과). 사진이 든 자산관리카드가 아니라 고정자산대장 엑셀을 골라 주세요.');
            return;
        }
        setWorking(true);
        try {
            const [list, organization] = await Promise.all([
                file.arrayBuffer().then((buf) => readWorkbook(buf)),
                getOrganization(orgId),
            ]);
            const orgData = (organization as Organization) ?? null;
            setOrg(orgData);
            // 머리글을 알아본 첫 시트를 고른다
            const first = Math.max(0, list.findIndex((s) => toImportTable(s) != null));
            setSheets(list);
            setFileName(file.name);
            applySheet(list, first, (orgData?.importColumnMap ?? {}) as ColumnMap);
            if (!list.some((s) => toImportTable(s) != null)) {
                setError('머리글(자산코드·품명 등) 줄을 찾지 못했습니다. 아래에서 머리글 줄 번호를 직접 골라 주세요.');
            }
            setStep('map');
        } catch (err) {
            captureError(err, { context: 'useAssetImport.pickFile' });
            setError('파일을 읽지 못했습니다. 엑셀(.xlsx·.xls) 파일인지 확인해 주세요.');
        } finally {
            setWorking(false);
        }
    }, [orgId, applySheet]);

    const selectSheet = useCallback((index: number) => {
        applySheet(sheets, index, (org?.importColumnMap ?? {}) as ColumnMap);
    }, [sheets, org, applySheet]);

    /** 머리글 줄을 직접 고른다(엑셀 줄 번호, 1부터) */
    const selectHeaderRow = useCallback((rowNumber: number) => {
        const sheet = sheets[sheetIndex];
        if (!sheet) return;
        const index = rowNumber - 1;
        setHeaderRowIndex(index);
        const t = toImportTable(sheet, index);
        setColumnMap(t ? autoMapColumns(t.headers, (org?.importColumnMap ?? {}) as ColumnMap) : {});
    }, [sheets, sheetIndex, org]);

    const setColumn = useCallback((field: ImportField, header: string) => {
        setColumnMap((prev) => {
            const next: ColumnMap = { ...prev };
            // 한 머리글은 한 필드에만 — 다른 필드에 쓰이던 것이면 거기서 뺀다
            for (const [f, h] of Object.entries(next) as Array<[ImportField, string | undefined]>) {
                if (h === header && f !== field) delete next[f];
            }
            if (header) next[field] = header;
            else delete next[field];
            return next;
        });
    }, []);

    /** 다음 단계 — 앱에 있는 재물·공간을 읽어 비교를 준비한다 */
    const goCompare = useCallback(async () => {
        if (!orgId || !parsed || blockers.length > 0) return;
        // 자주 쓰는 열을 빠뜨렸으면 한 번 묻는다 — 그대로 가져오면 모든 재물에서 그 칸이 빈다(2026-11-23)
        const missing = missingRecommended(columnMap);
        if (missing.length > 0) {
            const names = missing.map((f) => FIELD_DEF[f].label).join(', ');
            const ok = await confirm({
                title: '자주 쓰는 열을 연결하지 않았습니다',
                message: `${names} 열을 연결하지 않았습니다. 이대로 가져오면 모든 재물에서 이 칸이 비어 있습니다.\n엑셀에 이런 열이 있으면 [돌아가서 연결]을 누르고 '열 연결'에서 고르세요. 없으면 그대로 진행하세요.`,
                confirmText: '그대로 진행',
                cancelText: '돌아가서 연결',
            });
            if (!ok) return;
        }
        setWorking(true);
        setError('');
        try {
            const [spaceList, assetList, accMap, buildingList] = await Promise.all([
                getSpaces(orgId), getAssets(orgId), getAccountingMap(orgId), getBuildings(orgId),
            ]);
            setSpaces(spaceList);
            setBuildings(buildingList);
            setExisting(assetList);
            setAccounting(accMap);
            setLocationMap(suggestLocationMap(locations.map((l) => l.key), spaceList, org?.locationSpaceMap ?? {}, buildingList));
            setStep('compare');
        } catch {
            setError('앱에 있는 재물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setWorking(false);
        }
    }, [orgId, parsed, blockers, locations, org, columnMap, confirm]);

    const backToMap = useCallback(() => setStep('map'), []);

    const setLocationSpace = useCallback((key: string, spaceId: string) => {
        setLocationMap((prev) => {
            const next = { ...prev };
            if (spaceId) next[key] = spaceId;
            else delete next[key];
            return next;
        });
    }, []);

    /**
     * 위치 이름으로 새 공간을 만들어 연결한다. 위치 앞에 등록한 건물·층 이름이 있으면 떼어 내 건물·층을 채운다
     * ("본관 2층 상담실" → 본관·2층의 '상담실'). 뗀 이름이 다른 공간과 겹치면 원문 이름을 그대로 쓴다.
     */
    const createSpaceFor = useCallback(async (key: string, location: string | null) => {
        if (!orgId || !location) return;
        const parsed = parseLocation(location, buildings);
        let name = parsed.name;
        if (name !== normalizeSpaceName(location) && validateSpaceName(name, spaces)) name = location;
        const problem = validateSpaceName(name, spaces);
        if (problem) {
            showToast(problem, 'warning');
            return;
        }
        setWorking(true);
        try {
            const active = spaces.filter((s) => !s.archived);
            const order = active.length === 0 ? 0 : Math.max(...active.map((s) => s.order)) + 1;
            const place = { buildingId: parsed.buildingId, floor: parsed.floor };
            const id = await createSpace(orgId, name, order, place);
            setSpaces((prev) => [...prev, { id, organizationId: orgId, name: normalizeSpaceName(name), order, managerUids: [], teamIds: [], archived: false, ...place }]);
            setLocationMap((prev) => ({ ...prev, [key]: id }));
            const b = buildings.find((x) => x.id === parsed.buildingId);
            const where = b ? ` (${b.name}${parsed.floor ? ` ${parsed.floor}` : ''})` : '';
            showToast(`공간 '${normalizeSpaceName(name)}'${where}을(를) 만들었습니다.`, 'success');
        } catch {
            showToast('공간을 만들지 못했습니다.', 'error');
        } finally {
            setWorking(false);
        }
    }, [orgId, spaces, buildings, showToast]);

    const confirmImport = useCallback(async () => {
        if (!orgId || !parsed || !diff || !table) return;
        const unmapped = locations.filter((l) => !locationMap[l.key]).reduce((n, l) => n + l.count, 0);
        const lines = [
            `새로 등록 ${diff.added.length}건 · 바뀜 ${diff.changed.length}건 · 그대로 ${diff.unchanged}건`,
            diff.missing.length > 0 ? `이번 파일에 없는 재물 ${diff.missing.length}건은 지우지 않고 '대장에 없음'으로 표시합니다.` : '',
            unmapped > 0 ? `공간을 정하지 않은 재물 ${unmapped}건은 공간 없이 저장됩니다(나중에 다시 가져와 정할 수 있습니다).` : '',
        ].filter(Boolean);
        // 같은 가져오기를 다시 확정하는가 — 같은 파일·시트·열 연결·건수·금액 합계
        const key = JSON.stringify([fileName, table.sheetName, columnMap, parsed.counts, parsed.amountTotals.all]);
        const resume = pending.current?.key === key ? pending.current : null;
        if (resume) lines.unshift("지난번에 멈춘 가져오기를 이어서 저장합니다(이미 저장된 것은 '그대로'로 셉니다).");
        const ok = await confirm({ title: resume ? '가져오기 이어서 저장' : '가져오기 확정', message: `${lines.join('\n')}\n\n이대로 저장할까요?`, confirmText: '저장' });
        if (!ok) return;

        const counts: ImportDiffCounts = { added: diff.added.length, changed: diff.changed.length, missing: diff.missing.length, unchanged: diff.unchanged };
        const run = resume ?? { key, id: newImportId(), counts };
        pending.current = run;

        setStep('saving');
        setProgress({ done: 0, total: 0 });
        try {
            // 남은 것이 없으면 지난번 마지막 배치가 저장됐는데 응답만 못 받았을 수 있다 — 기록이 있으면 끝난 것
            const nothingLeft = counts.added + counts.changed + counts.missing === 0;
            const id = resume && nothingLeft && await importRecordExists(run.id)
                ? run.id
                : await commitImport({
                    orgId, fileName, sheetName: table.sheetName, columnMap, locationMap, parsed, diff, reportedTotal,
                    importId: run.id, recordDiff: run.counts,
                    onProgress: (done, total) => setProgress({ done, total }),
                });
            pending.current = null;
            setImportId(id);
            // 완료 요약은 처음 확정한 건수 — 다시 확정했으면 남은 건수만 비교되기 때문
            setResult(run.counts);
            setStep('done');
            showToast(resume ? '멈췄던 가져오기를 이어서 마쳤습니다.' : '가져오기를 마쳤습니다.', 'success');
        } catch {
            setStep('compare');
            setError('저장하다 멈췄습니다. 일부만 저장됐을 수 있습니다 — 같은 파일로 다시 확정하면 남은 것만 이어서 저장하고, 가져오기 기록은 하나로 남습니다.');
            // 다시 비교할 수 있게 앱 쪽 재물을 새로 읽는다
            try {
                const [assetList, accMap] = await Promise.all([getAssets(orgId), getAccountingMap(orgId)]);
                setExisting(assetList);
                setAccounting(accMap);
            } catch { /* 위 안내로 충분하다 */ }
        }
    }, [orgId, parsed, diff, table, locations, locationMap, confirm, fileName, columnMap, reportedTotal, showToast]);

    return {
        step, working, error, fileName,
        sheets, sheetIndex, table, columnMap, parsed, blockers, reportedTotal,
        spaces, buildings, locations, locationMap, diff, progress, importId, result,
        pickFile, selectSheet, selectHeaderRow, setColumn, goCompare, backToMap,
        setLocationSpace, createSpaceFor, confirmImport, reset,
    };
}
