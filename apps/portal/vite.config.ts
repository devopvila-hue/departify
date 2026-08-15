import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const SUPABASE_URL_ENV = "VITE_SUPABASE_URL";
const SUPABASE_ANON_KEY_ENV = "VITE_SUPABASE_ANON_KEY";
const CANONICAL_SUPABASE_HOST = "qygssfuqkqzrhwduafft.supabase.co";

function assertProductionSupabaseConfig(mode: string): void {
  if (mode !== "production") return;

  const env = loadEnv(mode, process.cwd(), "");
  const url = env[SUPABASE_URL_ENV]?.trim();
  const anonKey = env[SUPABASE_ANON_KEY_ENV]?.trim();
  const missing = [
    !url ? SUPABASE_URL_ENV : null,
    !anonKey ? SUPABASE_ANON_KEY_ENV : null,
  ].filter((name): name is string => name !== null);

  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== CANONICAL_SUPABASE_HOST) {
        missing.push(`${SUPABASE_URL_ENV} (must target the canonical Departify Supabase project)`);
      }
    } catch {
      missing.push(`${SUPABASE_URL_ENV} (must be a valid URL)`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[portal:production-config] Supabase public Auth configuration is missing or invalid: ${missing.join(", ")}. ` +
        "Set the production build variables in Netlify before deploying.",
    );
  }
}

export default defineConfig(({ mode }) => {
  assertProductionSupabaseConfig(mode);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://backend:3210",
          changeOrigin: true,
        },
      },
    },
    build: {
      target: "es2022",
      sourcemap: true,
      cssCodeSplit: true,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
    },
  };
});
