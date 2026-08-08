/**
 * Supabase client factory — Phase P0-A.
 *
 * The portal uses the official Supabase client ONLY for authentication
 * (register / login / session / logout). The ANON/publishable key is the only
 * key the browser ever sees. The service-role key never leaves the backend.
 *
 * When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not configured the
 * client is null and the portal renders the login screen (no fabricated
 * sessions).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    cached = null;
    return null;
  }
  cached = createClient(url, anonKey);
  return cached;
}
