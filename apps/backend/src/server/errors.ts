import { EngineError } from "@departify/engine-adapter";
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    statusCode: number;
  };
}

/** Maps a provider-independent EngineError to an HTTP status code. */
export function engineErrorStatusCode(error: EngineError): number {
  switch (error.code) {
    case "ENGINE_AUTHENTICATION":
      return 503;
    case "ENGINE_RATE_LIMIT":
      return 429;
    case "ENGINE_TIMEOUT":
      return 504;
    case "ENGINE_SESSION_NOT_FOUND":
      return 404;
    case "ENGINE_UNAVAILABLE":
      return 503;
    case "ENGINE_INVALID_REQUEST":
      return 400;
    case "ENGINE_EXECUTION":
    case "ENGINE_PROTOCOL":
    default:
      return 502;
  }
}

export function registerErrorHandling(server: FastifyInstance): void {
  server.setErrorHandler(handleError);
  server.setNotFoundHandler((request, reply) => {
    reply.header("x-departify-correlation-id", correlationIdFor(request));
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
        statusCode: 404,
      },
    } satisfies ErrorResponse);
  });
}

function handleError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.header("x-departify-correlation-id", correlationIdFor(request));
  // EngineErrors are already provider-independent; map them to clean responses
  // so no raw OpenClaw/Vertex error ever reaches the portal.
  if (error instanceof EngineError) {
    const statusCode = engineErrorStatusCode(error);
    request.log.error(
      {
        engineErrorCode: error.code,
        operation: error.operation,
        provider: error.provider,
        statusCode,
      },
      "Engine request failed",
    );
    reply.status(statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.id,
        statusCode,
      },
    } satisfies ErrorResponse);
    return;
  }

  const statusCode = normalizeStatusCode(error.statusCode);
  const code = statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR";
  const message = statusCode >= 500 ? "Internal server error" : error.message;

  request.log.error({ error, statusCode }, "Request failed");

  reply.status(statusCode).send({
    error: {
      code,
      message,
      requestId: request.id,
      statusCode,
    },
  } satisfies ErrorResponse);
}

function correlationIdFor(request: FastifyRequest): string {
  const supplied = request.headers["x-departify-correlation-id"];
  return typeof supplied === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : request.id;
}

function normalizeStatusCode(statusCode: number | undefined): number {
  if (!statusCode || statusCode < 400 || statusCode > 599) {
    return 500;
  }

  return statusCode;
}
