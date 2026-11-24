/**
 * HelpModal — 앱 안 '도움말 · 자주 하는 질문'
 *
 * 고정하는 것:
 *  - 대화상자 접근성(aria-modal·이름·Esc·닫기 버튼 포커스)
 *  - 검색(질문+답변, 띄어쓰기 무시)과 분류별 접기/펼치기, 직원은 현장 분류가 먼저
 *  - 직원에게만 '처음 쓰는 분께' 8단계
 *  - AI에게 묻기: 개인정보 안내가 늘 보이고, 보내는 중·답·오류 상태를 보여 준다.
 *    자동 재시도 없이 한 번만 부른다(Gemini 비용·하루 한도).
 */
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCallWithRetry = vi.fn();
const mockCaptureError = vi.fn();
vi.mock('@/lib/callableRetry', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/callableRetry')>()),
    callWithRetry: (...args: unknown[]) => mockCallWithRetry(...args),
}));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null }, firebaseFunctions: {} }));
vi.mock('@/lib/tokenRefresh', () => ({ refreshTokenSilently: vi.fn() }));
vi.mock('@/lib/monitoring', () => ({ captureError: (...args: unknown[]) => mockCaptureError(...args) }));

import HelpModal from '@/components/common/HelpModal';
import { EMPLOYEE_QUICK_GUIDE, FAQ_ITEMS } from '@/lib/faqData';
import { ASK_AI_PRIVACY_NOTICE, askAIErrorMessage } from '@/hooks/useAskAI';

/** 분류 머리 버튼(aria-expanded가 있고 "(개수)"가 붙은 것)의 이름 목록 */
function categoryButtons(): HTMLElement[] {
    return screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded') && /\(\d+\)/.test(b.textContent ?? ''));
}

function typeQuestion(text: string) {
    fireEvent.change(screen.getByLabelText('AI에게 물을 질문'), { target: { value: text } });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('HelpModal — 대화상자', () => {
    it('제목으로 이름 붙은 aria-modal 대화상자이고, 열리면 닫기 버튼에 포커스가 간다', () => {
        render(<HelpModal audience="admin" onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        // 이모지는 aria-hidden이라 이름에 들어가지 않는다
        expect(dialog).toHaveAccessibleName('도움말 · 자주 하는 질문');
        expect(screen.getByRole('button', { name: '창 닫기' })).toHaveFocus();
    });

    it('Esc와 닫기 버튼으로 닫힌다', () => {
        const onClose = vi.fn();
        render(<HelpModal audience="admin" onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: '창 닫기' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe('HelpModal — 분류·검색', () => {
    it('직원은 현장 스캔·제출·설치 분류가 먼저 나온다', () => {
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        const names = categoryButtons().map((b) => b.textContent ?? '');
        expect(names[0]).toContain('재물조사·현장 스캔');
        expect(names[1]).toContain('제출·승인·마감');
        expect(names[2]).toContain('설치·화면');
    });

    it('관리자는 FAQ 순서(설치·화면부터)이고 처음 쓰는 분께 안내가 없다', () => {
        render(<HelpModal audience="admin" onClose={vi.fn()} />);
        expect(categoryButtons()[0].textContent).toContain('설치·화면');
        expect(screen.queryByText('처음 쓰는 분께')).not.toBeInTheDocument();
    });

    it('직원에게는 처음 쓰는 분께 8단계를 보여 준다', () => {
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        expect(screen.getByText('처음 쓰는 분께')).toBeInTheDocument();
        for (const step of EMPLOYEE_QUICK_GUIDE) {
            expect(screen.getByText(step.text)).toBeInTheDocument();
        }
    });

    it('분류는 접혀 있다가 누르면 질문이 보이고, 질문을 누르면 답이 보인다', () => {
        render(<HelpModal audience="admin" onClose={vi.fn()} />);
        const install = FAQ_ITEMS.find((i) => i.id === 'app-install')!;
        expect(screen.queryByText(install.question)).not.toBeInTheDocument();

        const cat = categoryButtons()[0];
        expect(cat).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(cat);
        expect(cat).toHaveAttribute('aria-expanded', 'true');

        const q = screen.getByRole('button', { name: new RegExp(install.question.slice(0, 10)) });
        fireEvent.click(q);
        expect(q).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(install.answer[0])).toBeInTheDocument();
    });

    it('검색은 띄어쓰기를 무시하고 찾은 분류를 펼쳐 보여 준다', () => {
        render(<HelpModal audience="admin" onClose={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('질문 찾기'), { target: { value: '라벨  인쇄' } });

        expect(screen.getByRole('status')).toHaveTextContent(/질문 \d+개를 찾았어요/);
        const cats = categoryButtons();
        expect(cats.length).toBeGreaterThan(0);
        for (const c of cats) expect(c).toHaveAttribute('aria-expanded', 'true');
        const labelPrint = FAQ_ITEMS.find((i) => i.id === 'label-print')!;
        expect(screen.getByText(labelPrint.question)).toBeInTheDocument();
    });

    it('찾은 게 없으면 알려 주고, 그 낱말을 AI 질문 칸으로 옮길 수 있다', () => {
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('질문 찾기'), { target: { value: '없는낱말zzz' } });
        expect(screen.getByRole('status')).toHaveTextContent('맞는 질문이 없어요');
        expect(categoryButtons()).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: '이 낱말로 AI에게 묻기' }));
        const textarea = screen.getByLabelText('AI에게 물을 질문');
        expect(textarea).toHaveValue('없는낱말zzz');
        expect(textarea).toHaveFocus();
    });
});

describe('HelpModal — AI에게 묻기', () => {
    it('개인정보 안내가 늘 보이고, 빈 질문은 보낼 수 없다', () => {
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        expect(screen.getByText(ASK_AI_PRIVACY_NOTICE)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
        typeQuestion('   ');
        expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
    });

    it('질문은 300자에서 잘린다', () => {
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        typeQuestion('가'.repeat(350));
        expect(screen.getByLabelText('AI에게 물을 질문')).toHaveValue('가'.repeat(300));
        expect(screen.getByText('300/300자')).toBeInTheDocument();
    });

    it('보내는 동안 상태를 보여 주고, 답이 오면 답과 주의 문구를 보여 준다', async () => {
        let resolve!: (v: { answer: string }) => void;
        mockCallWithRetry.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        typeQuestion('  라벨이 안 읽혀요  ');
        fireEvent.click(screen.getByRole('button', { name: '보내기' }));

        expect(mockCallWithRetry).toHaveBeenCalledWith(
            'askAI', { question: '라벨이 안 읽혀요' }, expect.objectContaining({ attempts: 1 }),
        );
        expect(screen.getByText('답을 만드는 중이에요…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '보내는 중…' })).toBeDisabled();
        expect(screen.getByLabelText('AI에게 물을 질문')).toBeDisabled();

        await act(async () => { resolve({ answer: '[코드 직접 입력]에 자산코드를 넣으세요.' }); });

        expect(screen.getByText('[코드 직접 입력]에 자산코드를 넣으세요.')).toBeInTheDocument();
        expect(screen.getByText(/AI 답변은 틀릴 수 있어요/)).toBeInTheDocument();
        expect(screen.queryByText('답을 만드는 중이에요…')).not.toBeInTheDocument();
    });

    it('하루 한도 같은 서버 거부는 서버 문구를 그대로 보여 주고 오류 보고는 하지 않는다', async () => {
        mockCallWithRetry.mockRejectedValueOnce(Object.assign(new Error('AI에게 묻기는 하루 20번까지예요. 내일 다시 물어봐 주세요.'), {
            code: 'functions/resource-exhausted',
        }));
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        typeQuestion('질문');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '보내기' })); });

        expect(screen.getByRole('alert')).toHaveTextContent('하루 20번까지예요');
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('예상 밖 실패는 일반 안내를 보여 주고, 오류 보고에 질문 글을 싣지 않는다', async () => {
        mockCallWithRetry.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'functions/not-found' }));
        render(<HelpModal audience="employee" onClose={vi.fn()} />);
        typeQuestion('홍길동 010-1234-5678');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '보내기' })); });

        expect(screen.getByRole('alert')).toHaveTextContent('답을 가져오지 못했어요');
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockCaptureError.mock.calls[0][1])).not.toContain('홍길동');
        // 실패 뒤에도 다시 보낼 수 있다
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: '보내기' })).toBeEnabled();
    });
});

describe('askAIErrorMessage', () => {
    it.each([
        ['오프라인(응답 없음)', { code: 'functions/internal', message: 'internal [0]' }, '인터넷 연결을 확인'],
        ['길이 초과', { code: 'functions/invalid-argument', message: '질문은 300자 이내로 적어 주세요.' }, '300자 이내'],
        ['기관 없음', { code: 'functions/permission-denied', message: '기관에 소속된 사용자만 쓸 수 있어요.' }, '기관에 소속된'],
        ['Gemini 실패', { code: 'functions/unavailable', message: 'AI 답변을 만들지 못했어요. 잠시 후 다시 물어봐 주세요.' }, 'AI 답변을 만들지 못했어요'],
        ['한도(영어 문구)', { code: 'functions/resource-exhausted', message: 'resource-exhausted' }, '질문이 너무 많아요'],
        ['보안 확인 실패', { code: 'functions/unauthenticated', message: 'Unauthenticated' }, '보안 확인에 실패'],
        ['시간 초과', { code: 'functions/deadline-exceeded', message: 'deadline-exceeded' }, '답이 늦어지고'],
    ])('%s', (_label, err, expected) => {
        const { message, unexpected } = askAIErrorMessage(err);
        expect(message).toContain(expected);
        expect(unexpected).toBe(false);
    });
});
