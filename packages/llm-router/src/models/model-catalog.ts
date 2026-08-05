import type { LlmCapabilityCode } from "../capabilities/model-capabilities.js";
import { ModelCapabilities } from "../capabilities/model-capabilities.js";
import { assertRouterValid } from "../validation/router-error.js";

export type ProviderId = string;
export type ModelId = string;

export interface LlmModelDescriptor {
  providerId: ProviderId;
  modelId: ModelId;
  displayName: string;
  capabilities: readonly LlmCapabilityCode[];
  costScore: number;
  latencyScore: number;
  availabilityScore: number;
}

export class ModelCatalog {
  private readonly models: readonly LlmModelDescriptor[];

  constructor(models: readonly LlmModelDescriptor[]) {
    assertRouterValid(
      models.length > 0,
      "ModelCatalog requires at least one model.",
    );
    const keys = models.map((model) => modelKey(model));
    assertRouterValid(
      new Set(keys).size === keys.length,
      "ModelCatalog cannot contain duplicate provider/model pairs.",
    );
    models.forEach(validateModelDescriptor);
    this.models = models.map((model) => ({ ...model }));
  }

  list(): readonly LlmModelDescriptor[] {
    return this.models.map((model) => ({ ...model }));
  }

  find(providerId: ProviderId, modelId: ModelId): LlmModelDescriptor | null {
    const model = this.models.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    return model ? { ...model } : null;
  }

  findSupporting(
    required: readonly LlmCapabilityCode[],
  ): readonly LlmModelDescriptor[] {
    return this.models
      .filter((model) =>
        ModelCapabilities.create({
          capabilities: model.capabilities,
        }).supportsAll(required),
      )
      .map((model) => ({ ...model }));
  }
}

export function validateModelDescriptor(model: LlmModelDescriptor): void {
  assertRouterValid(
    model.providerId.trim().length >= 2,
    "Provider id is required.",
  );
  assertRouterValid(model.modelId.trim().length >= 2, "Model id is required.");
  assertRouterValid(
    model.displayName.trim().length >= 2,
    "Model displayName is required.",
  );
  ModelCapabilities.create({ capabilities: model.capabilities });
  validateScore(model.costScore, "costScore");
  validateScore(model.latencyScore, "latencyScore");
  validateScore(model.availabilityScore, "availabilityScore");
}

function validateScore(score: number, field: string): void {
  assertRouterValid(Number.isInteger(score), `${field} must be an integer.`);
  assertRouterValid(
    score >= 1 && score <= 100,
    `${field} must be between 1 and 100.`,
  );
}

function modelKey(model: LlmModelDescriptor): string {
  return `${model.providerId}:${model.modelId}`;
}
