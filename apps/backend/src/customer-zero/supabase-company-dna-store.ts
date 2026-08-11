/**
 * Supabase Company DNA store — Customer Zero P0.
 *
 * Durable, organization-scoped canonical Company DNA backed by the
 * `company_dna` table. Service role only (backend owns the canonical
 * record); RLS remains defense-in-depth for direct reads.
 *
 * MISSING-TABLE RESILIENCE
 *
 * Migrations in this project are applied as an explicit deploy step, not
 * by the Railway build pipeline. A backend that boots before its
 * migration has been applied must degrade honestly — "we have no durable
 * DNA for this organization yet" — rather than 500 the whole onboarding
 * path. A missing relation is therefore treated as "no record", logged
 * once, and never silently swallowed for any other error class.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  CompanyDnaRecord,
  CompanyDnaStore,
  FactProvenance,
} from "./company-dna.js";

interface CompanyDnaRow {
  organization_id: string;
  company_name: string;
  website: string | null;
  description: string | null;
  country: string | null;
  company_size: string | null;
  objective: string | null;
  products: string[] | null;
  customers: string[] | null;
  geography: string | null;
  business_model: string | null;
  positioning: string | null;
  channels: string[] | null;
  declared_tools: string[] | null;
  uncertainties: string[] | null;
  provenance: Record<string, FactProvenance> | null;
  research_completed_at: string | null;
  blocking_discovery_completed_at: string | null;
  ceo_confirmed_at: string | null;
  department_provisioned_at: string | null;
  facts_updated_at: string;
}

/** PostgREST/Postgres signals for "the table is not there yet". */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*company_dna.* does not exist/i.test(error.message ?? "")
  );
}

export class SupabaseCompanyDnaStore implements CompanyDnaStore {
  private readonly admin: SupabaseClient;
  private warnedMissingTable = false;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  private warnMissingTable(operation: string): void {
    if (this.warnedMissingTable) return;
    this.warnedMissingTable = true;
    // Operational signal only — no company data, no credentials.
    console.warn(
      `[company-dna] table public.company_dna is absent (${operation}). ` +
        "Apply migration 20260811120000_company_dna.sql. " +
        "Readiness will report NOT ready until it exists.",
    );
  }

  async get(organizationId: string): Promise<CompanyDnaRecord | null> {
    const { data, error } = await this.admin
      .from("company_dna")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        this.warnMissingTable("read");
        return null;
      }
      throw error;
    }
    if (!data) return null;
    return mapRow(data as CompanyDnaRow);
  }

  async upsert(record: CompanyDnaRecord): Promise<void> {
    const { error } = await this.admin.from("company_dna").upsert(
      {
        organization_id: record.organizationId,
        company_name: record.companyName,
        website: record.website ?? null,
        description: record.description ?? null,
        country: record.country ?? null,
        company_size: record.companySize ?? null,
        objective: record.objective ?? null,
        products: [...record.products],
        customers: [...record.customers],
        geography: record.geography ?? null,
        business_model: record.businessModel ?? null,
        positioning: record.positioning ?? null,
        channels: [...record.channels],
        declared_tools: [...record.declaredTools],
        uncertainties: [...record.uncertainties],
        provenance: record.provenance,
        research_completed_at: record.researchCompletedAt ?? null,
        blocking_discovery_completed_at:
          record.blockingDiscoveryCompletedAt ?? null,
        ceo_confirmed_at: record.ceoConfirmedAt ?? null,
        department_provisioned_at: record.departmentProvisionedAt ?? null,
        facts_updated_at: record.factsUpdatedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
    if (error) {
      if (isMissingTable(error)) {
        this.warnMissingTable("write");
        return;
      }
      throw error;
    }
  }
}

function mapRow(row: CompanyDnaRow): CompanyDnaRecord {
  return {
    organizationId: row.organization_id,
    companyName: row.company_name,
    ...(row.website ? { website: row.website } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.country ? { country: row.country } : {}),
    ...(row.company_size ? { companySize: row.company_size } : {}),
    ...(row.objective ? { objective: row.objective } : {}),
    products: row.products ?? [],
    customers: row.customers ?? [],
    ...(row.geography ? { geography: row.geography } : {}),
    ...(row.business_model ? { businessModel: row.business_model } : {}),
    ...(row.positioning ? { positioning: row.positioning } : {}),
    channels: row.channels ?? [],
    declaredTools: row.declared_tools ?? [],
    uncertainties: row.uncertainties ?? [],
    provenance: row.provenance ?? {},
    ...(row.research_completed_at
      ? { researchCompletedAt: row.research_completed_at }
      : {}),
    ...(row.blocking_discovery_completed_at
      ? { blockingDiscoveryCompletedAt: row.blocking_discovery_completed_at }
      : {}),
    ...(row.ceo_confirmed_at ? { ceoConfirmedAt: row.ceo_confirmed_at } : {}),
    ...(row.department_provisioned_at
      ? { departmentProvisionedAt: row.department_provisioned_at }
      : {}),
    factsUpdatedAt: row.facts_updated_at,
  };
}
