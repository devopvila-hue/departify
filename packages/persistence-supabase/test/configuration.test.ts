import { validateEnv } from "@departify/config";
import {
  createSupabasePersistenceConfig,
  createDepartifySupabaseClient,
} from "../src/index.js";

describe("Supabase persistence configuration", () => {
  it("creates adapter config from packages/config validated env", () => {
    const env = validateEnv({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });

    expect(createSupabasePersistenceConfig(env)).toEqual({
      url: "http://127.0.0.1:54321",
      key: "service-role-key",
    });
  });

  it("creates official Supabase client without session persistence", () => {
    const client = createDepartifySupabaseClient({
      url: "http://127.0.0.1:54321",
      key: "service-role-key",
    });

    expect(client.from("departify_organization_records")).toBeDefined();
  });

  it("rejects missing Supabase configuration", () => {
    const env = validateEnv({});

    expect(() => createSupabasePersistenceConfig(env)).toThrow(
      "SUPABASE_URL is required",
    );
  });
});
