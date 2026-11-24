/**
 * Settings — 기관 설정 페이지
 * 로직은 useSettings 훅
 */
import { Link } from 'react-router-dom';
import useSettings from '../../hooks/useSettings';
import useSettingsModals from '../../hooks/useSettingsModals';

import WithdrawOrgModal from './WithdrawOrgModal';
import FeedbackForm from '../common/FeedbackForm';
import HelpModal from '../common/HelpModal';
import OrgInfoSection from './settings/OrgInfoSection';
import ManagerSection from './settings/ManagerSection';
import ApprovalLineSection from './settings/ApprovalLineSection';
import SurveyModeSection from './settings/SurveyModeSection';
import AccountSection from './settings/AccountSection';

export default function Settings() {
    const {
        org, orgId, loading, saving, withdrawing,
        form, setForm,
        handleSave, handlePhoneChange, handleWithdraw,
    } = useSettings();

    const {
        showFeedback, setShowFeedback,
        showWithdraw, setShowWithdraw,
        showHelp, setShowHelp,
    } = useSettingsModals();


    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">설정</h1>

            {/* 기관 관리 섹션 */}
            <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 px-1">기관 관리</h2>

            {/* 기관 정보 */}
            <OrgInfoSection
                form={form}
                setForm={setForm}
                handlePhoneChange={handlePhoneChange}
                handleSave={handleSave}
                saving={saving}
                onRequestFeedback={() => setShowFeedback(true)}
            />

            {/* 조사 방식 (기획서 F02) — 고르는 즉시 저장 */}
            <SurveyModeSection
                value={form.surveyMode}
                saving={saving}
                onChange={(surveyMode) => handleSave(null, { surveyMode })}
            />

            {/* 관리 책임자 정·부 (2026-11-22) — 기록용, 라벨에 넣을 수 있다 */}
            <ManagerSection form={form} setForm={setForm} handleSave={handleSave} saving={saving} />

            {/* 결재 라인 설정 */}
            <ApprovalLineSection
                form={form}
                setForm={setForm}
                handleSave={handleSave}
                saving={saving}
            />


            {/* 접속기록 점검 — 고시 제16조 ②의 월 1회 점검 주체는 개인정보처리자인 기관이다 */}
            <div className="glass-card p-6 mb-6">
                <Link
                    to="/admin/audit-logs"
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left min-h-[48px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    <div className="w-10 h-10 bg-surface-100 dark:bg-surface-700 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-surface-500 dark:text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">접속기록</p>
                        <p className="text-xs text-surface-600 dark:text-surface-400">개인정보 접속·변경·반출 기록 점검 (월 1회 권장)</p>
                    </div>
                    <svg aria-hidden="true" className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </Link>
            </div>

            {/* 앱 정보 섹션 */}
            <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mt-8 mb-3 px-1">앱 정보</h2>

            <div className="glass-card p-6 mb-6 space-y-1">
                {/* 도움말 · 자주 하는 질문 (2026-11-24) — 검색과 AI에게 묻기 */}
                <button
                    type="button"
                    onClick={() => setShowHelp(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left min-h-[48px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    <div className="w-10 h-10 bg-surface-100 dark:bg-surface-700 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg aria-hidden="true" className="w-5 h-5 text-surface-500 dark:text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">도움말 · 자주 하는 질문</p>
                        <p className="text-xs text-surface-600 dark:text-surface-400">질문 검색 · AI에게 묻기</p>
                    </div>
                    <svg aria-hidden="true" className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>

                {/* 건의하기 */}
                <button
                    type="button"
                    onClick={() => setShowFeedback(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left min-h-[48px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                    <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg aria-hidden="true" className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">개발자에게 건의하기</p>
                        <p className="text-xs text-surface-600 dark:text-surface-400">소셜프리즘 · ehsheh@gmail.com</p>
                    </div>
                    <svg aria-hidden="true" className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>
            </div>

            {/* 내 계정 */}
            <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mt-8 mb-3 px-1">내 계정</h2>

            <AccountSection />

            {/* 기관 ID (읽기 전용) */}
            <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mt-8 mb-3 px-1">기관 정보 · 해지</h2>

            <div className="glass-card p-6 mb-6">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">기관 식별 정보</h3>
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <span className="text-surface-600 dark:text-surface-400">기관 ID</span>
                        <span className="font-mono text-surface-600 dark:text-surface-300 text-xs">{orgId}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <span className="text-surface-600 dark:text-surface-400">상태</span>
                        <span className={org?.status === 'approved' ? 'badge-success' : 'badge-warning'}>{org?.status === 'approved' ? '승인됨' : org?.status ?? '-'}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <span className="text-surface-600 dark:text-surface-400">등록일</span>
                        <span className="text-surface-600 dark:text-surface-300">
                            {(() => {
                                const ca = org?.createdAt;
                                if (ca && typeof ca === 'object' && 'toDate' in ca && typeof (ca as { toDate?: unknown }).toDate === 'function') {
                                    return (ca as { toDate: () => Date }).toDate().toLocaleDateString('ko-KR');
                                }
                                return '-';
                            })()}
                        </span>
                    </div>
                </div>
            </div>

            {/* 서비스 해지 (Danger Zone) */}
            <div className="glass-card p-6 mb-6 border border-red-200 dark:border-red-900/50">
                <h3 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-1">서비스 해지</h3>
                <p className="text-xs text-surface-600 dark:text-surface-400 mb-4">
                    기관의 서비스 이용을 종료합니다. 모든 직원의 접근이 차단되며, 30일간 보관 후 데이터가 영구 삭제됩니다.
                </p>
                <button
                    type="button"
                    onClick={() => setShowWithdraw(true)}
                    className="min-h-[48px] px-4 py-2 rounded-xl font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                >
                    서비스 해지하기
                </button>
            </div>

            {showWithdraw && (
                <WithdrawOrgModal
                    orgName={org?.name || form.name}
                    submitting={withdrawing}
                    onClose={() => setShowWithdraw(false)}
                    onConfirm={handleWithdraw}
                />
            )}
            {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
            {showHelp && <HelpModal audience="admin" onClose={() => setShowHelp(false)} />}


        </div>
    );
}
