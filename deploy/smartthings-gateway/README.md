# SmartThings Gateway deployment

> 공개 모드 배포 전에는 패키지의
> [공개 출시 계획](../../packages/smartthings-gateway/PUBLIC-LAUNCH.md)에 정의한 외부 승인,
> 개인정보, 보안 운영 게이트를 모두 통과해야 합니다. 현재 배포 절차의 성공은 기술적 배포
> 성공만 의미하며 공개·상업 이용 허가를 의미하지 않습니다.

이 디렉터리는 `100.72.144.111`에서 사용자가 한 번 초기화하고 이후 GitHub Actions가
커밋 SHA별 릴리스로 갱신하는 배포 단위입니다. 서버의 기존 Cloudflare Tunnel은
`smartthings.growful.click`을 `http://localhost:8100`으로 전달합니다.

최초 설정:

```bash
mkdir -p ~/app/smartthings-gateway
cp .env.example ~/app/smartthings-gateway/.env
# TOKEN_ENCRYPTION_KEY
openssl rand -base64 32
# 사용자가 ~/app/smartthings-gateway/.env를 편집
chmod 600 ~/app/smartthings-gateway/.env
```

예제 파일의 secret 값은 의도적으로 비어 있습니다. 이전 예제의 `replace-with-` 값도
실제 secret으로 인정하지 않으므로 모든 빈 값을 새로 채워야 합니다.

최초 배포는 `SERVICE_ACCESS_MODE=private_beta`를 유지하고 사용자마다 서로 다른 자격 증명을
발급합니다. 다음처럼 무작위 비밀번호와 hash를 만들고, 비밀번호는 사용자에게 한 번만 전달하며
운영 `.env`의 `PRIVATE_BETA_INVITES_JSON`에는 사용자명과 hash만 넣습니다.

```bash
read -r -p 'Invite username: ' invite_username
invite_password="$(openssl rand -hex 24)"
invite_password_hash="$(printf '%s' "$invite_password" | openssl dgst -sha256 -r | cut -d' ' -f1)"
printf 'Share once: username=%s password=%s\n' "$invite_username" "$invite_password"
printf 'Add to JSON array: {"username":"%s","passwordHash":"%s"}\n' \
  "$invite_username" "$invite_password_hash"
unset invite_password invite_password_hash invite_username
```

사용자명은 영문자·숫자로 시작하고 영문자·숫자·점·밑줄·하이픈을 합쳐 최대 64자입니다.
`PRIVATE_BETA_INVITES_JSON`은 최소 1개, 최대 100개의 고유 사용자명을 허용합니다. 예시는 다음과
같으며 실제 hash로 바꿔야 합니다.

```dotenv
PRIVATE_BETA_INVITES_JSON=[{"username":"tester-1","passwordHash":"<64자리 소문자 SHA-256>"}]
```

회수할 때는 해당 사용자 객체를 배열에서 제거하고 Gateway를 재기동합니다. 다른 사용자의
자격 증명은 유지되며 제거된 사용자의 기존 Growful 토큰과 저장된 SmartThings 토큰도 재기동
중 삭제되어 즉시 `401`을 받습니다. Basic 자격 증명은 `/oauth/start`의 GET과 POST에만
사용하며, 1분 동안 연속 5회 실패한 클라이언트는 일시적으로 제한합니다. 운영 `.env`와 요청의
`Authorization` 헤더는 로그에 남기지 않습니다.

두 모드 모두 다음 운영자·지원·정책 값을 요구하며 OAuth 시작 전에 사용자에게 표시하고
명시적 동의를 받습니다. 공개 모드는 SmartThings 서면 확인 값도 추가로 요구합니다. 값의
존재는 서면 확인 자체를 대신하지 않으므로 원본 답변과 법률 검토 기록을 별도로 보관합니다.

- `PUBLIC_OPERATOR_NAME`
- `PUBLIC_SUPPORT_EMAIL`
- `PUBLIC_PRIVACY_POLICY_URL` (HTTPS)
- `PUBLIC_TERMS_URL` (HTTPS)
- `SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE` (공개 모드만)
- `SMARTTHINGS_PUBLIC_USE_APPROVED_AT` (`YYYY-MM-DD`, 공개 모드만)

운영자·지원·정책 값이 바뀌면 정책 버전도 바뀌며 기존 연결은 시작 시 회수됩니다. 사용자는
새 정책을 확인하고 OAuth를 다시 완료해야 합니다.

`REFRESH_LEASE_SECONDS`는 `120` 이상이어야 합니다. preflight는 `.env`가 group/other
사용자에게 노출되지 않았는지와 이 하한을 배포 전에 확인합니다.
또한 API, authorize, token URL을 지원되는 `api.smartthings.com` 운영 경로로 제한합니다.
`REFRESH_CHECK_INTERVAL_SECONDS`는 토큰 갱신뿐 아니라 만료 OAuth state 정리 주기이므로
`1`~`300`초만 허용합니다. OAuth state의 10분 유효기간과 이 상한을 합쳐 미사용 state
해시와 요청 scope를 서비스가 정상 실행 중일 때 생성 후 최대 15분 안에 삭제합니다. 중단 뒤
재기동할 때는 worker의 첫 실행이 이미 만료된 행을 즉시 정리합니다.

## 기존 단일 연결에서 업그레이드

이 릴리스는 기존 단일 SmartThings 연결을 폐기합니다. migration은 기존 `oauth_tokens`
행을 삭제하며, 새 버전에서는 OAuth를 다시 완료해 연결별 Growful 토큰을 발급받아야 합니다.
자동 배포는 운영 `.env`를 수정하지 않으므로 사용자가 다음 두 줄을 직접 제거합니다.

```dotenv
GATEWAY_API_TOKEN=...
OAUTH_ADMIN_TOKEN=...
```

이전 이미지로 롤백할 때는 배포 스크립트가 예측 불가능한 임시 호환 토큰과 최소 scope를
롤백 프로세스에만 주입합니다. 운영 `.env`는 변경하지 않으며, 이전 이미지는 기존 연결이
삭제된 연결 해제 상태로만 기동합니다.

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
5. `127.0.0.1:8100`의 `/healthz`, `/`, `/manage`, `/robots.txt`, 인증 없는
   `/connection`, `/oauth/start`, `/smartthings/webhook`, `/v1/*` 확인
   - 비공개 베타의 인증 없는 `/oauth/start`가 `401`인지 확인
   - Basic 인증한 `GET /oauth/start` 선택 화면과 유효한 `POST /oauth/start` 리다이렉트를 확인
   - 서명 없는 webhook `EVENT`가 `401`로 거부되는지 확인
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
자동 배포에 포함하지 않습니다. CI는 이전 `main` 이미지로 DB를 만든 뒤 후보 이미지를
기동하고, 같은 DB에서 이전 이미지를 다시 기동하는 버전 교차 smoke test로 실제 롤백
호환성을 확인합니다.

OAuth scope는 더 이상 `.env`에서 설정하지 않습니다. 기존 설치의
`SMARTTHINGS_SCOPES` 값은 새 버전에서 무시되므로 남아 있어도 배포를 막지 않으며,
원할 때 제거할 수 있습니다. 첫 전환 배포에서 이전 이미지로 롤백할 때 이 값이 없으면
배포 스크립트가 이전 버전 기동에만 최소 scope와 임시 공유 토큰을 주입하고, 운영 `.env`는
변경하지 않습니다. 앱 등록 시 허용한 scope가 최종 상한이고 Gateway 선택 화면은 서버 허용 목록
안의 부분집합만 요청합니다. 앱 등록에는 다음 scope를 모두 허용합니다.

- `r:devices:$`, `x:devices:$`, `w:devices:$`
- `r:devices:*`, `x:devices:*`, `w:devices:*`
- `r:hubs:*`
- `r:locations:*`, `w:locations:*`, `x:locations:*`
- `r:scenes:*`, `x:scenes:*`
- `r:rules:*`, `w:rules:*`

권한 화면은 선택한 디바이스의 상태 읽기(`r:devices:$`)만 기본 선택합니다. 나머지 권한은
사용자가 명시적으로 선택해야 합니다. Gateway의 `DELETE /connection`은 Growful에 저장된
연결 데이터만 삭제하며 SmartThings Linked Service 설치를 제거하지 않습니다.

SmartThings Console의 API Access App Target URL은
`https://smartthings.growful.click/smartthings/webhook`으로 설정합니다. Console에서 Target
URL 확인을 요청하면 Gateway가 허용된 SmartThings confirmation URL을 자동 호출합니다.
이후 서명된 `EVENT`의 설치 해제 `DELETE` lifecycle을 받으면 해당 `installedAppId`의
암호화 토큰과 Growful 연결을 삭제합니다.

서버 `.env`의 `SMARTTHINGS_APP_ID`에는 Developer Center가 발급한 App ID를 입력합니다.
이 값은 `OAUTH_CLIENT_ID`와 별도이며, Gateway는 confirmation과 lifecycle event가 이 앱에
속하는지 확인하는 데 사용합니다. 값이 없으면 preflight와 프로세스 시작이 실패합니다.

기존 토큰에 저장된 다른 등록 scope는 OAuth 표준 scope 문자열이면 계속 읽고 표시하며,
refresh에서는 기존 승인 범위의 부분집합만 허용합니다. 새 권한 선택 화면에서는 위의 서버
허용 목록 밖 scope를 새로 요청할 수 없습니다. 디바이스의 `$`와 `*` 범위는 한 요청에서
하나만 선택하며, 다른 리소스 권한은 디바이스 권한 없이도 독립적으로 선택할 수 있습니다.

## 최초 배포 후 수동 인수 확인

자동 배포가 통과한 뒤 다음 순서로 실제 SmartThings 연동을 한 번 확인합니다.

1. `https://smartthings.growful.click/healthz`
2. SmartThings Console Target URL에
   `https://smartthings.growful.click/smartthings/webhook`을 입력하고 `CONFIRMED` 상태 확인
3. `https://smartthings.growful.click/oauth/start`에서 기능·디바이스 범위를 고른 뒤
   SmartThings 화면에서 실제 디바이스를 선택해 승인
4. callback 완료 화면에 한 번 표시되는 Growful 토큰을 안전하게 보관
5. 로컬 터미널에서 Growful 토큰으로 연결 상태와 실제 프록시를 확인

   ```bash
   read -r -s -p 'Growful token: ' growful_token
   printf '\n'
   curl --fail --silent --show-error \
     --header "Authorization: Bearer ${growful_token}" \
     https://smartthings.growful.click/connection
   curl --fail --silent --show-error \
     --header "Authorization: Bearer ${growful_token}" \
     https://smartthings.growful.click/v1/devices
   unset growful_token
   ```

6. 두 SmartThings 연결에서 각각 발급한 토큰이 서로 다른 연결을 사용하는지 확인
7. SmartThings 앱의 Linked Services에서 연결을 해제한 뒤 기존 Growful 토큰의
   `/connection` 요청이 `401`인지 확인
8. 갱신 예정 시간이 지난 뒤 `/connection`의 `lastRefreshedAt`과 `expiresAt` 확인

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
