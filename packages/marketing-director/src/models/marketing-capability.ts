export interface MarketingCapability {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: "internal" | "external";
  readonly requiresTool: boolean;
  readonly toolCapability?: string;
}

export function createMarketingCapability(
  input: Omit<MarketingCapability, "requiresTool"> & { requiresTool?: boolean },
): MarketingCapability {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    kind: input.kind,
    requiresTool: input.requiresTool ?? (input.kind === "external"),
    ...(input.toolCapability ? { toolCapability: input.toolCapability } : {}),
  };
}
