import {
  SupabaseUnitOfWork,
  createDepartifySupabaseClient,
} from "../src/index.js";

describe("Supabase UnitOfWork", () => {
  it("provides repositories inside a provider-neutral transaction context", async () => {
    const unitOfWork = new SupabaseUnitOfWork(
      createDepartifySupabaseClient({
        url: "http://127.0.0.1:54321",
        key: "service-role-key",
      }),
    );

    await expect(
      unitOfWork.execute(async (context) => {
        expect(context.transaction.id).toMatch(/^supabase_tx_/);
        expect(context.organizations).toBeDefined();
        expect(context.workspaces).toBeDefined();
        expect(context.provisioning).toBeDefined();
        return "ok";
      }),
    ).resolves.toBe("ok");
  });
});
