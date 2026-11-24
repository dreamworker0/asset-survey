/**
 * symbolicate — [오류 기록]의 압축된 스택을 원본 파일·줄로 푼다
 *
 * 2026-11-24 Sentry를 걷어내면서, 소스맵으로 스택을 풀어 주던 기능도 함께 없어졌다. 그 자리를 메운다.
 * 배포 워크플로가 빌드 때 만든 소스맵(.map, Hosting에는 안 나감)을 Actions 아티팩트
 * `sourcemaps-<커밋 SHA>`로 90일 보관한다. [오류 기록]의 '버전'(커밋 SHA 앞 7자리)으로 그 배포를 찾는다.
 *
 * 사용법:
 *   1) GitHub → Actions → 해당 배포 실행 → Artifacts에서 sourcemaps-<SHA>를 받아 압축을 푼다
 *      (또는 `gh run download <실행 ID> -n sourcemaps-<SHA> -D maps`)
 *   2) [오류 기록]의 스택을 파일로 저장하거나 그대로 붙여 넣는다
 *        npx tsx scripts/symbolicate.ts maps stack.txt
 *        Get-Clipboard | npx.cmd tsx scripts/symbolicate.ts maps
 *
 * 새 패키지 없이 Node 내장 `SourceMap`(node:module)을 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SourceMap } from 'node:module';
import { fileURLToPath } from 'node:url';

/** 스택 한 줄에서 `assets/<파일>.js:<줄>:<칸>`을 찾는다 */
const FRAME_RE = /(assets\/[^\s/():]+\.js):(\d+):(\d+)/;

const cache = new Map<string, SourceMap | null>();

function loadMap(mapsDir: string, asset: string): SourceMap | null {
    if (cache.has(asset)) return cache.get(asset)!;
    // 아티팩트는 dist 구조 그대로(assets/xxx.js.map)이거나 평평하게(xxx.js.map) 풀릴 수 있다
    const candidates = [path.join(mapsDir, `${asset}.map`), path.join(mapsDir, `${path.basename(asset)}.map`)];
    const file = candidates.find((f) => fs.existsSync(f));
    const map = file ? new SourceMap(JSON.parse(fs.readFileSync(file, 'utf-8'))) : null;
    cache.set(asset, map);
    return map;
}

/** 한 줄을 풀어 돌려준다 — 풀 수 없으면 원래 줄 그대로 */
export function symbolicateLine(line: string, mapsDir: string): string {
    const m = FRAME_RE.exec(line);
    if (!m) return line;
    const [, asset, lineNo, colNo] = m;
    const map = loadMap(mapsDir, asset);
    if (!map) return `${line}    ← 소스맵 없음(${asset}.map)`;
    // SourceMap.findEntry는 0부터 센다. 스택은 줄·칸 모두 1부터다.
    const entry = map.findEntry(Number(lineNo) - 1, Number(colNo) - 1) as {
        originalSource?: string; originalLine?: number; originalColumn?: number; name?: string;
    };
    if (!entry?.originalSource) return line;
    const src = entry.originalSource.replace(/^(\.\.\/)+/, '');
    const name = entry.name ? ` ${entry.name}` : '';
    return `${line}\n    → ${src}:${(entry.originalLine ?? 0) + 1}:${(entry.originalColumn ?? 0) + 1}${name}`;
}

function main(): void {
    const [mapsDir, stackFile] = process.argv.slice(2);
    if (!mapsDir || !fs.existsSync(mapsDir)) {
        console.error('사용법: npx tsx scripts/symbolicate.ts <소스맵 폴더> [스택 파일]  (스택 파일이 없으면 표준 입력)');
        process.exit(1);
    }
    const input = stackFile ? fs.readFileSync(stackFile, 'utf-8') : fs.readFileSync(0, 'utf-8');
    console.log(input.split(/\r?\n/).map((l) => symbolicateLine(l, mapsDir)).join('\n'));
}

// 테스트에서 불러올 때는 실행하지 않는다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
