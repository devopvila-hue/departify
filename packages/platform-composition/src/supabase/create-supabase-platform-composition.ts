import type { EnvConfig } from "@departify/config";
import {
  createSupabasePersistenceAdapter,
  createSupabasePersistenceConfig,
  type SupabasePersistenceAdapter,
} from "@departify/persistence-supabase";
import { FirstRealProvisioningService } from "../provisioning/first-real-provisioning-service.js";

export interface SupabasePlatformComposition {
  persistence: SupabasePersistenceAdapter;
  provisioning: FirstRealProvisioningService;
}

export function createSupabasePlatformComposition(
  env: EnvConfig,
): SupabasePlatformComposition {
  const persistence = createSupabasePersistenceAdapter(
    createSupabasePersistenceConfig(env),
  );

  return {
    persistence,
    provisioning: new FirstRealProvisioningService({
      unitOfWork: persistence.unitOfWork,
    }),
  };
}
