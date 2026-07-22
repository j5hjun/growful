import { z } from "zod"
import { type ServiceDisclosures, smartThingsPolicyConsentStatement } from "../config.js"
import type { SmartThingsScope } from "../oauth/smartthings-scope.js"
import { renderGatewayPage } from "./oauth-page.js"

const deviceRangeSchema = z.enum(["selected", "all"])
const devicePermissions = ["read", "control", "write"] as const
const hubPermissions = ["read"] as const
const locationPermissions = ["read", "write", "execute"] as const
const scenePermissions = ["read", "execute"] as const
const rulePermissions = ["read", "write"] as const
const devicePermissionSchema = z.enum(devicePermissions)
const hubPermissionSchema = z.enum(hubPermissions)
const locationPermissionSchema = z.enum(locationPermissions)
const scenePermissionSchema = z.enum(scenePermissions)
const rulePermissionSchema = z.enum(rulePermissions)
const optionalPolicyConsentSchema = z.union([z.tuple([]), z.tuple([z.literal("accepted")])])
const formFieldSchema = z.enum([
  "deviceRange",
  "devicePermissions",
  "hubPermissions",
  "locationPermissions",
  "policyConsent",
  "scenePermissions",
  "rulePermissions",
])
const uniqueSelection = <Value extends string>(values: readonly Value[]): boolean =>
  new Set(values).size === values.length
const selectionValuesSchema = z.object({
  deviceRange: z.tuple([deviceRangeSchema]),
  devicePermissions: z.array(devicePermissionSchema).refine(uniqueSelection),
  hubPermissions: z.array(hubPermissionSchema).refine(uniqueSelection),
  locationPermissions: z.array(locationPermissionSchema).refine(uniqueSelection),
  policyConsent: optionalPolicyConsentSchema,
  rulePermissions: z.array(rulePermissionSchema).refine(uniqueSelection),
  scenePermissions: z.array(scenePermissionSchema).refine(uniqueSelection),
})
const selectionSchema = selectionValuesSchema
  .refine((selection) => selection.policyConsent.length === 1)
  .refine(
    (selection) =>
      selection.devicePermissions.length +
        selection.hubPermissions.length +
        selection.locationPermissions.length +
        selection.scenePermissions.length +
        selection.rulePermissions.length >
      0,
  )
const deviceScopeByRangeAndPermission = {
  all: {
    control: "x:devices:*",
    read: "r:devices:*",
    write: "w:devices:*",
  },
  selected: {
    control: "x:devices:$",
    read: "r:devices:$",
    write: "w:devices:$",
  },
} as const satisfies Record<
  z.infer<typeof deviceRangeSchema>,
  Record<z.infer<typeof devicePermissionSchema>, SmartThingsScope>
>
const hubScopeByPermission = {
  read: "r:hubs:*",
} as const satisfies Record<z.infer<typeof hubPermissionSchema>, SmartThingsScope>
const locationScopeByPermission = {
  execute: "x:locations:*",
  read: "r:locations:*",
  write: "w:locations:*",
} as const satisfies Record<z.infer<typeof locationPermissionSchema>, SmartThingsScope>
const sceneScopeByPermission = {
  execute: "x:scenes:*",
  read: "r:scenes:*",
} as const satisfies Record<z.infer<typeof scenePermissionSchema>, SmartThingsScope>
const ruleScopeByPermission = {
  read: "r:rules:*",
  write: "w:rules:*",
} as const satisfies Record<z.infer<typeof rulePermissionSchema>, SmartThingsScope>

export type OAuthDeviceRange = z.infer<typeof deviceRangeSchema>
type OAuthDevicePermission = z.infer<typeof devicePermissionSchema>
type OAuthHubPermission = z.infer<typeof hubPermissionSchema>
type OAuthLocationPermission = z.infer<typeof locationPermissionSchema>
type OAuthScenePermission = z.infer<typeof scenePermissionSchema>
type OAuthRulePermission = z.infer<typeof rulePermissionSchema>

export const oauthScopeSelectionIssueKinds = {
  invalidSelection: "invalid_selection",
  missingPermission: "missing_permission",
  missingPolicyConsent: "missing_policy_consent",
} as const

export type OAuthScopeSelectionIssueKind =
  (typeof oauthScopeSelectionIssueKinds)[keyof typeof oauthScopeSelectionIssueKinds]

export type OAuthScopeSelectionDraft = {
  readonly devicePermissions: readonly OAuthDevicePermission[]
  readonly deviceRange: OAuthDeviceRange
  readonly hubPermissions: readonly OAuthHubPermission[]
  readonly locationPermissions: readonly OAuthLocationPermission[]
  readonly policyConsent: boolean
  readonly rulePermissions: readonly OAuthRulePermission[]
  readonly scenePermissions: readonly OAuthScenePermission[]
}

export type OAuthScopeSelectionSubmission =
  | {
      readonly kind: "invalid"
      readonly draft: OAuthScopeSelectionDraft
      readonly issues: readonly OAuthScopeSelectionIssueKind[]
    }
  | { readonly kind: "valid"; readonly scopes: readonly SmartThingsScope[] }

const initialScopeSelectionDraft = {
  devicePermissions: ["read"],
  deviceRange: "selected",
  hubPermissions: [],
  locationPermissions: [],
  policyConsent: false,
  rulePermissions: [],
  scenePermissions: [],
} as const satisfies OAuthScopeSelectionDraft

const selectionIssueMessages = {
  [oauthScopeSelectionIssueKinds.invalidSelection]:
    "처리할 수 없는 선택값이 있습니다. 화면에 표시된 항목을 확인하세요.",
  [oauthScopeSelectionIssueKinds.missingPermission]: "권한을 하나 이상 선택하세요.",
  [oauthScopeSelectionIssueKinds.missingPolicyConsent]: "정책 동의에 체크하세요.",
} as const satisfies Record<OAuthScopeSelectionIssueKind, string>

function parseFormParameters(body: unknown): URLSearchParams | null {
  const bodyResult = z.instanceof(Buffer).safeParse(body)
  return bodyResult.success ? new URLSearchParams(bodyResult.data.toString("utf8")) : null
}

export function parseOAuthDeviceRangeSelection(body: unknown): OAuthDeviceRange | null {
  const parameters = parseFormParameters(body)
  if (parameters === null) {
    return null
  }
  const rangeResult = z.tuple([deviceRangeSchema]).safeParse(parameters.getAll("deviceRange"))
  return rangeResult.success ? rangeResult.data[0] : null
}

function selectAllowlistedValues<Value extends string>(
  allowlist: readonly Value[],
  submitted: readonly string[],
): readonly Value[] {
  return allowlist.filter((value) => submitted.includes(value))
}

export function parseOAuthScopeSelectionSubmission(body: unknown): OAuthScopeSelectionSubmission {
  const parameters = parseFormParameters(body)
  if (parameters === null) {
    return {
      draft: initialScopeSelectionDraft,
      issues: [oauthScopeSelectionIssueKinds.invalidSelection],
      kind: "invalid",
    }
  }
  const fieldsResult = z.array(formFieldSchema).safeParse(Array.from(parameters.keys()))
  const submittedValues = {
    deviceRange: parameters.getAll("deviceRange"),
    devicePermissions: parameters.getAll("devicePermissions"),
    hubPermissions: parameters.getAll("hubPermissions"),
    locationPermissions: parameters.getAll("locationPermissions"),
    policyConsent: parameters.getAll("policyConsent"),
    rulePermissions: parameters.getAll("rulePermissions"),
    scenePermissions: parameters.getAll("scenePermissions"),
  }
  const selectionValuesResult = selectionValuesSchema.safeParse(submittedValues)
  const selectionResult = selectionSchema.safeParse(submittedValues)
  const deviceRangeResult = z.tuple([deviceRangeSchema]).safeParse(submittedValues.deviceRange)
  const draft = {
    devicePermissions: selectAllowlistedValues(
      devicePermissions,
      submittedValues.devicePermissions,
    ),
    deviceRange: deviceRangeResult.success ? deviceRangeResult.data[0] : "selected",
    hubPermissions: selectAllowlistedValues(hubPermissions, submittedValues.hubPermissions),
    locationPermissions: selectAllowlistedValues(
      locationPermissions,
      submittedValues.locationPermissions,
    ),
    policyConsent: submittedValues.policyConsent.includes("accepted"),
    rulePermissions: selectAllowlistedValues(rulePermissions, submittedValues.rulePermissions),
    scenePermissions: selectAllowlistedValues(scenePermissions, submittedValues.scenePermissions),
  } satisfies OAuthScopeSelectionDraft
  const permissionCount =
    draft.devicePermissions.length +
    draft.hubPermissions.length +
    draft.locationPermissions.length +
    draft.scenePermissions.length +
    draft.rulePermissions.length
  const issues = [
    ...(!fieldsResult.success || !selectionValuesResult.success
      ? [oauthScopeSelectionIssueKinds.invalidSelection]
      : []),
    ...(permissionCount === 0 ? [oauthScopeSelectionIssueKinds.missingPermission] : []),
    ...(!draft.policyConsent ? [oauthScopeSelectionIssueKinds.missingPolicyConsent] : []),
  ] satisfies readonly OAuthScopeSelectionIssueKind[]
  if (!fieldsResult.success || !selectionResult.success) {
    return { draft, issues, kind: "invalid" }
  }
  const selection = selectionResult.data
  const scopes = [
    ...devicePermissions
      .filter((permission) => selection.devicePermissions.includes(permission))
      .map((permission) => deviceScopeByRangeAndPermission[selection.deviceRange[0]][permission]),
    ...hubPermissions
      .filter((permission) => selection.hubPermissions.includes(permission))
      .map((permission) => hubScopeByPermission[permission]),
    ...locationPermissions
      .filter((permission) => selection.locationPermissions.includes(permission))
      .map((permission) => locationScopeByPermission[permission]),
    ...scenePermissions
      .filter((permission) => selection.scenePermissions.includes(permission))
      .map((permission) => sceneScopeByPermission[permission]),
    ...rulePermissions
      .filter((permission) => selection.rulePermissions.includes(permission))
      .map((permission) => ruleScopeByPermission[permission]),
  ]
  return { kind: "valid", scopes }
}

export function parseOAuthScopeSelection(body: unknown): readonly SmartThingsScope[] | null {
  const submission = parseOAuthScopeSelectionSubmission(body)
  return submission.kind === "valid" ? submission.scopes : null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderOAuthScopeSelection(options: {
  readonly disclosures: ServiceDisclosures
  readonly draft?: OAuthScopeSelectionDraft
  readonly issues?: readonly OAuthScopeSelectionIssueKind[]
}): string {
  const draft = options.draft ?? initialScopeSelectionDraft
  const issues = options.issues ?? []
  const checked = (selected: boolean): string => (selected ? " checked" : "")
  const selectedDeviceRange = checked(draft.deviceRange === "selected")
  const allDeviceRange = checked(draft.deviceRange === "all")
  const permissionGroupValidation = issues.includes(oauthScopeSelectionIssueKinds.missingPermission)
    ? ' aria-invalid="true" aria-describedby="selection-error-summary"'
    : ""
  const policyValidation = issues.includes(oauthScopeSelectionIssueKinds.missingPolicyConsent)
    ? ' aria-invalid="true" aria-describedby="selection-error-summary"'
    : ""
  const selectionError =
    issues.length === 0
      ? ""
      : `<section id="selection-error-summary" class="error-summary" role="alert" aria-labelledby="selection-error-title" tabindex="-1" autofocus>
        <h2 id="selection-error-title">입력 내용을 확인하세요</h2>
        <ul>${issues.map((issue) => `<li>${selectionIssueMessages[issue]}</li>`).join("")}</ul>
      </section>`
  const operatorName = escapeHtml(options.disclosures.operatorName)
  const privacyPolicyUrl = escapeHtml(options.disclosures.privacyPolicyUrl.toString())
  const supportEmail = escapeHtml(options.disclosures.supportEmail)
  const termsUrl = escapeHtml(options.disclosures.termsUrl.toString())
  return renderGatewayPage({
    body: `
    <h1>SmartThings 권한 연결</h1>
    <p class="intro"><span>Gateway에 허용할 리소스와 기능을 선택하세요.</span><span><span class="phrase">선택한 디바이스만 범위의 실제 대상은</span> <span class="phrase">SmartThings 화면에서 지정합니다.</span></span></p>
    <form action="/oauth/start" method="post">
      ${selectionError}
      <fieldset class="step-section" data-permission-step="range">
        <legend><span class="step-index">1</span> 디바이스 범위</legend>
        <label><input type="radio" name="deviceRange" value="selected"${selectedDeviceRange}> 선택한 디바이스만</label>
        <label><input type="radio" name="deviceRange" value="all"${allDeviceRange}> 연결된 모든 디바이스</label>
      </fieldset>
      <div class="permission-groups" role="group" aria-label="리소스 권한"${permissionGroupValidation}>
      <fieldset class="step-section" data-permission-step="basic-read">
        <legend><span class="step-index">2</span> 기본 읽기</legend>
        <p class="hint">위에서 고른 디바이스 범위에 적용됩니다.</p>
        <label><input type="checkbox" name="devicePermissions" value="read"${checked(draft.devicePermissions.includes("read"))}><span>상태 읽기 <small>r:devices:$ 또는 r:devices:*</small></span></label>
      </fieldset>
      <section class="additional-permissions" data-permission-step="additional" aria-labelledby="additional-title">
        <h2 id="additional-title"><span class="step-index">3</span> 추가 권한</h2>
        <p class="hint">필요한 리소스만 펼쳐 선택하세요. 접힌 상태에서도 선택 여부와 실제 영향 범위를 확인할 수 있습니다.</p>
      <details class="permission-resource" data-permission-resource="device">
        <summary><span class="summary-title">디바이스</span><span class="summary-meta"><span class="summary-state" data-selection-summary><span class="summary-label">선택:</span><span class="selection-empty">없음</span><span class="summary-choice" data-summary-permission="control">명령 실행</span><span class="summary-choice" data-summary-permission="write">이름 변경·삭제</span></span><span class="summary-state" data-risk-summary><span class="summary-label">영향:</span><span class="risk-empty">선택 시 제어·삭제 가능</span><span class="summary-choice" data-summary-permission="control">기기 상태 변경</span><span class="summary-choice" data-summary-permission="write">이름 변경·삭제</span></span></span></summary>
        <fieldset>
        <legend>디바이스 추가 권한</legend>
        <p class="hint">위에서 고른 디바이스 범위에 적용됩니다.</p>
        <label><input type="checkbox" name="devicePermissions" value="control"${checked(draft.devicePermissions.includes("control"))}><span>명령 실행 <small>x:devices:$ 또는 x:devices:*</small></span></label>
        <p class="impact">전원·밝기·온도처럼 디바이스가 지원하는 명령을 즉시 <span class="phrase">실행할 수 있습니다.</span></p>
        <label><input type="checkbox" name="devicePermissions" value="write"${checked(draft.devicePermissions.includes("write"))}><span>이름 변경·삭제 <small>w:devices:$ 또는 w:devices:*</small></span></label>
        <p class="impact">디바이스 이름을 바꾸거나 SmartThings에서 디바이스를 <span class="phrase">삭제할 수 있습니다.</span></p>
        </fieldset>
      </details>
      <details class="permission-resource" data-permission-resource="hub">
        <summary><span class="summary-title">허브</span><span class="summary-meta"><span class="summary-state" data-selection-summary><span class="summary-label">선택:</span><span class="selection-empty">없음</span><span class="summary-choice" data-summary-permission="read">허브 정보 읽기</span></span><span class="summary-state" data-risk-summary><span class="summary-label">영향:</span><span class="risk-empty">선택 시 읽기만</span><span class="summary-choice" data-summary-permission="read">허브 정보 열람</span></span></span></summary>
        <fieldset>
        <legend>허브 추가 권한</legend>
        <p class="hint">이 연결에 허용된 모든 허브에 적용됩니다.</p>
        <label><input type="checkbox" name="hubPermissions" value="read"${checked(draft.hubPermissions.includes("read"))}><span>허브 정보 읽기 <small>r:hubs:*</small></span></label>
        </fieldset>
      </details>
      <details class="permission-resource" data-permission-resource="location">
        <summary><span class="summary-title">위치</span><span class="summary-meta"><span class="summary-state" data-selection-summary><span class="summary-label">선택:</span><span class="selection-empty">없음</span><span class="summary-choice" data-summary-permission="read">위치 정보 읽기</span><span class="summary-choice" data-summary-permission="write">위치 설정 쓰기</span><span class="summary-choice" data-summary-permission="execute">위치 모드 변경</span></span><span class="summary-state" data-risk-summary><span class="summary-label">영향:</span><span class="risk-empty">선택 시 쓰기·실행 가능</span><span class="summary-choice" data-summary-permission="read">위치 정보 열람</span><span class="summary-choice" data-summary-permission="write">이름·좌표·온도 단위 변경</span><span class="summary-choice" data-summary-permission="execute">모드 조건 자동화 실행 가능</span></span></span></summary>
        <fieldset>
        <legend>위치 추가 권한</legend>
        <p class="hint">이 연결에 허용된 모든 위치에 적용됩니다.</p>
        <label><input type="checkbox" name="locationPermissions" value="read"${checked(draft.locationPermissions.includes("read"))}><span>위치 정보 읽기 <small>r:locations:*</small></span></label>
        <label><input type="checkbox" name="locationPermissions" value="write"${checked(draft.locationPermissions.includes("write"))}><span>위치 정보 쓰기 <small>w:locations:*</small></span></label>
        <p class="impact">위치 이름·좌표·온도 단위 같은 설정을 변경할 수 있습니다.</p>
        <label><input type="checkbox" name="locationPermissions" value="execute"${checked(draft.locationPermissions.includes("execute"))}><span>위치 모드 변경 실행 <small>x:locations:*</small></span></label>
        <p class="impact">위치 모드를 변경해 해당 모드를 조건으로 쓰는 자동화가 동작할 수 있습니다.</p>
        </fieldset>
      </details>
      <details class="permission-resource" data-permission-resource="scene">
        <summary><span class="summary-title">장면</span><span class="summary-meta"><span class="summary-state" data-selection-summary><span class="summary-label">선택:</span><span class="selection-empty">없음</span><span class="summary-choice" data-summary-permission="read">장면 읽기</span><span class="summary-choice" data-summary-permission="execute">장면 실행</span></span><span class="summary-state" data-risk-summary><span class="summary-label">영향:</span><span class="risk-empty">선택 시 여러 디바이스 실행 가능</span><span class="summary-choice" data-summary-permission="read">장면 정보 열람</span><span class="summary-choice" data-summary-permission="execute">여러 디바이스 상태 변경</span></span></span></summary>
        <fieldset>
        <legend>장면 추가 권한</legend>
        <p class="hint">이 연결에 허용된 모든 장면에 적용됩니다.</p>
        <label><input type="checkbox" name="scenePermissions" value="read"${checked(draft.scenePermissions.includes("read"))}><span>장면 읽기 <small>r:scenes:*</small></span></label>
        <label><input type="checkbox" name="scenePermissions" value="execute"${checked(draft.scenePermissions.includes("execute"))}><span>장면 실행 <small>x:scenes:*</small></span></label>
        <p class="impact">장면을 실행해 여러 디바이스 상태를 한 번에 바꿀 수 있습니다.</p>
        </fieldset>
      </details>
      <details class="permission-resource" data-permission-resource="rule">
        <summary><span class="summary-title">규칙</span><span class="summary-meta"><span class="summary-state" data-selection-summary><span class="summary-label">선택:</span><span class="selection-empty">없음</span><span class="summary-choice" data-summary-permission="read">규칙 읽기</span><span class="summary-choice" data-summary-permission="write">규칙 만들기·수정·삭제</span></span><span class="summary-state" data-risk-summary><span class="summary-label">영향:</span><span class="risk-empty">선택 시 자동화 쓰기·삭제 가능</span><span class="summary-choice" data-summary-permission="read">규칙 정보 열람</span><span class="summary-choice" data-summary-permission="write">자동화 동작 변경</span></span></span></summary>
        <fieldset>
        <legend>규칙 추가 권한</legend>
        <p class="hint">이 연결에 허용된 모든 규칙에 적용됩니다.</p>
        <label><input type="checkbox" name="rulePermissions" value="read"${checked(draft.rulePermissions.includes("read"))}><span>규칙 읽기 <small>r:rules:*</small></span></label>
        <label><input type="checkbox" name="rulePermissions" value="write"${checked(draft.rulePermissions.includes("write"))}><span>규칙 만들기·수정·삭제 <small>w:rules:*</small></span></label>
        <p class="impact">규칙을 만들고 수정하거나 삭제해 자동화 동작을 바꿀 수 있습니다.</p>
        </fieldset>
      </details>
      </section>
      </div>
      <section class="policy" data-permission-step="policy" aria-labelledby="policy-title">
        <h2 id="policy-title"><span class="step-index">4</span> 정책 동의</h2>
        <p><strong>${operatorName}</strong>에서 SmartThings 연결 정보와 암호화된 OAuth 토큰을 관리합니다.</p>
        <p><a href="${privacyPolicyUrl}" aria-label="개인정보처리방침(새 탭에서 열림)" rel="noopener noreferrer" target="_blank">개인정보처리방침</a> · <a href="${termsUrl}" aria-label="이용약관(새 탭에서 열림)" rel="noopener noreferrer" target="_blank">이용약관</a> · <a href="mailto:${supportEmail}">지원 문의</a></p>
        <label><input type="checkbox" name="policyConsent" value="accepted" required${checked(draft.policyConsent)}${policyValidation}><span>${smartThingsPolicyConsentStatement}</span></label>
      </section>
      <div class="form-actions" data-permission-step="actions">
        <p><span class="step-index">5</span> 연결 계속</p>
        <button type="submit">SmartThings에서 계속</button>
        <a href="/" data-action="cancel-oauth">서비스 안내로 돌아가기</a>
      </div>
    </form>`,
    description: "SmartThings Gateway에 허용할 권한과 디바이스 범위를 선택합니다.",
    styles: `
    .intro > span { display: block; }
    form { margin-top: var(--space-8); }
    fieldset { min-width: 0; margin: 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); }
    .step-section { margin-bottom: var(--space-6); }
    legend { padding: 0 var(--space-2); font-weight: var(--weight-bold); }
    .step-index { display: inline-flex; width: var(--space-6); height: var(--space-6); align-items: center; justify-content: center; margin-right: var(--space-2); border-radius: 50%; background: var(--surface-subtle); color: var(--text); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .hint { margin: var(--space-2) 0 var(--space-3); font-size: var(--font-small); }
    .error-summary { margin: 0 0 var(--space-6); padding: var(--space-4); border: 1px solid var(--error); border-radius: var(--radius-field); }
    .error-summary:focus { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .error-summary h2 { margin: 0 0 var(--space-2); color: var(--error); font-size: var(--font-h2); }
    .error-summary ul { margin: 0; padding-left: var(--space-6); color: var(--text); line-height: var(--line-body); }
    .error-summary li { word-break: keep-all; overflow-wrap: break-word; }
    .additional-permissions { margin-bottom: var(--space-6); }
    .additional-permissions h2 { margin: 0 0 var(--space-2); }
    .permission-resource { margin-top: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface); }
    .permission-resource summary { padding: var(--space-4); cursor: pointer; }
    .permission-resource summary:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .summary-title { margin-left: var(--space-2); font-weight: var(--weight-bold); }
    .summary-meta { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0 0 var(--space-6); color: var(--text-muted); font-size: var(--font-small); }
    .summary-state { display: inline-flex; flex-wrap: wrap; gap: var(--space-2); }
    .summary-label { font-weight: var(--weight-bold); }
    .summary-choice { display: none; color: var(--text); font-weight: var(--weight-bold); }
    .permission-resource:has(input:checked) .selection-empty, .permission-resource:has(input:checked) .risk-empty { display: none; }
    .permission-resource:has(input[value="read"]:checked) [data-summary-permission="read"], .permission-resource:has(input[value="control"]:checked) [data-summary-permission="control"], .permission-resource:has(input[value="write"]:checked) [data-summary-permission="write"], .permission-resource:has(input[value="execute"]:checked) [data-summary-permission="execute"] { display: inline; }
    .permission-resource fieldset { margin: 0 var(--space-4) var(--space-4); }
    .impact { margin: calc(-1 * var(--space-2)) 0 var(--space-4) calc(var(--control-size) + var(--space-3)); font-size: var(--font-small); }
    .policy { margin: 0 0 var(--space-8); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .policy h2 { margin: 0 0 var(--space-3); font-size: var(--font-h2); }
    .policy p { margin: var(--space-2) 0; }
    .policy a { color: var(--focus); }
    label { display: flex; gap: var(--space-3); align-items: flex-start; margin: var(--space-3) 0; line-height: var(--line-body); cursor: pointer; }
    label > span { min-width: 0; }
    small { display: block; color: var(--text-muted); font-size: var(--font-small); line-height: var(--line-body); overflow-wrap: anywhere; }
    input { width: var(--control-size); height: var(--control-size); margin: var(--control-offset) 0 0; flex: 0 0 auto; accent-color: var(--focus); }
    .form-actions { position: static; padding: var(--space-4) 0 var(--safe-area-bottom); border-top: 1px solid var(--border); background: var(--surface); text-align: center; }
    .form-actions p { margin: 0 0 var(--space-3); color: var(--text); font-size: var(--font-small); font-weight: var(--weight-bold); text-align: left; }
    .form-actions a { display: inline-block; min-height: var(--action-height); padding: var(--space-3); color: var(--text-muted); font-weight: var(--weight-bold); line-height: var(--line-action); }
    button { width: 100%; min-height: var(--action-height); padding: var(--space-3) var(--space-4); border: 0; border-radius: var(--radius-action); background: var(--action); color: var(--action-text); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); cursor: pointer; transition: background-color 100ms ease-out, transform 100ms ease-out; }
    button:hover { background: var(--action-hover); }
    button:active { transform: scale(var(--pressed-scale)); }
    button:focus-visible, input:focus-visible, .form-actions a:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (max-width: 20rem) {
      body { padding: var(--space-2); }
      main { padding: var(--space-3); }
      fieldset, .error-summary, .permission-resource summary, .policy { padding: var(--space-3); }
      .permission-resource fieldset { margin: 0 var(--space-2) var(--space-2); padding: var(--space-2); }
      .summary-meta { margin-left: 0; }
      .impact { margin-left: 0; }
      label { gap: var(--space-2); }
      .phrase { white-space: normal; }
    }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }`,
    title: "SmartThings 권한 연결",
  })
}
