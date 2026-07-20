import { z } from "zod"
import type { SmartThingsScope } from "../oauth/smartthings-scope.js"

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
    ? '<p class="error" id="permission-error" role="alert">선택값을 확인하세요. 디바이스 권한은 하나&nbsp;이상 필요합니다.</p>'
    : ""
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="SmartThings Gateway에 허용할 권한과 디바이스 범위를 선택합니다.">
  <title>SmartThings 권한 연결</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: "SF Pro Display", "Helvetica Neue", system-ui, sans-serif;
      --canvas: #f7f6f3; --surface: #ffffff; --text: #2f3437; --text-muted: #667085;
      --border: #89919a; --action: #20242a; --action-text: #ffffff;
      --action-hover: #353b43; --focus: #2563eb;
      --error: #b42318;
      --shadow-panel: #1f29370a; --font-small: .875rem;
      --control-size: 1.125rem; --control-offset: .15rem;
      --radius-action: .375rem; --pressed-scale: .98;
      --space-2: .5rem; --space-3: .75rem; --space-4: 1rem; --space-6: 1.5rem; --space-8: 2rem;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: var(--space-4); background: var(--canvas); color: var(--text); }
    main { width: min(34rem, 100%); padding: var(--space-8); border-radius: var(--space-3); background: var(--surface); box-shadow: 0 var(--space-2) var(--space-8) var(--shadow-panel); }
    h1 { margin: 0 0 var(--space-3); font-size: 1.75rem; line-height: 1.25; letter-spacing: -.02em; }
    p { margin: 0 0 var(--space-6); color: var(--text-muted); line-height: 1.6; text-wrap: pretty; }
    .intro span { display: block; }
    fieldset { margin: 0 0 var(--space-4); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--space-2); }
    legend { padding: 0 var(--space-2); font-weight: 700; }
    .hint { margin: var(--space-2) 0 var(--space-3); font-size: var(--font-small); }
    .error { margin: 0 0 var(--space-4); color: var(--error); font-weight: 700; }
    label { display: flex; gap: var(--space-3); align-items: flex-start; margin: var(--space-3) 0; line-height: 1.5; cursor: pointer; }
    input { width: var(--control-size); height: var(--control-size); margin: var(--control-offset) 0 0; flex: 0 0 auto; accent-color: var(--focus); }
    button { width: 100%; min-height: 2.75rem; padding: var(--space-3) var(--space-4); border: 0; border-radius: var(--radius-action); background: var(--action); color: var(--action-text); font: inherit; font-weight: 700; cursor: pointer; transition: background-color 100ms ease-out, transform 100ms ease-out; }
    button:hover { background: var(--action-hover); }
    button:active { transform: scale(var(--pressed-scale)); }
    button:focus-visible, input:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    h1, p, label, button { word-break: keep-all; overflow-wrap: break-word; }
    @media (max-width: 30rem) { main { padding: var(--space-6); } }
    @media (prefers-color-scheme: dark) {
      :root { --canvas: #101820; --surface: #19232d; --text: #edf2f7; --text-muted: #aeb8c4; --border: #748396; --action: #e8eef5; --action-text: #17202a; --action-hover: #ffffff; --focus: #60a5fa; --error: #ffb4ab; }
    }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  </style>
</head>
<body>
  <main>
    <h1>SmartThings 권한 연결</h1>
    <p class="intro"><span>Gateway에 허용할 기능과 디바이스&nbsp;범위를 선택하세요.</span><span>실제 디바이스 지정은 SmartThings 화면에서 진행합니다.</span></p>
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
    </form>
  </main>
</body>
</html>`
}
