/**
 * Provider-backed evidence for connector execution.
 *
 * A receipt records safe metadata only. It never contains OAuth material,
 * message bodies, document contents, or other provider secrets.
 */
export type ExecutionReceiptStatus = "executing" | "succeeded" | "failed" | "ambiguous";

export interface ExecutionReceipt {
  readonly operationId: string;
  readonly intent: string;
  readonly capability: string;
  readonly provider: string;
  readonly sideEffect: boolean;
  readonly status: ExecutionReceiptStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly providerResourceId?: string;
  readonly providerResourceUrl?: string;
  readonly safeMetadata?: Readonly<Record<string, string | number | boolean>>;
  readonly errorCategory?: string;
}

export function startExecutionReceipt(input: {
  readonly operationId: string;
  readonly intent: string;
  readonly capability: string;
  readonly provider: string;
  readonly sideEffect: boolean;
  readonly startedAt?: string;
}): ExecutionReceipt {
  return {
    ...input,
    status: "executing",
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
}

export function completeExecutionReceipt(
  receipt: ExecutionReceipt,
  input: {
    readonly provider?: string;
    readonly providerResourceId?: string;
    readonly providerResourceUrl?: string;
    readonly safeMetadata?: ExecutionReceipt["safeMetadata"];
    readonly completedAt?: string;
  } = {},
): ExecutionReceipt {
  return {
    ...receipt,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.providerResourceId ? { providerResourceId: input.providerResourceId } : {}),
    ...(input.providerResourceUrl ? { providerResourceUrl: input.providerResourceUrl } : {}),
    ...(input.safeMetadata ? { safeMetadata: input.safeMetadata } : {}),
    status: "succeeded",
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

export function failExecutionReceipt(
  receipt: ExecutionReceipt,
  errorCategory: string,
  status: "failed" | "ambiguous" = "failed",
  provider?: string,
): ExecutionReceipt {
  return {
    ...receipt,
    ...(provider ? { provider } : {}),
    status,
    errorCategory,
    completedAt: new Date().toISOString(),
  };
}
