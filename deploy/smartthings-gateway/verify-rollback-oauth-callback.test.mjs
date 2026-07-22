import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

const verifier = fileURLToPath(new URL("./verify-rollback-oauth-callback.mjs", import.meta.url))
const state = "oauth-state-sensitive-sentinel"
const secret = "oauth-secret-sensitive-sentinel"
const safeBody = `<!doctype html>
<html lang="ko">
  <body>
    <h1>연결 요청을 다시 시작해 주세요</h1>
    <a href="/oauth/start">OAuth 다시 시작</a>
    <a href="/">서비스 안내</a>
    <a href="/support">지원 안내</a>
    <p>OAuth code, state 또는 토큰을 보내지 마세요.</p>
  </body>
</html>`
const safeHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
}

let response = { body: safeBody, headers: safeHeaders, status: 400 }
let server
let baseUrl

before(async () => {
  server = createServer((request, reply) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/redirect-target") {
      reply.writeHead(400, safeHeaders)
      reply.end(safeBody)
      return
    }
    assert.equal(url.pathname, "/oauth/callback")
    assert.equal(url.searchParams.get("error"), "access_denied")
    assert.equal(url.searchParams.get("error_description"), secret)
    assert.equal(url.searchParams.get("state"), state)
    reply.writeHead(response.status, response.headers)
    reply.end(response.body)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, "object")
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  )
})

function runVerifier() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [verifier, baseUrl, state, secret], {
      stdio: "ignore",
    })
    child.once("exit", (code) => resolve(code))
  })
}

test("accepts the safe rollback OAuth recovery response", async () => {
  response = { body: safeBody, headers: safeHeaders, status: 400 }
  assert.equal(await runVerifier(), 0)
})

test("rejects the legacy JSON callback response", async () => {
  response = {
    body: '{"error":"invalid_oauth_state"}',
    headers: { "cache-control": "no-store", "content-type": "application/json" },
    status: 400,
  }
  assert.equal(await runVerifier(), 1)
})

test("rejects a response without the complete browser safety contract", async () => {
  for (const header of Object.keys(safeHeaders)) {
    const headers = { ...safeHeaders }
    delete headers[header]
    response = { body: safeBody, headers, status: 400 }
    assert.equal(await runVerifier(), 1, `accepted response without ${header}`)
  }
})

test("rejects a response with incomplete content security policy directives", async () => {
  for (const directive of [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]) {
    for (const replacement of ["", `${directive} https://attacker.invalid`]) {
      response = {
        body: safeBody,
        headers: {
          ...safeHeaders,
          "content-security-policy": safeHeaders["content-security-policy"].replace(
            directive,
            replacement,
          ),
        },
        status: 400,
      }
      assert.equal(await runVerifier(), 1, `accepted unsafe ${directive}`)
    }
  }
  for (const addedDirective of [
    "script-src-elem https://attacker.invalid",
    "navigate-to https://attacker.invalid",
    "FRAME-ANCESTORS https://attacker.invalid",
  ]) {
    response = {
      body: safeBody,
      headers: {
        ...safeHeaders,
        "content-security-policy": `${safeHeaders["content-security-policy"]}; ${addedDirective}`,
      },
      status: 400,
    }
    assert.equal(await runVerifier(), 1, `accepted ${addedDirective}`)
  }
})

test("rejects unsafe status, recovery content, and sensitive input disclosure", async () => {
  for (const unsafeResponse of [
    { body: safeBody, headers: safeHeaders, status: 200 },
    { body: "", headers: { ...safeHeaders, location: "/redirect-target" }, status: 302 },
    { body: "<h1>unknown error</h1>", headers: safeHeaders, status: 400 },
    { body: `${safeBody}${state}`, headers: safeHeaders, status: 400 },
    { body: `${safeBody}${secret}`, headers: safeHeaders, status: 400 },
    { body: safeBody, headers: { ...safeHeaders, "x-debug-state": state }, status: 400 },
    { body: safeBody, headers: { ...safeHeaders, "x-debug-secret": secret }, status: 400 },
    {
      body: safeBody,
      headers: { ...safeHeaders, refresh: "0;url=https://attacker.invalid" },
      status: 400,
    },
    {
      body: safeBody.replace(
        "<body>",
        '<head><meta http-equiv="refresh" content="0;url=https://attacker.invalid"></head><body>',
      ),
      headers: safeHeaders,
      status: 400,
    },
  ]) {
    response = unsafeResponse
    assert.equal(await runVerifier(), 1)
  }
})
