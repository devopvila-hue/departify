import type { SupabasePersistenceConfig } from "../configuration/supabase-persistence-config.js";
import {
  createDepartifySupabaseClient,
  type DepartifySupabaseClient,
} from "../client/supabase-client.js";
import { SupabaseOrganizationRepository } from "../repositories/organization-repository.js";
import { SupabaseProvisioningRepository } from "../repositories/provisioning-repository.js";
import { SupabaseWorkspaceRepository } from "../repositories/workspace-repository.js";
import { SupabaseUnitOfWork } from "../transactions/supabase-unit-of-work.js";

export interface SupabasePersistenceAdapter {
  client: DepartifySupabaseClient;
  organizations: SupabaseOrganizationRepository;
  workspaces: SupabaseWorkspaceRepository;
  provisioning: SupabaseProvisioningRepository;
  unitOfWork: SupabaseUnitOfWork;
}

export function createSupabasePersistenceAdapter(
  config: SupabasePersistenceConfig,
): SupabasePersistenceAdapter {
  const client = createDepartifySupabaseClient(config);

  return {
    client,
    organizations: new SupabaseOrganizationRepository(client),
    workspaces: new SupabaseWorkspaceRepository(client),
    provisioning: new SupabaseProvisioningRepository(client),
    unitOfWork: new SupabaseUnitOfWork(client),
  };
}
