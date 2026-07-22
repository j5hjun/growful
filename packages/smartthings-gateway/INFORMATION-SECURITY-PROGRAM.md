# Growful SmartThings Gateway 정보보호 프로그램

기준일: 2026-07-22

상태: **DRAFT — 운영 승인 및 통제 증빙 미완료**

이 문서는 Growful SmartThings Gateway의 서면 정보보호 프로그램 초안입니다. 절차가
작성되었다는 사실만으로 실제 통제가 운영되거나 SmartThings의 승인을 받았다고 주장하지
않습니다. 역할, 연락처, 인프라 사업자와 증빙 위치의 placeholder가 채워지고 승인·훈련 기록이
남기 전까지 공개 출시 근거로 사용할 수 없습니다.

근거:

- [SmartThings Developer Terms of Service](https://developer.smartthings.com/termsofservice)
- [개인정보의 안전성 확보조치 기준](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulNm=%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4%EC%9D%98+%EC%95%88%EC%A0%84%EC%84%B1+%ED%99%95%EB%B3%B4%EC%A1%B0%EC%B9%98+%EA%B8%B0%EC%A4%80&docType=JO&joNo=001300000&languageType=KO&paras=1)
- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)

## 1. 승인과 문서 통제

| 항목 | 책임 또는 값 | 현재 상태 |
| --- | --- | --- |
| 법적 운영자 | `[LEGAL_OPERATOR]` | 미확정 |
| 보안 책임자 | `[SECURITY_OWNER]` | 미지정 |
| 개인정보 보호 책임자 | `[PRIVACY_OWNER]` | 미지정 |
| 사고 지휘자와 대리자 | `[INCIDENT_COMMANDER]`, `[DEPUTY]` | 미지정 |
| 문서 승인자·승인일 | `[APPROVER]`, `[APPROVED_AT]` | 미승인 |
| 다음 정기 검토일 | `[NEXT_REVIEW_AT]` | 미확정 |
| 적용 서비스 버전 | `[RELEASE_OR_COMMIT]` | 미기록 |
| 증빙 저장소 | `[EVIDENCE_REGISTER]` | 미확정 |
| 예외·위험 수용 대장 | `[EXCEPTION_REGISTER]` | 미확정 |

보안 책임자는 최소 연 1회 및 중대한 서비스·인프라·법령·SmartThings 조건 변경 때 이 문서를
검토합니다. 모든 예외에는 사유, 영향, 보완 통제, 승인자, 만료일을 기록합니다.

## 2. 범위와 자산

프로그램 범위에는 다음 자산과 이를 관리하는 사람·단말·공급자가 포함됩니다.

- `smartthings.growful.click` 도메인, DNS, TLS와 Cloudflare 계층
- SmartThings Developer Workspace의 App ID, OAuth client와 webhook 설정
- GitHub 저장소·Actions·GHCR와 배포 이미지
- 운영 호스트, Tailscale 관리 경로, Docker와 PostgreSQL
- 애플리케이션 로그, 관리자 감사기록, PostgreSQL WAL·백업·호스트 snapshot
- 배포·복구·지원에 사용하는 관리자 계정과 관리 단말

자산 대장은 소유자, 환경, 사업자, 처리 국가/리전, 중요도, 인증 방식, 백업 여부, 마지막 검토일을
포함해야 합니다. 현재 사업자·리전은 확정되지 않았으며 공개 정책에 추정값을 쓰지 않습니다.

## 3. 데이터 분류와 처리 원칙

| 등급 | 예시 | 최소 통제 |
| --- | --- | --- |
| 제한 | SmartThings access/refresh token, OAuth client secret, 암호화 키 | 승인된 서비스만 접근, 암호화, 원문 로그·티켓·채팅 금지 |
| 기밀 | Growful token hash, `installedAppId`, 승인 scope, 연결·갱신 metadata | 업무상 최소 권한, 접근기록, 승인된 보존·파기 |
| 내부 | 배포 구성, 감사·장애 기록, 미공개 architecture | 인증된 관리자만 접근, 외부 공유 승인 |
| 공개 | 승인된 웹 문구와 공개 문서 | 게시 승인과 무결성 검토 |

수집 최소화, 목적 제한, 기본 거부, 최소 권한을 기본값으로 둡니다. 운영 데이터를 개발·테스트에
복사하지 않습니다. 불가피한 예외는 개인정보 보호 책임자의 사전 승인과 비식별·기한부 삭제
기록을 요구합니다.

## 4. 역할과 책임

- 서비스 소유자: 범위, 예산, 위험 수용과 공개 출시를 승인합니다.
- 보안 책임자: 위험 평가, 접근 검토, 취약점·사고·훈련 프로그램과 증빙을 관리합니다.
- 개인정보 보호 책임자: 고지·동의·권리행사·보존·파기·법정 통지 결정을 관리합니다.
- 시스템 관리자: 승인된 변경만 배포하고 접근·백업·복구 증빙을 남깁니다.
- 개발자: 비밀을 코드에 넣지 않고 review·test·dependency 정책을 따릅니다.
- 사고 지휘자: [사고 대응 runbook](./INCIDENT-RESPONSE.md)에 따라 역할과 타임라인을 통제합니다.

한 사람이 여러 역할을 맡더라도 승인자와 실행자를 가능한 한 분리하고, 분리할 수 없는 경우
사후 독립 검토를 남깁니다.

## 5. 계정과 접근권한

1. 공유 관리자 계정을 금지하고 사람별 고유 계정을 사용합니다.
2. GitHub, Cloudflare, 호스트, Tailscale, SmartThings와 비밀 저장소는 지원되는 경우 MFA/SSO를
   강제합니다. 복구 코드도 제한 데이터로 보관합니다.
3. 신규·변경 접근은 티켓에 대상, 역할, 업무 목적, 범위, 승인자, 시작·종료일을 기록한 뒤
   최소 권한으로 부여합니다.
4. 퇴사·역할 종료·단말 분실 시 접근을 즉시 회수하고 세션과 관련 비밀을 폐기 또는 교체합니다.
5. 보안 책임자는 최소 분기마다 계정, 역할, API key, deploy key, CI secret과 휴면 접근을
   검토합니다.
6. 권한 부여·변경·회수 기록은 SmartThings 요구에 맞춰 최소 3년 보존 대상으로 지정합니다.

접근 검토 증빙에는 검토 일시, 자산별 계정, 현재 권한, 필요성 판단, 조치, 검토자와 완료일이
포함되어야 합니다. 현재 실제 계정 목록과 검토 기록은 없으므로 이 통제는 운영 완료가 아닙니다.

## 6. 비밀과 암호화 키

- `.env`와 운영 비밀 파일은 저장소·이미지에 포함하지 않고 최소 권한(`0600`)으로 제한합니다.
- OAuth client secret, DB 자격 증명, Growful 암호화 키는 환경·목적별로 분리하고 재사용하지
  않습니다.
- 토큰은 애플리케이션 계층 AES-256-GCM으로 암호화하고 HTTPS로 전송합니다.
- 비밀 대장에는 소유자, 저장 위치, 생성일, 마지막 교체일, 다음 교체일, 의존 서비스와 폐기
  증빙을 기록합니다. 값 자체는 대장에 기록하지 않습니다.
- 노출 의심, 역할 종료, 공급자 권고 또는 정기 주기 도래 시 runbook에 따라 교체하고 이전 값을
  폐기합니다.

현재 저장 토큰을 새 암호화 키로 재암호화하는 migration과 다중 키 식별자 체계가 구현되지
않았습니다. 따라서 `TOKEN_ENCRYPTION_KEY`의 무중단 정기 교체를 완료된 통제로 표시하지
않습니다. 구현 전에는 사고 격리·연결 재승인까지 포함한 별도 절차가 필요합니다.

## 7. 네트워크·시스템·관리 단말

- 운영 DB와 관리 포트는 공용 인터넷에 직접 노출하지 않고 명시적으로 허용된 서비스와
  Tailscale 관리 경로만 허용합니다.
- container image는 digest로 고정하고 불필요한 port·capability·package를 제거합니다.
- 관리자 단말은 전체 디스크 암호화, 자동 화면 잠금, 지원 중 OS, 보안 update와 malware 방지
  기능을 유지합니다. 가족·공용 계정과 분리합니다.
- 운영 변경에는 승인·rollback·검증 계획이 있어야 하며 emergency change는 사고 기록에
  연결해 사후 승인합니다.
- production 데이터는 관리자 단말에 지속 저장하지 않습니다.

호스트 방화벽, Tailscale ACL, 단말 암호화와 patch 상태의 실제 캡처·export가 증빙 대장에
등록되기 전에는 이 항목을 운영 완료로 보지 않습니다.

## 8. 로그와 감사

애플리케이션 로그에 token, secret, Authorization header, OAuth code를 남기지 않습니다. 별도
관리자 감사기록은 최소한 다음 필드를 가져야 합니다.

- UTC 시각, 고유 관리자 주체, 작업 목적/승인 티켓
- 대상 환경과 가명화된 연결 식별자
- 수행 작업, 결과, 변경 전후 권한 또는 구성
- 요청·배포·incident correlation ID

감사기록은 운영자가 임의 수정할 수 없는 별도 sink 또는 append-only 통제로 보호하고 접근을
제한합니다. 정기 검토와 이상 징후 alert를 남깁니다. 개인정보취급자/관리자 접속기록은 적용되는
법적 기준에 따라 최소 1년 또는 해당 요건에 해당하면 2년을 검토 기준으로 삼고, 권한 변경
기록은 최소 3년을 목표로 합니다. 최종 기간은 법률 검토 및 인프라 구성 후
[보존·파기 대장](./DATA-RETENTION.md)에 확정합니다.

현재 연결 승인·재승인, Growful token 교체, 연결 삭제, 갱신 성공·실패, Growful 인증과
SmartThings token 읽기는 `installedAppId` 원문 대신 SHA-256 가명값으로 PostgreSQL 감사 테이블에
기록됩니다. 각 이벤트는 이전 이벤트 hash와 연결되며 애플리케이션 DB 역할의 update·delete·
truncate를 거부합니다. Node와 PostgreSQL trigger는 동일한 UTC 밀리초 정규화로 이벤트 hash를
만들며 `node dist/verify-audit.js`와 Gateway 런타임이 전체 체인의 형식·순서·이전 hash·이벤트
hash를 검증합니다. Gateway는 시작 시와 기존 유지보수 주기마다 자동 재검증하고, 손상 또는
읽기 실패 동안 준비 상태를 `503`으로 전환합니다. 반복 quota 위반의 수동 차단·해제도 가명
대상, 고정 사유, 해시된 운영자 ID와
승인 ticket을 같은 체인에 원자적으로 기록합니다. 다만 CLI 입력 ID는 self-asserted이며 실제
개별 관리자 계정과의 귀속은 SSH/session audit로 증명해야 합니다. 또한 이 통제는 같은 DB
소유자의 DDL 변경까지 막는 외부 불변 sink가 아니며, 보존기간, 검색·독립 alert와 운영 검토
증빙이 구현되지 않았습니다. 따라서 관리자 감사와 변조 방지 보존 통제는 계속 차단 상태입니다.

## 9. 안전한 개발·변경·배포

- 기능·보안 수정은 short-lived branch, peer review, 자동 test, type/lint/build와 배포 preflight를
  통과해야 합니다.
- 인증·권한·암호화·삭제·webhook·proxy 변경은 negative test와 위협 경계를 함께 검토합니다.
- dependency와 container 취약점은 자동 탐지하고 심각도·노출도에 따라 처리기한을 지정합니다.
- 운영 secret이나 실제 token을 test fixture, log, screenshot, issue, PR에 사용하지 않습니다.
- 배포 artifact의 source commit과 digest를 기록하고 승인되지 않은 artifact를 거부합니다.
- rollback이 데이터 파기나 보안 수정 취소를 일으키지 않는지 확인합니다.

## 10. 취약점·패치·공급망

보안 책임자는 공개 노출·악용 가능성·데이터 영향으로 취약점을 분류합니다. 목표 처리기한은 실제
운영 승인을 거쳐 확정하되, 악용 중인 제한 데이터 관련 문제는 즉시 incident로 전환합니다.
host, OS, Docker, database, Tailscale, CI action과 dependency를 자산 대장에 연결합니다.

각 외부 사업자/하위처리자 대장에는 법적 주체, 서비스, 데이터, 목적, 처리 국가/리전, 계약,
보안 문서, incident 연락처, 삭제·반환 조건, 검토일을 기록합니다. Shared Personal Information을
공유하기 전에 SmartThings에 제공해야 하는 subprocessor 목록과 변경 절차를 확인합니다.

## 11. 보존·백업·파기

데이터별 실제 보존·삭제·백업 동작은 [데이터 보존·파기 대장](./DATA-RETENTION.md)을 따릅니다.
백업은 암호화하고 복구 권한을 분리하며, 정기 restore test로 무결성과 삭제 후 재유입 방지를
검증합니다. WAL·snapshot·외부 log까지 기간과 책임자가 확정되기 전 “즉시 완전 삭제”를
주장하지 않습니다.

복구 목표는 아직 미확정입니다.

| 항목 | 목표 | 현재 상태 |
| --- | --- | --- |
| RTO | `[RTO]` | 미승인 |
| RPO | `[RPO]` | 미승인 |
| backup 주기·보존 | `[BACKUP_SCHEDULE_AND_RETENTION]` | 미확정 |
| restore test 책임자 | `[RESTORE_OWNER]` | 미지정 |

## 12. 사고 대응과 연속성

보안 사건은 [사고 대응 runbook](./INCIDENT-RESPONSE.md)에 따라 탐지, 분류, 격리, 증거보존,
복구, 통지와 사후검토를 수행합니다. SmartThings 관련 사건은 인지 시각부터 24시간 이내 통지를
운영 목표로 하지만 실제 접수 채널은 SmartThings 서면 답변으로 확정해야 합니다.

연락망, 의사결정 대리자, 법률 자문, hosting·DB·Cloudflare 연락처와 상태 페이지 권한을 반기마다
검증합니다. 복구 후 손상된 credential과 session을 재사용하지 않습니다.

## 13. 교육·훈련·증빙

- 역할 부여 시와 최소 연 1회 보안·개인정보·incident 교육을 완료합니다.
- 최소 반기마다 token 노출 또는 관리자 계정 침해 tabletop을 수행합니다.
- 최소 연 1회 backup restore와 삭제 후 재유입 방지 훈련을 수행합니다.
- 훈련에는 참여자, 시나리오, 시작·탐지·결정·통지 시각, 산출물, 실패, 시정조치 담당자와
  기한을 남깁니다.

## 14. 공개 출시 전 완료 조건

다음을 모두 만족하기 전 이 문서를 “운영 중” 또는 공개 출시 증빙으로 표시하지 않습니다.

1. 모든 필수 역할·연락처·사업자·리전·보존기간·RTO/RPO를 확정합니다.
2. 운영자와 개인정보 보호 책임자가 문서를 승인하고 적용 버전을 기록합니다.
3. 고유 계정, MFA, 접근 승인·회수·분기 검토의 실제 증빙을 남깁니다.
4. 비밀 대장과 token encryption key 교체/재암호화 절차를 구현·훈련합니다.
5. 관리자 감사기록의 변조 방지, 보존, 검색과 정기 검토를 검증합니다.
6. 공급자·subprocessor 목록과 계약·처리 지역을 확정합니다.
7. 사고 통지와 backup restore·삭제 훈련을 수행하고 시정조치를 닫습니다.
8. SmartThings 요구사항 및 적용 법률에 대한 법률·계약 검토를 기록합니다.
