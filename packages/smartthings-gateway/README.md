# @growful/smartthings-gateway

Growful의 SmartThings 연결 경계입니다. OAuth code 교환, 암호화 토큰 저장,
만료 전 갱신을 담당하며 다른 패키지에 토큰 원문을 전달하지 않습니다.

## HTTP API

- `GET /healthz`: 프로세스 상태
- `GET /oauth/start`: HTTP Basic 인증 후 SmartThings 권한 승인 시작
- `GET /oauth/callback`: authorization code 교환
- `GET /connection`: 연결 여부, 만료 시각, 마지막 갱신 시각
- `GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS /v1/*`: Gateway Bearer 인증 후 요청
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
- access/refresh token은 AES-256-GCM으로 암호화합니다.
- PostgreSQL의 갱신 임대 열이 여러 worker의 refresh token 중복 사용을 막습니다.
- 토큰 교환 요청은 일회용 refresh token 때문에 자동 재시도하지 않습니다.
- 연결 상태 API와 로그에는 토큰이나 client secret을 포함하지 않습니다.
- `/oauth/start`는 `.env`의 `OAUTH_ADMIN_TOKEN`을 HTTP Basic 비밀번호로 요구합니다.
- `/v1/*`는 별도의 `GATEWAY_API_TOKEN`을 Bearer 토큰으로 요구하며, Gateway는 이 값을
  저장된 SmartThings Access Token으로 교체합니다.
- SmartThings 응답은 리다이렉트를 따라가지 않고 상태 코드, 본문 바이트, 재구성이 필요한
  전송 헤더를 제외한 응답 헤더를 변환 없이 반환합니다.
- 각 SmartThings 요청의 응답 수신 제한시간은 기본 15초이며, 메모리 보호를 위해 응답
  본문은 10 MiB로 제한합니다.

브라우저에서 `/oauth/start`를 열면 사용자명에는 임의 값을, 비밀번호에는
`OAUTH_ADMIN_TOKEN`을 입력합니다.

배포 설정은 저장소의 `deploy/smartthings-gateway`에 있습니다.
