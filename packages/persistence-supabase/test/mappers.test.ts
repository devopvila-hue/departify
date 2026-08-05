import {
  fromSupabaseRecord,
  specificationToSupabaseFilters,
  toJson,
  toSupabaseRecord,
} from "../src/index.js";
import { organizationSnapshot } from "./fixtures.js";

describe("Supabase persistence mappers", () => {
  it("maps records to and from Supabase rows without leaking row shape", () => {
    const snapshot = organizationSnapshot();
    const row = toSupabaseRecord("org_supabase01", {
      snapshot,
      version: "v1",
    });

    expect(row).toMatchObject({
      id: "org_supabase01",
      version: "v1",
      snapshot: toJson(snapshot),
    });

    expect(
      fromSupabaseRecord({
        id: "org_supabase01",
        snapshot: row.snapshot,
        version: "v1",
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-08-05T00:00:00.000Z",
      }),
    ).toEqual({
      snapshot,
      version: "v1",
    });
  });

  it("maps declarative specifications to Supabase filter instructions", () => {
    expect(
      specificationToSupabaseFilters({
        name: "active-organizations",
        filters: {
          clauses: [
            { field: "status", operator: "equals", value: "active" },
            { field: "name", operator: "contains", value: "Departify" },
          ],
        },
      }),
    ).toEqual([
      { path: "snapshot->>status", operator: "eq", value: "active" },
      { path: "snapshot->>name", operator: "ilike", value: "%Departify%" },
    ]);
  });
});
