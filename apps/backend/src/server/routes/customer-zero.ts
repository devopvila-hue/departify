import {
  runMarketingCustomerZero,
} from "../../customer-zero/customer-zero-composition.js";
import type { FastifyInstance } from "fastify";

/**
 * Customer Zero route — the minimal product surface that lets the CEO put a
 * Department to work from the browser. Single product-intention endpoint:
 *
 *   POST /api/customer-zero/marketing
 *
 * The route is a thin adapter. It validates the CEO's real company
 * information and delegates the whole run to the existing composition. No
 * pipeline phases are reimplemented here.
 */
export async function registerCustomerZeroRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.post(
    "/api/customer-zero/marketing",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Put the Marketing department to work for a real company",
        body: {
          type: "object",
          required: ["companyName"],
          properties: {
            companyName: { type: "string", minLength: 1 },
            rawData: { type: "object" },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: [
              "status",
              "organizationId",
              "companyName",
              "department",
              "firstResult",
              "errors",
              "runId",
            ],
            properties: {
              status: { type: "string", enum: ["completed", "failed"] },
              organizationId: { type: "string" },
              companyName: { type: "string" },
              department: { type: "string", enum: ["Marketing"] },
              firstResult: {
                type: ["object", "null"],
                properties: {
                  confidence: { type: "string" },
                  gapCount: { type: "number" },
                  criticalGapCount: { type: "number" },
                  blockingGapCount: { type: "number" },
                  questionCount: { type: "number" },
                },
              },
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
              runId: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        companyName: string;
        rawData?: Readonly<Record<string, unknown>>;
      };

      const result = await runMarketingCustomerZero({
        companyName: body.companyName,
        rawData: body.rawData ?? {},
      });

      return reply.code(200).send(result);
    },
  );
}
