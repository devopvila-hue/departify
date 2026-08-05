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

export function registerErrorHandling(server: FastifyInstance): void {
  server.setErrorHandler(handleError);
  server.setNotFoundHandler((request, reply) => {
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

function normalizeStatusCode(statusCode: number | undefined): number {
  if (!statusCode || statusCode < 400 || statusCode > 599) {
    return 500;
  }

  return statusCode;
}
