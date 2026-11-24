/**
 * useAskAI — 도움말의 "AI에게 묻기" 호출 상태
 *
 * 콜러블 `askAI`(functions/src/handlers/callable/askAI.ts)를 부른다.
 * - 한 번만 부른다(attempts: 1). 부를 때마다 Gemini 비용과 하루 한도를 쓰므로 자동 재시도하지 않는다.
 *   토큰 만료만 callWithRetry가 갱신 후 한 번 더 부른다.
 * - 실패는 사용자가 할 수 있는 일을 말해 주는 문구로 바꾼다. 서버가 의도적으로 돌려준 거부
 *   (한도·길이·소속)는 서버 문구를 그대로 보여 준다.
 * - 질문 글은 오류 보고에 싣지 않는다(개인정보를 적었을 수 있다).
 */
import { useCallback, useRef, useState } from 'react';
import {
    callWithRetry, isAuthExpiredError, isCallableUnreachable, isRateLimitedError,
} from '../lib/callableRetry';
import { captureError } from '../lib/monitoring';

/** 질문 길이 상한 — 서버(ASK_AI_MAX_QUESTION_LENGTH)와 같은 값 */
export const ASK_AI_MAX_LENGTH = 300;

/** 질문 칸 위에 늘 보이는 안내 — 처리방침의 Gemini 위탁 항목(도움말 질문)과 같은 내용이다 */
export const ASK_AI_PRIVACY_NOTICE = '이름·전화번호 등 개인정보는 적지 마세요. 질문은 Google Gemini로 보내져 답을 만듭니다.';

/** Gemini 응답을 기다리는 시간. 서버 함수 제한(30초)보다 조금 길게 둔다. */
const ASK_AI_TIMEOUT_MS = 35_000;

export type AskAIStatus = 'idle' | 'loading' | 'answered' | 'error';

/** 서버가 의도적으로 돌려준 거부 — 서버 문구가 곧 안내다 */
const SERVER_MESSAGE_CODES = new Set(['invalid-argument', 'permission-denied', 'resource-exhausted', 'unavailable']);

function bareCode(err: unknown): string {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code !== 'string') return '';
    return code.includes('/') ? code.slice(code.lastIndexOf('/') + 1) : code;
}

/** 서버 문구가 한국어로 온 경우에만 그대로 쓴다(SDK 기본 영어 문구는 쓰지 않는다) */
function serverMessage(err: unknown): string | null {
    const msg = (err as { message?: unknown } | null)?.message;
    return typeof msg === 'string' && /[가-힣]/.test(msg) ? msg : null;
}

/** 실패를 화면 문구로 바꾼다. 두 번째 값은 운영자에게 알릴 만한 예상 밖 실패인가. */
export function askAIErrorMessage(err: unknown): { message: string; unexpected: boolean } {
    if (isCallableUnreachable(err) && bareCode(err) !== 'unavailable') {
        return { message: '인터넷 연결을 확인하고 다시 보내 주세요.', unexpected: false };
    }
    if (SERVER_MESSAGE_CODES.has(bareCode(err))) {
        const fallback = isRateLimitedError(err)
            ? '질문이 너무 많아요. 잠시 후 다시 보내 주세요.'
            : 'AI 답변을 만들지 못했어요. 잠시 후 다시 보내 주세요.';
        return { message: serverMessage(err) ?? fallback, unexpected: false };
    }
    if (isAuthExpiredError(err)) {
        // 토큰 갱신 후에도 거부 — 대개 App Check(보안 확인) 실패다
        return { message: '보안 확인에 실패했어요. 잠시 후 다시 보내 주세요.', unexpected: false };
    }
    if (bareCode(err) === 'deadline-exceeded') {
        return { message: '답이 늦어지고 있어요. 잠시 후 다시 보내 주세요.', unexpected: false };
    }
    return { message: '답을 가져오지 못했어요. 잠시 후 다시 보내 주세요.', unexpected: true };
}

export default function useAskAI() {
    const [status, setStatus] = useState<AskAIStatus>('idle');
    const [answer, setAnswer] = useState('');
    const [error, setError] = useState('');
    // 늦게 온 이전 응답이 새 질문의 결과를 덮지 않게 한다
    const requestSeq = useRef(0);

    const ask = useCallback(async (question: string) => {
        const trimmed = question.trim();
        if (!trimmed || trimmed.length > ASK_AI_MAX_LENGTH) return;

        const seq = ++requestSeq.current;
        setStatus('loading');
        setError('');
        setAnswer('');
        try {
            const data = await callWithRetry<{ question: string }, { answer: string }>(
                'askAI', { question: trimmed }, { attempts: 1, timeoutMs: ASK_AI_TIMEOUT_MS },
            );
            if (seq !== requestSeq.current) return;
            setAnswer(data.answer);
            setStatus('answered');
        } catch (err) {
            if (seq !== requestSeq.current) return;
            const { message, unexpected } = askAIErrorMessage(err);
            // 질문 글은 싣지 않는다 — 기능 이름만
            if (unexpected) captureError(err, { feature: 'askAI' });
            setError(message);
            setStatus('error');
        }
    }, []);

    const reset = useCallback(() => {
        requestSeq.current++;
        setStatus('idle');
        setAnswer('');
        setError('');
    }, []);

    return { status, answer, error, ask, reset };
}
