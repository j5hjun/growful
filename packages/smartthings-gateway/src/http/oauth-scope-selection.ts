import { z } from "zod"
import type { SmartThingsScope } from "../oauth/smartthings-scope.js"
import { renderOAuthPage } from "./oauth-page.js"

const deviceRangeSchema = z.enum(["selected", "all"])
const devicePermissionSchema = z.enum(["read", "control", "write"])
const formFieldSchema = z.enum(["deviceRange", "permissions", "locationRead"])
const selectionSchema = z.object({
  deviceRange: z.tuple([deviceRangeSchema]),
  locationRead: z.array(z.literal("on")).max(1),
  permissions: z
    .array(devicePermissionSchema)
    .min(1)
    .refine((permissions) => new Set(permissions).size === permissions.length),
})
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

export function parseOAuthScopeSelection(body: unknown): readonly SmartThingsScope[] | null {
  const bodyResult = z.instanceof(Buffer).safeParse(body)
  if (!bodyResult.success) {
    return null
  }
  const parameters = new URLSearchParams(bodyResult.data.toString("utf8"))
  const fieldsResult = z.array(formFieldSchema).safeParse(Array.from(parameters.keys()))
  if (!fieldsResult.success) {
    return null
  }
  const selectionResult = selectionSchema.safeParse({
    deviceRange: parameters.getAll("deviceRange"),
    locationRead: parameters.getAll("locationRead"),
    permissions: parameters.getAll("permissions"),
  })
  if (!selectionResult.success) {
    return null
  }
  const selection = selectionResult.data
  const deviceScopes = selection.permissions.map(
    (permission) => deviceScopeByRangeAndPermission[selection.deviceRange[0]][permission],
  )
  return selection.locationRead.length === 1 ? [...deviceScopes, "r:locations:*"] : deviceScopes
}

export function renderOAuthScopeSelection(showSelectionError = false): string {
  const defaultPermissionSelection = showSelectionError ? "" : " checked"
  const permissionDescriptionIds = showSelectionError
    ? "permission-hint permission-error"
    : "permission-hint"
  const permissionError = showSelectionError
    ? '<p class="error" id="permission-error" role="alert"><span class="phrase">선택값을 확인하세요.</span> <span class="phrase">권한을 하나 이상 선택하세요.</span></p>'
    : ""
  return renderOAuthPage({
    body: `
    <h1>SmartThings 권한 연결</h1>
    <p class="intro"><span>Gateway에 허용할 기능과 디바이스&nbsp;범위를 선택하세요.</span><span><span class="phrase">실제 디바이스 지정은</span> <span class="phrase">SmartThings 화면에서 진행합니다.</span></span></p>
    <form action="/oauth/start" method="post">
      <fieldset>
        <legend>디바이스 범위</legend>
        <label><input type="radio" name="deviceRange" value="selected" checked> 선택한 디바이스만</label>
        <label><input type="radio" name="deviceRange" value="all"> 모든 디바이스</label>
      </fieldset>
      ${permissionError}
      <fieldset aria-describedby="${permissionDescriptionIds}"${showSelectionError ? ' aria-invalid="true"' : ""}>
        <legend>허용할 기능</legend>
        <p class="hint" id="permission-hint">디바이스 권한을 하나 이상 선택하세요.</p>
        <label><input type="checkbox" name="permissions" value="read"${defaultPermissionSelection}> 상태 읽기</label>
        <label><input type="checkbox" name="permissions" value="control"${defaultPermissionSelection}> 명령 실행</label>
        <label><input type="checkbox" name="permissions" value="write"> 설정 쓰기</label>
        <label><input type="checkbox" name="locationRead" value="on"> 위치 정보 읽기</label>
      </fieldset>
      <button type="submit">SmartThings에서 계속</button>
    </form>`,
    description: "SmartThings Gateway에 허용할 권한과 디바이스 범위를 선택합니다.",
    styles: `
    .intro > span { display: block; }
    fieldset { margin: 0 0 var(--space-4); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); }
    legend { padding: 0 var(--space-2); font-weight: var(--weight-bold); }
    .hint { margin: var(--space-2) 0 var(--space-3); font-size: var(--font-small); }
    .error { margin: 0 0 var(--space-4); color: var(--error); font-weight: var(--weight-bold); }
    label { display: flex; gap: var(--space-3); align-items: flex-start; margin: var(--space-3) 0; line-height: var(--line-body); cursor: pointer; }
    input { width: var(--control-size); height: var(--control-size); margin: var(--control-offset) 0 0; flex: 0 0 auto; accent-color: var(--focus); }
    button { width: 100%; min-height: var(--action-height); padding: var(--space-3) var(--space-4); border: 0; border-radius: var(--radius-action); background: var(--action); color: var(--action-text); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); cursor: pointer; transition: background-color 100ms ease-out, transform 100ms ease-out; }
    button:hover { background: var(--action-hover); }
    button:active { transform: scale(var(--pressed-scale)); }
    button:focus-visible, input:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }`,
    title: "SmartThings 권한 연결",
  })
}
