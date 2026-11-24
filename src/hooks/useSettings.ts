/**
 * useSettings — 기관 설정 상태 관리 + 비즈니스 로직
 * Settings에서 추출된 커스텀 훅. 차량운행일지의 차량 기능 토글·공휴일·출발지는 걷어냈다.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { captureError } from '../lib/monitoring';
import { useConfirm } from './useConfirm';
import { getOrganization, updateOrganization, regenerateInviteCode } from '../lib/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { formatDateKr } from '../lib/dateUtils';
import { formatPhoneNumber } from './useOrgApplication';
import type { Organization, WithdrawReason, SurveyMode } from '../types/organization';
import { DEFAULT_SURVEY_MODE } from '../schemas/organization';

export interface SettingsForm {
    name: string;
    adminEmail: string;
    address: string;
    phone: string;
    approvalLine: { title: string }[];
    hideApprovalLine: boolean;
    /** 조사 방식 (기획서 F02) */
    surveyMode: SurveyMode;
    /** 관리 책임자 정·부 (2026-11-22, 기록용) */
    managerPrimary: string;
    managerSecondary: string;
}

export default function useSettings() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [org, setOrg] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [form, setForm] = useState<SettingsForm>({
        name: '',
        adminEmail: '',
        address: '',
        phone: '',
        approvalLine: [{ title: '담당' }, { title: '팀장' }],
        hideApprovalLine: false,
        surveyMode: DEFAULT_SURVEY_MODE,
        managerPrimary: '',
        managerSecondary: '',
    });

    const orgId = userData?.organizationId;

    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            try {
                const data = await getOrganization(orgId);
                if (data) {
                    const orgData = data as Organization;
                    setOrg(orgData);
                    setForm({
                        name: orgData.name || '',
                        adminEmail: orgData.adminEmail || '',
                        address: orgData.address || '',
                        phone: formatPhoneNumber(orgData.phone || ''),
                        approvalLine: (orgData.approvalLine && orgData.approvalLine.length > 0)
                            ? orgData.approvalLine
                            : [{ title: '담당' }, { title: '팀장' }],
                        hideApprovalLine: orgData.hideApprovalLine ?? false,
                        surveyMode: orgData.surveyMode ?? DEFAULT_SURVEY_MODE,
                        managerPrimary: orgData.managerPrimary ?? '',
                        managerSecondary: orgData.managerSecondary ?? '',
                    });
                }
            } catch (err) {
                captureError(err, { context: 'useSettings.loadOrg', orgId });
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    const handleSave = async (e?: React.FormEvent | null, overrides?: Partial<SettingsForm>) => {
        if (e) e.preventDefault();
        if (!orgId) return;
        setSaving(true);
        // 저장 실패 시 되돌릴 이전 값(변경 필드 한정). 최신 상태 기준으로 보관한다.
        let rollback: Partial<SettingsForm> | null = null;
        if (overrides) {
            // 변경 필드의 이전 값을 동기적으로 캡처(각 토글은 서로 다른 키만 건드리므로
            // 연속 클릭 상황에서도 해당 키 롤백은 정확하다).
            const snapshot: Partial<SettingsForm> = {};
            for (const key of Object.keys(overrides) as (keyof SettingsForm)[]) {
                (snapshot as Record<string, unknown>)[key] = form[key];
            }
            rollback = snapshot;
            // 기능 토글은 즉시 로컬 상태에 병합하고 변경 필드만 저장한다.
            // 연속 클릭이 같은 이전 form 전체를 보내 서로의 변경을 되돌리는 경쟁을 막는다.
            setForm(prev => ({ ...prev, ...overrides }));
        }
        const targetData = overrides ? null : form;
        try {
            if (overrides) {
                await updateOrganization(orgId, overrides);
            } else if (targetData) {
                await updateOrganization(orgId, {
                    name: targetData.name.trim(),
                    adminEmail: targetData.adminEmail.trim(),
                    address: targetData.address.trim(),
                    phone: targetData.phone.trim(),
                    approvalLine: targetData.approvalLine.filter(a => a.title.trim()).map(a => ({ title: a.title.trim() })),
                    hideApprovalLine: targetData.hideApprovalLine,
                    surveyMode: targetData.surveyMode,
                    managerPrimary: targetData.managerPrimary.trim(),
                    managerSecondary: targetData.managerSecondary.trim(),
                });
            }
            // 저장 알림은 토스트로 — 맨 위 띠는 아래쪽 칸에서 저장하면 화면 밖이었다(2026-11-22 점검)
            showToast('저장했습니다.', 'success');
        } catch (err) {
            console.error('저장 실패:', err);
            // 즉시 저장 토글의 낙관적 반영을 이전 값으로 되돌린다.
            if (rollback) {
                const revert = rollback as Partial<SettingsForm>;
                setForm(prev => ({ ...prev, ...revert }));
            }
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    // 전화번호 포맷팅 핸들러 (010-0000-0000)
    const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatPhoneNumber(e.target.value);
        setForm(prev => ({ ...prev, phone: formatted }));
    }, []);

    const handleRegenCode = async () => {
        if (!orgId) return;
        if (!await confirm({ message: '초대 코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.', confirmColor: 'warning' })) return;
        try {
            const newCode = await regenerateInviteCode(orgId);
            setOrg(prev => prev ? ({ ...prev, inviteCode: newCode }) : null);
        } catch (err) {
            captureError(err, { context: 'useSettings.handleRegenCode', orgId });
            showToast('초대 코드 재발급에 실패했습니다.', 'error');
        }
    };

    // 기관 서비스 해지 (자발적 탈퇴) — Admin SDK callable 호출
    // 성공 시 본인 user 문서가 삭제되며 auth/org 리스너가 자동 로그아웃·초대코드 화면으로 이동시킨다.
    const handleWithdraw = async (reason: WithdrawReason, reasonDetail?: string) => {
        if (!orgId) return;
        setWithdrawing(true);
        try {
            const withdrawOrganization = httpsCallable(getFunctions(undefined, 'asia-northeast3'), 'withdrawOrganization');
            await withdrawOrganization({ organizationId: orgId, reason, reasonDetail });
            showToast('서비스가 해지되었습니다.', 'success');
            // 본인 문서 삭제로 인한 자동 로그아웃까지 약간의 시간차가 있을 수 있어 별도 후처리는 하지 않는다.
        } catch (err) {
            console.error('서비스 해지 실패:', err);
            showToast('서비스 해지에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
            setWithdrawing(false);
        }
    };

    return {
        org, orgId, loading, saving, withdrawing,
        form, setForm,
        // 핸들러
        handleSave, handleRegenCode, handlePhoneChange, handleWithdraw,
        formatDate: formatDateKr,
    };
}
