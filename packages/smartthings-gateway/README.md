# @growful/smartthings-gateway

Growful의 SmartThings 연결 경계입니다. OAuth code 교환, 암호화 토큰 저장,
만료 전 갱신을 담당하며 다른 패키지에 토큰 원문을 전달하지 않습니다.

## HTTP API

- `GET /healthz`: 프로세스 상태
- `GET /oauth/start`: 권한·디바이스 범위 선택 화면
- `POST /oauth/start`: 선택값 검증 후 SmartThings 권한 승인 시작
- `GET /oauth/callback`: authorization code 교환 후 Growful 토큰을 한 번 표시
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

- OAuth `state`는 SHA-256 해시만 저장하고 콜백에서 한 번 소비합니다.
- 요청 scope는 일회용 `state`와 함께 저장하고, 토큰 응답의 승인 scope가 요청 범위를
  초과하면 기존 연결을 유지한 채 거부합니다.
- access/refresh token은 AES-256-GCM으로 암호화합니다.
- Growful 토큰 원문은 OAuth 완료 화면에서 한 번만 제공하고 SHA-256 해시만 저장합니다.
- PostgreSQL의 갱신 임대 열이 여러 worker의 refresh token 중복 사용을 막습니다.
- 토큰 교환 요청은 일회용 refresh token 때문에 자동 재시도하지 않습니다.
- 연결 상태 API와 로그에는 SmartThings 토큰, Growful 토큰, client secret을 포함하지 않습니다.
- `/connection`, `/token/rotate`, `/v1/*`는 Growful 토큰으로 연결을 인증·선택합니다.
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

권한 화면의 기본값은 선택한 디바이스의 상태 읽기(`r:devices:$`)뿐입니다. 제어·쓰기와
다른 리소스 권한은 사용자가 명시적으로 선택해야 하며, `DELETE /connection`은 Growful에
저장한 데이터만 삭제하고 SmartThings Linked Service 설치를 제거하지 않습니다.

배포 설정은 저장소의 `deploy/smartthings-gateway`에 있습니다.
