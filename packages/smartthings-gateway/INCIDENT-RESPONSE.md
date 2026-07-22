# Growful SmartThings Gateway 사고 대응 Runbook

기준일: 2026-07-22

상태: **DRAFT — 연락망, 접수 채널, 훈련 및 운영 승인 미완료**

이 runbook은 토큰·개인정보·서비스 가용성·공급망 사고의 실행 순서를 정의합니다. 작성 완료를
실제 대응 역량이나 SmartThings 통지 채널 확보로 간주하지 않습니다. 사고 중에는 모든 시각을
UTC와 현지 시각으로 함께 기록하고, 증거 보존과 피해 최소화를 우선합니다.

근거:

- [SmartThings Developer Terms of Service](https://developer.smartthings.com/termsofservice)
- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)

## 1. 연락망과 권한

| 역할/기관 | 주 담당 | 대리자 | 검증된 채널 | 상태 |
| --- | --- | --- | --- | --- |
| 사고 지휘자 | `[INCIDENT_COMMANDER]` | `[DEPUTY]` | `[PHONE/EMAIL]` | 미지정 |
| 보안 대응 | `[SECURITY_OWNER]` | `[SECURITY_DEPUTY]` | `[CHANNEL]` | 미지정 |
| 개인정보·법률 | `[PRIVACY_LEGAL_OWNER]` | `[DEPUTY]` | `[CHANNEL]` | 미지정 |
| 사용자 공지·지원 | `[COMMS_OWNER]` | `[DEPUTY]` | `[CHANNEL]` | 미지정 |
| SmartThings 24시간 통지 | `[SMARTTHINGS_CONTACT]` | `[BACKUP_CHANNEL]` | `[CONFIRMED_CHANNEL]` | 미확정 |
| Cloudflare/hosting/DB | `[PROVIDER_CONTACTS]` | `[ESCALATION]` | `[CHANNELS]` | 미확정 |
| 규제기관·수사기관 | `[LEGAL_DECISION]` | `[COUNSEL]` | `[OFFICIAL_CHANNEL]` | 미확정 |

누구든지 사건을 발견하면 사고 지휘자와 대리자에게 동시에 알릴 수 있어야 합니다. 지휘자는
격리·공개·복구의 단일 의사결정 기록을 유지합니다. 연락처는 최소 분기마다 실제 송수신으로
검증합니다.

## 2. 심각도와 선언 기준

| 등급 | 예시 | 초기 대응 목표 |
| --- | --- | --- |
| P0 중대 | token/암호화 키 대량 노출, 관리자·CI/host 장악, 데이터 반출, 광범위 무단 제어, 악용 진행 중 | 즉시 incident 선언, 전원 호출, 외부 통지 시계 시작 |
| P1 높음 | 단일 사용자 token 노출, 권한 우회 가능성, 감사기록 손상, 복구 가능한 보안 장애 | 15분 내 triage, 1시간 내 격리 계획 |
| P2 보통 | 공격 징후 없는 취약 구성, 제한된 가용성 문제, 민감정보 없는 실패 | 업무시간 내 담당 지정과 기한 설정 |

다음 중 하나면 보안 사건으로 선언합니다: 제한 데이터의 기밀성·무결성·가용성이 의심됨,
SmartThings API가 승인되지 않은 주체에 의해 호출됨, 관리자/공급자 계정이 탈취됨, audit 또는
backup이 변조됨, 서비스 중단·보안 문제에 관한 SmartThings 통지 의무 가능성이 있음.

## 3. 사건 타임라인

### 최초 15분

1. 사건 ID를 만들고 발견·인지 시각, 보고자, 관찰 사실과 출처를 기록합니다.
2. P0/P1/P2를 임시 분류하고 사고 지휘자·대리자에게 호출합니다.
3. SmartThings 관련성, 개인정보·token·관리자 접근·서비스 중단 가능성을 표시합니다.
4. 영향 확대를 막는 되돌릴 수 있는 조치를 선택합니다. 의심 계정/경로를 차단하되 증거를
   먼저 확보하고 로그·DB·host를 성급히 삭제하거나 재설치하지 않습니다.
5. 인지 시각으로부터 SmartThings 24시간 통지 deadline을 계산해 사건 기록 맨 위에 둡니다.

### 최초 1시간

1. 영향 사용자, `installedAppId`/연결의 가명 식별자, scope, 시간 범위, 자산·공급자를 추정합니다.
2. 관련 로그·container/image digest·설정 metadata·DB snapshot의 증거 보존본과 hash를 만듭니다.
3. 악용 중이면 영향 credential을 폐기·회수하고 public entry point를 제한합니다.
4. 개인정보·법률 담당자가 SmartThings, 사용자, 규제기관 통지 필요성과 기한을 병렬 평가합니다.
5. 다음 update 시각, 조사 담당자, 격리/복구 owner를 정합니다.

### 1시간 이후

- 사실·가설·결정을 구분한 event log를 유지하고 P0는 최소 매시간 상태를 재평가합니다.
- root cause가 불명확해도 24시간 통지를 늦추지 않습니다. 확인된 사실, 불확실성, 현재 통제와
  다음 update 약속을 보냅니다.
- 복구는 깨끗한 artifact와 새 credential을 사용하고 기능·권한·log·monitoring을 검증합니다.

## 4. 증거 보존

수집자는 사건 ID, 원본 위치, 수집 시각, 수집 명령/방법, hash, 보관 위치, 접근자를 기록합니다.
필요 대상은 다음과 같습니다.

- application·reverse proxy·Cloudflare·Tailscale·host·database audit log
- 배포 commit, image digest, CI workflow/run, dependency lockfile와 공급망 경보
- 변경 전후 설정의 값 없는 metadata와 계정·권한 변경 이력
- 관련 DB 행의 제한된 forensic export와 backup/WAL/snapshot metadata
- 사용자·공급자·SmartThings와 주고받은 통지 원본

token/secret 원문을 일반 사건 문서, issue, chat에 복사하지 않습니다. 증거 저장소는 접근을
최소화하고 chain of custody를 유지하며 법률 담당자가 보존 중지 여부를 결정합니다.

## 5. SmartThings 24시간 통지

SmartThings 관련 보안 사건은 Developer Terms에 따른 통지 가능성을 즉시 평가합니다. 실제
수신 채널과 접수 증빙 형식은 [승인 요청 패킷](./SMARTTHINGS-APPROVAL-REQUEST.md)으로 서면 확인
해야 하며, `[CONFIRMED_CHANNEL]`이 비어 있는 현재 상태에서는 공개 출시할 수 없습니다.

초기 통지에는 확인 가능한 범위에서 다음을 포함합니다.

```text
Subject: Security Incident Notice — Growful SmartThings Gateway — [INCIDENT_ID]

Licensee/operator: [LEGAL_OPERATOR]
SmartThings App ID: [APP_ID]
Incident ID: [INCIDENT_ID]
Detected at / became aware at: [UTC_TIMESTAMP]
Incident category and current severity: [CATEGORY / P0|P1]
Known or suspected time window: [START — END / UNKNOWN]
Affected SmartThings data, credentials, users and scopes: [FACTS / UNKNOWN]
Actions already taken to contain and preserve evidence: [ACTIONS]
Current user and SmartThings ecosystem impact: [IMPACT]
Primary incident contact and 24-hour callback channel: [CONTACT]
Next update by: [UTC_TIMESTAMP]
Items still under investigation: [UNKNOWN ITEMS]
```

발송 전 법률 검토가 지연되더라도 deadline을 넘기지 않도록 대리 승인자를 지정합니다. 발송
원문, 첨부, 수신자, 전송·접수 시각, ticket/case ID와 후속 답변을 변경 불가능한 증빙으로
보관합니다.

## 6. 사용자·규제기관 통지

개인정보 담당자는 적용 국가, 정보 종류, 암호화·키 노출 여부, 피해 가능성, 사용자 수와 법정
기한을 평가합니다. 확정 전에는 “영향 없음”이라고 단정하지 않습니다. 사용자 통지는 평이한
언어로 사건, 노출 가능 항목, 시기, 조치, 사용자가 할 일, 지원 연락처와 다음 update를 포함합니다.

규제기관/사용자 통지 결정, 법률 근거, 결정자와 시각을 남깁니다. 이 문서는 법률 자문을 대신하지
않으며 실제 관할·연락망 placeholder가 채워져야 합니다.

### 공개 상태 공지

서비스 가용성 공지는 승인 ticket과 운영자 ID를 사용해 `manage-status` CLI로 열고, 조사·관찰
상태를 갱신한 뒤 해결합니다. 제목과 메시지는 즉시 `/status`에 공개되므로 token, secret,
사용자 식별자와 공격자가 악용할 수 있는 내부 인프라 상세를 넣지 않습니다. 게시 전 사고
지휘자와 사용자 공지 담당자가 확인 가능한 사실, 사용자 영향과 다음 조치만 검토합니다.

```sh
node dist/manage-status.js open degraded "TITLE" "MESSAGE" OPERATOR_ID TICKET_ID
node dist/manage-status.js update INCIDENT_ID monitoring "MESSAGE" OPERATOR_ID TICKET_ID
node dist/manage-status.js resolve INCIDENT_ID "MESSAGE" OPERATOR_ID TICKET_ID
```

이 기능은 공개 이력과 운영자 감사기록을 제공하지만 이메일·푸시 같은 개별 사용자 통지,
SmartThings·규제기관 통지, 자동 장애 탐지 또는 접수 증빙을 대신하지 않습니다.

## 7. 시나리오별 조치

### Growful token 노출

1. 해당 hash로 연결을 찾되 token 원문을 log에 남기지 않습니다.
2. 기존 Growful token을 폐기하고 연결 접근을 차단합니다.
3. 사용자의 신원을 확인한 뒤 재발급 또는 SmartThings 재연결을 안내합니다.
4. 그 token으로 수행된 proxy 요청 범위를 audit 가능한 자료로 조사합니다.

### SmartThings access/refresh token 또는 DB 노출

1. 영향 연결의 refresh와 proxy를 중지하고 DB·host 접근을 격리합니다.
2. SmartThings에서 해당 설치/권한을 회수하는 공식 방법을 사용하고 재승인을 요구합니다.
3. 단순히 Growful DB 행을 삭제한 사실만으로 SmartThings credential이 폐기됐다고 주장하지
   않습니다. SmartThings 측 회수 결과를 별도 증빙으로 남깁니다.
4. 암호문만 노출됐어도 키 접근 가능성과 nonce/tag 무결성을 조사합니다.

### `TOKEN_ENCRYPTION_KEY` 노출

1. 모든 저장 token을 노출 가능 상태로 분류하고 service를 private/maintenance 상태로 제한합니다.
2. 침해 경로를 격리한 뒤 새 키를 안전한 경로로 생성합니다.
3. 현재 다중 키 재암호화 migration이 없으므로 영향 연결 폐기·사용자 재승인 계획을 실행합니다.
4. 이전 키가 모든 host, CI secret, backup, shell history와 복구본에서 제거됐는지 추적합니다.

### OAuth client secret 노출

1. SmartThings Developer Workspace에서 가능한 교체/폐기 절차와 영향 범위를 확인합니다.
2. callback·webhook app ID pinning과 최근 비정상 code exchange를 검토합니다.
3. 새 secret을 배포하고 이전 값의 폐기 확인과 end-to-end OAuth 검증을 남깁니다.

### 관리자·host·CI·공급망 침해

1. 의심 계정/session/deploy key를 차단하고 깨끗한 관리 단말에서 대응합니다.
2. image digest, workflow, action SHA, registry 권한과 최근 배포를 비교합니다.
3. 신뢰 기준 commit부터 깨끗한 host에 재배포하고 모든 접근·application secret을 교체합니다.
4. 공급자 case ID, 조사 결과와 downstream 사용자 영향을 기록합니다.

## 8. 복구 승인

사고 지휘자는 다음 체크를 기록한 뒤에만 public traffic을 복구합니다.

- root cause 또는 안전한 격리 경계가 확인됨
- 영향 credential·session·계정이 폐기되고 새 값이 안전하게 배포됨
- known indicators 검색과 권한 검토가 완료됨
- OAuth, webhook, token refresh, proxy, 연결 삭제의 보안·기능 test가 통과함
- monitoring·audit·rate limit이 정상이고 재발 탐지 alert가 있음
- 사용자·SmartThings·규제기관 후속 update 일정이 지정됨

## 9. 사후검토와 훈련

P0/P1은 안정화 후 `[POSTMORTEM_DEADLINE]` 안에 비난 없는 사후검토를 작성합니다. 타임라인,
root cause, 영향, 탐지·대응 지연, 잘된/실패한 통제, 시정조치 owner·기한과 재발 test를
포함합니다. 조치를 완료할 때까지 위험 대장에서 추적합니다.

최소 반기마다 다음을 tabletop 또는 실제 격리 환경에서 훈련합니다.

- token/키 노출 탐지부터 24시간 SmartThings 통지 초안·승인·전송 증빙까지
- 관리자 계정 탈취, public traffic 차단과 credential 교체
- backup restore 뒤 삭제 대상의 재유입 탐지와 재삭제

첫 훈련일, 참여자, 측정 타임라인, 통지 산출물, 실패와 시정조치가 기록되기 전 이 runbook을
운영 증빙으로 표시하지 않습니다.
