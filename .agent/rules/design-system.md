---
description: 재물조사 앱 디자인 시스템 규칙. 새 컴포넌트를 만들거나, 기존 UI를 수정할 때 반드시 참고한다.
---

# 🎨 디자인 시스템

이 문서는 재물조사 앱의 **디자인 일관성**을 유지하기 위한 규칙이다.
새 컴포넌트를 만들거나 기존 UI를 수정할 때 반드시 따른다.

---

## 1. 색상 팔레트

> `src/index.css`의 `@theme`에 정의된 커스텀 색상 토큰만 사용한다. Tailwind 기본 `blue`, `green`, `slate` 등을 직접 쓰지 않는다.
> **자동 검사**: [scripts/__tests__/designTokens.test.ts](../../scripts/__tests__/designTokens.test.ts)가 `src/`에서 아래 표에 없는 기본 색상 계열을 찾으면 실패한다(2026-11-24 — 규칙만 있던 동안 266곳까지 쌓여 184곳을 옮겼다).

| 토큰 | 용도 | 실제 색상 |
|------|------|-----------|
| `primary-*` | 브랜드 색상, 주요 버튼, 활성 상태, 링크 | Deep Blue 계열 (`#1e52a8` 기준) |
| `accent-*` | 성공, 긍정적 상태, 승인 | Green 계열 (`#16a34a` 기준) |
| `surface-*` | 배경, 텍스트, 보더, 비활성 상태 | Slate 계열 (`#f8fafc` ~ `#0f172a`) |
| `red-*` | 위험, 삭제, 에러, 미등록 판정 | Tailwind red (허용 예외) |
| `amber-*` | 경고, 다른 공간 판정, 마감 중 | Tailwind amber (허용 예외) |

#### 상태 색상 — 의미별로 고른다

| 의미 | 쓰는 토큰 | 예 |
|---|---|---|
| 성공·승인·확인됨 | `accent-*` | 스캔 '확인', 승인됨, 성공 토스트 |
| 정보·진행 중·이미 처리됨 | `primary-*` | 제출됨, 이미 찍은 재물, 안내 상자 |
| 경고 | `amber-*` | 다른 공간, 마감 중, 경고 토스트 |
| 위험·오류 | `red-*` | 미등록, 삭제, 오류 토스트 |
| 중립·장식 | `surface-*` | 회색 칩, 장식 상자 |

옮길 때 대응(값이 같은 것은 화면이 그대로다): `blue`→`primary`(같은 값), `green`→`accent`(같은 값), `emerald`→`accent`, `sky`·`indigo`→`primary`, `gray`·`slate`→`surface`, `yellow`·`orange`→`amber`, 그 밖의 장식색(`purple` 등)→`surface`.

### 주요 사용 패턴
- **배경**: `bg-surface-50` (앱 전체), `bg-white` (카드, 사이드바)
- **텍스트**: `text-surface-900` (제목), `text-surface-700` (본문), `text-surface-500` (보조·힌트 — 가장 옅은 읽는 글자). `text-surface-400`·`300`은 장식 전용(아래 대비 규칙)
- **보더**: `border-surface-100` (구분선), `border-surface-200` (인풋/카드)
- **아이콘 배경**: `bg-primary-100 text-primary-600` (기본), `bg-accent-50 text-accent-600` (성공), `bg-amber-50 text-amber-600` (경고)

### 글자 대비 규칙 (WCAG 1.4.3 · 1.4.11)

> **읽어야 하는 글자는 배경 대비 4.5:1 이상, 아이콘만 있는 버튼은 3:1 이상.** 라벨·보조 설명·날짜·빈 상태 안내·「초기화」 같은 글자 버튼·placeholder가 모두 "읽어야 하는 글자"다.

| 글자색 | 흰 바탕 | `surface-50` | `surface-100` | 다크 `surface-950` | `surface-900` | `surface-800` | `surface-700` |
|--------|--------|------|------|------|------|------|------|
| `surface-300` | 1.48 | 1.42 | 1.36 | 13.59 | 12.02 | 9.85 | 6.97 |
| `surface-400` | 2.56 | 2.45 | 2.34 | 7.87 | 6.96 | 5.71 | 4.04 |
| `surface-500` | **4.76** | **4.55** | 4.34 | 4.24 | 3.75 | 3.07 | 2.18 |
| `surface-600` | 7.58 | 7.24 | **6.92** | 2.66 | 2.36 | 1.93 | 1.37 |

- **라이트에서 읽는 글자의 하한은 `text-surface-500`**, 다크에서는 `dark:text-surface-400`. 그래서 보조 글자는 항상 `text-surface-500 dark:text-surface-400`로 쓴다. 거꾸로 된 `text-surface-400 dark:text-surface-500`는 라이트 2.56:1·다크 3.07:1로 양쪽 다 미달이다.
- **회색 칩 배경 위**(`bg-surface-100` / `dark:bg-surface-700`)에서는 한 단계 진하게 `text-surface-600 dark:text-surface-300`을 쓴다. `surface-500`은 `surface-100` 위에서 4.34:1, `surface-400`은 `surface-700` 위에서 4.04:1로 미달이다.
- **다크 페어링을 빠뜨리지 않는다.** `text-surface-500`만 쓰면 다크에서도 `surface-500`(3.07:1)으로 남는다. 공통 클래스(`btn-ghost`, `input`)의 다크 색도 인라인 `text-surface-*` 유틸리티가 덮어쓰므로, 인라인으로 글자색을 주면 `dark:`도 같이 쓴다.
- **`text-surface-400`(다크 `dark:text-surface-500`)·`text-surface-300`을 써도 되는 곳**: 글자 옆에 붙은 장식 아이콘(svg 자체, 검색칸 돋보기, 펼침 화살표), 「~」「|」「·」「→」 같은 구분 기호, 로딩 스피너, `disabled` 상태. 대비 기준이 면제되는 곳이다.
- **`--color-surface-400` 토큰 값을 바꿔 해결하지 않는다.** 4.5:1을 맞추면 `surface-500`과 같은 색이 되어 단계가 사라지고, 다크에서 본문 보조 글자로 쓰는 `dark:text-surface-400`(5.71:1)과 보더·포커스 링(`focus:ring-surface-400`)까지 함께 어두워진다.

### 다크 모드 필수 규칙

> **인라인으로 색상을 지정할 때는 반드시 `dark:` 변형을 함께 작성한다.**
> 공통 클래스(`glass-card`, `btn-*`, `badge-*`, `input` 등)는 이미 다크 모드가 포함되어 있으므로 추가 불필요.

| 라이트 모드 | 다크 모드 페어링 | 용도 |
|-------------|------------------|------|
| `text-surface-900` | `dark:text-surface-100` | 제목 |
| `text-surface-700` | `dark:text-surface-300` | 본문 |
| `text-surface-600` | `dark:text-surface-300` | 데이터 값 |
| `text-surface-500` | `dark:text-surface-400` | 라벨, 보조 텍스트, 힌트, 날짜, placeholder |
| `text-surface-600` (회색 칩 위) | `dark:text-surface-300` | `bg-surface-100 dark:bg-surface-700` 위 글자 |
| `text-surface-400` | `dark:text-surface-500` | 장식 아이콘·구분 기호 전용 (읽는 글자 금지) |
| `bg-surface-50` | `dark:bg-surface-800` | 행/섹션 배경 |
| `bg-{color}-50` | `dark:bg-{color}-900/20~30` | 컬러 카드 배경 |
| `border-{color}-100~200` | `dark:border-{color}-800/40~50` | 컬러 카드 보더 |
| `text-{color}-600~700` | `dark:text-{color}-400` | 컬러 텍스트 (숫자, 배지) |
| `bg-{color}-100` | `dark:bg-{color}-900/50` | 컬러 배지 배경 |

**체크리스트**: 새 컴포넌트를 만들거나 인라인 색상을 추가할 때, 위 표를 참고하여 `dark:` 변형이 빠지지 않았는지 확인한다.

---

## 2. 타이포그래피

- **폰트**: Pretendard (한글 최적화), Inter (영문 폴백)
- **줄 높이**: Tailwind 기본 사용

| 용도 | 클래스 |
|------|--------|
| 페이지 제목 (관리자) | `text-2xl font-bold text-surface-900` |
| 페이지 제목 (직원) | `text-xl font-bold text-surface-900` |
| 섹션 제목 | `text-lg font-semibold text-surface-900` |
| 소제목/그룹 레이블 | `text-sm font-semibold text-surface-600` |
| 본문 | `text-sm text-surface-700` |
| 보조 텍스트 | `text-sm text-surface-500` 또는 `text-xs text-surface-500` (+ `dark:text-surface-400`) |
| 날짜/시간 | `text-sm text-surface-500` (+ `dark:text-surface-400`) |
| 숫자/데이터 | `font-mono` 추가 |

---

## 3. 컴포넌트 스타일

> `index.css`의 `@layer components`에 정의된 클래스를 **우선 사용**한다. 인라인 TailwindCSS보다 공통 클래스를 선호한다.

### 3.1 카드
```
glass-card     — 기본 솔리드 카드: 흰 배경 + 선명한 1px 보더 + 미세 그림자 + rounded-2xl (다크: surface-900 + surface-800 보더)
glass-card p-5 — 일반 콘텐츠 카드 (padding 5)
glass-card p-4 — 콤팩트 카드 (예약·스캔 현황 등)
```
- **빈 상태 (Empty State)**: `glass-card p-8 text-center` + 아이콘 컨테이너(`w-12 h-12 rounded-2xl`) + 설명 텍스트
- **리스트 아이템**: `glass-card p-4 hover:shadow-glass-lg transition-all`

### 3.2 버튼
```
btn-primary    — 주요 액션 (파란색, 그림자)
btn-secondary  — 보조 액션 (회색 배경, 보더)
btn-danger     — 삭제/위험 (빨간색)
btn-success    — 승인/성공 (초록색)
btn-ghost      — 텍스트 버튼 (배경 없음)
btn-sm         — 작은 크기 수정자
btn-lg         — 큰 크기 수정자
btn-icon       — 아이콘 전용 (정사각형 패딩)
```
- **조합 예시**: `btn-primary btn-sm`, `btn-icon btn-ghost`
- **비활성**: `disabled:opacity-50 disabled:cursor-not-allowed`는 `btn` 베이스에 포함

### 3.3 인풋
```
input          — 기본 입력 필드 (w-full, rounded-xl, border)
input-error    — 에러 상태
label          — 폼 레이블 (text-sm font-medium text-surface-700 mb-1.5)
```
- **select**: `input` 클래스 동일 적용, 또는 커스텀 스타일
- **시간 입력**: `input text-sm px-2`

### 3.4 뱃지
```
badge-primary  — 기본 (파란색)
badge-success  — 성공 (초록색)
badge-warning  — 경고 (노란색)
badge-danger   — 위험 (빨간색)
badge-neutral  — 중립 (회색)
```

### 3.5 모달
- 공용 모달 컴포넌트 [Modal.tsx](../../src/components/common/Modal.tsx)를 우선 사용한다(`document.body` Portal, 포커스 트랩, ESC 닫기, 열기 버튼으로 초점 복원 포함).
```jsx
// 오버레이 톤
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]">
  // 모달 본체
  <div className="glass-card p-5 w-full max-w-md animate-scale-in">
    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">제목</h2>
    ...
    <div className="flex gap-3 pt-2">
      <button className="btn-secondary flex-1">취소</button>
      <button className="btn-primary flex-1">확인</button>
    </div>
  </div>
</div>
```

---

## 4. 레이아웃

### 4.1 관리자 (PC 중심)
- 좌측 사이드바 (`w-64`, `bg-white`, `border-r`) + 우측 메인 콘텐츠
- 상단 헤더: `sticky top-0 z-[45] bg-white/90 backdrop-blur-md border-b h-14`
- 콘텐츠 영역: `p-4 lg:p-6`
- 콘텐츠 최대 폭 (2단계 규칙):
  - **목록·대시보드·현황판·보고서형**: `max-w-5xl mx-auto` (`AdminDashboard`, `AssetList`, `SpaceManager`, `EmployeeManager`, `SurveyManager`, `SurveyReport`)
  - **집중 폼·설정·로그형**: `max-w-3xl mx-auto` (`Settings`, `AssetForm`, `AssetImport`, `AuditLogViewer`, `UnplacedAssets`)
- 사이드바 반응형: 모바일에서 오버레이로 전환 (`lg:static`, `-translate-x-full lg:translate-x-0`), 모바일 서랍 닫기(`✕`) 버튼 포함

### 4.2 직원 (모바일 중심)
- 상단 헤더: `sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b h-14`
- 하단 탭 바: `fixed bottom-0 bg-white/90 backdrop-blur-md border-t h-16`
- 콘텐츠 영역: `p-4 pb-20` (하단 탭 바 여유 공간)
- 콘텐츠 최대 폭: `max-w-lg mx-auto`

### 4.3 그리드
- **통계 카드**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`
- **달력 + 사이드 패널**: `grid grid-cols-1 lg:grid-cols-3 gap-6` (달력 2칸, 패널 1칸)
- **차량 선택**: `grid grid-cols-3 gap-1.5`
- **시간 입력 2칸**: `grid grid-cols-2 gap-2`

---

## 5. 아이콘 규칙

- **라이브러리**: Heroicons (outline, strokeWidth 1.5~1.8) — **시스템 이모지 대신 Heroicons SVG를 우선 사용**한다(OS별 렌더링 편차 방지).
- **사이드바/탭 아이콘**: `w-5 h-5` (사이드바), `w-6 h-6` (모바일 탭)
- **버튼 내 아이콘**: `w-4 h-4` (btn-sm), `w-5 h-5` (기본)
- **아이콘 컨테이너**: 정사각형 배경 + rounded
  - 대: `w-12 h-12 rounded-2xl` (빈 상태, 스캔 버튼)
  - 중: `w-10 h-10 rounded-xl` (대시보드 통계, 빠른 작업)
  - 소: `w-8 h-8 rounded-lg` (헤더 로고)

### 대상별 색상 원칙 (토큰 단계 활용)
> 대상별 색이 필요하면 허용 토큰(`primary`·`accent`·`surface`·`amber`·`red`)의 단계로 만든다 — Tailwind 기본 색상(`blue`, `green`, `purple` 등)을 쓰면 `designTokens.test.ts` 검사에 걸린다.

---

## 6. 애니메이션 & 상호작용

### 6.1 Tailwind 커스텀 애니메이션 (`@theme`, `src/index.css`)
| 클래스 | 용도 |
|--------|------|
| `animate-fade-in` | 페이지/섹션 진입 |
| `animate-slide-up` | 바닥에서 올라오는 요소 |
| `animate-slide-down` | 위에서 내려오는 요소 (에러 메시지) |
| `animate-scale-in` | 모달, 팝업 |
| `animate-pulse-soft` | 부드러운 강조 |

### 6.2 인터랙션
- **버튼 클릭**: `active:scale-[0.98]` (btn 베이스에 포함)
- **카드 호버**: `hover:shadow-glass-lg transition-all`
- **목록 아이템 호버**: `hover:bg-surface-50` 또는 `hover:bg-surface-100`
- **링크 호버**: `hover:underline`
- **전환**: `transition-all duration-200`

---

## 7. 로딩 & 에러 상태

### 로딩 스피너
```jsx
// 전체 페이지 로딩
<div className="flex items-center justify-center py-20">
  <div className="w-8 h-8 spinner" />
</div>

// 버튼 내 로딩
<div className="w-4 h-4 spinner" /> // (btn-sm)
<div className="w-5 h-5 spinner" /> // (기본 버튼)
```

### 에러 메시지
```jsx
<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 animate-slide-down">
  에러 메시지
</div>
```

---

## 8. 반응형 규칙

| 브레이크포인트 | 대상 | 동작 |
|---------------|------|------|
| `< lg (1024px)` | 관리자 사이드바 | 숨김, 햄버거 메뉴로 토글 |
| `sm (640px)` | 통계 카드 | `grid-cols-1` → `grid-cols-2` |
| `lg (1024px)` | 통계 카드 | → `grid-cols-4` |
| `lg (1024px)` | 달력 레이아웃 | `grid-cols-1` → `grid-cols-3` |
| 모바일 전체 | 직원 화면 | 하단 탭 바 + 상단 헤더 |

- **모바일 줌 방지**: iOS 사파리는 16px보다 작은 입력칸에 포커스하면 화면을 확대한다. 모바일 폭(`< 640px`)·터치 기기에서는 `src/index.css`의 공용 규칙이 `input`·`select`·`textarea`(입력 `text-xs`·`text-sm` 포함)를 16px 이상으로 올리므로, 입력칸 글자 크기는 `text-sm`까지만 쓰고 `text-[13px]`·인라인 `fontSize`처럼 이 규칙을 비껴가는 작은 크기는 쓰지 않는다. `viewport`의 `maximum-scale`·`user-scalable=no`로 막지 않는다(확대 차단은 접근성 위반)
- **Safe area**: `safe-top`, `safe-bottom` 유틸리티 사용 (노치 대응)

