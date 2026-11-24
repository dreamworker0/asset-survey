/**
 * designTokens.test.ts — 색상은 프로젝트 토큰만 쓴다 (.agent/agents.md D7, design-system §1)
 *
 * 2026-11-24에 Tailwind 기본 색상 184곳(blue·green·emerald·sky·gray·purple·indigo·yellow)을 토큰으로 옮겼다.
 * 규칙 문서만으로는 다시 쌓이므로(실제로 266곳까지 쌓였다) 여기서 막는다.
 *
 * 허용: primary·accent·surface(토큰), red(위험)·amber(경고)(design-system §1의 허용 예외), white·black 등.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Tailwind 기본 팔레트 중 쓰면 안 되는 계열 */
const FORBIDDEN = [
    'slate', 'gray', 'zinc', 'neutral', 'stone', 'orange', 'yellow', 'lime', 'green', 'emerald',
    'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];
const PREFIX = '(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|divide|outline|decoration|placeholder|shadow|caret|border-[trblxy])';
const PATTERN = new RegExp(`\\b${PREFIX}-(${FORBIDDEN.join('|')})-\\d{2,3}\\b`, 'g');

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(tsx?|css)$/.test(name)) out.push(p);
    }
    return out;
}

describe('디자인 토큰(D7)', () => {
    it('src에 Tailwind 기본 색상 계열(red·amber 제외)을 쓰지 않는다', () => {
        const hits: string[] = [];
        for (const file of walk(SRC)) {
            const lines = readFileSync(file, 'utf-8').split('\n');
            lines.forEach((line, i) => {
                for (const m of line.matchAll(PATTERN)) hits.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]}`);
            });
        }
        // 실패하면 목록의 클래스를 토큰으로 바꾼다: blue→primary, green·emerald→accent, gray·slate→surface,
        // yellow·orange→amber, 그 밖의 장식색은 primary/surface 중 의미에 맞는 쪽 (design-system.md §1)
        expect(hits).toEqual([]);
    });

    it('검사 정규식이 실제로 잡는다(자기 점검)', () => {
        expect('dark:bg-blue-900/20 text-emerald-700'.match(PATTERN)).toEqual(['bg-blue-900', 'text-emerald-700']);
        expect('bg-primary-50 text-red-700 border-amber-300 text-surface-900'.match(PATTERN)).toBeNull();
    });
});
