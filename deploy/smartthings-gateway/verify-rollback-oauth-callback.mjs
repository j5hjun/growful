const [baseUrl, state, sensitiveValue] = process.argv.slice(2)
const legacySensitiveDataGuidance = "OAuth code, state 또는 토큰을 보내지 마세요."
const standardizedSensitiveDataGuidance = [
  "보내지 마세요:",
  "주소창 전체 주소",
  "승인 과정의 임시 코드·상태값",
  "Growful 토큰",
  "SmartThings 연결 토큰",
  "비밀번호",
  "원본 계정·설치 식별자",
]

function requireContract(condition, failure) {
  if (!condition) throw new Error(`rollback OAuth callback contract failed: ${failure}`)
}

function parseContentSecurityPolicy(contentSecurityPolicy) {
  return contentSecurityPolicy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .map((directive) => directive.split(/\s+/))
}

function hasOnlySource(contentSecurityPolicyDirectives, directiveName, expectedSource) {
  const matchingDirectives = contentSecurityPolicyDirectives.filter(
    ([name]) => name === directiveName,
  )
  return (
    matchingDirectives.length === 1 &&
    matchingDirectives[0]?.length === 2 &&
    matchingDirectives[0][1] === expectedSource
  )
}

function hasStandardizedSensitiveDataGuidance(body) {
  let searchFrom = 0
  for (const requiredGuidance of standardizedSensitiveDataGuidance) {
    const guidanceIndex = body.indexOf(requiredGuidance, searchFrom)
    if (guidanceIndex === -1) return false
    searchFrom = guidanceIndex + requiredGuidance.length
  }
  return true
}

async function verifyRollbackOAuthCallback() {
  requireContract(baseUrl !== undefined, "missing base URL")
  requireContract(state !== undefined && state.length > 0, "missing state")
  requireContract(
    sensitiveValue !== undefined && sensitiveValue.length > 0,
    "missing sensitive input",
  )

  const callbackUrl = new URL("/oauth/callback", baseUrl)
  callbackUrl.searchParams.set("error", "access_denied")
  callbackUrl.searchParams.set("error_description", sensitiveValue)
  callbackUrl.searchParams.set("state", state)

  const response = await fetch(callbackUrl, { redirect: "manual" })
  const body = await response.text()
  const responseHeaderValues = [...response.headers.values()].join("\n")
  const contentSecurityPolicy = response.headers.get("content-security-policy") ?? ""
  const contentSecurityPolicyDirectives = parseContentSecurityPolicy(contentSecurityPolicy)

  requireContract(response.status === 400, "expected HTTP 400")
  requireContract(
    /^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? ""),
    "expected text/html",
  )
  requireContract(response.headers.get("cache-control") === "no-store", "expected no-store")
  requireContract(response.headers.get("refresh") === null, "unexpected refresh header")
  requireContract(contentSecurityPolicyDirectives.length === 10, "unexpected CSP directive")
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "default-src", "'none'"),
    "default-src",
  )
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "style-src", "'unsafe-inline'"),
    "style-src",
  )
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "script-src", "'none'"),
    "script-src",
  )
  requireContract(hasOnlySource(contentSecurityPolicyDirectives, "img-src", "'none'"), "img-src")
  requireContract(hasOnlySource(contentSecurityPolicyDirectives, "font-src", "'none'"), "font-src")
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "connect-src", "'none'"),
    "connect-src",
  )
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "object-src", "'none'"),
    "object-src",
  )
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "form-action", "'none'"),
    "form-action",
  )
  requireContract(hasOnlySource(contentSecurityPolicyDirectives, "base-uri", "'none'"), "base-uri")
  requireContract(
    hasOnlySource(contentSecurityPolicyDirectives, "frame-ancestors", "'none'"),
    "frame-ancestors",
  )
  requireContract(response.headers.get("referrer-policy") === "no-referrer", "referrer policy")
  requireContract(
    response.headers.get("x-frame-options")?.toLowerCase() === "deny",
    "frame protection",
  )
  requireContract(
    response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    "MIME protection",
  )
  requireContract(
    body.includes("<h1>연결 요청을 다시 시작해 주세요</h1>"),
    "missing recovery heading",
  )
  requireContract(body.includes('href="/oauth/start"'), "missing OAuth restart action")
  requireContract(body.includes('href="/"'), "missing service guidance action")
  requireContract(body.includes('href="/support"'), "missing support action")
  requireContract(
    body.includes(legacySensitiveDataGuidance) || hasStandardizedSensitiveDataGuidance(body),
    "missing sensitive-data guidance",
  )
  requireContract(!/<meta\b[^>]*\bhttp-equiv\b/i.test(body), "unexpected meta directive")
  for (const submittedValue of [state, sensitiveValue]) {
    requireContract(
      !body.includes(submittedValue) && !responseHeaderValues.includes(submittedValue),
      "sensitive disclosure",
    )
  }
}

verifyRollbackOAuthCallback().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "rollback OAuth callback contract verification failed",
  )
  process.exitCode = 1
})
