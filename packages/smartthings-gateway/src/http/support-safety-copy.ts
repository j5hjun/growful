export const supportSafeInformation =
  "화면에 표시된 지원 참조, 발생 시각, 시도한 작업, 화면 제목·표시된 오류 종류, 브라우저·기기 종류"

export const supportSecretInformation =
  "주소창 전체 주소, 승인 과정의 임시 코드·상태값, Growful 토큰, SmartThings 연결 토큰, 비밀번호, 원본 계정·설치 식별자"

export function renderSupportSafetyGuidance(): string {
  return `<p><strong>지원에 보내도 되는 정보:</strong> ${supportSafeInformation}</p>
      <p><strong>보내지 마세요:</strong> ${supportSecretInformation}</p>`
}
