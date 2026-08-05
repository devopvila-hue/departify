import type { OrganizationSnapshot } from "@departify/organization-domain";
import type { OrganizationProvisioningRecord } from "@departify/provisioning-engine";
import type { WorkspaceSnapshot } from "@departify/organization-domain";

export function organizationSnapshot(
  id = "org_supabase01",
): OrganizationSnapshot {
  return {
    id,
    name: "Departify Supabase",
    status: "active",
    brand: { displayName: "Departify Supabase" },
    license: { plan: "professional", seats: 10 },
    settings: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
      limits: { maxWorkspaces: 2, maxMembers: 10 },
      featureFlags: {},
      contactInformation: {},
    },
    workspaces: [{ id: "wsp_supabase01", name: "Primary", status: "active" }],
  };
}

export function workspaceSnapshot(id = "wsp_supabase01"): WorkspaceSnapshot {
  return {
    id,
    name: "Primary",
    status: "active",
  };
}

export function provisioningRecord(
  id = "prv_supabase01",
): OrganizationProvisioningRecord {
  return {
    id,
    state: "requested",
    request: {
      requestedBy: "actor_001",
      organizationName: "Departify Supabase",
    },
    attempts: 0,
    issues: [],
  };
}
