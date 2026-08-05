import { createRequire } from "node:module";
import type { GoogleVertexProviderRuntimeConfig } from "../configuration/google-vertex-provider-config.js";

/**
 * Provider-neutral client interface for Google Vertex AI generative models.
 *
 * Mirrors the subset of capabilities required by the LLM Router without
 * exposing `@google-cloud/vertexai` types outside this package.
 */
export interface GoogleVertexContent {
  role: "user" | "model";
  parts: readonly { text: string }[];
}

export interface GoogleVertexTool {
  functionDeclarations: readonly {
    name: string;
    description: string;
    parameters: Readonly<Record<string, unknown>>;
  }[];
}

export interface GoogleVertexGenerationRequest {
  contents: readonly GoogleVertexContent[];
  tools?: GoogleVertexTool;
  generationConfig?: {
    responseMimeType?: string;
    responseSchema?: Readonly<Record<string, unknown>>;
  };
}

export interface GoogleVertexGenerationResponse {
  candidates: readonly {
    content: {
      role: string;
      parts: readonly { text?: string; functionCall?: unknown }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GoogleVertexStreamChunk {
  candidates: readonly {
    content: {
      role: string;
      parts: readonly { text?: string }[];
    };
  }[];
}

export interface GoogleVertexGenerativeModel {
  generateContent(
    request: GoogleVertexGenerationRequest,
  ): Promise<GoogleVertexGenerationResponse>;
  generateContentStream(
    request: GoogleVertexGenerationRequest,
  ): Promise<AsyncIterable<GoogleVertexStreamChunk>>;
}

export interface GoogleVertexClient {
  getGenerativeModel(options: { model: string }): GoogleVertexGenerativeModel;
}

interface VertexAISdkShape {
  VertexAI: new (options: {
    project: string;
    location: string;
    googleAuthOptions?: { keyFilename?: string };
  }) => {
    getGenerativeModel(options: { model: string }): {
      generateContent(request: unknown): Promise<unknown>;
      generateContentStream(request: unknown): Promise<{
        stream: AsyncIterable<unknown>;
      }>;
    };
  };
}

const nodeRequire = createRequire(import.meta.url);
let cachedSdk: VertexAISdkShape | undefined;

function loadVertexSdk(): VertexAISdkShape {
  if (!cachedSdk) {
    cachedSdk = nodeRequire("@google-cloud/vertexai") as VertexAISdkShape;
  }
  return cachedSdk;
}

export function createGoogleVertexClient(
  config: GoogleVertexProviderRuntimeConfig,
): GoogleVertexClient {
  const sdk = loadVertexSdk();
  const vertex = new sdk.VertexAI({
    project: config.projectId,
    location: config.location,
    ...(config.applicationCredentials
      ? { googleAuthOptions: { keyFilename: config.applicationCredentials } }
      : {}),
  });
  return {
    getGenerativeModel({ model }) {
      const generativeModel = vertex.getGenerativeModel({ model });
      return {
        async generateContent(request) {
          return (await generativeModel.generateContent(
            request as never,
          )) as GoogleVertexGenerationResponse;
        },
        async generateContentStream(request) {
          const streamResult = await generativeModel.generateContentStream(
            request as never,
          );
          return streamResult.stream as unknown as AsyncIterable<GoogleVertexStreamChunk>;
        },
      };
    },
  };
}
