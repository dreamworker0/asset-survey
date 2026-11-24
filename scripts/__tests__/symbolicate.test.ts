/**
 * symbolicate.test.ts — [오류 기록]의 압축된 스택을 소스맵으로 원본 위치로 푼다
 */
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { symbolicateLine } from '../symbolicate';

let dir: string;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    // 생성 코드 1줄 0칸 → 원본 1줄 0칸, 2줄 0칸 → 원본 2줄 0칸(이름 crash)
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js.map'), JSON.stringify({
        version: 3, file: 'index-abc.js', sources: ['../../src/lib/foo.ts'], names: ['crash'],
        mappings: 'AAAA;AACAA',
    }));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('symbolicateLine', () => {
    it('assets 프레임을 원본 파일·줄·이름으로 푼다', () => {
        const out = symbolicateLine('    at x (https://app.example/assets/index-abc.js:2:1)', dir);
        expect(out).toContain('→ src/lib/foo.ts:2:1 crash');
    });

    it('스택이 아닌 줄은 그대로 둔다', () => {
        expect(symbolicateLine('TypeError: boom', dir)).toBe('TypeError: boom');
    });

    it('소스맵이 없으면 그렇다고 적는다', () => {
        expect(symbolicateLine('at y (https://a/assets/other-1.js:1:1)', dir)).toContain('소스맵 없음');
    });
});
