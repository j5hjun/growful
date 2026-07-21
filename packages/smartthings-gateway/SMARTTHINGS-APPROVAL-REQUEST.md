# SmartThings 공개·상업 사용 확인 요청 패킷

기준일: 2026-07-22

이 문서는 Growful SmartThings Gateway의 공개 가입 또는 유료화 전에 SmartThings로부터
서면 확인을 받기 위한 제출 초안입니다. 법률 자문이나 SmartThings의 승인을 대신하지
않습니다. 대괄호로 표시한 사실값을 실제 운영자가 채우고, 제출 직전 현행 약관과 구현을 다시
확인해야 합니다.

## 1차 접수 채널

SmartThings Developer Center의 공식 [Contact Us](https://developer.smartthings.com/contact)
폼을 사용합니다. 폼은 이름, 이메일, 회사, 의견을 받습니다. Developer Terms의 formal notice
조항은 우편·직접 전달 방식을 규정하므로, 이 문의에 대해 SmartThings가 정식 통지를 요구한다고
답하면 운영자 또는 법률대리인이 해당 절차를 별도로 진행합니다.

## 제출 전 필수 사실값

다음 값이 하나라도 비어 있으면 제출하지 않습니다.

- Licensee의 법적 이름: `[LEGAL LICENSEE NAME]`
- 문의자 이름과 Licensee를 대표할 권한: `[CONTACT NAME / AUTHORITY]`
- 회신 이메일: `[CONTACT EMAIL]`
- 회사 또는 개인사업자명: `[COMPANY, OR INDIVIDUAL LICENSEE]`
- SmartThings App ID: `[APP ID]`
- Developer Center App Display Name: `[DISPLAY NAME]`
- 현재 운영 단계: `[LOCAL TEST / CONTROLLED PRIVATE BETA]`
- 목표 단계: `[FREE PUBLIC / PAID / BOTH]`
- 공개 도메인: `https://smartthings.growful.click`
- 개인정보 처리방침 URL: `[HTTPS PRIVACY URL]`
- 이용조건 URL: `[HTTPS TERMS URL]`
- 지원 연락처: `[SUPPORT CONTACT]`
- 확정된 처리위탁자와 처리 국가: `[SUBPROCESSOR / COUNTRY LIST]`
- 백업·로그·DB 보존기간: `[RETENTION SUMMARY]`

Client Secret, access token, refresh token, Growful token, OAuth code, webhook confirmation token은
폼이나 후속 메일에 절대 포함하지 않습니다.

## Contact Us 입력 초안

### Full Name

`[CONTACT NAME]`

### Email

`[CONTACT EMAIL]`

### Company

`[LEGAL LICENSEE NAME]`

### Comments

아래 영문을 그대로 붙여 넣되 대괄호 값을 먼저 교체합니다.

```text
Subject: Request for written guidance on a multi-user SmartThings API Access App

We are requesting written guidance, or routing to the appropriate licensing and compliance team, before enabling public or paid access to Growful SmartThings Gateway.

Licensee: [LEGAL LICENSEE NAME]
App ID: [APP ID]
App display name: [DISPLAY NAME]
Service URL: https://smartthings.growful.click
Current stage: [LOCAL TEST / CONTROLLED PRIVATE BETA]
Planned stage: [FREE PUBLIC / PAID / BOTH]

The service uses the SmartThings OAuth 2.0 authorization-code flow. Each user selects scopes and authorizes the API Access App. Our server stores the SmartThings access and refresh tokens encrypted at rest, issues a separate random Growful credential whose plaintext is shown once, and forwards SmartThings API requests only when that credential authenticates the corresponding installation. We do not sell SmartThings data or use it for advertising, analytics, profiling, or model training. The implementation deletes the primary connection record when the user requests deletion or SmartThings sends the signed uninstall lifecycle event.

Please confirm in writing:

1. Whether this user-authorized, multi-user token-management and API-proxy model is an authorized Licensee Product for Users and does not violate the restriction on a service bureau or use for another person's benefit.
2. Whether the answer differs for a controlled free beta, a free public service, and a paid service.
3. Whether a separate agreement, review, certification, security assessment, or commercial program is required before any of those stages.
4. Whether and how we may use the word “SmartThings” descriptively in the app display name, service pages, and domain content without using the Works with SmartThings certification mark or implying affiliation.
5. Which 30-day or 45-day change-notice process applies to the initial public launch, paid features, policy changes, or other material modifications, and where those notices must be submitted.
6. Which privacy notice, subprocessor list, retention schedule, security-program evidence, test results, and incident-response contacts SmartThings requires before processing user data.
7. Which channel must receive a security incident notice within 24 hours and a user or Samsung deletion request.

We will keep public and paid access disabled until the applicable requirements are confirmed and completed. We can provide a data-flow diagram, endpoint inventory, scope list, deletion flow, security controls, and test evidence on request. Please identify the team and reference number governing your response.
```

## 후속 답변용 기술 요약

SmartThings가 상세 자료를 요청하면 다음 요약과
[준수 매트릭스](./SMARTTHINGS-COMPLIANCE-MATRIX.md)를 함께 제공합니다.

### 제품 경계

- 사용자는 SmartThings OAuth 동의 화면에서 Gateway에 부여할 scope와 디바이스를 선택합니다.
- Gateway는 사용자별 `installedAppId`와 SmartThings access/refresh token을 보관합니다.
- SmartThings token은 AES-256-GCM 암호문으로만 PostgreSQL에 저장합니다.
- Growful token 원문은 한 번만 보여 주고 SHA-256 해시만 저장합니다.
- Growful token은 하나의 SmartThings 설치를 선택하며 다른 사용자의 연결을 조회하지 못합니다.
- `/v1/*`는 인증된 연결의 SmartThings token으로 요청을 전달하며 응답 본문을 DB에 저장하지
  않습니다.
- 자동 갱신은 PostgreSQL 임대로 중복 refresh를 방지합니다.
- 사용자는 Growful token을 교체하거나 연결 행을 삭제할 수 있습니다.
- SmartThings의 서명된 설치 해제 lifecycle도 연결 행을 멱등 삭제합니다.

### 데이터 최소화와 보존

- OAuth state 원문은 저장하지 않고 SHA-256 해시와 요청 scope만 저장합니다.
- state는 생성 10분 뒤 무효화됩니다. 서비스 정상 실행 중 최대 5분 뒤 물리 삭제되며,
  재기동 시 만료 행을 첫 maintenance run에서 삭제합니다.
- 연결 자격 증명은 사용자가 Growful에서 삭제하거나 SmartThings에서 설치를 해제할 때까지
  기본 DB에 보존합니다.
- proxy 요청·응답 본문은 애플리케이션 DB에 저장하지 않습니다.
- 민감 경로의 Fastify 자동 요청 로그를 비활성화하고 Authorization 및 Cookie 헤더를
  redaction합니다.
- 백업, WAL, 호스트 스냅샷, 외부 로그의 최종 보존·파기 값은 운영 인프라 확인 후 별도로
  제출합니다.

### 현재 출시 제어

- `private_beta`의 OAuth 시작 GET/POST는 Basic 인증으로 제한합니다.
- `public` 모드는 운영자, 지원, 개인정보 처리방침, 이용조건, SmartThings 서면 확인 참조번호와
  확인일이 없으면 애플리케이션 시작과 배포 preflight가 실패합니다.
- Works with SmartThings 인증 마크는 사용하지 않습니다.
- 공개·유료 이용이 허용됐다고 추정하지 않습니다.

## 요청 증빙 목록

SmartThings가 요청한 항목만 제공하되, 비밀과 개인정보를 제거합니다.

| 증빙 | 저장소 위치 | 제공 전 처리 |
| --- | --- | --- |
| 공개 출시 게이트 | `PUBLIC-LAUNCH.md` | 운영자 사실값과 최신 상태 반영 |
| 약관·정책 준수 매트릭스 | `SMARTTHINGS-COMPLIANCE-MATRIX.md` | 미해결 행을 숨기지 않음 |
| HTTP endpoint와 보안 경계 | `README.md` | 내부 주소·비밀 제거 |
| 배포·롤백·preflight 절차 | `../../deploy/smartthings-gateway/README.md` | 서버 IP·계정·내부 경로 제거 |
| 자동 테스트 결과 | CI run URL 또는 서명된 결과 | token·환경변수·DB URL 제거 |
| 데이터 흐름 | 본 문서의 제품 경계와 데이터 최소화 절 | 처리위탁자·국가 확정 후 제공 |

## 답변 기록

답변을 받으면 다음 형식으로 원문과 해석을 분리해 보관합니다.

```text
Request reference:
Submitted at (UTC):
Submitted by:
Channel:
SmartThings respondent and team:
Response received at (UTC):
Applies to App ID:
Applies to service version/commit:
Free private beta decision:
Free public decision:
Paid service decision:
Brand-name decision:
Required agreement/review/certification:
Required notices and deadlines:
Required privacy/security evidence:
Incident/deletion contact channel:
Unresolved questions:
Original response location:
Internal interpretation owner:
```

원문 답변 파일이나 티켓 URL을 `SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE`에 직접 넣지
않습니다. 해당 환경변수에는 운영자가 접근할 수 있는 안정적인 내부 참조번호만 넣고, 원문은
접근 통제된 기록 시스템에 보관합니다.
