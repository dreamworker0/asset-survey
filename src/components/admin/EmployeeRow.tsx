/**
 * EmployeeRow — 직원 목록의 한 줄 (2026-11-23)
 *
 * 가입 대기 직원이 수십 명이면 사람마다 큰 카드(같은 안내 문구·팀 고르기·버튼)가 반복돼 목록이 끝없이 길었다.
 * 한 줄에 이름·이메일·팀·상태만 두고, 자세한 조작(이름 고치기·역할·팀·비활성화·삭제)은 [고치기] 창
 * (예전 카드 EmployeeListItem을 그대로 쓴다)에서 한다. 줄 앞 상자로 여러 명을 골라 한꺼번에 처리한다.
 */
import type { UnifiedMember } from '../../types';

const STATUS: Record<UnifiedMember['memberStatus'], { label: string; cls: string }> = {
    active: { label: '활성', cls: 'badge-success' },
    pending: { label: '가입 대기', cls: 'badge-warning' },
    disabled: { label: '비활성', cls: 'badge-danger' },
};
const ROLE_LABEL: Record<string, string> = { admin: '관리자', employee: '직원' };

export default function EmployeeRow({ member, checked, onCheck, teamName, isSelf, onEdit }: {
    member: UnifiedMember;
    checked: boolean;
    onCheck: (on: boolean) => void;
    teamName: (id: string | null | undefined) => string | null;
    isSelf: boolean;
    onEdit: () => void;
}) {
    const who = member.name || member.email || '이름 없음';
    const team = teamName((member.original as { teamId?: string | null }).teamId ?? null);
    const status = STATUS[member.memberStatus];
    // 가입 대기 직원에게 초대 메일을 보낸 날(2026-11-23)
    const invitedAt = member.memberStatus === 'pending'
        ? (member.original as { invitedAt?: { toDate?: () => Date } | null }).invitedAt?.toDate?.()
        : undefined;
    const invitedText = invitedAt ? `${invitedAt.getMonth() + 1}/${invitedAt.getDate()}` : null;
    return (
        <li className={`flex items-center gap-1 pr-2 ${checked ? 'bg-primary-50/70 dark:bg-primary-900/20' : ''}`}>
            <label className="w-12 h-12 flex items-center justify-center flex-shrink-0 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={checked} onChange={(e) => onCheck(e.target.checked)}
                    aria-label={`${who} 고르기`} />
            </label>
            <div className="flex-1 min-w-0 py-2">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium text-surface-900 dark:text-surface-100 break-keep">{who}</span>
                    {isSelf && <span className="text-xs text-surface-600 dark:text-surface-400">(나)</span>}
                    <span className={`${status.cls} whitespace-nowrap`}>{status.label}</span>
                    {member.role === 'admin' && <span className="badge-neutral whitespace-nowrap">{ROLE_LABEL.admin}</span>}
                </p>
                <p className="text-xs text-surface-600 dark:text-surface-400 break-all">
                    {member.email || '이메일 없음'}
                    <span className="break-keep"> · {team ? `👥 ${team}` : '팀 없음'}</span>
                    {invitedText && <span className="break-keep"> · ✉️ {invitedText} 초대 메일 보냄</span>}
                </p>
            </div>
            <button type="button" onClick={onEdit} className="btn-secondary btn-sm min-h-[48px] px-3 flex-shrink-0" aria-label={`${who} 고치기`}>
                고치기
            </button>
        </li>
    );
}
