# SmartThings Gateway Design System

## 1. Atmosphere & Identity

조용하고 신뢰할 수 있는 운영 화면이다. 장식보다 권한 선택의 의미와 다음 단계가 먼저
읽혀야 하며, 따뜻한 중립 배경 위의 단일 흰색 패널이 보안 경계를 표현한다.

## 2. Color

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Canvas | `--canvas` | `#f7f6f3` | `#101820` | 페이지 배경 |
| Surface | `--surface` | `#ffffff` | `#19232d` | 권한 패널 |
| Text | `--text` | `#2f3437` | `#edf2f7` | 제목과 본문 |
| Muted text | `--text-muted` | `#667085` | `#aeb8c4` | 설명 |
| Border | `--border` | `#89919a` | `#748396` | fieldset 경계(배경 대비 3:1 이상) |
| Error | `--error` | `#b42318` | `#ffb4ab` | 제출 오류와 복구 안내 |
| Action | `--action` | `#20242a` | `#e8eef5` | 기본 버튼 |
| Action text | `--action-text` | `#ffffff` | `#17202a` | 버튼 레이블 |
| Action hover | `--action-hover` | `#353b43` | `#ffffff` | 버튼 hover |
| Subtle surface | `--surface-subtle` | `#f2f4f7` | `#23303c` | 단계와 상태 영역 |
| Success | `--success` | `#067647` | `#6ce9a6` | 연결 성공 상태 |
| Backdrop | `--backdrop` | `#101820b3` | `#101820cc` | 확인 대화상자 뒤 배경 |
| Focus | `--focus` | `#2563eb` | `#60a5fa` | 포커스 링과 입력 accent |
| Panel shadow | `--shadow-panel` | `#1f29370a` | `#1f29370a` | 단일 패널 그림자 |

색상은 의미가 있는 상호작용과 계층에만 사용한다. 본문 대비는 WCAG AA 이상을 유지한다.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---|---|---|---|
| H1 | `--font-h1` (`1.75rem`) | `--weight-bold` (700) | `--line-heading` (1.25) | 페이지 제목 |
| H1 mobile | `--font-h1-mobile` (`1.5rem`) | `--weight-bold` (700) | `--line-heading` (1.25) | 30rem 이하 페이지 제목 |
| H2 | `--font-h2` (`1.125rem`) | `--weight-bold` (700) | `--line-heading` (1.25) | 섹션 제목 |
| Body | `--font-body` (`1rem`) | 400 | `--line-body` (1.6) | 설명과 선택지 |
| Small | `--font-small` (`.875rem`) | 400 | `--line-body` (1.6) | 입력 그룹 안내 |
| Action | `--font-body` (`1rem`) | `--weight-bold` (700) | `--line-action` (1.25) | 제출 버튼 |

Primary stack: `"SF Pro Display", "Helvetica Neue", system-ui, sans-serif`.
제목 자간은 `--tracking-h1` (`-.02em`)을 사용한다.
상태 레이블 자간은 `--tracking-label` (`.08em`)을 사용한다.
한국어는 `word-break: keep-all`과 `overflow-wrap: break-word`로 의미 단위 줄바꿈을 우선한다.

## 4. Spacing & Layout

기본 단위는 4px이다. `--space-2` 8px, `--space-3` 12px, `--space-4` 16px,
`--space-6` 24px, `--space-8` 32px, `--space-12` 48px, `--space-16` 64px을 사용한다.
OAuth 패널 최대 너비는 34rem, 관리 패널은 42rem, 랜딩 패널은 64rem이며 화면 가장자리에
16px 안전 여백을 둔다. 375px부터 한 열로 자연스럽게 축소되어야 한다.
3단계 흐름과 행동 그룹은 48rem 이하에서 한 열로 전환한다.
패널 최대 너비는 `--panel-max` (`34rem`), 패널 반경은 `--radius-panel` (`.75rem`),
입력 그룹 반경은 `--radius-field` (`.5rem`)을 사용한다. 입력 크기는 `--control-size`
(`1.125rem`), 입력 상단 보정은 `--control-offset` (`.15rem`)이다. 기본 버튼 높이는
`--action-height` (`2.75rem`), 반경은 `--radius-action` (`.375rem`), 포커스 링과
offset은 `--focus-ring` (`3px`)을 사용한다.

## 5. Components

### OAuth page shell

- Source: `src/http/oauth-page.ts`
- Structure: complete document plus one `main` panel
- Responsibility: shared semantic tokens, canvas, panel, typography, phrase wrapping, responsive layout, and dark mode
- Extension: each page supplies only its body and component-specific styles

### Authorization panel

- Structure: `main > h1 + p + form`
- Spacing: `--space-4`, `--space-6`, `--space-8`
- States: 기본, 좁은 화면, 밝은 모드, 어두운 모드
- Accessibility: 단일 `main` landmark, 문서 언어 `ko`, 논리적인 제목 순서
- Motion: 없음

### Scope fieldset

- Structure: `fieldset > legend + label[]`
- States: 기본, 체크됨, 키보드 focus
- Accessibility: 네이티브 radio/checkbox와 명시적 label 사용
- Validation: 전체 리소스 권한이 없으면 제출한 디바이스 범위를 유지하고 같은 화면의
  `role="alert"`로 복구 방법 안내
- Motion: 없음

### Resource permission group

- Structure: 리소스별 `fieldset > legend + p.hint + label[]`
- Order: 디바이스 범위, 디바이스, 허브, 위치, 장면, 규칙
- Copy: 권한 동작과 대상 리소스를 함께 표시하고 OAuth scope 문자열은 보조 설명으로 제공
- Default: 선택 디바이스 범위와 상태 읽기만 선택하고 제어·쓰기 권한은 명시적 동의로 추가
- Device wording: `*` 범위는 계정 전체가 아니라 설치 principal에 연결된 모든 디바이스로 표현하고,
  `w:devices`는 이름 변경·삭제 용도로 설명
- States: 기본, 체크됨, 키보드 focus, 전체 선택 오류
- Accessibility: 각 리소스 이름을 `legend`로 제공하고 scope 문자열은 label 안의 설명으로 연결
- Validation semantics: 모든 리소스 fieldset을 감싼 단일 `role="group"`에 전역
  `aria-invalid`와 오류 설명을 연결하며, 선택적인 개별 fieldset에는 invalid 상태를 표시하지 않음
- Responsive: 375px부터 한 열을 유지하며 문서 세로 스크롤만 사용
- Motion: 없음

### Primary action

- Structure: `button[type=submit]`
- States: 기본, hover, active, focus-visible
- Accessibility: 최소 높이 44px, 3px focus ring
- Motion: active에서만 `transform` 100ms

### Credential output

- Structure: `section[aria-labelledby] > h2 + p + output`
- Spacing: `--space-3`, `--space-4`, `--space-6`
- States: OAuth 완료, 토큰 재발급 완료
- Accessibility: 토큰은 `output`과 monospace 글꼴로 구분하고 긴 문자열은 패널 안에서 줄바꿈
- Security: `Cache-Control: no-store`, URL·쿠키·브라우저 저장소에 토큰을 기록하지 않음
- Motion: 없음

### Portal navigation

- Structure: `nav[aria-label] > a.brand + ul > li > a`
- States: 기본, hover, focus-visible, 현재 페이지
- Accessibility: 목적을 설명하는 링크 문구와 44px 이상의 터치 영역
- Responsive: 좁은 화면에서 브랜드와 링크가 자연스럽게 줄바꿈

### Landing decision path

- Structure: 소개 문구와 두 행동 링크, `ol` 기반 3단계 흐름, 보안 경계 설명
- Order: 서비스 역할 → 연결 시작 → 기존 연결 관리 → 처리 흐름 → 저장하지 않는 정보
- Accessibility: 카드 나열 대신 문서 순서가 곧 의사결정 순서가 되며 제목 수준을 건너뛰지 않음
- Motion: 없음

### Token access form

- Structure: `form > label + input[type=password] + p.hint + button`
- States: 기본, focus, 제출 중, 인증 오류, 연결 성공
- Security: 토큰은 기본 가림, 성공 직후 입력값 제거, 현재 탭 메모리에만 보관
- Accessibility: 자동완성 비활성화, 오류는 `role=alert`, 제출 중 `aria-busy`

### Connection status

- Structure: 상태 요약과 `dl`, scope 목록, 교체·해제 행동
- States: 미인증, 로딩, 연결됨, 교체 완료, 연결 해제됨, API 오류
- Accessibility: 상태 변경은 `role=status`, 날짜는 `time`, 긴 scope는 줄바꿈
- Responsive: 행동은 좁은 화면에서 세로로 쌓이고 44px 높이를 유지

### Confirmation dialog

- Structure: 네이티브 `dialog > form[method=dialog]`
- States: 열림, 취소, 해제 진행, 해제 오류
- Accessibility: 제목과 설명 연결, 취소 시 시작 버튼으로 포커스 복귀
- Motion: 없음

### Secondary and destructive actions

- Secondary: 표면색 배경, 텍스트색, 1px 경계 사용
- Destructive: 오류색을 텍스트·경계에 사용하고 확인 대화상자 뒤에서만 실행
- States: hover, active, focus-visible, disabled

## 6. Motion & Interaction

장식 애니메이션은 사용하지 않는다. 제출 버튼의 active 상태만 100ms `transform`으로
`--pressed-scale` (`.98`)까지 축소해 입력을 확인시킨다. `prefers-reduced-motion`에서는
transition을 제거한다.

## 7. Depth & Surface

전략은 tonal shift와 하나의 낮은 불투명도 shadow를 결합한다. 패널 외 구성요소에는
shadow를 추가하지 않는다. fieldset은 1px border로만 구분한다.

## 8. Accessibility Constraints & Accepted Debt

- WCAG 2.2 AA: 본문 4.5:1, 큰 텍스트와 UI 경계 3:1 이상
- 모든 입력과 버튼을 키보드로 조작할 수 있어야 한다.
- 375px, 768px, 1280px에서 가로 스크롤이나 한국어 한 글자 고아 줄이 없어야 한다.
- Accepted debt: 없음
