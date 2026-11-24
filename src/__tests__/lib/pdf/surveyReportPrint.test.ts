/**
 * surveyReportPrint.test.ts — 보고서 인쇄 타이밍
 *
 * close 뒤에 onload를 걸면 이미 load가 끝난 창에서는 인쇄가 안 뜬다. 사진은 다 받은 뒤(또는 상한 뒤) 인쇄한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printWhenImagesReady } from '../../../lib/pdf/surveyReportPdf';

function fakeWindow(images: Array<{ complete: boolean; decode: () => Promise<void> }>) {
    const print = vi.fn();
    return { w: { document: { images }, print } as unknown as Window, print };
}

describe('printWhenImagesReady', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('그림이 없으면 load를 기다리지 않고 인쇄한다', async () => {
        const { w, print } = fakeWindow([]);
        printWhenImagesReady(w);
        await vi.advanceTimersByTimeAsync(300);
        expect(print).toHaveBeenCalledTimes(1);
    });

    it('덜 받은 사진은 decode가 끝난 뒤에 인쇄한다', async () => {
        let resolve!: () => void;
        const decode = () => new Promise<void>((r) => { resolve = r; });
        const { w, print } = fakeWindow([{ complete: true, decode: vi.fn() }, { complete: false, decode }]);
        printWhenImagesReady(w);
        await vi.advanceTimersByTimeAsync(1000);
        expect(print).not.toHaveBeenCalled();

        resolve();
        await vi.advanceTimersByTimeAsync(300);
        expect(print).toHaveBeenCalledTimes(1);
    });

    it('사진을 못 받아도(decode 실패) 인쇄한다', async () => {
        const { w, print } = fakeWindow([{ complete: false, decode: () => Promise.reject(new Error('404')) }]);
        printWhenImagesReady(w);
        await vi.advanceTimersByTimeAsync(300);
        expect(print).toHaveBeenCalledTimes(1);
    });

    it('끝없이 기다리지 않는다 — 상한이 지나면 한 번만 인쇄한다', async () => {
        const { w, print } = fakeWindow([{ complete: false, decode: () => new Promise<void>(() => { }) }]);
        printWhenImagesReady(w, 5000);
        await vi.advanceTimersByTimeAsync(5300);
        expect(print).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10000);
        expect(print).toHaveBeenCalledTimes(1);
    });
});
