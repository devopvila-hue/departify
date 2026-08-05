import { validateProvisioningRequest } from "../src/index.js";

describe("validateProvisioningRequest", () => {
  it("accepts a structurally valid request", () => {
    expect(
      validateProvisioningRequest({
        organizationName: "Acme",
        requestedBy: "platform",
      }),
    ).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("reports explicit structural issues", () => {
    const result = validateProvisioningRequest({
      organizationName: " ",
      requestedBy: "",
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "ORGANIZATION_NAME_REQUIRED",
      "REQUESTED_BY_REQUIRED",
    ]);
  });
});
