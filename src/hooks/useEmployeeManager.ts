/**
 * useEmployeeManager — 직원 관리 상태 + CRUD 로직
 * EmployeeManager에서 추출된 커스텀 훅
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import useRetry from './useRetry';
import {
    getOrganizationMembers, getOrganization, regenerateInviteCode, updateUser, getPreRegisteredEmployees, addPreRegisteredEmployee,
    deletePreRegisteredEmployee, updatePreRegisteredTeam, recheckDeniedTarget,
    updateUsersTeamBatch, addPreRegisteredBatch, updatePreRegisteredTeamBatch, deletePreRegisteredBatch,
    sendInviteEmails,
} from '../lib/firestore';
import type { PreRegisteredEmployee } from '../lib/firestore/preRegistered';
import { invalidateCache } from '../lib/firestore/cache';
import type { User, UserRole, MemberStatus, UnifiedMember } from '../types/user';
import type { Organization } from '../types/organization';
import { captureError } from '../lib/monitoring';
import { APP_URL } from '../lib/constants';

/**
 * 대상 사용자가 이미 기관에 없어서 거부된 경우인지 판별한다.
 *
 * 직원 목록은 마운트 시 한 번만 읽어 오므로(실시간 구독이 아니다), 화면을 열어 둔 사이에
 * 직원이 스스로 기관을 탈퇴하거나(소속 비움) 다른 관리자·슈퍼관리자가 계정을 지우면(문서 삭제)
 * **이미 빠진 계정의 행이 남는다.** 그 행의 작업은 서버가 규칙대로 거부한다 — 코드 결함이 아니라
 * 목록이 낡았다는 신호다. 문서가 지워졌으면 not-found로 오고, 문서가 남아 소속만 비워졌으면
 * permission-denied로 오는데 후자는 recheckDeniedTarget이 대상을 다시 읽어 not-found로 바꿔 온다
 * (updateUser는 데이터 계층에서, 콜러블은 아래 callTargetCallable에서).
 *
 * 메시지가 아니라 **코드로 판별한다.** 같은 한국어 문구를 sendAdminNotice는
 * permission-denied(호출자 문서 없음)로도 던지는데, 그건 성격이 다른 실패라 함께 묶으면
 * 진짜 문제를 예상된 결과로 오인한다.
 */
function isTargetUserMissing(err: unknown): boolean {
    const code = (err as { code?: unknown })?.code;
    if (typeof code !== 'string') return false;
    return code === 'not-found' || code === 'functions/not-found';
}

export default function useEmployeeManager() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { runWithRetry } = useRetry();
    const [employees, setEmployees] = useState<User[]>([]);
    const [disabledEmployees, setDisabledEmployees] = useState<User[]>([]);
    const [preRegisteredEmployees, setPreRegisteredEmployees] = useState<PreRegisteredEmployee[]>([]);
    const [organization, setOrganization] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newEmployee, setNewEmployee] = useState({ name: '', email: '', teamId: '' });
    const [copiedType, setCopiedType] = useState<'none' | 'link' | 'code'>('none');
    const [regenerating, setRegenerating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ name: '', email: '' });
    const [searchQuery, setSearchQuery] = useState('');
    /** 팀 거르기 — 'all' / 'none'(팀 없음) / 팀 ID (2026-11-22) */
    const [teamFilter, setTeamFilter] = useState<string>('all');
    /**
     * 상태로 나눠 보기(2026-11-23) — 가입 대기 직원이 수십 명이면 목록이 끝없이 길었다.
     * null = 아직 고르지 않음(활성 직원이 있으면 '활성', 없으면 '전체'로 본다)
     */
    const [statusFilter, setStatusFilter] = useState<'all' | MemberStatus | null>(null);

    const orgId = userData?.organizationId;

    const fetchData = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            // 직원 관리 화면은 비활성화/영구삭제(Cloud Function 경유) 직후에도 최신 목록이
            // 보여야 하므로, 5분 TTL 캐시를 무효화하고 항상 서버에서 새로 읽는다.
            invalidateCache(`members:${orgId}`);
            const [members, org, preReg] = await Promise.all([
                getOrganizationMembers(orgId),
                getOrganization(orgId),
                getPreRegisteredEmployees(orgId),
            ]);
            const nonSuperAdmins = members.filter((m) => m.role !== 'superAdmin');
            const activeMembers = nonSuperAdmins.filter((m) => m.status !== 'disabled');
            const disabledMembers = nonSuperAdmins.filter((m) => m.status === 'disabled');
            setEmployees(
                activeMembers.sort((a, b) => {
                    if (a.role === 'admin' && b.role !== 'admin') return -1;
                    if (a.role !== 'admin' && b.role === 'admin') return 1;
                    return (a.name || '').localeCompare(b.name || '');
                }) as User[]
            );
            setDisabledEmployees(
                disabledMembers.sort((a, b) => (a.name || '').localeCompare(b.name || '')) as User[]
            );
            setPreRegisteredEmployees(preReg);
            setOrganization(org as Organization | null);
        } catch (err) {
            console.error('데이터 로드 실패:', err);
            captureError(err, { context: 'useEmployeeManager.fetchData', orgId });
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleAddEmployee = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!newEmployee.name.trim()) return;
        await runWithRetry('add-emp', async () => {
            await addPreRegisteredEmployee(orgId!, newEmployee.name.trim(), newEmployee.email.trim().toLowerCase(), newEmployee.teamId || null);
            // 같은 팀 직원을 이어서 넣기 쉽게 팀은 남긴다
            setNewEmployee((prev) => ({ name: '', email: '', teamId: prev.teamId }));
            setShowAddForm(false);
            await fetchData();
        }, { errorMessage: '직원 추가에 실패했습니다.' });
    };

    const handleCopyInviteCode = async (type: 'link' | 'code' = 'link') => {
        if (!organization?.inviteCode) return;
        const textToCopy = type === 'link' 
            ? `${APP_URL}?code=${organization.inviteCode}`
            : organization.inviteCode;
            
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopiedType(type);
            setTimeout(() => setCopiedType('none'), 2000);
            // '복사됨' 글자는 2초 뒤 사라지고 화면 낭독기에도 알려지지 않아 알림을 함께 띄운다
            showToast(type === 'link' ? '초대 링크를 복사했어요. 직원에게 보내 주세요.' : '기관 코드를 복사했어요.', 'success');
        } catch {
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setCopiedType(type);
            setTimeout(() => setCopiedType('none'), 2000);
        }
    };

    const handleRegenerateCode = async () => {
        if (!await confirm({ message: '초대 코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.', confirmColor: 'warning' })) return;
        setRegenerating(true);
        await runWithRetry('regen-code', async () => {
            const newCode = await regenerateInviteCode(orgId!);
            setOrganization(prev => prev ? ({ ...prev, inviteCode: newCode }) : null);
        }, { errorMessage: '코드 재발급에 실패했습니다.' });
        setRegenerating(false);
    };

    const handleEditEmployee = (emp: User) => {
        setEditingId(emp.id);
        setEditForm({ name: emp.name || '', email: emp.email || '' });
    };

    /**
     * 이미 사라진 직원 행에서 실패했을 때의 공통 처리.
     *
     * 안내 문구를 띄우고 목록을 다시 읽어 유령 행을 걷어낸다. 오류 보고도 생략한다 —
     * 서버가 규칙대로 거부한 예상된 결과이지 코드 결함이 아니다(isTargetUserMissing 주석 참고).
     * 대상이 같은 기관에 그대로 있는데 거부된 permission-denied는 여기 걸리지 않고 지금처럼 보고된다.
     *
     * @param onOtherError not-found가 아닌 실패의 처리. 직접 처리했으면 true를 반환한다.
     */
    const staleRowGuard = (onOtherError?: (err: unknown) => boolean | void) => ({
        shouldReport: (err: unknown) => !isTargetUserMissing(err),
        onError: (err: unknown) => {
            if (isTargetUserMissing(err)) {
                showToast('이미 탈퇴하거나 삭제된 직원입니다. 목록을 새로 고칩니다.', 'warning');
                fetchData(); // 사라진 행을 목록에서 걷어낸다 — 그대로 두면 같은 실패를 반복한다
                return true;
            }
            return onOtherError?.(err);
        },
    });

    /**
     * 대상 직원에 대한 콜러블을 호출한다. permission-denied면 대상을 다시 읽어, 이미 기관에서
     * 빠진 경우 not-found로 바꿔 던진다 — 서버는 이 경우 "다른 기관의 직원을 …할 수 없습니다"로
     * 거부하는데, 열어 둔 목록 입장에서는 탈퇴한 직원이라 그 문구가 오해를 부른다.
     */
    const callTargetCallable = async (name: 'disableUser' | 'enableUser' | 'deleteUserPermanently', uid: string) => {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const functions = getFunctions(undefined, 'asia-northeast3');
        try {
            await httpsCallable(functions, name)({ uid });
        } catch (err) {
            throw await recheckDeniedTarget(err, uid, orgId);
        }
    };

    /**
     * 콜러블이 규칙대로 거부한 사유(다른 기관 직원·상위 권한 계정 등)는 서버 문구가 가장
     * 정확하므로 그대로 보여준다. 네트워크 실패는 useRetry의 재시도 흐름에 맡긴다.
     */
    const showServerMessage = (err: unknown) => {
        const message = err instanceof Error ? err.message : null;
        if (message && !message.toLowerCase().includes('network')) {
            showToast(message, 'error');
            return true;
        }
    };

    const handleSaveEdit = async (empId: string) => {
        await runWithRetry(`save-edit-${empId}`, async () => {
            await updateUser(empId, { name: editForm.name.trim() });
            setEditingId(null);
            await fetchData();
        }, { errorMessage: '수정에 실패했습니다.', ...staleRowGuard() });
    };

    const handleDeleteEmployee = async (emp: User) => {
        // 안전 검증: 세션 유저 정보가 아직 로드되지 않은 경우 동작 차단
        if (!userData?.id) {
            showToast('사용자 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
            return;
        }
        // 자기 자신 삭제 금지
        if (emp.id === userData.id) {
            showToast('자기 자신은 비활성화할 수 없습니다.', 'warning');
            return;
        }
        if (!await confirm({ message: `${emp.name || emp.email} 직원을 비활성화하시겠습니까?\n\n비활성 직원은 앱 이용이 차단됩니다.`, confirmColor: 'danger' })) return;
        
        await runWithRetry(`disable-emp-${emp.id}`, async () => {
            await callTargetCallable('disableUser', emp.id);
            showToast('직원이 비활성화되었습니다.', 'success');
            await fetchData();
        }, {
            errorMessage: '비활성화에 실패했습니다.',
            useBackoff: true,
            ...staleRowGuard(showServerMessage),
        });
    };

    const handleDeletePermanently = async (emp: User) => {
        if (!userData?.id) {
            showToast('사용자 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
            return;
        }
        // 되돌릴 수 없는 작업 — 직원 이름(없으면 이메일)을 직접 입력받아 확인
        const confirmKey = (emp.name || '').trim() || emp.email || '';
        const typed = await confirm({
            type: 'input',
            title: '직원 완전 삭제',
            message: `${emp.name || emp.email} 직원의 계정을 영구 삭제합니다.\n\n• 계정이 삭제되며 되돌릴 수 없습니다.\n• 이 직원이 남긴 재물조사(스캔) 기록과 변경 이력은 그대로 남습니다.\n\n삭제하려면 아래에 "${confirmKey}"를 입력하세요.`,
            inputPlaceholder: confirmKey,
            confirmColor: 'danger',
            confirmText: '완전 삭제',
            cancelText: '취소',
        });
        if (typed === false || typed === null) return;
        if (typeof typed !== 'string' || typed.trim() !== confirmKey) {
            showToast('입력한 내용이 일치하지 않아 삭제를 취소했습니다.', 'warning');
            return;
        }

        await runWithRetry(`hard-delete-emp-${emp.id}`, async () => {
            await callTargetCallable('deleteUserPermanently', emp.id);
            showToast('직원 계정이 완전히 삭제되었습니다.', 'success');
            await fetchData();
        }, {
            errorMessage: '완전 삭제에 실패했습니다.',
            ...staleRowGuard(showServerMessage),
        });
    };

    const handleRestoreEmployee = async (emp: User) => {
        if (!await confirm({ message: `${emp.name || emp.email} 직원을 다시 활성화하시겠습니까?` })) return;
        // 서버 콜러블로 한다 — 비활성화(disableUser)가 막은 Auth 계정은 Admin SDK로만 풀 수 있다.
        // 예전엔 문서 status만 고쳐, 목록은 '활성'인데 직원 로그인이 auth/user-disabled로 막혔다(2026-11-18).
        await runWithRetry(`restore-emp-${emp.id}`, async () => {
            await callTargetCallable('enableUser', emp.id);
            showToast('직원이 활성화되었습니다.', 'success');
            await fetchData();
        }, {
            errorMessage: '활성화에 실패했습니다.',
            useBackoff: true,
            ...staleRowGuard(showServerMessage),
        });
    };

    const handleChangeRole = async (emp: User, newRole: UserRole) => {
        // 자기 자신 역할 변경 금지
        if (emp.id === userData?.id) {
            showToast('자신의 역할은 변경할 수 없습니다.', 'warning');
            await fetchData(); // select 원래 값으로 복원
            return;
        }
        // 마지막 admin 강등 금지
        if (newRole === 'employee' && emp.role === 'admin') {
            const adminCount = employees.filter(e => e.role === 'admin').length;
            if (adminCount <= 1) {
                showToast('관리자는 최소 1명이 있어야 합니다.', 'warning');
                await fetchData(); // select 원래 값으로 복원
                return;
            }
        }
        // 휴대폰에서 잘못 눌러 관리자 권한이 생기지 않게 올릴 때는 묻는다(2026-11-22)
        if (newRole === 'admin' && emp.role !== 'admin') {
            const ok = await confirm({
                title: '관리자로 바꿀까요?',
                message: `${emp.name || emp.email || '이 직원'}님이 재물·직원·조사를 모두 관리할 수 있게 됩니다.`,
                confirmText: '관리자로 바꾸기', confirmColor: 'warning',
            });
            if (!ok) { await fetchData(); return; }
        }
        await runWithRetry(`change-role-${emp.id}`, async () => {
            await updateUser(emp.id, { role: newRole });
            await fetchData();
        }, { errorMessage: '역할 변경에 실패했습니다.', ...staleRowGuard() });
    };

    /** 소속 팀 바꾸기(2026-11-22) — 공간 담당 권한이 팀으로도 오므로 관리자만 바꾼다(Rules가 본인 변경을 막는다) */
    const handleChangeTeam = async (emp: User, teamId: string) => {
        await runWithRetry(`change-team-${emp.id}`, async () => {
            await updateUser(emp.id, { teamId: teamId || null });
            setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, teamId: teamId || null } : e)));
            showToast('팀을 바꿨습니다.', 'success');
        }, { errorMessage: '팀을 바꾸지 못했습니다.', ...staleRowGuard() });
    };

    /** 가입 대기(사전 등록) 직원의 팀 바꾸기 — 가입하면 이 팀으로 들어간다 */
    const handleChangePendingTeam = async (preRegId: string, teamId: string) => {
        if (!orgId) return;
        await runWithRetry(`change-preteam-${preRegId}`, async () => {
            await updatePreRegisteredTeam(orgId, preRegId, teamId || null);
            setPreRegisteredEmployees((prev) => prev.map((p) => (p.id === preRegId ? { ...p, teamId: teamId || null } : p)));
            showToast('팀을 바꿨습니다. 가입하면 이 팀으로 들어갑니다.', 'success');
        }, { errorMessage: '팀을 바꾸지 못했습니다.' });
    };

    const handleDeletePreRegistered = async (preRegId: string) => {
        if (!orgId) return;
        if (!await confirm({ message: '사전 등록을 취소하시겠습니까?', confirmColor: 'warning' })) return;
        await runWithRetry(`del-prereg-${preRegId}`, async () => {
            await deletePreRegisteredEmployee(orgId, preRegId);
            showToast('사전 등록이 취소되었습니다.', 'success');
            await fetchData();
        }, { errorMessage: '삭제에 실패했습니다.' });
    };

    const filteredEmployees = employees.filter(emp => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return emp.name?.toLowerCase().includes(q) || emp.email?.toLowerCase().includes(q);
    });

    const admins = employees.filter(e => e.role === 'admin');
    const regularEmployees = employees.filter(e => e.role === 'employee');

    // ── 통합 목록: 활성 + 가입대기 + 비활성 ──
    // 타입은 src/types/user.ts가 단일 원본이다 (EmployeeListItem과 공유).

    const unifiedList: UnifiedMember[] = [
        // 1) 활성 직원 — 관리자 먼저, 이름순
        ...employees.map(emp => ({
            id: emp.id,
            name: emp.name || '',
            email: emp.email || '',
            role: emp.role,
            memberStatus: 'active' as MemberStatus,
            original: emp,
        })),
        // 2) 가입 대기
        ...preRegisteredEmployees.map(pre => ({
            id: pre.id,
            name: pre.name || '',
            email: pre.email || '',
            role: undefined,
            memberStatus: 'pending' as MemberStatus,
            original: pre as User,
        })),
        // 3) 비활성 직원
        ...disabledEmployees.map(emp => ({
            id: emp.id,
            name: emp.name || '',
            email: emp.email || '',
            role: emp.role,
            memberStatus: 'disabled' as MemberStatus,
            original: emp,
        })),
    ];

    const effectiveStatus: 'all' | MemberStatus = statusFilter ?? (employees.length > 0 ? 'active' : 'all');

    // 통합 검색 + 팀 거르기 + 상태
    const filteredUnifiedList = unifiedList.filter(m => {
        if (effectiveStatus !== 'all' && m.memberStatus !== effectiveStatus) return false;
        const team = (m.original as { teamId?: string | null }).teamId ?? null;
        if (teamFilter === 'none' ? team !== null : teamFilter !== 'all' && team !== teamFilter) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    });

    // 상태별 통계
    const stats = {
        total: employees.length + preRegisteredEmployees.length + disabledEmployees.length,
        active: employees.length,
        pending: preRegisteredEmployees.length,
        disabled: disabledEmployees.length,
        admins: admins.length,
        regularEmployees: regularEmployees.length,
    };

    // ── 여러 명 한꺼번에(2026-11-23) ──

    /** 고른 직원들의 팀을 한꺼번에 — 활성은 직원 문서, 가입 대기는 사전 등록 문서. 비활성은 건너뛴다 */
    const bulkAssignTeam = async (members: UnifiedMember[], teamId: string | null): Promise<boolean> => {
        if (!orgId) return false;
        const active = members.filter((m) => m.memberStatus === 'active').map((m) => m.id);
        const pending = members.filter((m) => m.memberStatus === 'pending').map((m) => m.id);
        const skipped = members.length - active.length - pending.length;
        if (active.length + pending.length === 0) {
            showToast('팀을 바꿀 수 있는 직원이 없습니다(비활성 직원은 건너뜁니다).', 'info');
            return false;
        }
        try {
            if (active.length > 0) await updateUsersTeamBatch(active, teamId);
            if (pending.length > 0) await updatePreRegisteredTeamBatch(orgId, pending, teamId);
            showToast(`${active.length + pending.length}명의 팀을 ${teamId ? '바꿨습니다' : '비웠습니다'}.${skipped > 0 ? ` (비활성 ${skipped}명은 건너뜀)` : ''}`, 'success');
            await fetchData();
            return true;
        } catch {
            showToast('팀을 바꾸지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
            await fetchData(); // 일부만 바뀌었을 수 있어 다시 읽는다
            return false;
        }
    };

    /** 고른 가입 대기 직원들의 사전 등록을 한꺼번에 취소 — 이미 가입한 직원은 여기서 지우지 않는다 */
    const bulkDeletePending = async (ids: string[]): Promise<boolean> => {
        if (!orgId || ids.length === 0) return false;
        const names = preRegisteredEmployees.filter((p) => ids.includes(p.id)).map((p) => p.name || p.email);
        const ok = await confirm({
            title: `가입 대기 ${ids.length}명의 사전 등록을 취소할까요?`,
            message: `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 외 ${names.length - 5}명` : ''}\n아직 가입하지 않은 사람들이라 계정은 없습니다. 나중에 다시 등록하거나 초대 링크로 가입하면 됩니다.`,
            confirmText: '등록 취소',
            confirmColor: 'danger',
        });
        if (!ok) return false;
        try {
            await deletePreRegisteredBatch(orgId, ids);
            showToast(`${ids.length}명의 사전 등록을 취소했습니다.`, 'success');
            await fetchData();
            return true;
        } catch {
            showToast('사전 등록을 취소하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
            await fetchData();
            return false;
        }
    };

    /**
     * 가입 대기 직원에게 초대 메일 보내기(2026-11-23).
     * 미리 등록만 하고 링크를 따로 보내지 않아 아무도 가입하지 않은 일이 있었다. 메일에는 가입 링크와
     * "이 주소의 구글 계정으로 로그인" 안내가 들어간다. 10분 안에 이미 보낸 사람은 서버가 건너뛴다.
     */
    const bulkSendInvites = async (ids: string[]): Promise<boolean> => {
        if (!orgId || ids.length === 0) return false;
        const picked = preRegisteredEmployees.filter((p) => ids.includes(p.id));
        const names = picked.map((p) => p.name || p.email);
        const again = picked.filter((p) => p.invitedAt).length;
        const ok = await confirm({
            title: `${ids.length}명에게 초대 메일을 보낼까요?`,
            message: `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 외 ${names.length - 5}명` : ''}\n`
                + '미리 등록한 이메일로 가입 링크를 보냅니다. 받은 사람은 그 이메일의 구글 계정으로 로그인하면 바로 가입됩니다.'
                + (again > 0 ? `\n${again}명은 전에 보낸 적이 있습니다(10분 안에 보낸 사람은 건너뜁니다).` : ''),
            confirmText: '메일 보내기',
        });
        if (!ok) return false;
        try {
            const r = await sendInviteEmails(orgId, ids);
            const extra = [r.skipped > 0 ? `${r.skipped}명은 방금 보내서 건너뜀` : '', r.failed > 0 ? `${r.failed}명 실패` : ''].filter(Boolean).join(', ');
            if (r.sent === 0 && r.failed > 0) {
                showToast(`초대 메일을 보내지 못했습니다(${extra}). 잠시 뒤 다시 누르거나 초대 링크를 복사해 보내 주세요.`, 'error');
            } else {
                showToast(`${r.sent}명에게 초대 메일을 보냈습니다.${extra ? ` (${extra})` : ''}`, r.failed > 0 ? 'warning' : 'success');
            }
            await fetchData();
            return r.sent > 0;
        } catch (err) {
            const code = (err as { code?: string })?.code ?? '';
            const msg = (err as { message?: string })?.message ?? '';
            showToast(code.endsWith('failed-precondition') || code.endsWith('resource-exhausted') ? msg
                : '초대 메일을 보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
            return false;
        }
    };

    /**
     * 여러 명 한꺼번에 미리 등록 — 한 줄에 "이름, 이메일, 팀"(쉼표·탭, 팀은 생략 가능).
     * 엑셀에서 세 칸을 복사하면 탭으로 나뉘어 온다. 팀 이름이 없거나 모르는 팀이면 기본 팀을 쓴다.
     * 이메일 형식이 틀렸거나 이미 등록·가입한 이메일, 같은 목록 안의 겹친 이메일은 건너뛰고 알린다.
     * @returns 등록한 수
     */
    const addPreRegisteredMany = async (
        text: string, defaultTeamId: string | null, findTeamId: (name: string) => string | null,
    ): Promise<number> => {
        if (!orgId) return 0;
        const known = new Set([
            ...employees.map((e) => (e.email || '').toLowerCase()),
            ...disabledEmployees.map((e) => (e.email || '').toLowerCase()),
            ...preRegisteredEmployees.map((p) => (p.email || '').toLowerCase()),
        ].filter(Boolean));
        const rows: Array<{ name: string; email: string; teamId: string | null }> = [];
        const problems: string[] = [];
        let unknownTeam = 0;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const [name = '', email = '', team = ''] = line.split(/\t|,/).map((x) => x.trim());
            const mail = email.toLowerCase();
            // 머리글 줄(이름, 이메일, 팀)은 조용히 건너뛴다
            if (name === '이름' && /메일/.test(email)) continue;
            if (!name) { problems.push(`${line}: 이름이 없습니다`); continue; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { problems.push(`${name}: 이메일 형식이 아닙니다`); continue; }
            if (known.has(mail)) { problems.push(`${name}: 이미 등록·가입한 이메일입니다`); continue; }
            known.add(mail);
            let teamId = defaultTeamId;
            if (team) {
                const found = findTeamId(team);
                if (found) teamId = found; else unknownTeam++;
            }
            rows.push({ name, email: mail, teamId });
        }
        if (rows.length === 0) {
            showToast(problems.length > 0 ? `등록할 직원이 없습니다. ${problems.slice(0, 2).join(' / ')}` : '한 줄에 "이름, 이메일"을 적어 주세요.', 'warning');
            return 0;
        }
        try {
            await addPreRegisteredBatch(orgId, rows);
            const notes = [
                problems.length > 0 ? `${problems.length}줄은 건너뜀(${problems.slice(0, 2).join(' / ')}${problems.length > 2 ? ' …' : ''})` : '',
                unknownTeam > 0 ? `모르는 팀 이름 ${unknownTeam}줄은 기본 팀으로 넣음` : '',
            ].filter(Boolean).join(' · ');
            showToast(`${rows.length}명을 미리 등록했습니다.${notes ? ` ${notes}` : ''}`, notes ? 'warning' : 'success');
            setStatusFilter('pending'); // 방금 넣은 사람들을 바로 보이게
            await fetchData();
            return rows.length;
        } catch {
            showToast('직원을 등록하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'error');
            return 0;
        }
    };

    return {
        statusFilter: effectiveStatus, setStatusFilter,
        bulkAssignTeam, bulkDeletePending, addPreRegisteredMany, bulkSendInvites,
        employees, disabledEmployees, preRegisteredEmployees, organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        copiedType, regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery, teamFilter, setTeamFilter,
        filteredEmployees, admins, regularEmployees,
        unifiedList, filteredUnifiedList, stats,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
        handleDeletePreRegistered, handleRestoreEmployee, handleDeletePermanently, handleChangeTeam, handleChangePendingTeam,
    };
}
