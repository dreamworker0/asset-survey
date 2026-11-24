// @vitest-environment node
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

/** compat SDK의 서버 시각 — Rules가 `== request.time`으로 확인하는 필드에 쓴다 */
const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();

// Firebase 에뮬레이터 프로젝트 ID — demo- 접두사는 에뮬레이터 전용(실제 프로젝트에 닿지 않음)임을 보장한다
const PROJECT_ID = 'demo-asset-survey';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules for Multi-Tenant Isolation', () => {
  beforeAll(async () => {
    // 에뮬레이터 환경 초기화 (firestore.rules 읽어오기)
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  beforeEach(async () => {
    // 각 테스트 단위마다 Firestore 초기화
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    // 모든 테스트가 끝나면 리소스 정리
    await testEnv.cleanup();
  });

  // Mock Contexts
  const setupContext = (uid: string, token: Record<string, unknown>) => testEnv.authenticatedContext(uid, token);
  const _unauthContext = () => testEnv.unauthenticatedContext();

  

  it('7. 알림(notifications) 생성은 superAdmin 전용, 조회는 본인 대상만', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('notifications').doc('noti_A').set({
        targetUid: 'user_A', organizationId: 'org-A', type: 'approval', message: '승인 알림',
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // 일반 사용자는 같은 조직 UID 대상이라도 알림 생성 불가 (superAdmin 전용 — 알림 주입 차단)
    await assertFails(orgAMemberDb.collection('notifications').doc('noti_evil').set({
      targetUid: 'user_A2', organizationId: 'org-A', message: '피싱 텍스트 주입 시도',
    }));

    // superAdmin은 생성 가능 (승인/반려 알림 화면)
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    await assertSucceeds(superDb.collection('notifications').doc('noti_ok').set({
      targetUid: 'user_A', organizationId: 'org-A', message: '기관 승인 완료',
    }));

    // 본인 대상 알림은 조회 가능, 타인 알림은 차단
    await assertSucceeds(orgAMemberDb.collection('notifications').doc('noti_A').get());
    const orgBMemberDb = setupContext('user_B', { role: 'member', orgId: 'org-B' }).firestore();
    await assertFails(orgBMemberDb.collection('notifications').doc('noti_A').get());
  });

  // 기대 동작 표 #10 · #12 · #13
  it('8. 관리자의 organizationId 변경(교차 테넌트 권한상승) 차단', async () => {
    // given: 기관 A의 admin과 소속 직원 문서 존재
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('admin_A').set({
        email: 'admin_a@x.com', role: 'admin', organizationId: 'org-A',
      });
      await db.collection('users').doc('user_A2').set({
        email: 'user_a2@x.com', role: 'employee', organizationId: 'org-A',
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    // admin이 자기 문서의 org를 타 기관으로 변경(자기 권한상승) → 차단
    await assertFails(adminADb.collection('users').doc('admin_A').update({
      organizationId: 'org-B',
    }));

    // admin이 소속 직원을 타 기관으로 이동 → 차단
    await assertFails(adminADb.collection('users').doc('user_A2').update({
      organizationId: 'org-B',
    }));

    // 정상: admin이 소속 직원 role을 변경(org 불변)하는 것은 허용
    await assertSucceeds(adminADb.collection('users').doc('user_A2').update({
      role: 'admin',
    }));
  });

  it('10. 기관(organizations) 클라이언트 직접 생성 차단 (승인 절차 우회 방지)', async () => {
    // 일반 로그인 사용자가 status:approved·inviteCode를 임의 지정해 승인된 기관을 생성 시도 → 차단
    const memberDb = setupContext('user_X', { role: 'employee' }).firestore();
    await assertFails(memberDb.collection('organizations').doc('org_evil').set({
      name: '가짜기관', applicantUid: 'user_X', status: 'approved', inviteCode: 'ABC123',
    }));

    // superAdmin은 생성 가능
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    await assertSucceeds(superDb.collection('organizations').doc('org_ok').set({
      name: '정상기관', applicantUid: 'super_1', status: 'pending',
    }));
  });

  it('10-1. 기관 동의 기록(consent) 클라이언트 변경 차단 — 위탁 계약 입증 자료 보호', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('organizations').doc('org-A').set({
        name: '기관A', applicantUid: 'admin_A', status: 'approved',
        consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
      });
      // 동의 기록이 없는 레거시 기관 — 클라이언트가 뒤늦게 심는 것도 막아야 한다
      await context.firestore().collection('organizations').doc('org-legacy').set({
        name: '레거시기관', applicantUid: 'admin_L', status: 'approved',
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    const adminLDb = setupContext('admin_L', { role: 'admin', orgId: 'org-legacy' }).firestore();

    // 기관 관리자·superAdmin 모두 동의 기록 변경·삭제 차단
    await assertFails(adminADb.collection('organizations').doc('org-A').update({
      consent: { terms: true, privacy: true, termsVersion: '2099-01-01', privacyVersion: '2099-01-01' },
    }));
    await assertFails(superDb.collection('organizations').doc('org-A').update({
      consent: { terms: false, privacy: false, termsVersion: 'x', privacyVersion: 'x' },
    }));

    // 레거시 기관에 동의 기록을 클라이언트가 신설하는 것도 차단 (서버 경로만 허용)
    await assertFails(adminLDb.collection('organizations').doc('org-legacy').update({
      consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
    }));

    // 정상: 동의 기록을 건드리지 않는 다른 필드 수정은 허용
    await assertSucceeds(adminADb.collection('organizations').doc('org-A').update({ hipassEnabled: false }));

    // 신청자 본인 수정 분기는 2026-11-24 뺐다(신청은 서버가 applicantUid "anonymous-app"으로 만든다).
    // applicantUid가 실제 uid와 같은 승인 전 기관이라도 신청자는 아무 필드도 쓸 수 없다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('organizations').doc('org-pending').set({
        name: '신청중기관', applicantUid: 'applicant_1', status: 'pending',
      });
    });
    const applicantDb = setupContext('applicant_1', { role: 'employee' }).firestore();
    await assertFails(applicantDb.collection('organizations').doc('org-pending').update({ address: '서울시' }));
    await assertFails(applicantDb.collection('organizations').doc('org-pending').update({
      consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
    }));
    // 서버가 실제로 남기는 표식("anonymous-app")으로는 누구도 맞출 수 없다 — 이름·연락처를 고쳐 쓰는 것도 막힌다
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('organizations').doc('org-anon').set({
        name: '익명신청기관', applicantUid: 'anonymous-app', status: 'pending',
      });
    });
    const anonUidDb = setupContext('anonymous-app', { role: 'employee' }).firestore();
    await assertFails(anonUidDb.collection('organizations').doc('org-anon').update({ applicantPhone: '010-0000-0000' }));
    // 읽기도 같다 — 신청자 본인 읽기 분기도 뺐다(2026-11-24). 승인 전 기관의 연락처·주소는 superAdmin만 본다
    await assertFails(applicantDb.collection('organizations').doc('org-pending').get());
    await assertFails(anonUidDb.collection('organizations').doc('org-anon').get());
    await assertSucceeds(superDb.collection('organizations').doc('org-pending').get());

    // create 경로로 임의 동의 기록을 심는 것도 차단 (update만 막으면 우회 가능)
    await assertFails(superDb.collection('organizations').doc('org_new_evil').set({
      name: '위조기관', applicantUid: 'super_1', status: 'pending',
      consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
    }));
    // consent 없는 정상 create는 계속 허용
    await assertSucceeds(superDb.collection('organizations').doc('org_new_ok').set({
      name: '정상기관', applicantUid: 'super_1', status: 'pending',
    }));
  });

  it('10-3. 기관관리자는 기관 문서의 서버 소유 필드를 쓸 수 없다 — 초대코드 가로채기·AI 재심사 반복 차단', async () => {
    // 종전 규칙은 consent만 막아 기관관리자가 inviteCode·status·증빙 경로까지 임의로 쓸 수 있었다.
    // (1) 다른 기관의 초대 코드를 자기 기관에 복사 → joinOrganization이 두 기관 중 하나를 찍어
    //     신규 직원을 가로챌 수 있었고, (2) 증빙 경로를 바꿀 때마다 autoVerifyDocument가 재발동해
    //     Gemini·알림톡 비용이 상한 없이 반복됐다. 둘 다 이 규칙 한 줄이 닫는다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('organizations').doc('org-A').set({
        name: '기관A', applicantUid: 'admin_A', applicantEmail: 'a@x.com', status: 'approved',
        inviteCode: 'AAAAAA', aiVerified: true, uniqueNumber: '123-82-00001',
        uniqueNumberImagePath: 'organizations/org-A/doc.jpg',
      });
      await context.firestore().collection('organizations').doc('org-B').set({
        name: '기관B', applicantUid: 'admin_B', status: 'approved', inviteCode: 'BBBBBB',
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const orgA = adminADb.collection('organizations').doc('org-A');

    // 초대 코드 — 타 기관 코드 복사(가로채기)·임의 값 모두 차단. 재발급은 콜러블만 한다
    await assertFails(orgA.update({ inviteCode: 'BBBBBB' }));
    await assertFails(orgA.update({ inviteCode: 'ZZZZZZ' }));
    // 승인 상태·시각
    await assertFails(orgA.update({ status: 'deleted' }));
    await assertFails(orgA.update({ approvedAt: new Date() }));
    // AI 심사 결과·증빙 경로 — 바꾸면 autoVerifyDocument가 재발동한다
    await assertFails(orgA.update({ aiVerified: false }));
    await assertFails(orgA.update({ aiVerifyDetail: { rejected: false } }));
    await assertFails(orgA.update({ uniqueNumberImagePath: 'organizations/org-A/other.jpg' }));
    // 신청 시 확정된 신원·수신처
    await assertFails(orgA.update({ uniqueNumber: '999-82-99999' }));
    await assertFails(orgA.update({ applicantEmail: 'attacker@evil.com' }));
    await assertFails(orgA.update({ applicantPhone: '010-0000-0000' }));
    // 허용 필드와 섞어도 차단 (한 필드라도 걸리면 전체 거부)
    await assertFails(orgA.update({ hipassEnabled: false, inviteCode: 'BBBBBB' }));

    // 정상: 설정 화면이 저장하는 필드는 계속 허용
    await assertSucceeds(orgA.update({ name: '기관A 수정', phone: '02-000-0000', hipassEnabled: false }));
    await assertSucceeds(orgA.update({ approvalLine: [{ title: '팀장' }], sites: [] }));

    // superAdmin은 승인·반려·복구 경로가 있으므로 종전대로 쓸 수 있다
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    await assertSucceeds(superDb.collection('organizations').doc('org-A').update({ inviteCode: 'CCCCCC' }));
    await assertSucceeds(superDb.collection('organizations').doc('org-A').update({ status: 'rejected', rejectedAt: new Date() }));
  });

  it('10-2. 직원 이용약관 동의 기록(users.consent) 클라이언트 변경·주입 차단', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('user_A').set({
        email: 'a@example.com', name: '직원A', role: 'employee', organizationId: 'org-A',
        consent: { terms: true, termsVersion: '2026-08-05' },
      });
      // 동의 기록이 없는 레거시 직원
      await db.collection('users').doc('user_L').set({
        email: 'l@example.com', name: '직원L', role: 'employee', organizationId: 'org-A',
      });
    });

    const ownerDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    const adminDb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    const legacyOwnerDb = setupContext('user_L', { role: 'employee', orgId: 'org-A' }).firestore();

    // 본인·기관관리자·superAdmin 모두 동의 기록 변경 차단
    await assertFails(ownerDb.collection('users').doc('user_A').update({
      consent: { terms: true, termsVersion: '2099-01-01' },
    }));
    await assertFails(adminDb.collection('users').doc('user_A').update({
      consent: { terms: false, termsVersion: 'x' },
    }));
    await assertFails(superDb.collection('users').doc('user_A').update({
      consent: { terms: false, termsVersion: 'x' },
    }));

    // 동의하지 않은 레거시 직원이 스스로 동의 기록을 심는 것도 차단
    await assertFails(legacyOwnerDb.collection('users').doc('user_L').update({
      consent: { terms: true, termsVersion: '2026-08-05' },
    }));

    // 정상: 동의 기록을 건드리지 않는 본인 프로필 수정은 허용
    await assertSucceeds(ownerDb.collection('users').doc('user_A').update({ phone: '010-1111-2222' }));

    // 신규 가입 시 클라이언트 create로 동의 기록을 심는 것도 차단
    const newUserDb = setupContext('user_new', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    await assertFails(newUserDb.collection('users').doc('user_new').set({
      email: 'new@example.com', consent: { terms: true, termsVersion: '2026-08-05' },
    }));
    await assertSucceeds(newUserDb.collection('users').doc('user_new').set({ email: 'new@example.com' }));
  });

  it('10-3. 접속기록(auditLogs) — 클라이언트 쓰기 전면 차단, 읽기는 점검 주체만', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('auditLogs').doc('log_A').set({
        organizationId: 'org-A', action: 'update', targetType: 'driveLog',
        targetId: 'dl_A', actorUid: null, actorSource: 'unknown', subjectUids: ['user_A'],
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const employeeADb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    const adminBDb = setupContext('admin_B', { role: 'admin', orgId: 'org-B' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();

    // 쓰기: 누구도 불가 (Admin SDK 트리거 전용)
    await assertFails(adminADb.collection('auditLogs').doc('log_new').set({
      organizationId: 'org-A', action: 'create', targetType: 'driveLog', targetId: 'x',
    }));
    await assertFails(superDb.collection('auditLogs').doc('log_new2').set({
      organizationId: 'org-A', action: 'create', targetType: 'driveLog', targetId: 'x',
    }));
    // 기록 인멸 차단 — 수정·삭제 모두 불가
    await assertFails(adminADb.collection('auditLogs').doc('log_A').update({ action: 'create' }));
    await assertFails(superDb.collection('auditLogs').doc('log_A').update({ action: 'create' }));
    await assertFails(adminADb.collection('auditLogs').doc('log_A').delete());
    await assertFails(superDb.collection('auditLogs').doc('log_A').delete());

    // 읽기: 해당 기관 관리자와 superAdmin만
    await assertSucceeds(adminADb.collection('auditLogs').doc('log_A').get());
    await assertSucceeds(superDb.collection('auditLogs').doc('log_A').get());
    // 일반 직원은 자기 기관 기록도 볼 수 없다 (점검 주체가 아니다)
    await assertFails(employeeADb.collection('auditLogs').doc('log_A').get());
    // 타 기관 관리자는 차단 (멀티테넌트 격리)
    await assertFails(adminBDb.collection('auditLogs').doc('log_A').get());

    // 기관 미소속 계정(superAdmin)의 기록은 __system__으로 남는다 — superAdmin만 읽는다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('auditLogs').doc('log_sys').set({
        organizationId: '__system__', action: 'update', targetType: 'user',
        targetId: 'super_1', actorUid: null, actorSource: 'unknown', subjectUids: ['super_1'],
        changedFields: ['role'],
      });
    });
    await assertSucceeds(superDb.collection('auditLogs').doc('log_sys').get());
    await assertFails(adminADb.collection('auditLogs').doc('log_sys').get());
    await assertFails(adminBDb.collection('auditLogs').doc('log_sys').get());
  });

  it('10-3b. 접속기록 목록 조회 — 기관 필터가 있어야 통과한다 (점검 화면의 전제)', async () => {
    // 문서 단건 get이 통과하는 것과 목록 조회(list)가 통과하는 것은 별개다.
    // 점검 화면(getAuditLogs)은 list로 읽으므로, 기관 필터가 빠진 쿼리가 통째로
    // 거부되는 것을 여기서 고정한다 — 필터를 지우면 화면이 조용히 비는 대신 이 테스트가 깨진다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('auditLogs').doc('log_A1').set({
        organizationId: 'org-A', action: 'login', targetType: 'session',
        targetId: 'user_A', actorUid: 'user_A', actorSource: 'auth', subjectUids: ['user_A'],
        at: new Date('2026-08-01T09:00:00Z'),
      });
      await db.collection('auditLogs').doc('log_B1').set({
        organizationId: 'org-B', action: 'login', targetType: 'session',
        targetId: 'user_B', actorUid: 'user_B', actorSource: 'auth', subjectUids: ['user_B'],
        at: new Date('2026-08-01T09:00:00Z'),
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const employeeADb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();

    // 자기 기관 필터 + 최신순 — 화면이 실제로 쓰는 쿼리 형태
    await assertSucceeds(
      adminADb.collection('auditLogs').where('organizationId', '==', 'org-A').orderBy('at', 'desc').limit(50).get()
    );
    // 유형 필터(action in) 조합도 같은 경계로 통과한다
    await assertSucceeds(
      adminADb.collection('auditLogs')
        .where('organizationId', '==', 'org-A')
        .where('action', 'in', ['create', 'update', 'delete'])
        .orderBy('at', 'desc').limit(50).get()
    );
    // 기관 필터가 없으면 타 기관 문서가 섞이므로 쿼리 전체가 거부된다
    await assertFails(adminADb.collection('auditLogs').orderBy('at', 'desc').limit(50).get());
    // 타 기관을 지목한 조회도 거부
    await assertFails(adminADb.collection('auditLogs').where('organizationId', '==', 'org-B').get());
    // 직원은 점검 주체가 아니라 자기 기관 목록도 못 읽는다
    await assertFails(employeeADb.collection('auditLogs').where('organizationId', '==', 'org-A').get());
  });

  it('10-5. 전체 공지 이력(broadcasts) — 클라이언트 쓰기 전면 차단, 읽기는 운영자만', async () => {
    // sendBroadcastNotice(Admin SDK)만 기록한다. 발송자 uid가 담기므로 읽기도 운영자 한정.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('broadcasts').doc('bc_1').set({
        title: '약관 개정 안내', message: '8월 10일 시행', actorUid: 'sa_1',
        recipientCount: 812, status: 'sent',
      });
    });

    const superAdmin = setupContext('sa_1', { role: 'superAdmin' }).firestore();
    const adminA = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const memberA = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // (1) 운영자만 읽는다
    await assertSucceeds(superAdmin.collection('broadcasts').doc('bc_1').get());
    await assertFails(adminA.collection('broadcasts').doc('bc_1').get());
    await assertFails(memberA.collection('broadcasts').doc('bc_1').get());

    // (2) 운영자조차 쓸 수 없다 — 발송하지 않은 이력을 만들거나 지울 수 없어야 한다
    await assertFails(superAdmin.collection('broadcasts').doc('bc_2').set({ title: '위조' }));
    await assertFails(superAdmin.collection('broadcasts').doc('bc_1').update({ recipientCount: 0 }));
    await assertFails(superAdmin.collection('broadcasts').doc('bc_1').delete());
  });

  it('10-6. 앱 오류 기록(clientErrors) — 클라이언트 쓰기 전면 차단, 읽기는 운영자만 (2026-11-23)', async () => {
    // reportClientError(Admin SDK)만 기록한다. 기관 관리자가 읽으면 다른 기관이 겪은 오류가 보인다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('clientErrors').doc('e_1').set({
        name: 'TypeError', message: 'x is undefined', where: 'getAssets', count: 3, orgIds: ['org-A'],
      });
    });

    const superAdmin = setupContext('sa_1', { role: 'superAdmin' }).firestore();
    const adminA = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    await assertSucceeds(superAdmin.collection('clientErrors').doc('e_1').get());
    await assertFails(adminA.collection('clientErrors').doc('e_1').get());
    // 운영자도 쓰지 못한다 — 기록은 서버 함수만 남긴다
    await assertFails(superAdmin.collection('clientErrors').doc('e_2').set({ message: '위조' }));
    await assertFails(adminA.collection('clientErrors').doc('e_1').update({ count: 0 }));
    await assertFails(superAdmin.collection('clientErrors').doc('e_1').delete());
  });

  it('11. 비밀 사용자 데이터(users/{uid}/private) — 본인·같은 기관 모두 접근 차단 (Functions 전용)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/user_A/private/oauth').set({
        accessToken: 'a', refreshToken: 'r', expiryDate: 1,
      });
    });

    // 본인조차 클라이언트에서 토큰을 읽거나 쓸 수 없다 (Admin SDK 전용)
    const ownerDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    await assertFails(ownerDb.doc('users/user_A/private/oauth').get());
    await assertFails(ownerDb.doc('users/user_A/private/oauth').set({ accessToken: 'z' }));

    // 같은 기관 타 멤버도 당연히 차단
    const mateDb = setupContext('user_A2', { role: 'employee', orgId: 'org-A' }).firestore();
    await assertFails(mateDb.doc('users/user_A/private/oauth').get());
  });

  it('11-1. 기관 미소속(orgId null) 사용자 간 PII 상호 열람 차단 — "null == null" 우회 방지', async () => {
    // 탈퇴·기관 이동 대기 계정은 organizationId가 null로 명시 저장되고
    // 클레임의 orgId도 null이 된다(setCustomClaims). "같은 기관 멤버" 조건이
    // null == null로 성립해 미소속 계정끼리 이메일·이름·연락처를 읽을 수 있었다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('orphan_A').set({
        organizationId: null, name: '미소속A', email: 'a@t.kr', role: 'employee',
      });
      await db.collection('users').doc('orphan_B').set({
        organizationId: null, name: '미소속B', email: 'b@t.kr', role: 'employee',
      });
      await db.collection('users').doc('user_C').set({
        organizationId: 'org-C', name: '직원C', email: 'c@t.kr', role: 'employee',
      });
    });

    const orphanADb = setupContext('orphan_A', { role: 'employee', orgId: null }).firestore();

    // (1) 미소속끼리 상호 열람 차단
    await assertFails(orphanADb.collection('users').doc('orphan_B').get());

    // (2) 미소속 → 기관 소속 사용자 열람도 차단
    await assertFails(orphanADb.collection('users').doc('user_C').get());

    // (3) 본인 문서는 계속 읽을 수 있다 (회귀 가드 — 재가입 화면의 전제)
    await assertSucceeds(orphanADb.collection('users').doc('orphan_A').get());

    // (4) 기관 소속 멤버 간 열람은 계속 허용된다 (회귀 가드 — 정당한 접근 경로 보존)
    const memberCDb = setupContext('user_C2', { role: 'employee', orgId: 'org-C' }).firestore();
    await assertSucceeds(memberCDb.collection('users').doc('user_C').get());
  });

  /**
   * 의견(feedbacks) 생성이 **서버 비용을 부르는 쓰기**라는 점을 규칙으로 못박는다.
   *
   * 이 컬렉션의 onCreate(notifyNewFeedback)는 Discord 웹훅을 실행한다(당시에는 첨부 다운로드·
   * Gemini 호출까지 — AI 초안은 2026-10-16에 없앴다). 규칙이 `isSignedIn()` 하나였을 때는 로그인한 누구나 타인 명의로,
   * 첨부 개수·본문 길이 제한 없이 그 연쇄를 무제한 유발할 수 있었다 (2026-08-14 감사 발견 1).
   *
   * 호출 '횟수' 상한은 Rules로 표현할 수 없어 트리거 안의 일일 쿼터가 맡는다. 여기서는
   * 한 번의 쓰기가 시킬 수 있는 일의 크기와 명의를 검증한다.
   */
  it('11. 의견 생성 — 명의 위조·첨부 과다·AI 필드 선점 차단', async () => {
    const author = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();
    const base = {
      message: '건의드립니다',
      imageUrls: [] as string[],
      userEmail: 'a@example.com',
      userName: '사용자A',
      organizationId: 'org-A',
      authorUid: 'user_A',
      status: 'unread',
    };

    // (1) 정상 경로(FeedbackForm이 보내는 모양) → 허용. 이게 막히면 의견 기능이 죽는다.
    await assertSucceeds(author.collection('feedbacks').doc('fb_ok').set(base));

    // (2) 첨부 3개까지 → 허용 (트리거 fetchPromptImages의 maxImages와 같은 값)
    await assertSucceeds(author.collection('feedbacks').doc('fb_img3').set({
      ...base, imageUrls: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'],
    }));

    // (3) 타인 명의로 심기 → 차단
    await assertFails(author.collection('feedbacks').doc('fb_forged').set({ ...base, authorUid: 'user_B' }));

    // (4) 첨부 4개 이상 → 차단 (쓰기 1건이 시키는 다운로드·토큰 비용의 상한)
    await assertFails(author.collection('feedbacks').doc('fb_img4').set({
      ...base, imageUrls: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg', 'https://a/4.jpg'],
    }));

    // (5) 본문 길이 상한 초과 → 차단
    await assertFails(author.collection('feedbacks').doc('fb_long').set({ ...base, message: 'x'.repeat(5001) }));

    // (6) AI·답변 필드 선점 → 차단 (답변 이력이 사용자 입력으로 오염되는 것을 막는다)
    await assertFails(author.collection('feedbacks').doc('fb_ai').set({ ...base, aiDraft: '내가 쓴 초안' }));
    await assertFails(author.collection('feedbacks').doc('fb_reply').set({ ...base, reply: '처리 완료' }));

    // (7) 읽기는 여전히 superAdmin 전용 — 작성자 본인도 못 읽는다
    await assertFails(author.collection('feedbacks').doc('fb_ok').get());
  });

  it('22. 기관 신청서(orgApplications) — 클라이언트에는 열려 있지 않다', async () => {
    // 이 컬렉션은 신청자 이메일·연락처가 담긴 개인정보인데, 규칙이
    // `applicantEmail == request.auth.token.email`이었다. 그 조건은 **토큰에 email이 없으면
    // null == null로 통과**하고(익명 로그인이 켜져 있던 동안 그런 토큰을 발급할 수 있었다),
    // 정작 쓰는 곳이 없다 — 접수는 비인증 콜러블(Admin SDK)이 하고 심사 화면도 읽지 않는다.
    // 그래서 클라이언트 경로를 닫았다. 다시 열리면 이 테스트가 실패한다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('orgApplications').doc('app_kim').set({
        applicantEmail: 'kim@a.or.kr',
        orgName: '가나복지관',
        phone: '010-1111-2222',
        status: 'pending',
      });
    });

    const kim = setupContext('uid_kim', { email: 'kim@a.or.kr' }).firestore();
    const noEmail = setupContext('uid_noemail', {}).firestore();
    const superAdmin = setupContext('uid_root', { role: 'superAdmin' }).firestore();

    // (1) 본인 이메일이 일치해도 읽지 못한다 — 클라이언트가 쓰지 않는 경로다
    await assertFails(kim.collection('orgApplications').doc('app_kim').get());
    // (2) email 클레임이 없는 토큰도 못 읽는다 (null == null 통과 경로 차단)
    await assertFails(noEmail.collection('orgApplications').doc('app_kim').get());
    // (3) 심사는 superAdmin이 하므로 읽기는 남긴다
    await assertSucceeds(superAdmin.collection('orgApplications').doc('app_kim').get());

    // (4) 생성은 아무도 못 한다 — 접수는 Admin SDK(submitOrgApplication) 경로뿐이다
    await assertFails(kim.collection('orgApplications').doc('app_new').set({
      applicantEmail: 'kim@a.or.kr', orgName: '새복지관', status: 'pending',
    }));
    // email 없는 토큰이 applicantEmail을 비워 밀어 넣는 경로도 막힌다
    await assertFails(noEmail.collection('orgApplications').doc('app_null').set({
      orgName: '이메일없음', status: 'pending',
    }));

    // (5) 심사 결과 변경·삭제도 클라이언트에서는 불가 — superAdmin도 Admin SDK로 한다
    await assertFails(kim.collection('orgApplications').doc('app_kim').update({ status: 'approved' }));
    await assertFails(superAdmin.collection('orgApplications').doc('app_kim').update({ status: 'approved' }));
    await assertFails(superAdmin.collection('orgApplications').doc('app_kim').delete());
  });

  it('23. users/{uid}/private — superAdmin도 예외가 아니다 (11번 보완)', async () => {
    // 11번이 본인·같은 기관 멤버 차단을 이미 고정한다. 여기서 더하는 것은 **superAdmin**이다 —
    // 전체 데이터 읽기 권한을 가진 역할이라 "관리자니까 열어 준다"로 뚫리기 쉬운 자리인데,
    // 이 컬렉션은 Google OAuth 리프레시 토큰이라 열리면 계정 임퍼소네이션이 된다
    // (2026-07-10 감사 #4). 부모 문서 읽기가 정상임도 함께 고정해, private만 닫힌 것임을 밝힌다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('uid_owner').set({ email: 'o@a.or.kr', organizationId: 'org-A' });
      await db.collection('users').doc('uid_owner').collection('private').doc('googleOauth').set({
        refreshToken: 'SECRET',
      });
    });

    const owner = setupContext('uid_owner', { orgId: 'org-A' }).firestore();
    const sameOrg = setupContext('uid_peer', { orgId: 'org-A' }).firestore();
    const superAdmin = setupContext('uid_root', { role: 'superAdmin' }).firestore();

    const path = (db: typeof owner) =>
      db.collection('users').doc('uid_owner').collection('private').doc('googleOauth');

    // 본인조차 읽을 수 없다 — 토큰은 서버만 만진다
    await assertFails(path(owner).get());
    await assertFails(path(sameOrg).get());
    await assertFails(path(superAdmin).get());

    // 쓰기도 전면 차단 (본인 명의로도 심을 수 없다)
    await assertFails(path(owner).set({ refreshToken: 'INJECTED' }));
    await assertFails(path(superAdmin).set({ refreshToken: 'INJECTED' }));

    // 부모 문서 읽기는 여전히 정상 — private만 닫힌 것이다
    await assertSucceeds(owner.collection('users').doc('uid_owner').get());
  });

  // 외부 대여 반납 — 운전자가 기관 구성원이 아니라 driverUid를 비운 운행일지를 관리자가 쓴다.
  // Rules는 driverUid의 **존재**만 본다(대리 작성 기능과 같은 판단). 이 전제가 바뀌면 반납이 막힌다.

  /**
   * 기대 동작 표 (2026-10-17 규칙 감사) — 표 번호마다 허용·거부를 함께 고정한다.
   *
   * 위 테스트들이 이미 정확히 검증하는 항목(#3·#5·#6a·#17·#18a~c 등)은 여기서 다시 만들지 않고
   * 해당 테스트에 표 번호 주석만 달았다. 여기에는 빠져 있던 쪽(허용 대조군, 목록 쿼리, 삭제,
   * 다른 기관 관리자 등)만 둔다.
   *
   * 픽스처: 기관 2개 × (직원 2명 + 기관 관리자 1명) + 전체 관리자 1명. 문서 모양은 src/schemas/를 따른다.
   * 클레임의 직원 역할은 실제 값인 'employee'다(위 테스트의 'member'는 실재하지 않는 값).
   */
  describe('기대 동작 표', () => {
    const ORGS = ['org-A', 'org-B'] as const;
    const at = new Date('2026-10-01T09:00:00Z');

    const emp = (org: 'A' | 'B', n: 1 | 2) =>
      setupContext(`emp_${org}${n}`, { role: 'employee', orgId: `org-${org}` }).firestore();
    const admin = (org: 'A' | 'B') =>
      setupContext(`admin_${org}`, { role: 'admin', orgId: `org-${org}` }).firestore();
    const superAdmin = () => setupContext('super_1', { role: 'superAdmin' }).firestore();
    const anon = () => testEnv.unauthenticatedContext().firestore();

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        for (const orgId of ORGS) {
          const o = orgId.slice(-1); // 'A' | 'B'
          await db.collection('organizations').doc(orgId).set({
            name: `기관${o}`, applicantUid: `admin_${o}`, status: 'approved',
          });
          for (const [uid, role] of [[`emp_${o}1`, 'employee'], [`emp_${o}2`, 'employee'], [`admin_${o}`, 'admin']] as const) {
            await db.collection('users').doc(uid).set({
              name: uid, email: `${uid}@example.org`, role, organizationId: orgId, status: 'active',
            });
          }
        }
        await db.collection('users').doc('super_1').set({
          name: '운영자', email: 'super_1@example.org', role: 'superAdmin', organizationId: null,
        });
        // 기관에 소속된 채로 지정된 전체 관리자 — addSuperAdmin은 organizationId를 지우지 않는다
        await db.collection('users').doc('super_inorg').set({
          name: '운영자(기관 소속)', email: 'super_inorg@example.org', role: 'superAdmin', organizationId: 'org-A',
        });
        // 규칙에 match가 없는 서버 전용 컬렉션 (기본 거부)
        await db.collection('_health').doc('ping').set({ at });
        await db.collection('_rateLimits').doc('k1').set({ count: 1 });
      });
    });

    it('#1 로그인 안 한 사람은 사용자·기관 문서를 읽지도 쓰지도 못한다', async () => {
      const db = anon();
      await assertFails(db.collection('users').doc('emp_A1').get());
      await assertFails(db.collection('organizations').doc('org-A').get());
      await assertFails(db.collection('users').where('organizationId', '==', 'org-A').get());
      await assertFails(db.collection('users').doc('anon_new').set({ email: 'x@example.org' }));
      await assertFails(db.collection('users').doc('emp_A1').update({ phone: '010-0000-0000' }));
      await assertFails(db.collection('organizations').doc('org-A').update({ name: '변경' }));
    });

    it('#4 직원은 같은 기관 사용자만 읽고, 다른 기관 사용자·기관 문서는 읽을 수 없다 (목록 쿼리 포함)', async () => {
      const db = emp('A', 1);
      await assertSucceeds(db.collection('users').doc('emp_A2').get());
      await assertSucceeds(db.collection('users').where('organizationId', '==', 'org-A').get());
      await assertSucceeds(db.collection('organizations').doc('org-A').get());
      await assertFails(db.collection('users').doc('emp_B1').get());
      await assertFails(db.collection('users').where('organizationId', '==', 'org-B').get());
      await assertFails(db.collection('organizations').doc('org-B').get());
    });

    it('#12 기관 관리자는 다른 기관의 사용자·기관 문서를 고칠 수 없다', async () => {
      const db = admin('A');
      await assertFails(db.collection('users').doc('emp_B1').update({ role: 'admin' }));
      await assertFails(db.collection('organizations').doc('org-B').update({ name: '침범' }));
      await assertSucceeds(db.collection('organizations').doc('org-A').update({ name: '기관A 새 이름' }));
    });

    it('#10 직원·관리자는 자기 문서의 역할을 올리거나 기관을 바꿀 수 없다 (탈퇴·자기 강등은 허용)', async () => {
      const empDb = emp('A', 1);
      const self = empDb.collection('users').doc('emp_A1');
      await assertFails(self.update({ role: 'admin' }));
      await assertFails(self.update({ role: 'superAdmin' }));
      await assertFails(self.update({ organizationId: 'org-B' }));
      await assertFails(self.update({ status: 'disabled' }));
      // 탈퇴 분기: 기관을 비우고 employee로 — 허용 (clearUserOrganization)
      await assertSucceeds(self.update({ organizationId: null, role: 'employee' }));

      const adminDb = admin('A');
      const adminSelf = adminDb.collection('users').doc('admin_A');
      await assertFails(adminSelf.update({ role: 'superAdmin' }));
      await assertFails(adminSelf.update({ organizationId: 'org-B' }));
      // 표 정밀화(b): 관리자는 자기 역할을 낮출 수 있다 — 권한 상승이 아니다
      await assertSucceeds(adminSelf.update({ role: 'employee' }));
    });

    it('#13 기관 관리자는 같은 기관 직원의 역할을 admin·employee로만 바꿀 수 있다', async () => {
      const db = admin('A');
      await assertSucceeds(db.collection('users').doc('emp_A1').update({ role: 'admin', lastEditedByUid: 'admin_A' }));
      await assertSucceeds(db.collection('users').doc('emp_A1').update({ role: 'employee', lastEditedByUid: 'admin_A' }));
      await assertFails(db.collection('users').doc('emp_A2').update({ role: 'superAdmin' }));
      await assertFails(db.collection('users').doc('emp_A2').update({ organizationId: 'org-B' }));
    });

    it('#13 기관 관리자도 직원의 활성 상태(status·disabledAt)는 직접 못 바꾼다 — 콜러블 전용', async () => {
      // 활성/비활성은 Auth 계정 차단과 함께 바뀌어야 한다(disableUser·enableUser).
      // 문서만 'active'로 고치면 목록은 활성인데 로그인은 auth/user-disabled로 막힌다(2026-11-18).
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('users').doc('emp_A2').update({ status: 'disabled', disabledAt: new Date() });
      });
      const db = admin('A');
      // 비활성 → 활성 (이번 사고의 경로)
      await assertFails(db.collection('users').doc('emp_A2').update({ status: 'active', disabledAt: null, lastEditedByUid: 'admin_A' }));
      await assertFails(db.collection('users').doc('emp_A2').update({ disabledAt: null, lastEditedByUid: 'admin_A' }));
      // 활성 → 비활성
      await assertFails(db.collection('users').doc('emp_A1').update({ status: 'disabled', lastEditedByUid: 'admin_A' }));
      await assertFails(db.collection('users').doc('emp_A1').update({ disabledAt: new Date(), lastEditedByUid: 'admin_A' }));
      // 다른 필드(이름)는 그대로 고칠 수 있다
      await assertSucceeds(db.collection('users').doc('emp_A1').update({ name: '바뀐이름', lastEditedByUid: 'admin_A' }));
    });

    it('#13 기관 관리자는 자기 기관에 소속된 전체 관리자를 강등·비활성화할 수 없다', async () => {
      // addSuperAdmin은 organizationId를 지우지 않아 기관 소속 전체 관리자가 생긴다.
      // 2단계 분류 (a) 규칙 문제 후보 — users update의 관리자 분기에 대상 역할 조건이 없다.
      const db = admin('A');
      await assertFails(db.collection('users').doc('super_inorg').update({ role: 'employee' }));
      await assertFails(db.collection('users').doc('super_inorg').update({ status: 'disabled' }));
    });

    it('#21 규칙에 없는 서버 전용 컬렉션(_health·_rateLimits)은 누구도 접근할 수 없다', async () => {
      for (const db of [emp('A', 1), admin('A'), superAdmin()]) {
        await assertFails(db.collection('_health').doc('ping').get());
        await assertFails(db.collection('_rateLimits').doc('k1').get());
        await assertFails(db.collection('_health').doc('ping').set({ at }));
        await assertFails(db.collection('_rateLimits').doc('k2').set({ count: 0 }));
      }
    });

    // ── 공간 (기획서 F03) ──
    const spaceDoc = (org: 'A' | 'B', uid: string, extra: Record<string, unknown> = {}) => ({
      organizationId: `org-${org}`, name: `공간${org}`, order: 0, managerUids: [], archived: false,
      createdAt: serverTs(), updatedAt: serverTs(), lastEditedByUid: uid, ...extra,
    });
    const seedSpace = async (id: string, org: 'A' | 'B', managerUids: string[] = []) => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('spaces').doc(id).set({
          organizationId: `org-${org}`, name: id, order: 0, managerUids, archived: false,
          createdAt: at, updatedAt: at, lastEditedByUid: `admin_${org}`,
        });
      });
    };

    it('#S1 공간은 같은 기관 구성원만 읽는다 (단건·목록·내 담당 공간)', async () => {
      await seedSpace('sp_A', 'A', ['emp_A1']);
      await seedSpace('sp_B', 'B');
      const db = emp('A', 2);
      await assertSucceeds(db.collection('spaces').doc('sp_A').get());
      await assertSucceeds(db.collection('spaces').where('organizationId', '==', 'org-A').get());
      await assertSucceeds(emp('A', 1).collection('spaces')
        .where('organizationId', '==', 'org-A').where('managerUids', 'array-contains', 'emp_A1').get());
      await assertFails(db.collection('spaces').doc('sp_B').get());
      await assertFails(db.collection('spaces').where('organizationId', '==', 'org-B').get());
      await assertFails(db.collection('spaces').get());
      await assertFails(anon().collection('spaces').doc('sp_A').get());
    });

    it('#S2 공간 추가·수정은 그 기관 관리자만 (직원·다른 기관 관리자는 막힌다)', async () => {
      await assertSucceeds(admin('A').collection('spaces').doc('new_A').set(spaceDoc('A', 'admin_A')));
      await assertFails(emp('A', 1).collection('spaces').doc('emp_new').set(spaceDoc('A', 'emp_A1')));
      await assertFails(admin('B').collection('spaces').doc('cross').set(spaceDoc('A', 'admin_B')));

      await seedSpace('sp_A', 'A');
      const upd = { name: '바뀐 이름', updatedAt: serverTs() };
      await assertSucceeds(admin('A').collection('spaces').doc('sp_A').update({ ...upd, lastEditedByUid: 'admin_A' }));
      await assertFails(emp('A', 1).collection('spaces').doc('sp_A').update({ ...upd, lastEditedByUid: 'emp_A1' }));
      await assertFails(admin('B').collection('spaces').doc('sp_A').update({ ...upd, lastEditedByUid: 'admin_B' }));
    });

    it('#S3 공간은 아무도 지울 수 없다 — 숨김(archived)만 쓴다', async () => {
      await seedSpace('sp_A', 'A');
      await assertFails(admin('A').collection('spaces').doc('sp_A').delete());
      await assertFails(superAdmin().collection('spaces').doc('sp_A').delete());
      await assertSucceeds(admin('A').collection('spaces').doc('sp_A')
        .update({ archived: true, updatedAt: serverTs(), lastEditedByUid: 'admin_A' }));
    });

    it('#S4 공간 데이터 형식 — 빈 이름·긴 이름·담당자 과다·모르는 필드·다른 기관 이전은 막힌다', async () => {
      const db = admin('A');
      await assertFails(db.collection('spaces').doc('x1').set(spaceDoc('A', 'admin_A', { name: '' })));
      await assertFails(db.collection('spaces').doc('x2').set(spaceDoc('A', 'admin_A', { name: '가'.repeat(51) })));
      await assertFails(db.collection('spaces').doc('x3').set(spaceDoc('A', 'admin_A', {
        managerUids: Array.from({ length: 21 }, (_, i) => `u${i}`),
      })));
      await assertFails(db.collection('spaces').doc('x4').set(spaceDoc('A', 'admin_A', { memo: '모르는 필드' })));
      await assertFails(db.collection('spaces').doc('x5').set(spaceDoc('A', 'admin_A', { order: -1 })));
      await assertFails(db.collection('spaces').doc('x6').set(spaceDoc('A', 'admin_A', { order: 1.5 })));

      await seedSpace('sp_A', 'A');
      await assertFails(db.collection('spaces').doc('sp_A')
        .update({ organizationId: 'org-B', updatedAt: serverTs(), lastEditedByUid: 'admin_A' }));
    });

    it('#S5 공간 쓰기에는 본인 행위자 스탬프가 있어야 한다 (생략·타인 명의 모두 막힘)', async () => {
      const db = admin('A');
      const { lastEditedByUid: _omit, ...noStamp } = spaceDoc('A', 'admin_A');
      await assertFails(db.collection('spaces').doc('s1').set(noStamp));
      await assertFails(db.collection('spaces').doc('s2').set(spaceDoc('A', 'emp_A1')));

      // 마지막 수정자가 다른 사람인 문서를 스탬프 없이 고치면, 남의 이름이 그대로 남으므로 막힌다
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('spaces').doc('sp_A').set({
          organizationId: 'org-A', name: 'sp_A', order: 0, managerUids: [], archived: false,
          createdAt: at, updatedAt: at, lastEditedByUid: 'someone_else',
        });
      });
      await assertFails(db.collection('spaces').doc('sp_A').update({ name: '스탬프 없음', updatedAt: serverTs() }));
      await assertSucceeds(db.collection('spaces').doc('sp_A')
        .update({ name: '스탬프 있음', updatedAt: serverTs(), lastEditedByUid: 'admin_A' }));
    });

    it('#S5b 공간의 건물·층은 비워 두거나 짧은 글자만 저장된다', async () => {
      const db = admin('A');
      await assertSucceeds(db.collection('spaces').doc('loc1').set(spaceDoc('A', 'admin_A', { buildingId: 'b1', floor: 'B1' })));
      await assertSucceeds(db.collection('spaces').doc('loc2').set(spaceDoc('A', 'admin_A', { buildingId: null, floor: null })));
      await assertFails(db.collection('spaces').doc('loc3').set(spaceDoc('A', 'admin_A', { floor: '가'.repeat(11) })));
      await assertFails(db.collection('spaces').doc('loc4').set(spaceDoc('A', 'admin_A', { buildingId: 3 })));
    });

    // ── 건물 (2026-11-22) — 경계는 공간과 같다 ──
    const buildingDoc = (org: 'A' | 'B', uid: string, extra: Record<string, unknown> = {}) => ({
      organizationId: `org-${org}`, name: `본관${org}`, address: '', floors: ['B1', '1', '2'], order: 0, archived: false,
      createdAt: serverTs(), updatedAt: serverTs(), lastEditedByUid: uid, ...extra,
    });
    const seedBuilding = async (id: string, org: 'A' | 'B') => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('buildings').doc(id).set({
          organizationId: `org-${org}`, name: id, address: '', floors: ['1'], order: 0, archived: false,
          createdAt: at, updatedAt: at, lastEditedByUid: `admin_${org}`,
        });
      });
    };

    it('#B1 건물은 같은 기관 구성원만 읽고, 그 기관 관리자만 추가·수정하며, 아무도 지울 수 없다', async () => {
      await seedBuilding('bd_A', 'A');
      await seedBuilding('bd_B', 'B');
      await assertSucceeds(emp('A', 1).collection('buildings').doc('bd_A').get());
      await assertSucceeds(emp('A', 1).collection('buildings').where('organizationId', '==', 'org-A').get());
      await assertFails(emp('A', 1).collection('buildings').doc('bd_B').get());
      await assertFails(anon().collection('buildings').doc('bd_A').get());

      await assertSucceeds(admin('A').collection('buildings').doc('new_A').set(buildingDoc('A', 'admin_A')));
      await assertFails(emp('A', 1).collection('buildings').doc('emp_new').set(buildingDoc('A', 'emp_A1')));
      await assertFails(admin('B').collection('buildings').doc('cross').set(buildingDoc('A', 'admin_B')));

      const upd = { floors: ['1', '2'], updatedAt: serverTs() };
      await assertSucceeds(admin('A').collection('buildings').doc('bd_A').update({ ...upd, lastEditedByUid: 'admin_A' }));
      await assertFails(emp('A', 1).collection('buildings').doc('bd_A').update({ ...upd, lastEditedByUid: 'emp_A1' }));
      await assertFails(admin('A').collection('buildings').doc('bd_A').delete());
      await assertFails(superAdmin().collection('buildings').doc('bd_A').delete());
    });

    it('#B2 건물 데이터 형식 — 빈 이름·긴 주소·층 과다·모르는 필드·다른 기관 이전은 막힌다', async () => {
      const db = admin('A');
      await assertFails(db.collection('buildings').doc('x1').set(buildingDoc('A', 'admin_A', { name: '' })));
      await assertFails(db.collection('buildings').doc('x2').set(buildingDoc('A', 'admin_A', { address: '가'.repeat(201) })));
      await assertFails(db.collection('buildings').doc('x3').set(buildingDoc('A', 'admin_A', {
        floors: Array.from({ length: 51 }, (_, i) => String(i)),
      })));
      await assertFails(db.collection('buildings').doc('x4').set(buildingDoc('A', 'admin_A', { memo: '모르는 필드' })));
      await assertFails(db.collection('buildings').doc('x5').set(buildingDoc('A', 'admin_A', { floors: '1,2' })));

      await seedBuilding('bd_A', 'A');
      await assertFails(db.collection('buildings').doc('bd_A')
        .update({ organizationId: 'org-B', updatedAt: serverTs(), lastEditedByUid: 'admin_A' }));
    });

    // ── 재물 마지막 확인 (2026-11-22) ──
    const checkDoc = (org: 'A' | 'B', assetId: string, uid: string, extra: Record<string, unknown> = {}) => ({
      organizationId: `org-${org}`, assetId, checkedAt: serverTs(), checkedByUid: uid, via: 'qr', spaceId: null, surveyId: null, ...extra,
    });

    it('#C1 마지막 확인은 같은 기관 구성원이 본인 이름으로만 남기고, 같은 기관만 읽는다', async () => {
      const id = 'org-A__1';
      await assertSucceeds(emp('A', 1).collection('assetChecks').doc(id).set(checkDoc('A', id, 'emp_A1')));
      await assertSucceeds(admin('A').collection('assetChecks').doc(id).set(checkDoc('A', id, 'admin_A', { via: 'survey', spaceId: 'sp-1', surveyId: 'sv1' })));
      await assertSucceeds(emp('A', 2).collection('assetChecks').doc(id).get());
      await assertSucceeds(emp('A', 2).collection('assetChecks').where('organizationId', '==', 'org-A').get());
      await assertFails(emp('B', 1).collection('assetChecks').doc(id).get());
      await assertFails(anon().collection('assetChecks').doc(id).get());
      await assertFails(emp('A', 1).collection('assetChecks').doc(id).delete());
    });

    it('#C2 다른 사람 이름·다른 기관 자리·정해지지 않은 값은 막힌다', async () => {
      const db = emp('A', 1);
      await assertFails(db.collection('assetChecks').doc('org-A__2').set(checkDoc('A', 'org-A__2', 'emp_A2')));
      await assertFails(db.collection('assetChecks').doc('org-B__2').set(checkDoc('B', 'org-B__2', 'emp_A1')));
      await assertFails(db.collection('assetChecks').doc('org-B__3').set(checkDoc('A', 'org-B__3', 'emp_A1')));
      await assertFails(db.collection('assetChecks').doc('org-A__4').set(checkDoc('A', 'org-A__5', 'emp_A1')));
      await assertFails(db.collection('assetChecks').doc('org-A__6').set(checkDoc('A', 'org-A__6', 'emp_A1', { via: 'manual' })));
      await assertFails(db.collection('assetChecks').doc('org-A__7').set(checkDoc('A', 'org-A__7', 'emp_A1', { memo: 'x' })));
      await assertFails(db.collection('assetChecks').doc('org-A__8').set(checkDoc('A', 'org-A__8', 'emp_A1', { checkedAt: new Date(2020, 0, 1) })));
    });

    it('#S6 조사 방식(surveyMode)은 정해진 값만 저장된다', async () => {
      const db = admin('A');
      await assertSucceeds(db.collection('organizations').doc('org-A').update({ surveyMode: 'solo' }));
      await assertSucceeds(db.collection('organizations').doc('org-A').update({ surveyMode: 'delegated' }));
      await assertFails(db.collection('organizations').doc('org-A').update({ surveyMode: 'anyone' }));
      await assertFails(emp('A', 1).collection('organizations').doc('org-A').update({ surveyMode: 'solo' }));
    });

    // ── 재물 (기획서 F04~F08) ──
    const assetDoc = (org: 'A' | 'B', uid: string, extra: Record<string, unknown> = {}) => ({
      organizationId: `org-${org}`, code: '1-1-1', name: 'TV', category: '비품', spec: null, acquiredAt: '2021-03-13',
      acquiredQuantity: 1, quantity: 1, status: 'active', statusRaw: '운영', locationRaw: '101호', spaceId: null,
      department: null, usage: null, missingFromSource: false, lastImportId: 'imp1',
      createdAt: serverTs(), updatedAt: serverTs(), lastEditedByUid: uid, ...extra,
    });
    const seedAsset = async (id: string, org: 'A' | 'B') => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.collection('assets').doc(id).set({ ...assetDoc(org, `admin_${org}`), createdAt: at, updatedAt: at });
        await db.collection('assetAccounting').doc(id).set({
          organizationId: `org-${org}`, amount: 450000, depreciation: 449000, residual: 1000, updatedAt: at, lastEditedByUid: `admin_${org}`,
        });
      });
    };

    it('#A1 재물은 같은 기관이 읽고, 금액은 그 기관 관리자만 읽는다', async () => {
      await seedAsset('org-A__1-1-1', 'A');
      await assertSucceeds(emp('A', 1).collection('assets').doc('org-A__1-1-1').get());
      await assertSucceeds(emp('A', 1).collection('assets').where('organizationId', '==', 'org-A').get());
      await assertFails(emp('B', 1).collection('assets').doc('org-A__1-1-1').get());
      await assertFails(anon().collection('assets').doc('org-A__1-1-1').get());

      await assertSucceeds(admin('A').collection('assetAccounting').doc('org-A__1-1-1').get());
      await assertFails(emp('A', 1).collection('assetAccounting').doc('org-A__1-1-1').get());
      await assertFails(emp('A', 1).collection('assetAccounting').where('organizationId', '==', 'org-A').get());
      await assertFails(admin('B').collection('assetAccounting').doc('org-A__1-1-1').get());
    });

    it('#A2 재물 등록은 그 기관 관리자만, 문서 ID는 기관ID__코드 꼴이어야 한다', async () => {
      await assertSucceeds(admin('A').collection('assets').doc('org-A__1-1-1').set(assetDoc('A', 'admin_A')));
      await assertFails(admin('A').collection('assets').doc('org-B__1-1-1').set(assetDoc('A', 'admin_A')));
      await assertFails(admin('A').collection('assets').doc('random-id').set(assetDoc('A', 'admin_A')));
      await assertFails(emp('A', 1).collection('assets').doc('org-A__9').set(assetDoc('A', 'emp_A1')));
      await assertFails(admin('B').collection('assets').doc('org-A__9').set(assetDoc('A', 'admin_B')));

      const acc = { organizationId: 'org-A', amount: 1000, depreciation: null, residual: 0, updatedAt: serverTs(), lastEditedByUid: 'admin_A' };
      await assertSucceeds(admin('A').collection('assetAccounting').doc('org-A__1-1-1').set(acc));
      await assertFails(emp('A', 1).collection('assetAccounting').doc('org-A__2').set({ ...acc, lastEditedByUid: 'emp_A1' }));
      await assertFails(admin('A').collection('assetAccounting').doc('org-A__3').set({ ...acc, amount: '천원' }));
    });

    it('#A3 재물·금액은 아무도 지울 수 없다', async () => {
      await seedAsset('org-A__1-1-1', 'A');
      for (const db of [admin('A'), superAdmin()]) {
        await assertFails(db.collection('assets').doc('org-A__1-1-1').delete());
        await assertFails(db.collection('assetAccounting').doc('org-A__1-1-1').delete());
      }
    });

    it('#A4 재물 형식 — 모르는 상태·모르는 필드·빈 코드·스탬프 없음은 막힌다', async () => {
      const db = admin('A');
      await assertFails(db.collection('assets').doc('org-A__x1').set(assetDoc('A', 'admin_A', { status: 'lost' })));
      await assertFails(db.collection('assets').doc('org-A__x2').set(assetDoc('A', 'admin_A', { owner: '홍길동' })));
      await assertFails(db.collection('assets').doc('org-A__x3').set(assetDoc('A', 'admin_A', { code: '' })));
      await assertFails(db.collection('assets').doc('org-A__x4').set(assetDoc('A', 'emp_A1')));
      await assertFails(db.collection('assets').doc('org-A__x5').set(assetDoc('A', 'admin_A', { quantity: '한 개' })));
    });

    it('#A5 재물 수정은 코드·기관을 바꿀 수 없다', async () => {
      await seedAsset('org-A__1-1-1', 'A');
      const db = admin('A');
      const upd = { updatedAt: serverTs(), lastEditedByUid: 'admin_A' };
      await assertSucceeds(db.collection('assets').doc('org-A__1-1-1').update({ ...upd, missingFromSource: true }));
      await assertFails(db.collection('assets').doc('org-A__1-1-1').update({ ...upd, code: '9-9-9' }));
      await assertFails(db.collection('assets').doc('org-A__1-1-1').update({ ...upd, organizationId: 'org-B' }));
      await assertFails(emp('A', 1).collection('assets').doc('org-A__1-1-1').update({ ...upd, lastEditedByUid: 'emp_A1', name: '바꿈' }));
    });

    it('#A6 가져오기 기록·변경 이력은 관리자가 만들고 아무도 고치거나 지우지 못한다', async () => {
      const db = admin('A');
      const imp = {
        organizationId: 'org-A', fileName: '대장.xlsx', sheetName: '시트1', columnMap: { code: '자산코드' },
        counts: { total: 1, active: 1, inactive: 0, disposed: 0 }, diff: { added: 1, changed: 0, missing: 0, unchanged: 0 },
        amountTotal: 1000, reportedTotal: null, lastEditedByUid: 'admin_A', confirmedAt: serverTs(),
      };
      await assertSucceeds(db.collection('imports').doc('imp1').set(imp));
      await assertFails(db.collection('imports').doc('imp1').update({ fileName: '바꿈' }));
      await assertFails(db.collection('imports').doc('imp1').delete());
      await assertFails(emp('A', 1).collection('imports').doc('imp2').set({ ...imp, lastEditedByUid: 'emp_A1' }));
      await assertFails(emp('A', 1).collection('imports').doc('imp1').get());

      const hist = {
        organizationId: 'org-A', assetId: 'org-A__1-1-1', code: '1-1-1', type: 'import-change',
        changes: { name: { before: 'TV', after: '모니터' } }, importId: 'imp1', lastEditedByUid: 'admin_A', at: serverTs(),
      };
      await assertSucceeds(db.collection('history').doc('h1').set(hist));
      await assertFails(db.collection('history').doc('h1').update({ code: '바꿈' }));
      await assertFails(db.collection('history').doc('h1').delete());
      await assertFails(db.collection('history').doc('h2').set({ ...hist, assetId: 'org-B__1' }));
      await assertFails(db.collection('history').doc('h3').set({ ...hist, type: 'free-text' }));
      // 직접 등록·수정 이력(2026-11-22)
      await assertSucceeds(db.collection('history').doc('h4').set({ ...hist, type: 'manual-create', changes: {}, importId: null }));
      await assertSucceeds(db.collection('history').doc('h5').set({ ...hist, type: 'manual-edit', importId: null }));
      // 직접 등록 재물 표시(manual)는 참·거짓만, 직원은 등록할 수 없다
      await assertSucceeds(db.collection('assets').doc('org-A__m-1').set(assetDoc('A', 'admin_A', { code: 'm-1', manual: true, lastImportId: null })));
      await assertFails(db.collection('assets').doc('org-A__m-2').set(assetDoc('A', 'admin_A', { code: 'm-2', manual: 'yes' })));
      await assertFails(emp('A', 1).collection('assets').doc('org-A__m-3').set(assetDoc('A', 'emp_A1', { code: 'm-3', manual: true })));
      // 내용연수(2026-11-22)는 0~100 숫자 또는 null, 없어도 된다(예전 문서)
      await assertSucceeds(db.collection('assets').doc('org-A__u-1').set(assetDoc('A', 'admin_A', { code: 'u-1', usefulLife: 5 })));
      await assertSucceeds(db.collection('assets').doc('org-A__u-2').set(assetDoc('A', 'admin_A', { code: 'u-2', usefulLife: null })));
      await assertFails(db.collection('assets').doc('org-A__u-3').set(assetDoc('A', 'admin_A', { code: 'u-3', usefulLife: '5년' })));
      await assertFails(db.collection('assets').doc('org-A__u-4').set(assetDoc('A', 'admin_A', { code: 'u-4', usefulLife: 101 })));
      await assertFails(db.collection('assets').doc('org-A__u-5').set(assetDoc('A', 'admin_A', { code: 'u-5', usefulLife: -1 })));
      // 대표 사진 값(2026-11-22)은 글자 또는 null
      await assertSucceeds(db.collection('assets').doc('org-A__p-1').set(assetDoc('A', 'admin_A', {
        code: 'p-1', photoUrl: 'https://x/y.jpg', photoThumbUrl: 'https://x/t.jpg', photoPath: 'organizations/org-A/assets/org-A__p-1/photo-1.jpg', photoThumbPath: null,
      })));
      await assertFails(db.collection('assets').doc('org-A__p-2').set(assetDoc('A', 'admin_A', { code: 'p-2', photoUrl: 123 })));
      await assertFails(emp('A', 1).collection('history').doc('h1').get());
    });

    it('#A7 기관의 열·위치 연결은 맵으로만 저장된다', async () => {
      const db = admin('A');
      await assertSucceeds(db.collection('organizations').doc('org-A').update({
        importColumnMap: { code: '자산코드' }, locationSpaceMap: { '101호': 'sp1' },
      }));
      await assertFails(db.collection('organizations').doc('org-A').update({ importColumnMap: '자산코드' }));
      await assertFails(db.collection('organizations').doc('org-A').update({ locationSpaceMap: ['sp1'] }));
    });

    it('#A8 QR 태그는 형식이 맞아야 하고, 한 번 정하면 바꾸거나 지울 수 없다 (기획서 F09)', async () => {
      await seedAsset('org-A__1-1-1', 'A');
      const ref = (db: ReturnType<typeof admin>) => db.collection('assets').doc('org-A__1-1-1');
      const upd = { updatedAt: serverTs(), lastEditedByUid: 'admin_A' };
      // 형식: 헷갈리는 글자(I·L·O·U) 없는 대문자·숫자 10자
      await assertFails(ref(admin('A')).update({ ...upd, tagId: 'abcdefgh23' }));
      await assertFails(ref(admin('A')).update({ ...upd, tagId: 'ABCDEFGHIO' }));
      await assertFails(ref(admin('A')).update({ ...upd, tagId: 'ABC' }));
      // 직원은 발급하지 못한다
      await assertFails(ref(emp('A', 1)).update({ updatedAt: serverTs(), lastEditedByUid: 'emp_A1', tagId: 'ABCDEFGH23' }));
      // 관리자 발급
      await assertSucceeds(ref(admin('A')).update({ ...upd, tagId: 'ABCDEFGH23' }));
      // 바꾸기·지우기 금지, 같은 값 유지와 다른 필드 수정은 된다(다시 가져오기)
      await assertFails(ref(admin('A')).update({ ...upd, tagId: 'ZZZZZZZZZZ' }));
      await assertFails(ref(admin('A')).update({ ...upd, tagId: null }));
      await assertSucceeds(ref(admin('A')).update({ ...upd, name: '모니터' }));
      // 직원은 태그로 내 기관 재물을 찾을 수 있고, 다른 기관은 못 찾는다
      await assertSucceeds(emp('A', 1).collection('assets').where('organizationId', '==', 'org-A').where('tagId', '==', 'ABCDEFGH23').get());
      await assertFails(emp('B', 1).collection('assets').where('organizationId', '==', 'org-A').where('tagId', '==', 'ABCDEFGH23').get());
    });

    it('#A9 기관 라벨 기본 규격은 정해진 값·맵만 저장된다', async () => {
      const db = admin('A');
      await assertSucceeds(db.collection('organizations').doc('org-A').update({ labelSize: 'small' }));
      await assertSucceeds(db.collection('organizations').doc('org-A').update({
        labelSize: 'custom', labelCustom: { w: 70, h: 37, cols: 3, rows: 8, top: 0, left: 0, hpitch: 70, vpitch: 37 },
      }));
      await assertFails(db.collection('organizations').doc('org-A').update({ labelSize: 'huge' }));
      await assertFails(db.collection('organizations').doc('org-A').update({ labelCustom: '70x37' }));
    });

    // ── 조사 회차·대상·스캔 (기획서 F10~F12) ──
    const surveyDoc = (org: 'A' | 'B', extra: Record<string, unknown> = {}) => ({
      organizationId: `org-${org}`, name: '2026년 정기 재물조사', startDate: '2026-11-21', endDate: '2026-12-05',
      spaceIds: ['sp-1', 'sp-2'], includesUnassigned: true, mode: 'delegated', status: 'open', targetCount: 2,
      lastEditedByUid: `admin_${org}`, createdAt: serverTs(), ...extra,
    });
    const scanDoc = (uid: string, extra: Record<string, unknown> = {}) => ({
      organizationId: 'org-A', surveyId: 'sv1', assetId: 'org-A__1', code: '1', name: 'TV', spaceId: 'sp-1',
      expectedSpaceId: 'sp-1', result: 'ok', method: 'qr', condition: 'normal', memo: '',
      scannedByUid: uid, scannedAt: serverTs(), lastEditedByUid: uid, updatedAt: serverTs(), ...extra,
    });
    /** 공간 2개(sp-1 담당 emp_A1, sp-2 담당 emp_A2)와 열린 회차 sv1 */
    const seedSurvey = async (extra: Record<string, unknown> = {}) => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        for (const [id, mgr] of [['sp-1', 'emp_A1'], ['sp-2', 'emp_A2']]) {
          await db.collection('spaces').doc(id).set({
            organizationId: 'org-A', name: id, order: 0, managerUids: [mgr], archived: false, lastEditedByUid: 'admin_A', createdAt: at, updatedAt: at,
          });
        }
        await db.collection('surveys').doc('sv1').set({ ...surveyDoc('A'), createdAt: at, ...extra });
      });
    };

    it('#V1 회차는 그 기관 관리자만 시작하고, 대상 묶음과 함께 만든다. 고치거나 지우지 못한다', async () => {
      const db = admin('A');
      const batch = db.batch();
      batch.set(db.collection('surveys').doc('sv9'), surveyDoc('A'));
      batch.set(db.collection('surveyTargets').doc('sv9__sp-1'), {
        organizationId: 'org-A', surveyId: 'sv9', spaceId: 'sp-1', items: [{ id: 'org-A__1', code: '1', name: 'TV', tagId: null }],
        lastEditedByUid: 'admin_A', createdAt: serverTs(),
      });
      await assertSucceeds(batch.commit());

      await assertFails(emp('A', 1).collection('surveys').doc('sv8').set({ ...surveyDoc('A'), lastEditedByUid: 'emp_A1' }));
      await assertFails(admin('B').collection('surveys').doc('sv7').set(surveyDoc('A', { lastEditedByUid: 'admin_B' })));
      await assertFails(db.collection('surveys').doc('sv6').set(surveyDoc('A', { endDate: '2026-11-01' })));
      await assertFails(db.collection('surveys').doc('sv5').set(surveyDoc('A', { status: 'closed' })));
      // 회차 없는 대상
      await assertFails(db.collection('surveyTargets').doc('nope__sp-1').set({
        organizationId: 'org-A', surveyId: 'nope', spaceId: 'sp-1', items: [], lastEditedByUid: 'admin_A', createdAt: serverTs(),
      }));
      await assertFails(db.collection('surveys').doc('sv9').update({ name: '바꿈' }));
      await assertFails(db.collection('surveys').doc('sv9').delete());
      await assertFails(db.collection('surveyTargets').doc('sv9__sp-1').delete());
      // 같은 기관은 읽고, 다른 기관은 못 읽는다
      await assertSucceeds(emp('A', 2).collection('surveyTargets').doc('sv9__sp-1').get());
      await assertFails(emp('B', 1).collection('surveys').doc('sv9').get());
    });

    it('#V2 스캔은 내 담당 공간에서만 — 남의 공간·다른 기관·회차 대상 밖 공간은 막힌다', async () => {
      await seedSurvey();
      await assertSucceeds(emp('A', 1).collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      // 다른 공간 재물도 내 공간에서 찍으면 남는다(다른 공간 판정)
      await assertSucceeds(emp('A', 1).collection('scans').doc('sv1__org-A__2').set(scanDoc('emp_A1', {
        assetId: 'org-A__2', code: '2', expectedSpaceId: 'sp-2', result: 'otherSpace',
      })));
      await assertFails(emp('A', 2).collection('scans').doc('sv1__org-A__3').set(scanDoc('emp_A2', { assetId: 'org-A__3', code: '3' })));
      await assertFails(emp('B', 1).collection('scans').doc('sv1__org-A__4').set(scanDoc('emp_B1', { assetId: 'org-A__4', code: '4' })));
      await assertFails(admin('A').collection('scans').doc('sv1__org-A__5').set(scanDoc('admin_A', { assetId: 'org-A__5', code: '5', spaceId: 'sp-9' })));
      await assertSucceeds(admin('A').collection('scans').doc('sv1__org-A__6').set(scanDoc('admin_A', { assetId: 'org-A__6', code: '6', spaceId: 'sp-2' })));
      // 남의 이름·모르는 판정·ID가 회차로 시작하지 않음
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__7').set(scanDoc('emp_A2', { assetId: 'org-A__7' })));
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__8').set(scanDoc('emp_A1', { result: 'great' })));
      await assertFails(emp('A', 1).collection('scans').doc('zz__org-A__9').set(scanDoc('emp_A1')));
    });

    it('#V2b 담당 팀(2026-11-22) — 공간의 teamIds에 내 팀이 있으면 찍을 수 있고, 다른 팀이면 막힌다', async () => {
      await seedSurvey();
      const setTeam = async (teamId: string | null) => testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('users').doc('emp_A1').set({ teamId }, { merge: true });
      });
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('spaces').doc('sp-2').set({ teamIds: ['t1'] }, { merge: true });
      });
      const scan = (id: string) => emp('A', 1).collection('scans').doc(id).set(scanDoc('emp_A1', { spaceId: 'sp-2', expectedSpaceId: 'sp-2' }));
      await setTeam('t9');
      await assertFails(scan('sv1__org-A__1'));
      await setTeam('t1');
      await assertSucceeds(scan('sv1__org-A__1'));
    });

    it('#U-team 직원은 자기 팀을 바꿀 수 없고, 같은 기관 관리자는 바꿀 수 있다', async () => {
      await assertFails(emp('A', 1).collection('users').doc('emp_A1').update({ teamId: 't1', lastEditedByUid: 'emp_A1' }));
      await assertSucceeds(admin('A').collection('users').doc('emp_A1').update({ teamId: 't1', lastEditedByUid: 'admin_A' }));
    });

    // ── 팀 ──
    it('#T1 팀은 같은 기관이 읽고 관리자만 만들며 지우지 못한다', async () => {
      const team = (uid: string, extra: Record<string, unknown> = {}) => ({
        organizationId: 'org-A', name: '행정팀', order: 0, archived: false, createdAt: serverTs(), updatedAt: serverTs(), lastEditedByUid: uid, ...extra,
      });
      await assertSucceeds(admin('A').collection('teams').doc('t1').set(team('admin_A')));
      await assertFails(emp('A', 1).collection('teams').doc('t2').set(team('emp_A1')));
      await assertFails(admin('B').collection('teams').doc('t3').set(team('admin_B')));
      await assertFails(admin('A').collection('teams').doc('t4').set(team('admin_A', { name: '' })));
      await assertSucceeds(emp('A', 2).collection('teams').doc('t1').get());
      await assertFails(emp('B', 1).collection('teams').doc('t1').get());
      await assertFails(admin('A').collection('teams').doc('t1').delete());
    });

    it('#O-mgr 관리 책임자 정·부는 50자 이하 글자, 라벨 표시는 참·거짓만', async () => {
      const org = admin('A').collection('organizations').doc('org-A');
      await assertSucceeds(org.update({ managerPrimary: '관장 홍길동', managerSecondary: '사무국장 김철수', labelShowManagers: true }));
      await assertFails(org.update({ managerPrimary: '가'.repeat(51) }));
      await assertFails(org.update({ labelShowManagers: 'yes' }));
    });

    it('#V3b 현장 사진(2026-11-22) — 담당자는 스캔에 사진 값을 붙이고 지울 수 있다, 다른 값과 함께 바꾸면 막힌다', async () => {
      await seedSurvey();
      const db = emp('A', 1);
      await assertSucceeds(db.collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      const photo = { photoUrl: 'https://p/1.jpg', photoThumbUrl: 'https://p/1-t.jpg', photoPath: 'organizations/org-A/scans/sv1/a.jpg', photoThumbPath: 'organizations/org-A/scans/sv1/a-t.jpg' };
      await assertSucceeds(db.collection('scans').doc('sv1__org-A__1').update({ ...photo, updatedAt: serverTs(), lastEditedByUid: 'emp_A1' }));
      await assertFails(db.collection('scans').doc('sv1__org-A__1').update({ photoUrl: 123, updatedAt: serverTs(), lastEditedByUid: 'emp_A1' }));
      await assertFails(db.collection('scans').doc('sv1__org-A__1').update({ ...photo, result: 'otherSpace', updatedAt: serverTs(), lastEditedByUid: 'emp_A1' }));
      await assertSucceeds(db.collection('scans').doc('sv1__org-A__1').update({ photoUrl: null, photoThumbUrl: null, photoPath: null, photoThumbPath: null, updatedAt: serverTs(), lastEditedByUid: 'emp_A1' }));
    });

    it('#V3 같은 물건을 다시 찍어도 기록이 바뀌지 않는다 — 물건 상태·메모만 고친다', async () => {
      await seedSurvey();
      const ref = (db: ReturnType<typeof admin>) => db.collection('scans').doc('sv1__org-A__1');
      await assertSucceeds(ref(emp('A', 1)).set(scanDoc('emp_A1')));
      // 두 번째 저장(다른 사람·다른 판정)은 막힌다 → 수가 늘지 않는다
      await assertFails(ref(admin('A')).set(scanDoc('admin_A', { spaceId: 'sp-2', result: 'otherSpace' })));
      await assertFails(ref(emp('A', 1)).set(scanDoc('emp_A1', { method: 'manual' })));
      // 상태·메모는 그 공간 담당·관리자가 고친다
      const cond = { condition: 'damaged', memo: '다리 부러짐', updatedAt: serverTs() };
      await assertSucceeds(ref(emp('A', 1)).update({ ...cond, lastEditedByUid: 'emp_A1' }));
      await assertSucceeds(ref(admin('A')).update({ ...cond, condition: 'labelDamaged', lastEditedByUid: 'admin_A' }));
      await assertFails(ref(emp('A', 2)).update({ ...cond, lastEditedByUid: 'emp_A2' }));
      await assertFails(ref(emp('A', 1)).update({ ...cond, condition: 'lost', lastEditedByUid: 'emp_A1' }));
      // 지우기는 찍은 사람·관리자만
      await assertFails(ref(emp('A', 2)).delete());
      await assertSucceeds(ref(emp('A', 1)).delete());
    });

    it('#V4 혼자 조사 회차는 관리자만 찍고, 마감된 회차에는 아무도 못 찍는다', async () => {
      await seedSurvey({ mode: 'solo' });
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      await assertSucceeds(admin('A').collection('scans').doc('sv1__org-A__1').set(scanDoc('admin_A')));
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('surveys').doc('sv1').update({ status: 'closed' });
      });
      await assertFails(admin('A').collection('scans').doc('sv1__org-A__2').set(scanDoc('admin_A', { assetId: 'org-A__2', code: '2' })));
      await assertFails(admin('A').collection('scans').doc('sv1__org-A__1').delete());
    });

    it('#V5 스캔은 같은 기관이 읽는다(중복 확인) — 다른 기관은 못 읽는다', async () => {
      await seedSurvey();
      await assertSucceeds(emp('A', 1).collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      await assertSucceeds(emp('A', 2).collection('scans').doc('sv1__org-A__1').get());
      await assertSucceeds(emp('A', 2).collection('scans').where('organizationId', '==', 'org-A').where('surveyId', '==', 'sv1').where('expectedSpaceId', '==', 'sp-2').get());
      await assertFails(emp('B', 1).collection('scans').doc('sv1__org-A__1').get());
      // 없는 문서는 '없음'을 확인할 수 있다(다른 공간에서 찍혔는지 미리 확인) — 로그인 안 하면 못 한다
      await assertSucceeds(emp('A', 2).collection('scans').doc('sv1__org-A__404').get());
      await assertSucceeds(emp('A', 1).collection('surveySubmissions').doc('sv1__sp-1').get());
      await assertFails(anon().collection('scans').doc('sv1__org-A__404').get());
    });

    // ── 제출·승인·마감·이력·반영 목록 (기획서 F13~F17) ──
    const subDoc = (uid: string, extra: Record<string, unknown> = {}) => ({
      organizationId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', state: 'submitted',
      submittedByUid: uid, submittedAt: serverTs(), reviewedByUid: null, reviewedAt: null,
      reason: '', selfApproved: false, proxyApproved: false, lastEditedByUid: uid, updatedAt: serverTs(), ...extra,
    });
    const review = (uid: string, extra: Record<string, unknown>) => ({
      reviewedByUid: uid, reviewedAt: serverTs(), lastEditedByUid: uid, updatedAt: serverTs(), ...extra,
    });

    it('#V6 제출은 그 공간 담당자가, 검토는 관리자가 — 반려·본인 승인은 사유 필수', async () => {
      await seedSurvey();
      const ref = (db: ReturnType<typeof admin>) => db.collection('surveySubmissions').doc('sv1__sp-1');
      await assertFails(ref(emp('A', 2)).set(subDoc('emp_A2')));                       // 남의 공간
      await assertFails(emp('A', 1).collection('surveySubmissions').doc('sv1__sp-9').set(subDoc('emp_A1', { spaceId: 'sp-9' }))); // ID·공간 불일치
      await assertSucceeds(ref(emp('A', 1)).set(subDoc('emp_A1')));
      // 직원은 승인 못 함, 관리자 반려는 사유 필수
      await assertFails(ref(emp('A', 1)).update(review('emp_A1', { state: 'approved' })));
      await assertFails(ref(admin('A')).update(review('admin_A', { state: 'rejected', reason: '' })));
      await assertSucceeds(ref(admin('A')).update(review('admin_A', { state: 'rejected', reason: '창고 다시' })));
      // 반려 뒤 다시 제출 → 승인
      await assertSucceeds(ref(emp('A', 1)).set(subDoc('emp_A1')));
      await assertFails(ref(admin('A')).update(review('admin_A', { state: 'approved', selfApproved: true, reason: '거짓 본인' })));
      await assertSucceeds(ref(admin('A')).update(review('admin_A', { state: 'approved' })));
      // 승인된 것은 다시 제출·검토 못 함
      await assertFails(ref(emp('A', 1)).set(subDoc('emp_A1')));
      await assertFails(ref(admin('A')).update(review('admin_A', { state: 'rejected', reason: 'x' })));
      await assertFails(ref(admin('A')).delete());
    });

    it('#V7 본인 승인·대신 승인은 표시와 사유가 있어야 한다', async () => {
      await seedSurvey();
      const ref = admin('A').collection('surveySubmissions').doc('sv1__sp-1');
      await assertSucceeds(ref.set(subDoc('admin_A')));                                // 관리자 본인 제출
      await assertFails(ref.update(review('admin_A', { state: 'approved' })));          // 본인 승인 표시 없음
      await assertFails(ref.update(review('admin_A', { state: 'approved', selfApproved: true, reason: '' })));
      await assertSucceeds(ref.update(review('admin_A', { state: 'approved', selfApproved: true, reason: '혼자 담당' })));
      // 대신 승인 — 제출 없이, 사유 필수, 관리자만
      const proxy = {
        organizationId: 'org-A', surveyId: 'sv1', spaceId: 'sp-2', state: 'approved', submittedByUid: null, submittedAt: null,
        reviewedByUid: 'admin_A', reviewedAt: serverTs(), reason: '담당자 휴가', selfApproved: false, proxyApproved: true,
        lastEditedByUid: 'admin_A', updatedAt: serverTs(),
      };
      const pref = (db: ReturnType<typeof admin>) => db.collection('surveySubmissions').doc('sv1__sp-2');
      await assertFails(pref(admin('A')).set({ ...proxy, reason: '' }));
      await assertFails(pref(emp('A', 2)).set({ ...proxy, reviewedByUid: 'emp_A2', lastEditedByUid: 'emp_A2' }));
      await assertSucceeds(pref(admin('A')).set(proxy));
    });

    it('#V8 제출·승인된 공간은 스캔이 잠기고, 반려되면 다시 열린다. 혼자 조사 회차는 제출이 없다', async () => {
      await seedSurvey();
      const sref = (db: ReturnType<typeof admin>) => db.collection('surveySubmissions').doc('sv1__sp-1');
      await assertSucceeds(emp('A', 1).collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      await assertSucceeds(sref(emp('A', 1)).set(subDoc('emp_A1')));
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__2').set(scanDoc('emp_A1', { assetId: 'org-A__2', code: '2' })));
      await assertFails(admin('A').collection('scans').doc('sv1__org-A__3').set(scanDoc('admin_A', { assetId: 'org-A__3', code: '3' })));
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__1').update({ condition: 'damaged', memo: 'x', updatedAt: serverTs(), lastEditedByUid: 'emp_A1' }));
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__1').delete());
      // 다른 공간은 계속 찍는다
      await assertSucceeds(emp('A', 2).collection('scans').doc('sv1__org-A__5').set(scanDoc('emp_A2', { assetId: 'org-A__5', code: '5', spaceId: 'sp-2' })));
      await assertSucceeds(sref(admin('A')).update(review('admin_A', { state: 'rejected', reason: '다시' })));
      await assertSucceeds(emp('A', 1).collection('scans').doc('sv1__org-A__2').set(scanDoc('emp_A1', { assetId: 'org-A__2', code: '2' })));

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('surveys').doc('sv1').update({ mode: 'solo' });
      });
      await assertFails(admin('A').collection('surveySubmissions').doc('sv1__sp-2').set(subDoc('admin_A', { spaceId: 'sp-2' })));
    });

    it('#V9 마감은 관리자만, 정해진 필드만 — 마감 뒤에는 스캔·제출이 막힌다', async () => {
      await seedSurvey();
      const close = (uid: string, extra: Record<string, unknown> = {}) => ({
        status: 'closed', closedAt: serverTs(), closedByUid: uid, lastEditedByUid: uid,
        spaceNames: { 'sp-1': '101호' }, summary: { target: 1, found: 1 }, ...extra,
      });
      const freeze = (uid: string, status = 'closing', extra: Record<string, unknown> = {}) => ({ status, lastEditedByUid: uid, ...extra });
      // 열린 회차를 바로 닫을 수는 없다 — 먼저 '마감 중'으로 멈춘다(2026-11-24)
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A')));
      await assertFails(emp('A', 1).collection('surveys').doc('sv1').update(freeze('emp_A1')));
      await assertFails(admin('B').collection('surveys').doc('sv1').update(freeze('admin_B')));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(freeze('admin_A', 'closing', { name: '바꿈' })));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(freeze('emp_A1')));
      await assertSucceeds(admin('A').collection('surveys').doc('sv1').update(freeze('admin_A')));
      // 마감 중에는 스캔·제출이 막힌다
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      await assertFails(emp('A', 1).collection('surveySubmissions').doc('sv1__sp-1').set(subDoc('emp_A1')));
      // 마감 취소(closing → open)는 상태만 바꿔서 — 다시 찍을 수 있다
      await assertFails(emp('A', 1).collection('surveys').doc('sv1').update(freeze('emp_A1', 'open')));
      await assertSucceeds(admin('A').collection('surveys').doc('sv1').update(freeze('admin_A', 'open')));
      await assertSucceeds(emp('A', 1).collection('scans').doc('sv1__org-A__1').set(scanDoc('emp_A1')));
      await assertSucceeds(admin('A').collection('surveys').doc('sv1').update(freeze('admin_A')));
      await assertFails(emp('A', 1).collection('surveys').doc('sv1').update(close('emp_A1')));
      await assertFails(admin('B').collection('surveys').doc('sv1').update(close('admin_B')));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { name: '바꿈' })));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { closedByUid: 'emp_A1' })));
      // 마감 시점 공간 위치(2026-11-22)는 map일 때만 함께 남길 수 있다
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { spaceLocations: '본관 1층' })));
      // 마감 시점 보고서 머리(2026-11-24) — 정해진 키·모양일 때만
      const snap = { orgName: '행복복지관', approvalLine: [{ title: '담당' }], personNames: { emp_A1: '김직원' } };
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { reportSnapshot: { ...snap, extra: 1 } })));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { reportSnapshot: { ...snap, personNames: '김직원' } })));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { reportSnapshot: '행복복지관' })));
      await assertSucceeds(admin('A').collection('surveys').doc('sv1').update(close('admin_A', { spaceLocations: { 'sp-1': '본관 1층' }, reportSnapshot: snap })));
      await assertFails(admin('A').collection('surveys').doc('sv1').update({ status: 'open' }));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(freeze('admin_A', 'open')));
      await assertFails(admin('A').collection('surveys').doc('sv1').update(freeze('admin_A')));
      await assertFails(emp('A', 1).collection('scans').doc('sv1__org-A__2').set({ ...scanDoc('emp_A1'), assetId: 'org-A__2', code: '2' }));
      await assertFails(emp('A', 1).collection('surveySubmissions').doc('sv1__sp-1').set(subDoc('emp_A1')));
    });

    it('#V10 조사 이력은 생성만 — 직원은 제출 기록만, 관리자만 읽는다', async () => {
      await seedSurvey();
      const ev = (uid: string, type: string) => ({
        organizationId: 'org-A', surveyId: 'sv1', spaceId: 'sp-1', type, reason: '', targetId: null, byUid: uid, at: serverTs(),
      });
      await assertSucceeds(emp('A', 1).collection('surveyEvents').doc('e1').set(ev('emp_A1', 'submit')));
      await assertFails(emp('A', 1).collection('surveyEvents').doc('e2').set(ev('emp_A1', 'approve')));
      await assertFails(emp('A', 1).collection('surveyEvents').doc('e3').set(ev('emp_A2', 'submit')));
      await assertSucceeds(admin('A').collection('surveyEvents').doc('e4').set(ev('admin_A', 'close')));
      await assertFails(admin('A').collection('surveyEvents').doc('e5').set(ev('admin_A', 'delete-all')));
      await assertFails(admin('A').collection('surveyEvents').doc('e1').update({ reason: '바꿈' }));
      await assertFails(admin('A').collection('surveyEvents').doc('e1').delete());
      await assertSucceeds(admin('A').collection('surveyEvents').doc('e1').get());
      await assertFails(emp('A', 1).collection('surveyEvents').doc('e1').get());
      await assertFails(admin('B').collection('surveyEvents').doc('e6').set({ ...ev('admin_B', 'close'), organizationId: 'org-B' }));
    });

    it('#V11 희망이음 반영 목록 — 마감 중(멈춘 뒤)에 관리자가 만들고, 처리 완료만 체크한다', async () => {
      await seedSurvey();
      const task = {
        organizationId: 'org-A', surveyId: 'sv1', kind: 'move', assetId: 'org-A__1', code: '1', name: 'TV',
        fromSpaceId: 'sp-1', toSpaceId: 'sp-2', memo: '', done: false, doneByUid: null, doneAt: null,
      };
      const ref = (db: ReturnType<typeof admin>) => db.collection('syncTasks').doc('sv1__move__org-A__1');
      // 열린 회차(아직 결과가 바뀔 수 있을 때)에는 만들지 못한다(2026-11-24)
      await assertFails(ref(admin('A')).set(task));
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('surveys').doc('sv1').update({ status: 'closing' });
      });
      await assertFails(ref(emp('A', 1)).set(task));
      await assertFails(ref(admin('A')).set({ ...task, done: true }));
      await assertSucceeds(ref(admin('A')).set(task));
      await assertSucceeds(ref(admin('A')).set(task)); // 마감 재시도 — 같은 내용
      // 마감 뒤 체크
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('surveys').doc('sv1').update({ status: 'closed' });
      });
      await assertFails(admin('A').collection('syncTasks').doc('sv1__move__org-A__2').set({ ...task, assetId: 'org-A__2' }));
      await assertFails(ref(admin('A')).update({ done: true, doneByUid: 'emp_A1', doneAt: serverTs() }));
      await assertFails(ref(admin('A')).update({ code: '바꿈' }));
      await assertSucceeds(ref(admin('A')).update({ done: true, doneByUid: 'admin_A', doneAt: serverTs() }));
      await assertSucceeds(ref(admin('A')).update({ done: false, doneByUid: null, doneAt: null }));
      await assertFails(ref(admin('A')).delete());
      await assertFails(ref(emp('A', 1)).get());
    });
  });

  // 직원 화면 더보기 › 기관 나가기 — 문서 삭제는 superAdmin 전용이라 본인은 소속만 비우는 update 분기를 쓴다.
  // (예전 화면은 deleteDoc을 불러 직원이 항상 permission-denied를 받았다.)
  it('29. 본인 기관 나가기 — 소속 비우기 update는 허용, users 문서 삭제는 superAdmin만', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('emp_A').set({
        email: 'emp@example.com', name: '직원A', role: 'employee', organizationId: 'org-A', status: 'active',
      });
      await db.collection('users').doc('emp_A2').set({
        email: 'emp2@example.com', name: '직원A2', role: 'employee', organizationId: 'org-A', status: 'active',
      });
      await db.collection('users').doc('admin_A').set({
        email: 'admin@example.com', name: '관리자A', role: 'admin', organizationId: 'org-A',
      });
    });
    const empDb = setupContext('emp_A', { role: 'employee', orgId: 'org-A' }).firestore();
    const emp2Db = setupContext('emp_A2', { role: 'employee', orgId: 'org-A' }).firestore();
    const adminDb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    const leave = { organizationId: null, role: 'employee' };

    // 직원은 본인 문서라도 삭제할 수 없다 — 예전 기관 나가기가 실패하던 경로
    await assertFails(empDb.collection('users').doc('emp_A').delete());

    // 본인 탈퇴 분기에 기대는 우회는 막힌다
    await assertFails(empDb.collection('users').doc('emp_A').update({ organizationId: 'org-B', role: 'employee' })); // 다른 기관으로 옮겨 타기
    await assertFails(empDb.collection('users').doc('emp_A').update({ ...leave, status: 'disabled' })); // 상태 필드 동반 변경
    await assertFails(emp2Db.collection('users').doc('emp_A').update(leave)); // 동료의 소속 비우기
    await assertFails(empDb.collection('users').doc('emp_A').update({ ...leave, lastEditedByUid: 'emp_A2' })); // 행위자 위조

    // 정상 경로: 본인이 소속을 비운다 (clearUserOrganization과 같은 payload)
    await assertSucceeds(empDb.collection('users').doc('emp_A').update({ ...leave, lastEditedByUid: 'emp_A' }));

    // 관리자도 같은 분기로 나갈 수 있다 — role은 employee로만 내려간다
    await assertFails(adminDb.collection('users').doc('admin_A').update({ organizationId: null, role: 'admin' }));
    await assertSucceeds(adminDb.collection('users').doc('admin_A').update({ ...leave, lastEditedByUid: 'admin_A' }));

    // 대조군: superAdmin의 멤버 제거(문서 삭제)는 허용된다
    await assertSucceeds(superDb.collection('users').doc('emp_A2').delete());
  });
});
