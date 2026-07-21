import { z } from "zod"
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
const formFieldSchema = z.enum([
  "deviceRange",
  "devicePermissions",
  "hubPermissions",
  "locationPermissions",
  "scenePermissions",
  "rulePermissions",
])
const uniqueSelection = <Value extends string>(values: readonly Value[]): boolean =>
  new Set(values).size === values.length
const selectionSchema = z
  .object({
    deviceRange: z.tuple([deviceRangeSchema]),
    devicePermissions: z.array(devicePermissionSchema).refine(uniqueSelection),
    hubPermissions: z.array(hubPermissionSchema).refine(uniqueSelection),
    locationPermissions: z.array(locationPermissionSchema).refine(uniqueSelection),
    rulePermissions: z.array(rulePermissionSchema).refine(uniqueSelection),
    scenePermissions: z.array(scenePermissionSchema).refine(uniqueSelection),
  })
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

export function parseOAuthScopeSelection(body: unknown): readonly SmartThingsScope[] | null {
  const parameters = parseFormParameters(body)
  if (parameters === null) {
    return null
  }
  const fieldsResult = z.array(formFieldSchema).safeParse(Array.from(parameters.keys()))
  if (!fieldsResult.success) {
    return null
  }
  const selectionResult = selectionSchema.safeParse({
    deviceRange: parameters.getAll("deviceRange"),
    devicePermissions: parameters.getAll("devicePermissions"),
    hubPermissions: parameters.getAll("hubPermissions"),
    locationPermissions: parameters.getAll("locationPermissions"),
    rulePermissions: parameters.getAll("rulePermissions"),
    scenePermissions: parameters.getAll("scenePermissions"),
  })
  if (!selectionResult.success) {
    return null
  }
  const selection = selectionResult.data
  return [
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
}

export function renderOAuthScopeSelection(
  options: { readonly deviceRange?: OAuthDeviceRange; readonly showSelectionError?: boolean } = {},
): string {
  const deviceRange = options.deviceRange ?? "selected"
  const showSelectionError = options.showSelectionError ?? false
  const defaultReadPermissionSelection = showSelectionError ? "" : " checked"
  const selectedDeviceRange = deviceRange === "selected" ? " checked" : ""
  const allDeviceRange = deviceRange === "all" ? " checked" : ""
  const permissionGroupValidation = showSelectionError
    ? ' aria-invalid="true" aria-describedby="permission-error"'
    : ""
  const permissionError = showSelectionError
    ? '<p class="error" id="permission-error" role="alert"><span class="phrase">선택값을 확인하세요.</span> <span class="phrase">권한을 하나 이상 선택하세요.</span></p>'
    : ""
  return renderGatewayPage({
    body: `
    <h1>SmartThings 권한 연결</h1>
    <p class="intro"><span>Gateway에 허용할 리소스와 기능을 선택하세요.</span><span><span class="phrase">선택한 디바이스만 범위의 실제 대상은</span> <span class="phrase">SmartThings 화면에서 지정합니다.</span></span></p>
    <form action="/oauth/start" method="post">
      <fieldset>
        <legend>디바이스 범위</legend>
        <label><input type="radio" name="deviceRange" value="selected"${selectedDeviceRange}> 선택한 디바이스만</label>
        <label><input type="radio" name="deviceRange" value="all"${allDeviceRange}> 연결된 모든 디바이스</label>
      </fieldset>
      ${permissionError}
      <div class="permission-groups" role="group" aria-label="리소스 권한"${permissionGroupValidation}>
      <fieldset>
        <legend>디바이스</legend>
        <p class="hint">위에서 고른 디바이스 범위에 적용됩니다.</p>
        <label><input type="checkbox" name="devicePermissions" value="read"${defaultReadPermissionSelection}><span>상태 읽기 <small>r:devices:$ 또는 r:devices:*</small></span></label>
        <label><input type="checkbox" name="devicePermissions" value="control"><span>명령 실행 <small>x:devices:$ 또는 x:devices:*</small></span></label>
        <label><input type="checkbox" name="devicePermissions" value="write"><span>이름 변경·삭제 <small>w:devices:$ 또는 w:devices:*</small></span></label>
      </fieldset>
      <fieldset>
        <legend>허브</legend>
        <p class="hint">이 연결에 허용된 모든 허브에 적용됩니다.</p>
        <label><input type="checkbox" name="hubPermissions" value="read"><span>허브 정보 읽기 <small>r:hubs:*</small></span></label>
      </fieldset>
      <fieldset>
        <legend>위치</legend>
        <p class="hint">이 연결에 허용된 모든 위치에 적용됩니다.</p>
        <label><input type="checkbox" name="locationPermissions" value="read"><span>위치 정보 읽기 <small>r:locations:*</small></span></label>
        <label><input type="checkbox" name="locationPermissions" value="write"><span>위치 정보 쓰기 <small>w:locations:*</small></span></label>
        <label><input type="checkbox" name="locationPermissions" value="execute"><span>위치 모드 변경 실행 <small>x:locations:*</small></span></label>
      </fieldset>
      <fieldset>
        <legend>장면</legend>
        <p class="hint">이 연결에 허용된 모든 장면에 적용됩니다.</p>
        <label><input type="checkbox" name="scenePermissions" value="read"><span>장면 읽기 <small>r:scenes:*</small></span></label>
        <label><input type="checkbox" name="scenePermissions" value="execute"><span>장면 실행 <small>x:scenes:*</small></span></label>
      </fieldset>
      <fieldset>
        <legend>규칙</legend>
        <p class="hint">이 연결에 허용된 모든 규칙에 적용됩니다.</p>
        <label><input type="checkbox" name="rulePermissions" value="read"><span>규칙 읽기 <small>r:rules:*</small></span></label>
        <label><input type="checkbox" name="rulePermissions" value="write"><span>규칙 만들기·수정·삭제 <small>w:rules:*</small></span></label>
      </fieldset>
      </div>
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
    small { display: block; color: var(--text-muted); font-size: var(--font-small); line-height: var(--line-body); }
    input { width: var(--control-size); height: var(--control-size); margin: var(--control-offset) 0 0; flex: 0 0 auto; accent-color: var(--focus); }
    button { width: 100%; min-height: var(--action-height); padding: var(--space-3) var(--space-4); border: 0; border-radius: var(--radius-action); background: var(--action); color: var(--action-text); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); cursor: pointer; transition: background-color 100ms ease-out, transform 100ms ease-out; }
    button:hover { background: var(--action-hover); }
    button:active { transform: scale(var(--pressed-scale)); }
    button:focus-visible, input:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }`,
    title: "SmartThings 권한 연결",
  })
}
