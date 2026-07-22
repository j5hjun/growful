# SmartThings 약관·정책 준수 매트릭스

기준일: 2026-07-22

이 매트릭스는 [SmartThings Developer Terms of Service](https://developer.smartthings.com/termsofservice),
[API Access App Setup](https://developer.smartthings.com/docs/service-integrations/app-setup),
[Product Policies](https://developer.smartthings.com/docs/certification/product-policies)를 현재 구현과
연결합니다. 공식 문서의 의미를 대체하지 않으며, `통과`는 코드로 증명할 수 있는 좁은 항목만
뜻합니다.

상태 정의:

- `통과`: 현재 코드와 테스트가 요구사항을 직접 증명합니다.
- `부분`: 일부 구현됐지만 운영 증빙이나 추가 통제가 필요합니다.
- `차단`: 외부 확인 또는 필수 구현이 없어 공개·유료 출시를 막습니다.
- `해당 없음`: 현재 제품 범위에는 없으며 범위가 바뀌면 다시 평가합니다.

## 제품·상업 조건

| 공식 요구사항 | 상태 | 현재 증빙 | 남은 조치 |
| --- | --- | --- | --- |
| Authorized Purpose 안에서 Developer Tools 사용 | 차단 | OAuth API Access App 구조와 사용자 승인 흐름 구현 | token 대행·proxy 모델이 Licensee Product 운영인지 서면 확인 |
| service bureau 또는 타인의 이익을 위한 사용 제한 | 차단 | 연결별 사용자 승인과 격리는 구현 | 비공개 베타·무료 공개·유료 각각의 허용 여부 서면 확인 |
| 출시 전 live production 통합과 applicable test | 부분 | webhook, OAuth, proxy, PostgreSQL 통합·실제 HTTP QA | SmartThings가 요구하는 closed test와 제출 형식 확인·완료 |
| 30일 change notice와 45일 Material Modification 통지 | 차단 | [출시 계획](./PUBLIC-LAUNCH.md)에 gate 기록 | 어느 기한·채널이 최초 공개, 유료화, 정책 변경에 적용되는지 확인 |
| 고객 지원 책임 | 부분 | `/manage` self-service 연결 확인·교체·삭제, `/support`의 안전한 문의·신고 안내, `/status`의 readiness와 운영자 공지·해결 이력 | 본인 확인, 응답 목표, 긴급 단계, 실제 ticket·공지 훈련과 자동 탐지·개별 통지 |
| 공개 발표·Samsung/SmartThings 명칭 사용 제한 | 차단 | 인증 마크와 Samsung 로고를 사용하지 않음 | 설명적 명칭·도메인 문구 사용 범위와 사전 동의 여부 확인 |
| Certification Mark는 인증된 제품에만 사용 | 통과 | Works with SmartThings mark 미사용 | 향후 표장 추가 시 인증과 usage guideline 재검토 |
| 유료 기능 추가의 상업 조건 | 차단 | 결제·가격 기능 없음 | 별도 계약 필요 여부 확인 후 결제·환불·세금 법률 검토 |

## OAuth·API Access App

| 공식 요구사항 | 상태 | 현재 증빙 | 남은 조치 |
| --- | --- | --- | --- |
| 공개 HTTPS callback | 통과 | `OAUTH_REDIRECT_URI` production 고정 preflight | 운영 Console 등록값과 실제 callback 최종 대조 |
| App ID, Client ID, Client Secret 분리 | 통과 | `config.ts`, `main.ts`, webhook app ID 검증 | 운영 비밀 교체 절차를 서면 보안 프로그램에 포함 |
| Target URL confirmation | 통과 | `src/http/smartthings-webhook.ts`의 app ID·URL pinning | Developer Center에서 실제 `CONFIRMED` 상태 증빙 |
| uninstall lifecycle 정리 | 통과 | 서명된 `DELETE` lifecycle의 멱등 연결 삭제 E2E | 운영 SmartThings 계정에서 실제 unlink 확인 |
| OAuth scope 최소화 | 통과 | 기본 `r:devices:$`, 기능별 opt-in, 서버 allowlist | 새 기능마다 필요 scope 재평가 |
| access token 만료 전 refresh | 통과 | refresh worker, lease, stale-claim 방지 테스트 | 운영 장기 실행에서 refresh 주기 관찰 |
| SmartThings rate-limit 응답 보존 | 부분 | proxy가 upstream 상태·허용 응답 헤더를 전달하고 PostgreSQL 공유 `Retry-After`를 연결별로 준수; Growful도 연결별 60건/60초 quota, 누적 거부 metadata, 사용자 `supportReference`, 운영자 명시적 차단·해제를 모든 인스턴스에서 공유 | endpoint별 공식 한도 재확인, anomaly alert·지원 ticket/status 연동과 운영 review 절차 추가 |

## 개인정보

| 공식 요구사항 | 상태 | 현재 증빙 | 남은 조치 |
| --- | --- | --- | --- |
| 적절한 고지와 동의 | 부분 | OAuth 전에 운영자·내장 정책 링크·지원 채널을 표시하고 scope·정책 동의를 연결에 기록; CI·배포가 `/privacy`, `/terms` 응답 확인 | 운영자 사실값·법률 검토 완료 |
| 수집 항목·목적·보유기간 공개 | 부분 | `/privacy`와 `PUBLIC-LAUNCH.md`에 확인된 데이터 흐름과 미확정 보존 경계 기록 | 처리위탁자·국가·백업·로그 보존 확정 후 법률 검토·게시 |
| 제3자 제공·위탁과 공유 데이터 공개 | 차단 | SmartThings API 통신 경계는 코드로 확인 | Samsung/SmartThings 전달 항목과 Licensee subprocessors 확정·제출 |
| 데이터 판매·광고·분석·모델링 금지 | 통과 | 해당 저장·분석·광고·학습 기능 없음 | 기능 추가 시 회귀 검토와 명시적 SmartThings 합의 없이 유지 |
| 사용자 삭제 수단 | 부분 | `DELETE /connection`, signed uninstall lifecycle, token 분실 시 외부 본인 확인·승인 뒤 `supportReference`를 쓰는 PostgreSQL 운영 CLI와 성공/대상 없음 감사 | 본인 확인·외부 ticket 승인 검증·완료 통지와 backup 파기 운영 |
| Samsung/User 요청 시 영구 삭제 | 부분 | 운영 CLI가 primary 연결 삭제와 성공 operator audit를 원자적으로 실행하고 대상 없음 실패도 기록 | SmartThings 설치·credential 회수와 WAL·backup·snapshot·외부 log의 파기 시한·증빙 확정 |
| OAuth 임시 데이터 최소 보존 | 통과 | state 원문 미저장, 10분 만료, 정상 실행 중 최대 5분 내 정리 | 서비스 중단 시 재기동 정리와 운영 모니터링 유지 |
| privacy policy가 Samsung으로의 공개·사용을 허용 | 차단 | `/privacy`가 OAuth 승인과 SmartThings API 요청의 정보 전달 경계를 설명 | 적용법과 SmartThings 요구사항에 맞는 문구인지 법률 검토 후 확정 |
| subprocessors 목록 사전 제공 | 차단 | 저장소에는 확정 사업자·국가 목록 없음 | Cloudflare·hosting·DB·backup·monitoring 계약 주체와 국가 확정 |

## 기술·조직적 보안 조치

| 공식 요구사항 | 상태 | 현재 증빙 | 남은 조치 |
| --- | --- | --- | --- |
| 최소 권한과 개별 관리자 계정 | 차단 | 배포는 Tailscale SSH로 제한 | 운영 관리자 명단, 개별 계정, 부여·회수·정기 검토 절차 |
| 권한 변경 기록 3년 이상 | 차단 | 관리자 권한 audit store 없음 | 변조 방지 권한 이력과 보존 정책 구현 |
| 안전한 원격 관리자 접근 | 부분 | Tailscale SSH와 tag policy 문서화 | MFA/OTP, session timeout, 실제 ACL 증빙과 정기 검토 |
| 전송 중·저장 시 암호화 | 부분 | HTTPS 경계, AES-256-GCM token 암호화 | DB volume·backup 암호화와 key lifecycle 문서화·검증 |
| 관리자·운영자 활동 로그 | 차단 | 연결 수명주기·인증·token 읽기, 수동 차단·해제와 개인정보 삭제 성공/대상 없음을 가명 append-only hash-chain에 기록; 운영 작업은 해시된 운영자 ID·승인 ticket 포함, 전체 체인 검증 CLI 구현 | CLI self-asserted ID를 개별 관리자 계정과 외부 ticket 승인에 귀속, 외부 불변 sink, 보존·검색·정기 review 구현 |
| malware·patch 관리 | 차단 | digest-pinned container와 Dependabot만 확인 | host·관리 단말 patch/EDR 정책과 긴급 업데이트 절차 |
| 관리 단말·물리 접근 통제 | 차단 | 저장소에서 증명 불가 | 운영자 단말 전용성, 화면 잠금, 디스크 암호화, 물리 통제 기록 |
| 운영 데이터의 테스트 사용 방지 | 부분 | 테스트 fixture는 합성 token·ID 사용 | 운영 데이터 export 금지와 예외 승인·비식별 절차 문서화 |
| enterprise security policy | 부분 | [정보보호 프로그램 초안](./INFORMATION-SECURITY-PROGRAM.md)에 범위·역할·접근·암호화·개발·공급망 통제 정의 | 역할·사실값 확정, 운영 승인, 접근 검토·훈련·감사 증빙 |

## 사고·삭제 운영

| 공식 요구사항 | 상태 | 현재 증빙 | 남은 조치 |
| --- | --- | --- | --- |
| incident response program | 부분 | [사고 대응 Runbook 초안](./INCIDENT-RESPONSE.md)에 탐지·분류·격리·증거보존·복구·통지·사후검토 정의 | 연락망 확정, 반기 훈련과 시정조치 증빙 |
| SmartThings에 24시간 내 사고 통지 | 부분 | 15분/1시간/24시간 timeline과 초기 통지 template 작성 | 승인 요청에서 실제 채널·필수 형식 확인 후 전송 훈련 |
| 사용자·규제기관 통지 | 차단 | `/support`와 운영자 공지·해결 이력용 `/status`는 있으나 법정 통지 결정·개별 전달 기능은 없음 | 적용법별 의사결정표, 통지 템플릿, 전달·접수 증빙과 법률 연락망 |
| 삭제 요청 처리와 증빙 | 부분 | token 분실 요청을 `supportReference`+운영자+외부 승인 ticket으로 처리하는 primary PostgreSQL CLI, 원자적 성공 audit·대상 없음 실패 audit, unlink E2E, [보존·파기 대장 초안](./DATA-RETENTION.md) | 외부 본인 확인·ticket 검증, SmartThings 회수, backup aging, 완료 통지, 표본 훈련 |
| 서비스 중단·보안 문제의 SmartThings 통지 | 차단 | 자동 통지 없음 | 담당자, 접수 채널, emergency change notice 절차 확정 |

## 제출·출시 게이트

공개 또는 유료 모드는 다음을 모두 만족하기 전까지 활성화하지 않습니다.

1. [승인 요청 패킷](./SMARTTHINGS-APPROVAL-REQUEST.md)의 필수 사실값을 실제 운영자가 채웁니다.
2. SmartThings가 무료 비공개, 무료 공개, 유료 모델의 허용 범위를 App ID에 연결해 서면으로
   답합니다.
3. 답변이 요구하는 계약, test, security/privacy review, notice를 완료합니다.
4. 이 매트릭스의 공개 출시 관련 `차단` 행을 증빙과 함께 해소합니다.
5. 개인정보 처리방침·이용조건·지원·삭제 흐름이 공개 HTTPS에서 동작합니다.
6. 운영 DB뿐 아니라 WAL·backup·snapshot·log까지 삭제·복구·사고 훈련을 통과합니다.
7. 전체 자동 검사와 실제 SmartThings 계정 기반 end-to-end 검증을 완료합니다.
