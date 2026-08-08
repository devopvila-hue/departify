/**
 * Tenant organization store contracts — Phase P0-A.
 *
 * The backend-owned port for durable organization creation and membership
 * listing. Production is backed by Supabase (service role + RPC); tests use
 * an in-memory fake. Only the verified `user.id` from the request token ever
 * reaches these calls — never a value supplied by the browser.
 */

import type { OrganizationRole } from "@departify/auth";

export interface OrganizationSummary {
  readonly organizationId: string;
  readonly name: string;
  readonly role: OrganizationRole;
}

export interface OrganizationStore {
  /** Atomically creates an organization + owner membership. Returns the id. */
  createOrganization(name: string, ownerId: string): Promise<OrganizationSummary>;
  /** Lists the organizations the user belongs to. */
  listForUser(userId: string): Promise<OrganizationSummary[]>;
}
