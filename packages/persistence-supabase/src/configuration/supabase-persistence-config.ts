import type { EnvConfig } from "@departify/config";

export interface SupabasePersistenceConfig {
  url: string;
  key: string;
}

export function createSupabasePersistenceConfig(
  env: EnvConfig,
): SupabasePersistenceConfig {
  const url = normalizeRequired(env.SUPABASE_URL, "SUPABASE_URL");
  const key = normalizeRequired(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  return { url, key };
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required for Supabase persistence.`);
  }
  return normalized;
}
