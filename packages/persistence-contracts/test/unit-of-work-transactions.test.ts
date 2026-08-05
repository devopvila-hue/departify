import type {
  TransactionBoundary,
  TransactionContext,
  TransactionOptions,
  UnitOfWork,
  UnitOfWorkContext,
} from "../src/index.js";

describe("unit of work and transactions", () => {
  it("defines transaction boundary contracts", () => {
    const boundary = {} as TransactionBoundary<TransactionContext>;

    expectTypeOf(boundary.runInTransaction).toBeFunction();
  });

  it("defines unit of work context contracts", () => {
    const unitOfWork = {} as UnitOfWork;

    expectTypeOf(unitOfWork.execute).toBeFunction();
    expectTypeOf<UnitOfWorkContext>().toHaveProperty("organizations");
    expectTypeOf<UnitOfWorkContext>().toHaveProperty("workspaces");
    expectTypeOf<UnitOfWorkContext>().toHaveProperty("provisioning");
    expectTypeOf<UnitOfWorkContext>().toHaveProperty("transaction");
  });

  it("keeps transaction options provider-neutral", () => {
    const options: TransactionOptions = {
      isolationLevel: "serializable",
      timeoutMs: 5000,
    };

    expect(options).toEqual({
      isolationLevel: "serializable",
      timeoutMs: 5000,
    });
  });
});
