# SmartThings Gateway deployment

이 디렉터리는 `100.72.144.111`에서 사용자가 한 번 초기화하고 이후 GitHub Actions가
커밋 SHA별 릴리스로 갱신하는 배포 단위입니다. 서버의 기존 Cloudflare Tunnel은
`smartthings.growful.click`을 `http://localhost:8100`으로 전달합니다.

최초 설정:

```bash
mkdir -p ~/app/smartthings-gateway
cp .env.example ~/app/smartthings-gateway/.env
# TOKEN_ENCRYPTION_KEY
openssl rand -base64 32
# OAUTH_ADMIN_TOKEN
openssl rand -base64 32
# GATEWAY_API_TOKEN
openssl rand -base64 32
# 사용자가 ~/app/smartthings-gateway/.env를 편집
chmod 600 ~/app/smartthings-gateway/.env
```

예제 파일의 secret 값은 의도적으로 비어 있습니다. 이전 예제의 `replace-with-` 값도
실제 secret으로 인정하지 않으므로 모든 빈 값을 새로 채워야 합니다.

`REFRESH_LEASE_SECONDS`는 `120` 이상이어야 합니다. preflight는 `.env`가 group/other
사용자에게 노출되지 않았는지와 이 하한을 배포 전에 확인합니다.
`GATEWAY_API_TOKEN`은 Growful 내부 클라이언트가 `/v1/*`를 호출할 때 사용하는 Bearer
토큰이며 OAuth 관리용 `OAUTH_ADMIN_TOKEN`과 반드시 다른 값이어야 합니다.

## 기존 설치 업그레이드 — 이 변경을 `main`에 병합하기 전

이미 배포된 서버의 `.env`는 자동 배포가 수정하지 않습니다. 따라서 이 기능의 PR을
병합하기 전에 사용자가 서버에서 다음 작업을 먼저 수행해야 합니다.

1. `cp ~/app/smartthings-gateway/.env ~/app/smartthings-gateway/.env.before-api-proxy`
2. `openssl rand -base64 32`로 `OAUTH_ADMIN_TOKEN`과 다른 새 토큰을 생성합니다.
3. `~/app/smartthings-gateway/.env`에 다음 세 값을 추가합니다.

   ```dotenv
   GATEWAY_API_TOKEN=<새로 생성한 32자 이상의 토큰>
   SMARTTHINGS_API_URL=https://api.smartthings.com
   SMARTTHINGS_API_TIMEOUT_SECONDS=15
   ```

4. `chmod 600 ~/app/smartthings-gateway/.env`를 실행합니다.
5. `grep -E '^(GATEWAY_API_TOKEN|SMARTTHINGS_API_URL|SMARTTHINGS_API_TIMEOUT_SECONDS)=' ~/app/smartthings-gateway/.env`
   로 세 키가 각각 한 번만 존재하는지 확인합니다. 출력은 공유하지 않습니다.

이 준비 없이 병합하면 배포 preflight가 실패하며 기존 정상 릴리스는 그대로 유지됩니다.

서버에는 GHCR private image를 pull할 수 있는 로그인이 한 번 필요합니다. 자동 배포는
Tailscale SSH를 통해 `~/app/smartthings-gateway/releases/<commit-sha>`에 Compose
파일과 배포 스크립트를 복사하고, 모든 검증을 통과한 커밋 SHA만 `current`로
활성화합니다. 일반 SSH 개인키와 `known_hosts`는 사용하지 않습니다.

## 검증 경계

PR의 CI는 다음 순서로 배포 이미지 자체를 검증합니다.

1. lint, typecheck, unit test, PostgreSQL integration test, build
2. 배포 롤백 스크립트의 정상 배포·컨테이너 실패·공개 경로 실패 시나리오
3. 실제 Docker 이미지와 PostgreSQL을 Compose로 실행
4. migration을 두 번 실행해 멱등성 확인
5. `127.0.0.1:8100`의 `/healthz`, `/connection`, `/oauth/start`, 인증 없는 `/v1/*` 확인
6. Gateway 컨테이너 재시작 횟수가 0인지 확인

`main` 배포의 CD는 다음 순서로 실제 서버를 검증합니다.

1. Docker/Compose 접근, amd64 아키텍처, `.env` 필수값을 읽기 전용으로 사전 점검
2. 커밋 SHA에서 확인한 digest 이미지 pull, PostgreSQL 시작, migration 실행
3. 컨테이너 health와 재시작 횟수 확인
4. 서버의 `http://127.0.0.1:8100/healthz` 확인
5. `https://smartthings.growful.click/healthz` 확인
6. Tailscale SSH를 통해 배포 서버에서 공개 `/healthz`, `/connection`, `/oauth/start`,
   인증 없는 `/v1/*` 재확인

배포 이미지는 변경 가능한 tag가 아니라 빌드가 반환한 `sha256` digest로 고정합니다.
GitHub Actions, npm 의존성, Node/PostgreSQL/registry 기반 이미지도 검토된 commit
또는 digest로 고정하며 Dependabot의 주간 PR을 통해 갱신합니다. 빌드는 provenance와
SBOM을 함께 게시합니다.
이미 배포된 커밋 SHA를 다시 실행하면 이미지를 다시 pull하거나 컨테이너를 교체하지
않고 현재 서비스의 health와 공개 경로만 확인합니다. 같은 릴리스 SHA의 GHCR 이미지가
이미 있으면 기존 digest를 재사용하고 tag를 다시 게시하지 않습니다.

여러 `main` 실행이 겹치더라도 Actions 실행 자체를 취소하지 않습니다. 각 이미지는
릴리스 SHA별 immutable tag로만 게시하고, 게시 직후·배포 시작 전·서버 변경 직전에
현재 릴리스를 다시 확인합니다. 서버의 실제 변경은 `flock`으로 직렬화하며, 배포 상태에
GitHub workflow run number를 함께 기록합니다. 별도의 최고 시도 순번은 릴리스 SHA와
이미지 digest에 묶여 실패와 롤백 뒤에도 유지되므로, 더 낮은 순번의 지연된 배포는
변경 없이 건너뜁니다.

1~5 중 실패하면 이전 정상 이미지와 이전 릴리스의 Compose 파일로 자동
롤백합니다. 최초 배포에는 이전 릴리스가 없으므로 실패한 Gateway를 정지하고 Actions를
실패 처리합니다. Tailscale SSH를 통해 배포 서버에서 수행하는 마지막 공개 확인이 실패하면
Actions는 실패하지만, 이미 공개 경로까지 통과한 정상 릴리스는 유지합니다.

DB migration은 애플리케이션 교체 전에 실행되므로 기존 버전과 호환되는 추가형
변경만 허용합니다. 컬럼 삭제나 의미 변경은 별도 백업 및 단계적 migration 계획 없이
자동 배포에 포함하지 않습니다.

## 최초 배포 후 수동 인수 확인

자동 배포가 통과한 뒤 다음 순서로 실제 SmartThings 연동을 한 번 확인합니다.

1. `https://smartthings.growful.click/healthz`
2. `https://smartthings.growful.click/connection`
3. `https://smartthings.growful.click/oauth/start`에서 HTTP Basic 비밀번호로
   `OAUTH_ADMIN_TOKEN`을 입력한 뒤 SmartThings 권한 승인
4. callback 완료 후 `/connection`의 `connected`와 `expiresAt` 확인
5. 서버 터미널에서 다음 명령으로 토큰을 화면에 표시하지 않고 실제 프록시를 확인

   ```bash
   read -r -s -p 'GATEWAY_API_TOKEN: ' gateway_api_token
   printf '\n'
   curl --fail --silent --show-error \
     --header "Authorization: Bearer ${gateway_api_token}" \
     https://smartthings.growful.click/v1/devices
   unset gateway_api_token
   ```

6. 갱신 예정 시간이 지난 뒤 `lastRefreshedAt`과 `expiresAt`이 갱신되는지 확인

필요한 GitHub Secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`

`production` Environment Variable:

- `DEPLOY_USER`: 서버에서 Docker를 실행할 수 있는 사용자명

## Tailscale SSH 준비

서버에서 Tailscale SSH를 활성화합니다.

```bash
sudo tailscale set --ssh
```

`tag:hp`는 Tailscale Admin Console의 **Machines**에서 대상 장비의
**Edit tags** 메뉴를 열어 적용합니다. `tailscale set`에는
`--advertise-tags` 옵션이 없으며, 원격 서버에서 `tailscale up --force-reauth`
방식으로 태그를 바꾸면 현재 연결이 끊길 수 있으므로 사용하지 않습니다.

GitHub Actions용 OAuth credential은 `auth_keys` write scope와 `tag:ci`를 사용합니다.
기존 tailnet policy에 다음 항목을 병합하고 `<DEPLOY_USER>`를 실제 사용자명으로
바꿉니다.

```json
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
    "tag:hp": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:ci"],
      "dst": ["tag:hp"],
      "ip": ["tcp:22"]
    }
  ],
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:ci"],
      "dst": ["tag:hp"],
      "users": ["<DEPLOY_USER>"]
    }
  ]
}
```

`tag:hp` 적용은 서버의 Tailscale 신원을 사용자 기반에서 태그 기반으로 바꿉니다.
정책을 저장하기 전에 기존 사용자 접근 규칙이 계속 필요한지 함께 확인합니다.
