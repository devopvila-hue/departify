import {
  isRuntimeCapabilityAvailable,
  type RuntimeCapabilityManifest,
} from "./capability-manifest.js";

/** Native business surface advertised to the runtime engine. Mutating external
 * provider operations remain outside this surface and approval-gated. */
export const NATIVE_READ_TOOL_NAMES = [
  "departify.company.context",
  "departify.email.list",
  "departify.email.search",
  "departify.calendar.list",
  "departify.facebook.pages.publish",
  "departify.drive.search",
  "departify.drive.read",
  "departify.drive.create_folder",
  "departify.drive.create_file",
  "departify.drive.write",
  "departify.tasks.list",
  "departify.approvals.list",
  "departify.results.list",
  "departify.work.deliverable",
  "departify.marketing.delegate",
] as const;

export const NATIVE_DRIVE_READ_INPUT = {
  type: "object",
  properties: {
    query: { type: "string", description: "Optional file or folder search terms" },
    parentId: { type: "string", description: "Optional authorized parent folder id" },
    mimeType: { type: "string", description: "Optional MIME type filter" },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
} as const;

export type NativeReadToolName = (typeof NATIVE_READ_TOOL_NAMES)[number];

const REQUIRED_CAPABILITY: Partial<Record<NativeReadToolName, string>> = {
  "departify.email.list": "email.business.read",
  "departify.email.search": "email.business.search",
  "departify.calendar.list": "calendar.list",
  "departify.drive.search": "drive.search",
  "departify.drive.read": "drive.read",
  "departify.drive.create_folder": "drive.create_folder",
  "departify.drive.create_file": "drive.create_file",
  "departify.drive.write": "drive.write",
  "departify.tasks.list": "tasks.list",
  "departify.approvals.list": "approvals.list",
  "departify.results.list": "results.list",
  "departify.work.deliverable": "work.deliverable",
  "departify.facebook.pages.publish": "marketing.social.publish",
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
