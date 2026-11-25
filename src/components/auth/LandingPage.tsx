/**
 * LandingPage — 서비스 소개 (비로그인 첫 화면)
 */
import { Suspense, lazy, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';
import PublicNav from '../common/PublicNav';
import AppIcon from '../common/AppIcon';
/**
 * 문의 모달은 **열기 전까지 필요 없다.** 정적으로 두면 이 모달이 끌어오는 `lib/firebase`
 * 때문에 Firestore SDK(전송 164KB)가 랜딩 첫 화면의 임계 경로에 얹힌다 —
 * 랜딩만 보고 나가는 사람이 쓰지도 않을 것을 내려받는 셈이다(2026-08-09 Lighthouse 측정).
 */
const PublicFeedbackModal = lazy(() => import('../common/PublicFeedbackModal'));

interface Feature {
    icon: ReactNode;
    title: string;
    desc: string;
}

const FEATURES: Feature[] = [
    {
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
        ),
        title: '엑셀 대장 가져오기',
        desc: '희망이음에서 내려받은 고정자산대장이나 기관 자체 대장을 올리면 열 이름을 알아서 맞춥니다. 건수·금액을 원본과 대조해 확인합니다.',
    },
    {
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
            </svg>
        ),
        title: 'QR 라벨 인쇄',
        desc: 'A4 라벨지 규격에 맞춰 공간별로, 필요한 것만 골라 QR 라벨을 뽑습니다. 쓰다 남은 라벨지는 건너뛸 칸을 정해 이어 씁니다.',
    },
    {
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
        ),
        title: '휴대폰 QR 조사',
        desc: '공간 담당자가 휴대폰으로 라벨을 찍으면 정상·다른 공간·미등록을 바로 알려 줍니다. 같은 물건을 여러 번 찍어도 한 번만 셉니다.',
    },
    {
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        ),
        title: '공간별 제출·승인',
        desc: '공간 담당자가 결과를 제출하면 재물 담당자가 승인하거나 사유와 함께 돌려보냅니다. 작은 기관은 담당자 혼자 조사할 수도 있습니다.',
    },
    {
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
        ),
        title: '조사 결과 보고서',
        desc: '공간별 현황, 파손·불용, 위치가 바뀐 재물을 정리한 보고서를 PDF·Excel로 받습니다. 지난해 조사도 연도별로 남습니다.',
    },
    {
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
        ),
        title: '기관별 데이터 격리',
        desc: '여러 기관이 함께 쓰지만 다른 기관의 재물·직원 정보는 어떤 경로로도 보이지 않습니다. 변경 기록은 누가·언제·무엇을 남깁니다.',
    },
];

interface Step {
    num: string;
    title: string;
    desc: string;
}

const STEPS: Step[] = [
    {
        num: '1',
        title: '기관 신청',
        desc: '고유번호증 사진 한 장이면 AI가 자동 심사합니다. 빠르면 즉시 승인!',
    },
    {
        num: '2',
        title: '직원 초대',
        desc: '링크를 직원에게 공유하세요. 구글 로그인만으로 바로 합류.',
    },
    {
        num: '3',
        title: '대장 올리고 조사',
        desc: '엑셀 대장을 올리고 QR 라벨을 붙인 뒤, 공간별로 휴대폰으로 찍으면 됩니다.',
    },
];

interface SubFeature {
    icon: ReactNode;
    label: string;
}

const SUB_FEATURES: SubFeature[] = [
    {
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21" />
            </svg>
        ),
        label: '공간·담당자 지정',
    },
    {
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
        ),
        label: '푸시 알림',
    },
    {
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
            </svg>
        ),
        label: '다크 모드',
    },
    {
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
            </svg>
        ),
        label: '글꼴 크기 조절',
    },
    {
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
        ),
        label: '매일 자동 백업',
    },
    {
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
        ),
        label: '의견 보내기',
    },
];

export default function LandingPage() {
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    useForceLightMode();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-800 via-primary-900 to-surface-950 text-white">
            <SEOHead
                title="재물조사 - 사회복지기관·비영리단체 전용"
                description="엑셀 대장 가져오기, QR 라벨, 휴대폰 조사, 승인, 결과 보고서까지. 사회복지기관을 위한 무료 재물조사 서비스."
                path="/"
                isHome
            />
            {/* 배경 장식 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-400/15 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-300/10 rounded-full blur-3xl" />
                <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-accent-400/10 rounded-full blur-3xl" />
            </div>

            {/* ─── 상단 네비게이션 ─── */}
            <PublicNav variant="overlay" />

            {/* ─── 히어로 ─── */}
            <header className="relative flex-1 flex flex-col items-center justify-center text-center px-4 py-16 sm:py-24">
                <div className="w-20 h-20 mx-auto mb-6 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 animate-scale-in" aria-hidden="true">
                    <AppIcon className="w-10 h-10 text-white" />
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3 animate-fade-in">재물조사</h1>
                <p className="text-primary-200 text-base sm:text-lg max-w-md mb-2 animate-fade-in">
                    사회복지기관·비영리단체 전용
                </p>
                <p className="text-primary-100 text-sm max-w-sm mb-8 leading-relaxed animate-fade-in">
                    엑셀 대장을 올리고, QR 라벨을 붙이고, 휴대폰으로 찍으면 끝.<br />
                    연 1회 재물조사를 공간 담당자와 함께 나눠서 합니다.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-md animate-fade-in">
                    <button
                        type="button"
                        onClick={() => navigate('/apply')}
                        className="flex-1 btn bg-white text-primary-700 font-bold hover:bg-primary-50 shadow-lg hover:shadow-xl transition-all min-h-[48px]"
                    >
                        서비스 도입 신청
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="flex-1 btn bg-white/10 backdrop-blur-sm text-white border border-white/25 hover:bg-white/20 transition-all min-h-[48px]"
                    >
                        직원 로그인
                    </button>
                </div>

                <div className="mt-5 flex flex-col items-center gap-2">
                    <p className="text-primary-100 text-xs">완전 무료 · 광고 없음 · 신청하면 바로 쓸 수 있어요</p>
                    <button
                        type="button"
                        onClick={() => setIsFeedbackModalOpen(true)}
                        className="text-primary-100 hover:text-white text-sm underline underline-offset-4 transition-colors min-h-[48px] px-4 py-2"
                    >
                        이용 문의하기
                    </button>
                </div>
            </header>

            {/* ─── 3단계로 시작하세요 ─── */}
            <section className="relative bg-primary-900/60 border-y border-white/10 backdrop-blur-sm px-4 py-12 sm:py-16">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-10">단 3단계면 시작할 수 있어요!</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        {STEPS.map((s) => (
                            <div key={s.num} className="text-center rounded-2xl bg-white/5 border border-white/10 p-6">
                                <div className="w-11 h-11 mx-auto mb-4 bg-white/15 rounded-full flex items-center justify-center text-lg font-bold border border-white/25">
                                    {s.num}
                                </div>
                                <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                                <p className="text-primary-100 text-sm leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── 주요 기능 ─── */}
            <section className="relative bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 px-4 py-16 sm:py-20">
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-2">주요 기능</h2>
                    <p className="text-center text-sm text-surface-600 dark:text-surface-400 mb-10">아래 기능을 지금 바로 쓸 수 있습니다.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {FEATURES.map((f) => (
                            <div
                                key={f.title}
                                className="bg-surface-50 dark:bg-surface-800/70 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-6 text-left"
                            >
                                <div className="w-11 h-11 mb-4 rounded-xl bg-primary-50 dark:bg-primary-900/40 text-primary-600 dark:text-primary-300 flex items-center justify-center" aria-hidden="true">
                                    {f.icon}
                                </div>
                                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                                <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* 부가 기능 칩 */}
                    <div className="flex flex-wrap justify-center gap-2.5 mt-10">
                        {SUB_FEATURES.map((s) => (
                            <span
                                key={s.label}
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-100 dark:border-primary-800/50 rounded-full text-sm font-medium"
                            >
                                <span aria-hidden="true">{s.icon}</span>
                                <span>{s.label}</span>
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── 대상 안내 ─── */}
            <section className="relative bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-4 py-12 sm:py-16 border-t border-surface-200/70 dark:border-surface-800">
                <div className="max-w-2xl mx-auto text-center">
                    <h2 className="text-xl font-bold mb-4">어떤 곳에서 쓸 수 있나요?</h2>
                    <p className="text-surface-600 dark:text-surface-400 text-sm leading-relaxed mb-6">
                        사회복지법인, 사회복지시설, 비영리사단법인·재단법인 등<br />
                        <strong>고유번호증 또는 사업자등록증을 보유한 비영리단체</strong>라면 누구나 신청할 수 있습니다.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 rounded-xl px-4 py-2.5 text-sm">
                        <svg className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                        <span>영리 기업 및 종교단체, 학교, 병원은 이용 대상이 아닙니다</span>
                    </div>
                </div>
            </section>

            {/* ─── CTA ─── */}
            <section className="relative bg-primary-900 text-white px-4 py-12 sm:py-16 text-center">
                <h2 className="text-xl font-bold mb-2">재물조사, 올해는 함께 나눠서 해 볼까요?</h2>
                <p className="text-primary-100 text-sm mb-6">AI가 서류를 먼저 확인하고, 확인이 더 필요하면 영업일 기준 1~2일 안에 직접 살펴 승인해 드립니다.</p>
                <button
                    type="button"
                    onClick={() => navigate('/apply')}
                    className="btn bg-white text-primary-700 font-bold hover:bg-primary-50 shadow-lg hover:shadow-xl transition-all min-h-[48px]"
                >
                    서비스 도입 신청
                </button>
            </section>

            {/* ─── 푸터 ─── */}
            <footer className="relative bg-primary-950 text-primary-200 text-center text-xs px-4 py-6 space-y-2" role="contentinfo">
                <nav className="space-x-2 flex items-center justify-center min-h-[48px]" aria-label="법적 고지">
                    <Link to="/terms" className="hover:text-white underline underline-offset-2 transition-colors p-2 min-h-[48px] inline-flex items-center">이용약관</Link>
                    <span className="text-primary-300/60" aria-hidden="true">|</span>
                    <Link to="/privacy" className="hover:text-white underline underline-offset-2 transition-colors p-2 min-h-[48px] inline-flex items-center">개인정보 처리방침</Link>
                </nav>
                <p>© 2026 재물조사. All rights reserved.</p>
            </footer>
            {/* 피드백(문의하기) 모달 — 열릴 때 받아온다 */}
            {isFeedbackModalOpen && (
                <Suspense fallback={null}>
                    <PublicFeedbackModal
                        isOpen={isFeedbackModalOpen}
                        onClose={() => setIsFeedbackModalOpen(false)}
                    />
                </Suspense>
            )}
        </div>
    );
}
