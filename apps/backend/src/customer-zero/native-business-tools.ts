import {
  isRuntimeCapabilityAvailable,
  type RuntimeCapabilityManifest,
} from "./capability-manifest.js";

/** Read-only native surface advertised to the runtime engine. */
export const NATIVE_READ_TOOL_NAMES = [
  "departify.company.context",
  "departify.email.list",
  "departify.email.search",
  "departify.calendar.list",
  "departify.drive.search",
  "departify.drive.read",
  "departify.tasks.list",
  "departify.approvals.list",
  "departify.results.list",
] as const;

export type NativeReadToolName = (typeof NATIVE_READ_TOOL_NAMES)[number];

const REQUIRED_CAPABILITY: Partial<Record<NativeReadToolName, string>> = {
  "departify.email.list": "email.business.read",
  "departify.email.search": "email.business.search",
  "departify.calendar.list": "calendar.list",
  "departify.drive.search": "drive.search",
  "departify.drive.read": "drive.read",
  "departify.tasks.list": "tasks.list",
  "departify.approvals.list": "approvals.list",
  "departify.results.list": "results.list",
};

export function isNativeReadToolName(value: string): value is NativeReadToolName {
  return (NATIVE_READ_TOOL_NAMES as readonly string[]).includes(value);
}

/** Capability-first exposure. The backend is the source of truth. */
export function nativeToolsForManifest(
  manifest: RuntimeCapabilityManifest,
): readonly NativeReadToolName[] {
  return NATIVE_READ_TOOL_NAMES.filter((name) => {
    const capability = REQUIRED_CAPABILITY[name];
    return !capability || isRuntimeCapabilityAvailable(manifest, capability);
  });
}

export function requiredCapabilityForNativeTool(
  name: NativeReadToolName,
): string | null {
  return REQUIRED_CAPABILITY[name] ?? null;
}
