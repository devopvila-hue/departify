import { routeExecutiveIntent } from "../src/index.js";
import {
  assignTaskIntent,
  createOrganizationIntent,
  requestAgentIntent,
  requestDepartmentIntent,
} from "./fixtures.js";

describe("Executive routing", () => {
  it("routes organization creation to provisioning coordination", () => {
    expect(routeExecutiveIntent(createOrganizationIntent())).toMatchObject({
      decisionType: "coordinate_provisioning",
      target: "provisioning_engine",
    });
  });

  it("routes task assignment to runtime coordination contracts", () => {
    expect(routeExecutiveIntent(assignTaskIntent())).toMatchObject({
      decisionType: "coordinate_agent_runtime",
      target: "agent_runtime",
    });
  });

  it("records department and agent requests internally", () => {
    expect(routeExecutiveIntent(requestDepartmentIntent())).toMatchObject({
      decisionType: "record_operational_request",
      target: "executive_director",
    });
    expect(routeExecutiveIntent(requestAgentIntent())).toMatchObject({
      decisionType: "record_operational_request",
      target: "executive_director",
    });
  });
});
