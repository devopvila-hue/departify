/**
 * Turns a deliverable into something a CEO reads. Models sometimes answer
 * with a JSON envelope; the business owner must never see braces.
 */
export function readable(value: string): string {
  const trimmed = value.trim().replace(/^```[a-z]*|```$/gi, "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return flatten(parsed).join("\n\n");
  } catch {
    return trimmed;
  }
}

function flatten(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(flatten);
  }
  return [];
}

