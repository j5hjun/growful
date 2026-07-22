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
navigation, footer, 행동 그룹과 3단계 흐름은 40rem 이하에서 한 열로 전환해 태블릿에서는
가로 구조를 유지한다.
패널 최대 너비는 `--panel-max` (`34rem`), 패널 반경은 `--radius-panel` (`.75rem`),
입력 그룹 반경은 `--radius-field` (`.5rem`)을 사용한다. 입력 크기는 `--control-size`
(`1.125rem`), 입력 상단 보정은 `--control-offset` (`.15rem`)이다. 기본 버튼 높이는
`--action-height` (`2.75rem`), 반경은 `--radius-action` (`.375rem`), 포커스 링과
offset은 `--focus-ring` (`3px`)을 사용한다. 화면 하단 행동 영역은
`--safe-area-top` (`max(16px, env(safe-area-inset-top))`)과 `--safe-area-bottom`
(`max(16px, env(safe-area-inset-bottom))`)을 사용해 화면 cutout과 홈 인디케이터에 겹치지 않으며
문서의 scroll padding은 상단 안전 여백과 행동 영역 높이를 포함한다. 모든 공개 포털과 OAuth 화면은
콘텐츠 길이와 viewport 높이에 관계없이 상단 safe-area를 공통 세로 기준선으로 사용한다.
연결 관리 패널은 상단 안전 여백에 고정해 상태나 콘텐츠 길이가 바뀌어도
navigation과 주요 행동 영역의 세로 기준점이 이동하지 않게 한다.
연결 관리 입력·상태·행동 영역은 `auto 1fr auto` 그리드와 최소 블록 크기를 공유한다.
고정 높이는 사용하지 않고, 초기·로딩·오류·연결 상태가 같은 프레임과 하단 행동 슬롯을 유지한다.

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

- Structure: `1 디바이스 범위` fieldset, `2 기본 읽기` fieldset, `3 추가 권한`의 리소스별
  `details > summary + fieldset`, `4 정책 동의`, `5 행동 영역`
- Order: 디바이스 범위, 기본 디바이스 읽기, 디바이스, 허브, 위치, 장면, 규칙, 정책, 행동
- Copy: 권한 동작과 대상 리소스를 함께 표시하고 OAuth scope 문자열은 보조 설명으로 제공
- Default: 선택 디바이스 범위와 상태 읽기만 선택하고 제어·쓰기 권한은 명시적 동의로 추가
- Device wording: `*` 범위는 계정 전체가 아니라 설치 principal에 연결된 모든 디바이스로 표현하고,
  `w:devices`는 이름 변경·삭제 용도로 설명
- Elevated impact: 디바이스 명령은 물리 상태를 즉시 바꿀 수 있고, 디바이스 쓰기는 이름 변경·삭제,
  위치 실행은 모드 변경과 연동 자동화 실행 가능성, 장면 실행은 여러 디바이스의 동시 상태 변경,
  규칙 쓰기는 자동화 생성·수정·삭제 가능성을 설명한다.
- Disclosure: 추가 권한은 리소스별 native `details`로 접을 수 있고, 닫힌 `summary`에도 선택 여부와
  읽기/제어/쓰기/삭제 위험 요약을 표시한다.
- States: 기본, details 열림·닫힘, 체크됨, 키보드 focus, 전체 선택 오류
- Accessibility: 각 리소스 이름을 `legend`로 제공하고 scope 문자열은 label 안의 설명으로 연결
- Validation semantics: 모든 리소스 fieldset을 감싼 단일 `role="group"`에 전역
  `aria-invalid`와 오류 설명을 연결하며, 선택적인 개별 fieldset에는 invalid 상태를 표시하지 않음
- Responsive: 375px부터 한 열을 유지하며 문서 세로 스크롤만 사용
- Motion: 없음

### Policy consent block

- Structure: `section[aria-labelledby] > h2 + p + p[links] + label > input[required]`
- Content: 운영자명, 개인정보처리방침, 이용약관, 지원 연락처와 토큰 처리 동의를 함께 제공
- States: 미동의, 동의, 서버 검증 오류, 키보드 focus
- Accessibility: 네이티브 required checkbox와 명시적 label을 사용하고 정책 링크의 접근 가능한
  이름으로 새 탭 동작을 알림
- Responsive: 375px에서 링크와 동의 문구가 패널 안에서 의미 단위로 줄바꿈
- Motion: 없음

### Primary action

- Structure: 정책 동의 뒤 인플로우 행동 영역 안의 `button[type=submit]`과 서비스 안내 취소 링크
- States: 기본, hover, active, focus-visible
- Accessibility: 최소 높이 44px, 3px focus ring
- Overlay safety: CTA가 앞 단계보다 먼저 보이거나 본문을 덮지 않도록 현재는 인플로우로 배치한다.
  향후 sticky를 사용할 때도 별도 레이아웃 공간, `safe-area-inset-bottom`, 문서 scroll padding,
  불투명 surface 배경을 함께 적용해 순서·포커스 링·마지막 본문이 가려지지 않게 한다.
- Motion: active에서만 `transform` 100ms

### Credential output

- Structure: `section[aria-labelledby] > h2 + p + output + live feedback + primary copy + secondary recovery action`
- Spacing: `--space-3`, `--space-4`, `--space-6`
- States: OAuth 완료, 토큰 재발급 완료
- Accessibility: 토큰은 `output`과 monospace 글꼴로 구분하고 긴 문자열은 패널 안에서 줄바꿈하며, 복사 성공은 `aria-live`로 알리고 실패하면 직접 복사할 `output`으로 포커스를 이동
- Security: `Cache-Control: no-store`, URL·쿠키·브라우저 저장소에 토큰을 기록하지 않음
- Motion: 없음

### OAuth callback recovery result

- Source: `src/http/oauth-callback-result.ts`
- Structure: 상태 레이블, 안전한 제목과 설명, `다음 단계` 섹션, OAuth 재시작·서비스 안내·지원 링크
- Variants: 승인 취소, 만료·재사용·잘못된 state, scope 불일치, token 교환 실패,
  잘못된 query, callback 요청 제한, 예상하지 못한 오류
- Content: 사용자가 이해할 수 있는 복구 방법만 설명하고 OAuth code·state·토큰·원본 오류·
  사용자 식별자를 본문과 DOM 속성에 포함하지 않음
- Security: 모든 variant에 `Cache-Control: no-store`, script를 허용하지 않는 CSP,
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` 적용
- Accessibility: 단일 `main`, 순차적인 h1/h2, 44px 이상 링크, 명확한 링크 목적과
  한국어 의미 단위 줄바꿈을 유지
- Responsive: 375px부터 행동 링크를 한 열로 유지하고 200% 확대에서도 가로 스크롤이 없어야 함
- Motion: active 입력 확인 외 장식 motion 없음

### Portal navigation

- Structure: `nav[aria-label] > a.brand + ul > li > a`
- Primary links: 서비스 안내, 상태, 연결 관리만 상단에 유지
- Secondary links: 지원 안내, 개인정보 처리방침, 이용약관은 공통 footer의 보조 navigation으로 제공하고,
  운영자명과 `mailto:` 지원 이메일을 같은 footer에 표시
- States: 기본, hover, focus-visible, 현재 페이지
- Accessibility: 문서 첫 포커스 항목은 `main#main-content`를 가리키는 skip link이며, 목적을 설명하는
  링크 문구와 44px 이상의 터치 영역을 사용. 정책·지원 페이지의 현재 문서는 footer 링크에
  `aria-current="page"`로 표시
- Responsive: 좁은 화면에서 브랜드와 링크가 자연스럽게 줄바꿈

### Portal footer

- Structure: `footer > nav[aria-label="보조 메뉴"] + dl`
- Content: 지원, 개인정보 처리방침, 이용약관, 운영자, 지원 이메일
- States: 기본, hover, focus-visible, 지원·개인정보·약관 현재 페이지
- Accessibility: 보조 navigation과 운영 정보를 별도 의미 구조로 제공하고 모든 링크는 44px 이상의
  키보드·터치 대상을 유지
- Responsive: 40rem 이하에서 보조 링크와 운영 정보가 한 열로 전환
- Motion: 없음

### Landing decision path

- Structure: 소개 문구, 비공개 베타일 때 CTA 직전 자격 증명 안내, 두 행동 링크, `ol` 기반
  3단계 흐름, 보안 경계 설명, 운영 정보 `dl`
- Order: 서비스 역할 → 연결 시작 → 기존 연결 관리 → 처리 흐름 → 저장하지 않는 정보 → 운영자·정책·지원
- Private beta guidance: 초대 사용자 이름·비밀번호가 필요하고 삼성 계정 비밀번호가 아니며,
  반복 오입력 시 연결 시작이 잠시 제한될 수 있음을 CTA 전에 알린다. 공개 모드에는 표시하지 않는다.
- Accessibility: 카드 나열 대신 문서 순서가 곧 의사결정 순서가 되며 제목 수준을 건너뛰지 않음
- Motion: 없음

### Policy document

- Source: `src/http/portal-policy.ts`
- Structure: 포털 navigation 뒤 `header > eyebrow + h1 + summary`, 이어서 제목이 있는 `section[]`,
  마지막에 운영자와 `mailto:` 지원 연락처
- Variants: 개인정보 처리방침, 이용약관
- Content: 현재 코드와 운영 설정으로 확인되는 사실만 표시하며, 사업자 주소·위탁자·처리 국가·
  백업 보존기간·상업 조건처럼 확정되지 않은 값은 추정하지 않고 미확정 경계를 명시
- Typography: 본문은 Body, 보조 설명과 갱신일은 Small, 섹션 제목은 H2를 사용하고 문단 너비를
  `--panel-manage` 이하로 제한해 긴 한국어 문장의 읽기 흐름을 유지
- Accessibility: 단일 `main`, 순차적인 h1/h2, 의미 있는 목록, 현재 문서의 `aria-current`, 명시적인
  지원 이메일 링크를 제공하며 200% 확대와 375px에서 가로 스크롤이 없어야 함
- Responsive: 문서 목차와 본문은 모든 breakpoint에서 단일 열을 유지
- Motion: 없음

### Support document

- Source: `src/http/portal-support.ts`
- Structure: 포털 navigation 뒤 `header > eyebrow + h1 + summary`, 문의 유형 목록, 안전한 문의 정보,
  셀프서비스 절차, 미확정 운영 경계, 운영자와 `mailto:` 지원 연락처
- Content: 원시 토큰·OAuth code·비밀번호·민감한 전체 응답 본문을 요청하지 않으며, 확인된
  셀프서비스 동작과 아직 확정되지 않은 본인 확인·응답시간·긴급 단계만 사실대로 설명
- Accessibility: 단일 `main`, 순차적인 h1/h2, 의미 있는 목록, 현재 문서의 `aria-current`,
  명시적인 지원 이메일 링크를 제공
- Responsive: 문의 유형과 운영자 정보는 30rem 이하에서 한 열로 전환
- Motion: 없음

### Service status document

- Source: `src/http/portal-status.ts`
- Structure: 포털 navigation 뒤 `Growful readiness` 요약, 현재 상태, 진행 장애, 해결 이력,
  검사 범위, 지원 순서의 `article[data-status-document]`
- States: `ready`, `unavailable`; 두 상태 모두 문서를 읽을 수 있도록 HTTP 200을 유지하고
  기계용 `/readyz`만 unavailable에서 503을 반환. 공지 이력은 비어 있음, 활성 공지, 해결됨,
  readiness 장애로 저장소를 읽을 수 없음 상태를 구분
- Content: 마지막 확인 시각, 다시 확인, 내 연결 확인을 첫 화면에 제공. Gateway 프로세스·
  데이터베이스·감사 체인 준비 상태만 설명하며 SmartThings 외부 종단을 검사하지 않고
  SmartThings 가용성, SLA, 가동률이나 복구 시간을 추정하지 않음. 이력은 운영자가 실제로
  등록한 공지만 표시하고 자동 탐지나 개별 사용자 통지를 암시하지 않음
- Accessibility: 현재 상태 블록은 `h2`의 "현재 준비 상태"를 먼저 읽고 그 다음 색상 외 한국어
  상태 레이블을 읽는 DOM 순서를 유지. 현재 문서의 `aria-current`, h1/h2 순서와 의미 있는
  `/readyz`, 다시 확인, 관리, 지원 링크를 제공. 공지 시각은 한국어 현지 시각으로 읽히게 렌더링하고
  ISO 8601 원본은 `time[datetime]`에 유지
- Responsive: 현재 상태, 공지 metadata와 운영자 정보는 30rem 이하에서 한 열로 전환하고 긴
  공지 제목과 본문은 패널 안에서 줄바꿈
- Motion: 없음

### Service disclosure block

- Structure: `section[aria-labelledby] > div[heading] + dl`
- Content: 운영자, 현재 상태, `mailto:` 지원 링크, 개인정보처리방침과 이용약관 링크
- Accessibility: `dt`와 `dd`로 값의 의미를 연결하고 외부 정책 링크 이름을 구체적으로 유지
- Responsive: 48rem 이하에서 제목과 정보 목록을 한 열로 전환
- Motion: 없음

### Token access form

- Structure: `form > label + input[type=password] + p.hint + button`
- States: 기본, focus, 제출 중, 인증 오류, 연결 성공
- Security: 토큰은 기본 가림, 성공 직후 입력값 제거, 현재 탭 메모리에만 보관
- Accessibility: 자동완성 비활성화, 오류는 `role=alert`, 제출 중 `aria-busy`

### Connection status

- Structure: 상태 요약과 `dl`, scope 목록, 교체·해제 행동
- States: 미인증, 로딩, 연결됨·API 사용 가능, 연결됨·API 접근 차단, 교체 완료, 연결 해제됨,
  API 오류
- Support identity: 연결 상태가 확인되면 가명 `supportReference`를 항상 표시하고 긴 hash는
  monospace와 안전한 줄바꿈을 사용한다. 원시 `installedAppId`는 표시하지 않는다.
- Accessibility: 상태 변경은 `role=status`, 날짜는 `time`, 긴 scope는 줄바꿈
- Responsive: 행동은 좁은 화면에서 세로로 쌓이고 44px 높이를 유지

### Restricted access notice

- Structure: 차단 상태 레이블, 제목, 고정 사유의 한국어 설명, 지원 참조, `mailto:` 지원 링크
- Color: `--error`는 차단 레이블과 제목에만 사용하고 본문·참조값은 기본 text 대비를 유지한다.
- States: `quota_abuse`, `security_incident`, `terms_violation`; 자동 차단이나 해제 약속을 암시하지 않음
- Accessibility: `role="alert"`로 상태를 알리고 enum 코드가 아니라 사용자가 이해할 수 있는 문장으로
  사유를 제공한다. 지원 링크에는 문의 시 지원 참조를 함께 전달하라는 목적을 명시한다.
- Security: Growful token, SmartThings token, `installedAppId`를 안내문·메일 URL·DOM attribute에 넣지 않는다.
- Responsive: 375px과 200% 확대에서 64자리 참조값이 패널 밖으로 넘치지 않는다.
- Motion: 없음

### Confirmation dialog

- Structure: 네이티브 `dialog > form[method=dialog]`
- Variants: 연결 해제, 현재 토큰을 즉시 무효화하고 모든 소비자 설정 변경이 필요한 토큰 교체
- States: 열림, 취소, 확인 진행, 오류
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
- 모든 포털 문서는 skip link에서 `main#main-content`로 이동하고 이후 제목·행동·footer 순서로
  예측 가능한 키보드 흐름을 제공해야 한다.
- 375px, 768px, 1280px에서 가로 스크롤이나 한국어 한 글자 고아 줄이 없어야 한다.
- 밝은/어두운 색상 선호와 200% 확대에서도 탐색, 상태 정보, 404 복구 행동이 손실되지 않아야 한다.
- Accepted debt: 없음
