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
| Focus | `--focus` | `#2563eb` | `#60a5fa` | 포커스 링과 입력 accent |
| Panel shadow | `--shadow-panel` | `#1f29370a` | `#1f29370a` | 단일 패널 그림자 |

색상은 의미가 있는 상호작용과 계층에만 사용한다. 본문 대비는 WCAG AA 이상을 유지한다.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---|---|---|---|
| H1 | `--font-h1` (`1.75rem`) | `--weight-bold` (700) | `--line-heading` (1.25) | 페이지 제목 |
| Body | `--font-body` (`1rem`) | 400 | `--line-body` (1.6) | 설명과 선택지 |
| Small | `--font-small` (`.875rem`) | 400 | `--line-body` (1.6) | 입력 그룹 안내 |
| Action | `--font-body` (`1rem`) | `--weight-bold` (700) | `--line-action` (1.25) | 제출 버튼 |

Primary stack: `"SF Pro Display", "Helvetica Neue", system-ui, sans-serif`.
제목 자간은 `--tracking-h1` (`-.02em`)을 사용한다.
한국어는 `word-break: keep-all`과 `overflow-wrap: break-word`로 의미 단위 줄바꿈을 우선한다.

## 4. Spacing & Layout

기본 단위는 4px이다. `--space-2` 8px, `--space-3` 12px, `--space-4` 16px,
`--space-6` 24px, `--space-8` 32px을 사용한다. 패널 최대 너비는 34rem이며 화면 가장자리에
16px 안전 여백을 둔다. 375px부터 한 열로 자연스럽게 축소되어야 한다.
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
- Validation: 디바이스 권한이 없으면 같은 화면의 `role="alert"`로 복구 방법 안내
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
