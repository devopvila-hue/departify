/**
 * Mautic capability definition — Sprint 62.
 *
 * The first certified Marketing department capability, built from the EXISTING
 * real Mautic integration (mautic-tools.ts → mautic-adapter.ts). No new Mautic
 * client is created: this contract wraps the already-validated tools.
 *
 * The contract maps the three real Tool Runtime tool ids:
 *   - mautic.contacts.count   (read)
 *   - mautic.contacts.search  (read)
 *   - mautic.test_connection  (read / validation)
 *
 * Status is derived operationally by the DepartmentCapabilityRegistry from the
 * connection state — never from memory. When Mautic is connected and
 * verification passes, the capability becomes READY.
 */

import type { CapabilityContract } from "../contracts/capability-contract.js";

export const MAUTIC_CAPABILITY_ID = "mautic";
export const MAUTIC_DEPARTMENT = "marketing";

export function buildMauticCapability(): CapabilityContract {
  return {
    id: MAUTIC_CAPABILITY_ID,
    name: "Mautic CRM",
    description:
      "Acceso a los contactos del CRM Mautic: contar, buscar e inspeccionar contactos reales.",
    department: MAUTIC_DEPARTMENT,
    provider: "mautic",
    version: "1.0.0",
    source: "integration",
    requiredConnections: ["mautic"],
    requiredCredentials: [
      "MAUTIC_BASE_URL",
      "MAUTIC_CLIENT_ID",
      "MAUTIC_CLIENT_SECRET",
    ],
    actions: [
      {
        id: "count_contacts",
        name: "Contar contactos",
        description: "Total de contactos en Mautic.",
        toolId: "mautic.contacts.count",
        kind: "read",
        riskLevel: "read",
        approvalPolicy: "auto",
      },
      {
        id: "search_contacts",
        name: "Buscar contactos",
        description: "Buscar contactos por nombre o email en Mautic.",
        toolId: "mautic.contacts.search",
        kind: "read",
        riskLevel: "read",
        approvalPolicy: "auto",
      },
      {
        id: "test_connection",
        name: "Comprobar conexión",
        description: "Validar credenciales y conectividad de Mautic.",
        toolId: "mautic.test_connection",
        kind: "read",
        riskLevel: "read",
        approvalPolicy: "auto",
      },
    ],
    readActions: [
      "count_contacts",
      "search_contacts",
      "test_connection",
    ],
    writeActions: [],
    riskLevel: "read",
    approvalPolicy: "auto",
    verification: {
      status: "pending",
      checks: [
        "mautic.test_connection passes",
        "mautic.contacts.count returns a real total",
      ],
    },
  };
}

/** Produces the verified Mautic contract after real validation. */
export function certifyMauticCapability(
  capability: CapabilityContract,
  verifiedAt: string,
): CapabilityContract {
  return {
    ...capability,
    verification: {
      status: "passed",
      checks: capability.verification.checks,
      verifiedAt,
    },
  };
}
