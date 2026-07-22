# Growful SmartThings Gateway 데이터 보존·파기 대장

기준일: 2026-07-22

상태: **PARTIAL DRAFT — 애플리케이션 동작은 확인, 인프라 보존·파기 증빙 미완료**

이 대장은 데이터가 생기는 위치, 목적, 논리적 삭제와 물리적 소멸 시점을 구분합니다. 코드에서
행을 삭제하는 것과 WAL·backup·snapshot·외부 log에서 복구 불가능해지는 것은 같은 사건이
아닙니다. 실제 사업자, 리전, 보존 설정과 훈련 증빙이 채워지기 전 “즉시 완전 삭제”를
주장하지 않습니다.

관련 문서:

- [정보보호 프로그램](./INFORMATION-SECURITY-PROGRAM.md)
- [사고 대응 Runbook](./INCIDENT-RESPONSE.md)
- [공개 출시 계획](./PUBLIC-LAUNCH.md)

## 1. 애플리케이션 데이터 목록

| 데이터 | 위치/형태 | 목적 | 현재 수명·삭제 trigger | 상태 |
| --- | --- | --- | --- | --- |
| OAuth state | PostgreSQL의 SHA-256 hash | callback 위조·재사용 방지 | 생성 10분 후 만료, callback 1회 소비 | 구현·test 완료 |
| 요청 scope | OAuth state 행 | callback 승인 범위 검증 | state와 함께 삭제 | 구현·test 완료 |
| `installedAppId` | 연결 행 | SmartThings 설치·webhook 연결 | 사용자 연결 삭제 또는 signed uninstall | 구현·test 완료 |
| 승인 scope | 연결 행 | 최소 권한·proxy 허용 확인 | 연결 행과 함께 삭제 | 구현·test 완료 |
| SmartThings token | AES-256-GCM 암호문 | API proxy와 refresh | 연결 행과 함께 논리 삭제 | 구현·test 완료 |
| token 종류·만료·갱신 metadata | 연결 행 | 안전한 refresh | 연결 행과 함께 삭제 | 구현·test 완료 |
| Growful token | 원문 1회 출력, DB에는 SHA-256 hash | 연결 인증 | rotate 또는 연결 삭제 시 이전 hash 폐기 | 구현·test 완료 |
| refresh lease·마지막 오류 | 연결 행 | 중복 refresh 방지·운영 상태 | 연결 행과 함께 삭제 | 구현·test 완료 |
| Growful quota 창 시작·허용 건수 | 연결 행 | 연결별 60건/60초 공정 사용 제한 | 60초 뒤 효력 없음, 다음 요청이 덮어씀, 연결 행과 함께 삭제 | 구현·test 완료 |
| Growful quota 누적 거부 횟수·마지막 시각 | 연결 행 | 반복 위반 검토 | 연결 행과 함께 삭제; 별도 기간 정책 미확정 | 구현·test 완료 |
| proxy 차단 시각·고정 사유 | 연결 행 | 수동 abuse 대응 | 해제 시 현재 상태 삭제, 연결 행과 함께 삭제; 감사 이벤트는 별도 보존 | 구현·test 완료 |
| SmartThings rate-limit 마감 | 연결 행 | upstream `Retry-After`를 인스턴스 간 공유 | 만료 뒤 효력 없음, 연결 행과 함께 삭제 | 구현·test 완료 |
| proxy request/response | process memory | SmartThings API 전달 | 응답 완료 후 참조 해제; DB 미저장 | 구현 확인, memory dump 제외 미검증 |
| 관리 화면 입력 token | 현재 browser tab memory | 연결 확인·교체·삭제 | 입력 초기화·새로고침·tab 종료 | 구현·test 완료 |
| OAuth 완료 token 출력 | HTTP 응답/화면 1회 | 최초 전달 | server 재조회 불가; 사용자 환경 사본은 사용자 통제 | 구현·test 완료 |

사용자의 SmartThings 계정, 장치 상태와 proxy 본문은 애플리케이션 DB에 저장하지 않습니다.
다만 reverse proxy, CDN/WAF, host, crash dump 또는 공급자 진단 기능이 본문/header를 수집하는지는
실제 운영 설정으로 별도 검증해야 합니다.

## 2. OAuth state의 정확한 삭제 경계

- state의 유효기간은 생성 시각부터 10분이며 `expiresAt <= now`이면 사용할 수 없습니다.
- 정상 실행 중 유지보수 주기는 최대 5분이므로 사용되지 않은 만료 행은 생성 후 최대 약
  15분 안에 PostgreSQL에서 물리적 행 삭제 대상이 됩니다.
- callback에서 소비된 state는 즉시 행 삭제를 시도합니다.
- service가 중단돼 유지보수가 실행되지 않으면 만료 행은 더 오래 남을 수 있지만 유효하지
  않습니다. 재기동 직후 첫 유지보수에서 정리합니다.
- 이 경계는 primary DB에만 해당합니다. WAL·backup·snapshot의 수명은 아래 인프라 대장에
  별도로 확정해야 합니다.

## 3. 사용자 삭제 경로

| 경로 | 인증/trigger | primary DB 결과 | 아직 증명되지 않은 결과 |
| --- | --- | --- | --- |
| `DELETE /connection` | 유효한 Growful token | 연결 행과 암호화 token/hash 삭제 | SmartThings 설치·credential 회수, backup aging |
| SmartThings signed `DELETE` lifecycle | signature, date, app ID 검증 | `installedAppId` 연결 멱등 삭제 | backup/WAL/log 소멸 |
| Growful token rotate | 현재 유효 token | 이전 hash 폐기, 새 token 원문 1회 표시 | 과거 audit/log 사본 정책 |
| token 분실 사용자의 권리행사 | 외부 `[IDENTITY_VERIFICATION]` 완료 + `supportReference` + 외부 승인 ticket | 운영 CLI가 일치하는 연결 행을 삭제하고 성공/대상 없음 결과를 감사 | 본인 확인 절차·완료 통지, backup/WAL/log 파기 |
| 운영자 강제 삭제 | `supportReference` + 외부 승인 ticket + 운영자 ID | primary 삭제와 성공 audit를 같은 트랜잭션으로 실행; 대상 없음도 실패 audit | 중앙 운영자 신원 귀속·외부 ticket 검증·SmartThings 회수 |

`DELETE /connection`은 Growful 저장 데이터만 삭제합니다. SmartThings Linked Service 설치 및
SmartThings 측 credential의 확실한 회수가 필요한 경우 공식 설치 해제/회수 결과를 별도
확인해야 합니다.

## 4. 로그·감사기록 대장

| 원천 | 허용 내용 | 금지 내용 | 보존기간 | 관리자/사업자 | 상태 |
| --- | --- | --- | --- | --- | --- |
| application stdout/stderr | event, 상태, redacted error name, correlation ID | token, secret, Authorization, OAuth code, request body | `[APP_LOG_RETENTION]` | `[LOG_OWNER/PROVIDER]` | 미확정 |
| reverse proxy/CDN/WAF | 시간, route, status, bytes, 가명 IP 정책값 | Authorization/header·본문 원문 | `[EDGE_LOG_RETENTION]` | `[PROVIDER]` | 미확정 |
| host/system | service·security event | 환경변수·secret dump | `[HOST_LOG_RETENTION]` | `[HOST_PROVIDER]` | 미확정 |
| PostgreSQL | 접속·관리·오류 metadata | query parameter의 token/본문 | `[DB_LOG_RETENTION]` | `[DB_OWNER]` | 미확정 |
| 연결 수명주기·접근 audit | 가명 연결 hash, 작업, 결과, UTC 시각, 이전 이벤트 hash | token, secret, 사용자명, `installedAppId` 원문 | `[AUDIT_RETENTION]` | `[DB_OWNER]` | append-only·단일 정규화 hash chain·CLI/런타임 자동 검증 구현, 외부 불변 보존 미확정 |
| 관리자 audit | 해시된 주체·승인 ticket, 고정 목적 사유, 가명 대상, 차단·해제·개인정보 삭제, 결과, UTC 시각 | token/secret/원시 운영자 ID·원시 ticket·`installedAppId` | 1/2년 법적 검토, 권한 변경 3년 목표 | `[AUDIT_PROVIDER]` | 차단·해제와 개인정보 삭제 성공·대상 없음 append-only 기록 구현; 중앙 신원 귀속·외부 불변 보존 미구현 |
| CI/registry | actor, workflow, commit, digest, 결과 | secret 출력 | `[CI_LOG_RETENTION]` | GitHub/`[OWNER]` | 실제 설정 미검증 |
| incident evidence | 최소 forensic 자료, hash, chain of custody | 불필요한 원문 확산 | `[LEGAL_RETENTION]` | `[SECURITY_OWNER]` | 미확정 |
| 공개 서비스 공지 | 사건 제목·영향·공개 메시지·시작/갱신/해결 시각 | token, secret, 사용자 식별자, 내부 인프라 상세 | `[STATUS_HISTORY_RETENTION]` | `[COMMS_OWNER/DB_OWNER]` | PostgreSQL 공지·해결 이력과 공개 페이지 구현, 보존기간 미확정 |

보존기간을 길게 설정하는 것만으로 적법·안전하지 않습니다. 목적 종료 시 삭제하고, 법적 보존
필요가 있는 경우 접근 제한과 보존 중지 사유·해제일을 기록합니다.

감사 체인은 `node dist/verify-audit.js`와 Gateway 런타임이 전체 행의 형식, sequence 순서, 이전
해시와 이벤트 해시를 재계산합니다. CLI 정상 결과는 종료코드 0, 손상 결과는 종료코드 1입니다.
Gateway는 시작 시와 기존 유지보수 주기마다 재검증하고 손상 또는 읽기 실패 동안 `/readyz`를
`503`으로 전환합니다. 출력과 로그에는 원문 연결 식별자나 token을 포함하지 않습니다.
`manage-abuse`와 `manage-privacy-deletion` CLI의 운영자 ID와 ticket은 입력 직후 SHA-256 값으로만
기록되지만 입력 주체나 외부 ticket 승인 상태를 중앙 검증하지는 않으므로 개별 관리자 계정과
승인 시스템의 귀속 절차가 필요합니다. 자동 검증 결과의 외부 보존 위치, 독립 alert 연결, 검토
담당자와 검토 증빙은 `[AUDIT_REVIEW_PROCEDURE]`로 확정해야 합니다.

## 5. Backup·WAL·snapshot 대장

| 저장소 | 사업자/리전 | 암호화·키 | 생성 주기 | 보존/소멸 | 삭제 대상 재유입 통제 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL base backup | `[PROVIDER/REGION]` | `[ENCRYPTION/KEY_OWNER]` | `[SCHEDULE]` | `[RETENTION]` | `[RESTORE_PROCEDURE]` | 미확정 |
| PostgreSQL WAL/PITR | `[PROVIDER/REGION]` | `[ENCRYPTION/KEY_OWNER]` | `[CONTINUOUS]` | `[RETENTION]` | `[REPLAY_BOUNDARY]` | 미확정 |
| host/volume snapshot | `[PROVIDER/REGION]` | `[ENCRYPTION/KEY_OWNER]` | `[SCHEDULE]` | `[RETENTION]` | `[RESTORE_PROCEDURE]` | 미확정 |
| off-site/disaster copy | `[PROVIDER/REGION]` | `[ENCRYPTION/KEY_OWNER]` | `[SCHEDULE]` | `[RETENTION]` | `[RESTORE_PROCEDURE]` | 미확정 |
| edge/log archive | `[PROVIDER/REGION]` | `[ENCRYPTION/KEY_OWNER]` | `[SCHEDULE]` | `[RETENTION]` | 해당 없음/`[DELETE]` | 미확정 |

각 backup은 자동 만료 정책, 수동 삭제 권한, immutable 기간, 계약 종료 시 반환·파기, key 폐기
효과를 증빙해야 합니다. backup을 직접 수정할 수 없다면 삭제 tombstone/억제 목록을 별도 보호해
restore 직후 외부 연결 전에 재삭제합니다.

## 6. 삭제 요청 실행 절차

1. 요청을 고유 case ID로 접수하고 요청자, 범위, 수신 시각과 법정 기한을 기록합니다.
2. `[IDENTITY_VERIFICATION]`으로 본인을 확인하되 새 개인정보를 과도하게 수집하지 않습니다.
3. legal hold, 계약상 의무와 SmartThings 측 회수 필요성을 확인합니다.
4. 확인된 `supportReference`, 운영자 ID와 외부 승인 ticket으로
   `node dist/manage-privacy-deletion.js delete SUPPORT_REFERENCE OPERATOR_ID EXTERNAL_APPROVAL_TICKET`을
   실행합니다. 일치하는 연결 삭제와 성공 audit는 같은 트랜잭션이고, 대상 없음도 실패 audit로
   남습니다. 원시 `installedAppId`, token, 운영자 ID와 ticket은 출력·저장하지 않습니다.
5. SmartThings 설치·credential 회수가 요청 범위라면 공식 절차를 실행하고 결과를 기록합니다.
6. log·ticket·support·incident 저장소에서 허용된 식별자로 검색해 삭제 또는 접근 제한합니다.
7. backup/WAL/snapshot은 확정된 수명에 따라 만료시키고 restore 억제 목록에 case를 등록합니다.
8. 다음 backup cycle과 sample restore에서 대상이 재유입되지 않음을 검증합니다.
9. 확인된 범위, 즉시 삭제된 위치, backup에서 소멸할 예정일과 예외를 사용자에게 알립니다.

삭제 증빙은 삭제된 데이터 자체를 다시 복제하지 않고 case ID, 가명 식별자, 위치, 결과, 시각,
실행·검토자와 backup 만료 확인으로 구성합니다.

4단계 CLI는 primary PostgreSQL에만 효력이 있습니다. 2단계 본인 확인, 5단계 SmartThings 설치와
credential 회수, 6~8단계 외부 저장소·backup/WAL 파기와 복구 억제는 독립된 외부 절차이며 CLI의
성공 결과가 그 완료를 뜻하지 않습니다.

## 7. 복구 시 개인정보 보호

복구 담당자는 production traffic을 열기 전에 다음을 수행합니다.

- backup 생성 시각과 현재 삭제 억제 목록을 대조합니다.
- backup 이후 삭제·회수·token rotate·권한 변경 event를 순서대로 재적용합니다.
- 만료 OAuth state와 삭제된 연결이 존재하지 않는지 query와 표본으로 확인합니다.
- 복구 환경의 network egress를 검증 전 차단해 오래된 token이 사용되지 않게 합니다.
- 검증 결과, 대상 case 수, 실패·재처리와 승인자를 restore report에 남깁니다.

## 8. 공개 문구에서 금지할 주장

다음 표현은 인프라 설정과 훈련 증빙이 없으므로 현재 사용할 수 없습니다.

- “모든 데이터는 즉시 영구 삭제됩니다.”
- “로그에는 개인정보가 전혀 없습니다.”
- “모든 데이터는 한국에서만 처리됩니다.”
- “백업에서도 즉시 삭제됩니다.”
- “SmartThings 연결과 credential도 Growful 삭제 즉시 폐기됩니다.”
- “법적 보존기간과 모든 보안 기준을 충족했습니다.”

대신 primary DB의 확인된 동작과 backup의 확정된 최대 잔존 기간을 구분해 설명합니다.

## 9. 완료 조건

1. 모든 `[PLACEHOLDER]`에 계약·설정으로 확인한 사업자, 리전, 소유자와 기간을 채웁니다.
2. 각 log sink에서 민감 header/body가 수집되지 않는지 실제 request로 검증합니다.
3. DB, WAL, backup, snapshot, edge/log archive의 자동 만료와 수동 파기 증빙을 보관합니다.
4. token 분실 사용자의 외부 본인 확인·삭제 승인·완료 통지 절차를 확정하고 표본 훈련합니다.
5. restore test로 만료 state와 삭제 연결이 public network에 재유입되지 않음을 입증합니다.
6. 개인정보 보호 책임자와 법률 검토자가 기간·표현을 승인합니다.
7. 공개 개인정보 처리방침의 보존·파기 문구가 이 대장 및 실제 설정과 일치하는지 검토합니다.
