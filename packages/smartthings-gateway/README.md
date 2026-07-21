# @growful/smartthings-gateway

Growful의 SmartThings 연결 경계입니다. OAuth code 교환, 암호화 토큰 저장,
만료 전 갱신을 담당하며 다른 패키지에 토큰 원문을 전달하지 않습니다.

공개 가입이나 유료 서비스 전 필수 조건과 단계별 완료 기준은
[공개 출시 계획](./PUBLIC-LAUNCH.md)에서 관리합니다. 현재 포털의 비공개 베타 표시는
SmartThings의 공개·상업 이용 승인이나 법률 검토 완료를 뜻하지 않습니다.
SmartThings 서면 확인을 요청할 때는
[승인 요청 패킷](./SMARTTHINGS-APPROVAL-REQUEST.md)과
[준수 매트릭스](./SMARTTHINGS-COMPLIANCE-MATRIX.md)를 사용합니다.

## HTTP API

- `GET /healthz`: 프로세스 상태
- `GET /`: SmartThings 연결 흐름과 보안 경계를 설명하는 공개 포털
- `GET /manage`: Growful 토큰으로 연결을 확인·교체·해제하는 관리 화면
- `GET /portal.js`: 관리 화면의 자체 호스팅 브라우저 클라이언트
- `GET /robots.txt`: 공개 포털의 검색 엔진 접근 정책
- `GET /oauth/start`: 권한·디바이스 범위 선택 화면
- `POST /oauth/start`: 선택값 검증 후 SmartThings 권한 승인 시작
- `GET /oauth/callback`: authorization code 교환 후 Growful 토큰을 한 번 표시
- `POST /smartthings/webhook`: API Access App 확인 요청과 서명된 lifecycle event 수신
- `GET /connection`: Growful Bearer 인증 후 승인 scope, 만료 시각, 마지막 갱신 시각
- `POST /token/rotate`: Growful 토큰 교체
- `DELETE /connection`: Growful에 저장한 연결 정보와 Growful 토큰 삭제
- `GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS /v1/*`: Growful Bearer 인증 후 요청
  메서드·경로·쿼리·본문을 동일한 SmartThings API로 전달

## 개발

Node.js 24와 pnpm 10을 사용합니다.

```bash
pnpm install
pnpm check
pnpm build
```

PostgreSQL 통합 테스트는 별도 데이터베이스를 사용합니다.

```bash
TEST_DATABASE_URL=postgresql://gateway:password@127.0.0.1:5432/gateway_test \
  pnpm test:integration
```

## 보안 경계

- OAuth `state`는 SHA-256 해시만 저장하고 콜백에서 한 번 소비합니다. 생성 10분 뒤 만료되며,
  유지보수 주기는 최대 5분으로 제한됩니다. 서비스가 정상 실행 중이면 사용되지 않은 state
  해시와 요청 scope도 생성 후 최대 15분 안에 삭제되고, 중단 뒤 재기동할 때는 첫 유지보수
  실행에서 이미 만료된 행을 정리합니다.
- 요청 scope는 일회용 `state`와 함께 저장하고, 토큰 응답의 승인 scope가 요청 범위를
  초과하면 기존 연결을 유지한 채 거부합니다.
- access/refresh token은 AES-256-GCM으로 암호화합니다.
- Growful 토큰 원문은 OAuth 완료 화면에서 한 번만 제공하고 SHA-256 해시만 저장합니다.
- 관리 화면에 입력한 Growful 토큰은 현재 탭의 메모리에만 두며 쿠키나 브라우저 저장소에
  기록하지 않습니다. 상태 확인 뒤 입력란을 비우고 새로고침하면 메모리에서도 사라집니다.
- PostgreSQL의 갱신 임대 열이 여러 worker의 refresh token 중복 사용을 막습니다.
- 토큰 교환 요청은 일회용 refresh token 때문에 자동 재시도하지 않습니다.
- 연결 상태 API와 로그에는 SmartThings 토큰, Growful 토큰, client secret을 포함하지 않습니다.
- `/connection`, `/token/rotate`, `/v1/*`는 Growful 토큰으로 연결을 인증·선택합니다.
- SmartThings `EVENT` webhook은 본문 SHA-256 digest, RSA-SHA256 HTTP Signature와 5분 이내
  `Date`를 검증합니다. 공개 키는 `keyId`별로 SmartThings에서 받아 4시간만 캐시합니다.
- `SMARTTHINGS_APP_ID`는 Developer Center가 발급한 App ID로 설정하며, confirmation과
  lifecycle event의 `appId`가 이 값과 다르면 거부합니다. OAuth Client ID와는 별도 값입니다.
- 설치 해제 `DELETE` lifecycle event는 해당 `installedAppId`의 토큰과 Growful 연결을
  멱등 삭제합니다. 재전송되거나 이미 삭제된 연결도 `200 OK`로 확인합니다.
- SmartThings 응답은 리다이렉트를 따라가지 않고 상태 코드, 본문 바이트, 재구성이 필요한
  전송 헤더를 제외한 응답 헤더를 변환 없이 반환합니다.
- 각 SmartThings 요청의 응답 수신 제한시간은 기본 15초이며, 메모리 보호를 위해 응답
  본문은 10 MiB로 제한합니다.

브라우저에서 `/oauth/start`를 열고 Gateway 화면에서 리소스별 기능과 디바이스 범위를 고른 뒤
SmartThings 동의 화면에서 실제 디바이스를 선택합니다. 디바이스 권한 없이 허브·위치·장면·규칙
권한만 선택할 수도 있습니다. 완료 화면의 Growful 토큰은 다시
조회할 수 없으므로 안전한 곳에 복사합니다. 허용 scope는 서버 코드에 고정되어
있으며 `.env`의 `SMARTTHINGS_SCOPES`는 사용하지 않습니다. SmartThings 앱 등록에는
Gateway가 제공하는 다음 상한 scope를 모두 허용해야 합니다.

- `r:devices:$`, `x:devices:$`, `w:devices:$`
- `r:devices:*`, `x:devices:*`, `w:devices:*`
- `r:hubs:*`
- `r:locations:*`, `w:locations:*`, `x:locations:*`
- `r:scenes:*`, `x:scenes:*`
- `r:rules:*`, `w:rules:*`

이 목록은 SmartThings의 [API Access App 공식 scope 목록](https://developer.smartthings.com/docs/service-integrations/app-setup#available-scopes)을 기준으로 합니다.

권한 화면의 기본값은 선택한 디바이스의 상태 읽기(`r:devices:$`)뿐입니다. 제어·쓰기와
다른 리소스 권한은 사용자가 명시적으로 선택해야 하며, `DELETE /connection`은 Growful에
저장한 데이터만 삭제하고 SmartThings Linked Service 설치를 제거하지 않습니다.

`SERVICE_ACCESS_MODE=private_beta`에서는 `/oauth/start`의 GET과 POST 모두
`PRIVATE_BETA_INVITES_JSON`에 등록된 사용자별 HTTP Basic 인증을 요구합니다. 목록에는 사용자명과
비밀번호 원문 대신 소문자 SHA-256 hash만 저장합니다. 사용자를 회수하려면 해당 항목을 제거하고
Gateway를 재기동합니다. 공개 모드는
운영자·정책 URL과 SmartThings 공개 사용 서면 확인 정보를 모두 검증한 설정에서만 기동합니다.
공개 모드 설정 필드와 외부 게이트는 [공개 출시 계획](./PUBLIC-LAUNCH.md)을 따릅니다.
SmartThings 제출 질문은 [승인 요청 패킷](./SMARTTHINGS-APPROVAL-REQUEST.md), 요구사항과 증빙은
[준수 매트릭스](./SMARTTHINGS-COMPLIANCE-MATRIX.md)에서 추적합니다. 운영 통제 초안은
[정보보호 프로그램](./INFORMATION-SECURITY-PROGRAM.md),
[사고 대응 Runbook](./INCIDENT-RESPONSE.md),
[데이터 보존·파기 대장](./DATA-RETENTION.md)에 있습니다. 이 문서들은 역할·인프라 사실값,
승인과 실제 훈련 증빙이 채워지기 전에는 완료된 운영 통제를 의미하지 않습니다.

SmartThings Console의 Target URL에는
`https://smartthings.growful.click/smartthings/webhook`을 등록합니다. Gateway는
`CONFIRMATION`의 URL이 `https://api.smartthings.com/v1/apps/{appId}/confirm-registration`
형식인지 확인한 뒤 자동 요청합니다. 이후 현재 API Access App 형식인 서명된 `EVENT` 안의
`INSTALLED_APP_LIFECYCLE_EVENT.lifecycle=DELETE`를 처리합니다. 이 흐름은 공식
[API Access App 설정](https://developer.smartthings.com/docs/service-integrations/app-setup)과
[Webhook Events](https://developer.smartthings.com/docs/service-integrations/webhook-events)를
기준으로 합니다.

배포 설정은 저장소의 `deploy/smartthings-gateway`에 있습니다.
