/**
 * adminAlertMail — 운영자에게 가는 장애·보안 경보 메일
 *
 * 운영 결정(OPERATIONS.md, 2026-11-21)으로 Discord·Sentry를 비워 두면 captureError·captureWarning·
 * sendDiscordAlert가 모두 조용히 빠진다. 그러면 백업 실패·기관 파기 실패·superAdmin 승격 같은
 * "사람이 꼭 알아야 하는 것"이 아무에게도 닿지 않는다. 이미 처리방침에 있는 Gmail 발송으로
 * 그 공백을 메운다 — Discord가 켜져 있어도 병행해서 보낸다(메일이 운영자가 늘 보는 곳이다).
 *
 * 받는 사람은 notifyNewApplication과 같다: ADMIN_NOTIFICATION_EMAIL, 없으면 발신 계정.
 * 이 모듈을 부르는 함수는 `secrets: [GMAIL_APP_PASSWORD]`를 선언해야 한다(core/params.ts).
 *
 * 쓰는 곳은 "드물고 중요한 것"으로 한정한다. 콜러블 오류마다 부르면 메일함이 무뎌진다.
 * 발송 실패는 던지지 않는다 — 경보 실패가 본 작업(배치·트리거)을 깨면 안 된다.
 */
import { createGmailTransporter, isGmailConfigured, systemMailFrom } from "./mailer";
import { escapeHtml } from "../utils/helpers";

export interface AdminAlertMail {
    /** 제목 — 앞에 `[재물조사]`가 붙는다 */
    subject: string;
    /** 본문 줄 — 각 줄을 escape해 그대로 보여 준다(여러 줄 오류 메시지도 줄바꿈이 산다) */
    lines: string[];
    /** 관리 화면 바로가기(선택) */
    link?: { href: string; label: string };
}

/** 받는 사람 — 설정이 없으면 null */
export function adminAlertRecipient(): string | null {
    return process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER || null;
}

/** 메일 본문 HTML. 값은 전부 escape한다. */
export function buildAdminAlertHtml({ subject, lines, link }: AdminAlertMail): string {
    const body = lines.map((l) => escapeHtml(l)).join("\n");
    const button = link
        ? `<p style="margin-top:16px;"><a href="${escapeHtml(link.href)}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">${escapeHtml(link.label)}</a></p>`
        : "";
    return [
        `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;padding:16px;">`,
        `<h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(subject)}</h2>`,
        `<pre style="white-space:pre-wrap;word-break:break-all;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;font-size:13px;">${body}</pre>`,
        button,
        `<p style="color:#94A3B8;font-size:12px;margin-top:16px;">재물조사 시스템이 자동으로 보낸 운영 경보입니다.</p>`,
        `</div>`,
    ].join("");
}

/** 운영 경보 메일 1통 — 보냈으면 true. 설정이 없거나 실패하면 로그만 남기고 false */
export async function sendAdminAlertMail(mail: AdminAlertMail): Promise<boolean> {
    const to = adminAlertRecipient();
    if (!isGmailConfigured() || !to) {
        console.error(`[adminAlertMail] Gmail 설정이 없어 운영 경보를 보내지 못함: ${mail.subject}`);
        return false;
    }
    try {
        await createGmailTransporter().sendMail({
            from: systemMailFrom(),
            to,
            subject: `[재물조사] ${mail.subject}`,
            html: buildAdminAlertHtml(mail),
        });
        return true;
    } catch (e) {
        console.error(`[adminAlertMail] 운영 경보 메일 발송 실패: ${mail.subject}`, (e as Error).message);
        return false;
    }
}
