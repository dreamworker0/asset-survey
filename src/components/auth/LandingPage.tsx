/**
 * LandingPage — 서비스 소개 (비로그인 첫 화면)
 */
import { Suspense, lazy, useState } from 'react';
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
    icon: string;
    title: string;
    desc: string;
}

const FEATURES: Feature[] = [
    {
        icon: '📥',
        title: '엑셀 대장 가져오기',
        desc: '희망이음에서 내려받은 고정자산대장이나 기관 자체 대장을 올리면 열 이름을 알아서 맞춥니다. 건수·금액을 원본과 대조해 확인합니다.',
    },
    {
        icon: '🏷️',
        title: 'QR 라벨 인쇄',
        desc: 'A4 라벨지 규격에 맞춰 공간별로, 필요한 것만 골라 QR 라벨을 뽑습니다. 쓰다 남은 라벨지는 건너뛸 칸을 정해 이어 씁니다.',
    },
    {
        icon: '📱',
        title: '휴대폰 QR 조사',
        desc: '공간 담당자가 휴대폰으로 라벨을 찍으면 정상·다른 공간·미등록을 바로 알려 줍니다. 같은 물건을 여러 번 찍어도 한 번만 셉니다.',
    },
    {
        icon: '✅',
        title: '공간별 제출·승인',
        desc: '공간 담당자가 결과를 제출하면 재물 담당자가 승인하거나 사유와 함께 돌려보냅니다. 작은 기관은 담당자 혼자 조사할 수도 있습니다.',
    },
    {
        icon: '📊',
        title: '조사 결과 보고서',
        desc: '공간별 현황, 파손·불용, 위치가 바뀐 재물을 정리한 보고서를 PDF·Excel로 받습니다. 지난해 조사도 연도별로 남습니다.',
    },
    {
        icon: '🔒',
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
    icon: string;
    label: string;
}

const SUB_FEATURES: SubFeature[] = [
    { icon: '🏢', label: '공간·담당자 지정' },
    { icon: '🔔', label: '푸시 알림' },
    { icon: '🌙', label: '다크 모드' },
    { icon: '🔠', label: '글꼴 크기 조절' },
    { icon: '💾', label: '매일 자동 백업' },
    { icon: '💬', label: '의견 보내기' },
];

export default function LandingPage() {
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
    useForceLightMode();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 text-white">
            <SEOHead
                title="재물조사 - 사회복지기관·비영리단체 전용"
                description="엑셀 대장 가져오기, QR 라벨, 휴대폰 조사, 승인, 결과 보고서까지. 사회복지기관을 위한 무료 재물조사 서비스."
                path="/"
                isHome
            />
            {/* 배경 장식 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-400/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-300/10 rounded-full blur-3xl" />
                <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-accent-400/10 rounded-full blur-3xl" />
            </div>

            {/* ─── 상단 네비게이션 ─── */}
            <PublicNav variant="overlay" />

            {/* ─── 히어로 ─── */}
            <header className="relative flex-1 flex flex-col items-center justify-center text-center px-4 py-16 sm:py-24">
                <div className="w-20 h-20 mx-auto mb-6 bg-white/10 dark:bg-surface-800/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 animate-scale-in" aria-hidden="true">
                    <AppIcon className="w-10 h-10 text-white" />
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold mb-3 animate-fade-in">재물조사</h1>
                <p className="text-primary-200 text-base sm:text-lg max-w-md mb-2 animate-fade-in">
                    사회복지기관·비영리단체 전용
                </p>
                <p className="text-primary-100 text-sm max-w-sm mb-8 animate-fade-in">
                    엑셀 대장을 올리고, QR 라벨을 붙이고, 휴대폰으로 찍으면 끝.<br />
                    연 1회 재물조사를 공간 담당자와 함께 나눠서 합니다.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-md animate-fade-in">
                    <button
                        type="button"
                        onClick={() => navigate('/apply')}
                        className="flex-1 btn bg-white dark:bg-surface-800 text-primary-700 dark:text-primary-300 font-bold hover:bg-primary-50 dark:hover:bg-primary-900/30 shadow-lg hover:shadow-xl transition-all min-h-[48px]"
                    >
                        서비스 도입 신청
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="flex-1 btn bg-white/10 dark:bg-surface-800/10 backdrop-blur-sm text-white border border-white/20 hover:bg-white/20 transition-all min-h-[48px]"
                    >
                        직원 로그인
                    </button>
                </div>

                <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-primary-100 text-xs"><span aria-hidden="true">✨ </span>완전 무료 · 광고 없음 · 신청하면 바로 쓸 수 있어요</p>
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
            <section className="relative bg-primary-800/50 backdrop-blur-sm px-4 py-12 sm:py-16">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-10">단 3단계면 시작할 수 있어요!</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        {STEPS.map((s) => (
                            <div key={s.num} className="text-center">
                                <div className="w-12 h-12 mx-auto mb-4 bg-white/10 rounded-full flex items-center justify-center text-xl font-bold border border-white/20">
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
            <section className="relative bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 px-4 py-16 sm:py-20">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-2">주요 기능</h2>
                    <p className="text-center text-sm text-surface-600 dark:text-surface-400 mb-10">아래 기능을 지금 바로 쓸 수 있습니다.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f) => (
                            <div
                                key={f.title}
                                className="bg-surface-50 dark:bg-surface-800 rounded-2xl p-6 text-center"
                            >
                                <div className="text-4xl mb-4" aria-hidden="true">{f.icon}</div>
                                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                                <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* 부가 기능 칩 */}
                    <div className="flex flex-wrap justify-center gap-3 mt-10">
                        {SUB_FEATURES.map((s) => (
                            <span
                                key={s.label}
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-sm font-medium"
                            >
                                <span aria-hidden="true">{s.icon}</span> {s.label}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── 대상 안내 ─── */}
            <section className="relative bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 px-4 py-12 sm:py-16">
                <div className="max-w-2xl mx-auto text-center">
                    <h2 className="text-xl font-bold mb-4">어떤 곳에서 쓸 수 있나요?</h2>
                    <p className="text-surface-600 dark:text-surface-400 text-sm leading-relaxed mb-6">
                        사회복지법인, 사회복지시설, 비영리사단법인·재단법인 등<br />
                        <strong>고유번호증 또는 사업자등록증을 보유한 비영리단체</strong>라면 누구나 신청할 수 있습니다.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 rounded-xl px-4 py-2 text-sm">
                        <span aria-hidden="true">⚠️</span>
                        <span>영리 기업 및 종교단체, 학교, 병원은 이용 대상이 아닙니다</span>
                    </div>
                </div>
            </section>

            {/* ─── CTA ─── */}
            <section className="relative bg-primary-800 text-white px-4 py-12 sm:py-16 text-center">
                <h2 className="text-xl font-bold mb-2">재물조사, 올해는 함께 나눠서 해 볼까요?</h2>
                <p className="text-primary-100 text-sm mb-6">AI가 서류를 먼저 확인하고, 확인이 더 필요하면 영업일 기준 1~2일 안에 직접 살펴 승인해 드립니다.</p>
                <button
                    type="button"
                    onClick={() => navigate('/apply')}
                    className="btn bg-white dark:bg-surface-800 text-primary-700 dark:text-primary-300 font-bold hover:bg-primary-50 dark:hover:bg-primary-900/30 shadow-lg hover:shadow-xl transition-all min-h-[48px]"
                >
                    서비스 도입 신청
                </button>
            </section>

            {/* ─── 푸터 ─── */}
            <footer className="relative bg-primary-900 text-primary-200 text-center text-xs px-4 py-6 space-y-2" role="contentinfo">
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
