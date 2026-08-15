/**
 * Capability Registry — Customer Zero 01.
 *
 * The CEO (and Elvira) think in business capabilities:
 *
 *   "Necesito consultar los contactos del CRM."
 *   "Quiero ver los segmentos."
 *   "Quiero revisar la actividad de un lead."
 *
 * NOT in tool names. This module maps business capabilities to the
 * providers that can fulfil them, asks the CredentialResolver whether
 * the provider is currently available, and exposes a simple
 * `isAvailable(orgId, capabilityId)` check the rest of the system
 * consumes.
 *
 * Today only Mautic is mapped. Adding a new provider never changes
 * MarketingService or Elvira — only this registry.
 */

import {
  hasConfiguredCredentials,
  type CredentialProvider,
} from "./credential-resolver.js";
import { ADS_CAPABILITIES } from "./ads-capabilities.js";
import type { AdsBusinessCapability, AdsCapabilityDefinition } from "./ads-capabilities.js";

/**
 * Business capabilities the CEO / Elvira can ask for. Each maps to
 * one provider and one or more tool ids.
 *
 * Keep this list capability-first; never name a provider in the
 * capability id.
 */
export type BusinessCapability =
  | "crm.contacts.read"
  | "crm.contacts.list"
  | "crm.contacts.search"
  | "crm.contact.read"
  | "crm.contacts.summary"
  | "crm.segments.read"
  | "crm.segments.list"
  | "crm.campaigns.read"
  | "crm.campaigns.list"
  | "crm.activity.read"
  | "results.publish"
  | "memory.remember"
  | "email.identity.read"
  | "email.context.read"
  | "email.search"
  | "email.thread.read"
  | "email.draft"
  | "email.send.personal"
  | "email.send.bulk"
  | "email.delivery.read"
  | "email.bounce.read"
  | "email.campaign.read"
  | "email.campaign.execute"
  | "calendar.read"
  | "calendar.create"
  | "calendar.update"
  | "drive.search"
  | "drive.read"
  | "drive.create"
  | "inbox.read"
  | "inbox.classify"
  | "inbox.work.create"
  | AdsBusinessCapability;

/** Provider-owned capability ids are validated by the Ads registry at runtime. */
export interface CapabilityDescriptor {
  readonly id: BusinessCapability | AdsBusinessCapability;
  /** Capability name in business language (no provider). */
  readonly name: string;
  readonly nameEs: string;
  /** Short description of what the capability gives Elvira. */
  readonly description: string;
  /** Provider that implements the capability. */
  readonly provider: CredentialProvider;
  /** Tool Runtime tool ids that fulfil this capability. */
  readonly toolIds: readonly string[];
}

/**
 * Static mapping table. This is the single place where "this
 * business capability is delivered by this tool of this provider"
 * lives.
 */
export const CAPABILITY_REGISTRY: Readonly<Record<string, CapabilityDescriptor>> = {
  "crm.contacts.read": {
    id: "crm.contacts.read",
    name: "Read CRM contacts",
    nameEs: "Leer contactos del CRM",
    description:
      "Lee información agregada y de detalle de los contactos del CRM conectado.",
    provider: "mautic",
    toolIds: ["mautic.contacts.list", "mautic.contacts.count", "mautic.contacts.summary"],
  },
  "crm.contacts.list": {
    id: "crm.contacts.list",
    name: "List CRM contacts",
    nameEs: "Listar contactos del CRM",
    description: "Obtiene una página de contactos del CRM conectado.",
    provider: "mautic",
    toolIds: ["mautic.contacts.list"],
  },
  "crm.contacts.search": {
    id: "crm.contacts.search",
    name: "Search CRM contacts",
    nameEs: "Buscar contactos del CRM",
    description: "Busca contactos por nombre o email en el CRM conectado.",
    provider: "mautic",
    toolIds: ["mautic.contacts.search"],
  },
  "crm.contact.read": {
    id: "crm.contact.read",
    name: "Read one CRM contact",
    nameEs: "Leer un contacto del CRM",
    description: "Obtiene un contacto concreto del CRM por su identificador.",
    provider: "mautic",
    toolIds: ["mautic.contacts.get"],
  },
  "crm.contacts.summary": {
    id: "crm.contacts.summary",
    name: "CRM contacts summary",
    nameEs: "Resumen de contactos del CRM",
    description:
      "Resumen agregado para análisis ejecutivo: totales, segmentos y actividad.",
    provider: "mautic",
    toolIds: ["mautic.contacts.summary"],
  },
  "crm.segments.read": {
    id: "crm.segments.read",
    name: "Read CRM segments",
    nameEs: "Leer segmentos del CRM",
    description: "Lee los segmentos (listas de leads) del CRM conectado.",
    provider: "mautic",
    toolIds: ["mautic.segments.list"],
  },
  "crm.segments.list": {
    id: "crm.segments.list",
    name: "List CRM segments",
    nameEs: "Listar segmentos del CRM",
    description: "Lista todos los segmentos disponibles.",
    provider: "mautic",
    toolIds: ["mautic.segments.list"],
  },
  "crm.campaigns.read": {
    id: "crm.campaigns.read",
    name: "Read CRM campaigns",
    nameEs: "Leer campañas del CRM",
    description: "Lee las campañas del CRM conectado.",
    provider: "mautic",
    toolIds: ["mautic.campaigns.list"],
  },
  "crm.campaigns.list": {
    id: "crm.campaigns.list",
    name: "List CRM campaigns",
    nameEs: "Listar campañas del CRM",
    description: "Lista todas las campañas disponibles.",
    provider: "mautic",
    toolIds: ["mautic.campaigns.list"],
  },
  "crm.activity.read": {
    id: "crm.activity.read",
    name: "Read CRM contact activity",
    nameEs: "Leer actividad de un contacto",
    description: "Lee la actividad reciente de un contacto cuando está disponible.",
    provider: "mautic",
    toolIds: ["mautic.contact.activity"],
  },
  "results.publish": {
    id: "results.publish",
    name: "Publish department result",
    nameEs: "Publicar un resultado del departamento",
    description:
      "Publica un resultado durable (informe, análisis, hallazgo) que el CEO puede revisar en Resultados.",
    provider: "mautic",
    toolIds: ["department.work.publish_result"],
  },
  "memory.remember": {
    id: "memory.remember",
    name: "Remember a fact",
    nameEs: "Recordar un hecho",
    description: "Guarda un hecho en la memoria duradera del departamento.",
    provider: "mautic",
    toolIds: ["department.work.remember"],
  },
  "email.identity.read": {
    id: "email.identity.read",
    name: "Read email identity",
    nameEs: "Leer identidad de email",
    description: "Lee la identidad del buzón conectado (email + displayName).",
    provider: "gmail",
    toolIds: ["gmail.identity.read"],
  },
  "email.context.read": {
    id: "email.context.read",
    name: "Read email context",
    nameEs: "Leer contexto de correo",
    description:
      "Lee el contexto reciente del buzón (bandeja de entrada, etiquetas, hilos).",
    provider: "gmail",
    toolIds: ["gmail.context.read", "gmail.search"],
  },
  "email.search": {
    id: "email.search",
    name: "Search emails",
    nameEs: "Buscar correos",
    description:
      "Busca correos reales en el buzón del CEO por texto, remitente o etiqueta.",
    provider: "gmail",
    toolIds: ["gmail.search"],
  },
  "email.thread.read": {
    id: "email.thread.read",
    name: "Read email thread",
    nameEs: "Leer hilo de correo",
    description: "Lee un hilo completo con sus mensajes.",
    provider: "gmail",
    toolIds: ["gmail.thread.read"],
  },
  "email.draft": {
    id: "email.draft",
    name: "Create email draft",
    nameEs: "Crear borrador",
    description: "Crea un borrador en el buzón del CEO sin enviarlo.",
    provider: "gmail",
    toolIds: ["gmail.draft.create"],
  },
  "email.send.personal": {
    id: "email.send.personal",
    name: "Send personal email",
    nameEs: "Enviar correo personal",
    description:
      "Envía un correo personal desde el buzón del CEO. Requiere aprobación.",
    provider: "gmail",
    toolIds: ["gmail.send"],
  },
  "email.send.bulk": {
    id: "email.send.bulk",
    name: "Send bulk email campaign",
    nameEs: "Enviar campaña masiva",
    description:
      "Envía una campaña aprobada usando el proveedor de entrega autenticado.",
    provider: "resend",
    toolIds: ["email_delivery.send_bulk"],
  },
  "email.delivery.read": {
    id: "email.delivery.read",
    name: "Read delivery status",
    nameEs: "Consultar entregas",
    description:
      "Consulta el estado de entrega y métricas agregadas de campañas enviadas.",
    provider: "resend",
    toolIds: ["email_delivery.delivery.read"],
  },
  "email.bounce.read": {
    id: "email.bounce.read",
    name: "Read bounces & complaints",
    nameEs: "Consultar rebotes y quejas",
    description:
      "Lee eventos de rebote, queja y supresión para una campaña o globalmente.",
    provider: "resend",
    toolIds: ["email_delivery.bounces.read", "email_delivery.complaints.read"],
  },
  "email.campaign.read": {
    id: "email.campaign.read",
    name: "Read email campaign",
    nameEs: "Leer campaña",
    description:
      "Lee el estado y las métricas de una campaña de email enviada.",
    provider: "resend",
    toolIds: ["email_delivery.campaign.read"],
  },
  "email.campaign.execute": {
    id: "email.campaign.execute",
    name: "Execute email campaign",
    nameEs: "Ejecutar campaña",
    description:
      "Envía una campaña de email aprobada. Estructuralmente requiere campaign.status === 'approved'.",
    provider: "resend",
    toolIds: ["email_delivery.send_bulk"],
  },
  "calendar.read": {
    id: "calendar.read",
    name: "Read calendar events",
    nameEs: "Leer eventos del calendario",
    description: "Lee los eventos próximos del calendario conectado.",
    provider: "google",
    toolIds: ["google.calendar.list", "google.calendar.get"],
  },
  "calendar.create": {
    id: "calendar.create",
    name: "Create calendar event",
    nameEs: "Crear evento de calendario",
    description:
      "Crea un evento en el calendario del CEO con intención de negocio explícita.",
    provider: "google",
    toolIds: ["google.calendar.create"],
  },
  "calendar.update": {
    id: "calendar.update",
    name: "Update calendar event",
    nameEs: "Actualizar evento de calendario",
    description: "Actualiza un evento existente del calendario.",
    provider: "google",
    toolIds: ["google.calendar.update"],
  },
  "drive.search": {
    id: "drive.search",
    name: "Search Drive files",
    nameEs: "Buscar archivos en Drive",
    description: "Busca archivos por nombre o metadatos en el Drive conectado.",
    provider: "google",
    toolIds: ["google.drive.search"],
  },
  "drive.read": {
    id: "drive.read",
    name: "Read Drive file",
    nameEs: "Leer archivo de Drive",
    description: "Lee metadatos + contenido permitido de un archivo.",
    provider: "google",
    toolIds: ["google.drive.read"],
  },
  "drive.create": {
    id: "drive.create",
    name: "Create Drive file",
    nameEs: "Crear archivo en Drive",
    description:
      "Crea un documento en Drive a través de la frontera segura de Departify.",
    provider: "google",
    toolIds: ["google.drive.create"],
  },
  "inbox.read": {
    id: "inbox.read",
    name: "Read unified inbox",
    nameEs: "Leer inbox unificado",
    description: "Lee los elementos normalizados del inbox unificado.",
    provider: "google",
    toolIds: ["inbox.read"],
  },
  "inbox.classify": {
    id: "inbox.classify",
    name: "Classify inbox item",
    nameEs: "Clasificar elemento del inbox",
    description: "Determina la categoría de negocio de un elemento.",
    provider: "google",
    toolIds: ["inbox.classify"],
  },
  "inbox.work.create": {
    id: "inbox.work.create",
    name: "Create work from inbox",
    nameEs: "Crear trabajo desde inbox",
    description:
      "Convierte un elemento del inbox en un DepartmentTask durable.",
    provider: "google",
    toolIds: ["inbox.work.create"],
  },
  ...Object.fromEntries(
    ADS_CAPABILITIES.map((capability) => [
      capability.id,
      adsCapabilityDescriptor(capability),
    ]),
  ),
};

function adsCapabilityDescriptor(capability: AdsCapabilityDefinition): CapabilityDescriptor {
  const provider = capability.platform === "meta"
    ? "meta_ads"
    : capability.platform === "tiktok"
      ? "tiktok_ads"
      : capability.sideEffect
        ? "google_ads_api"
        : "google_ads";
  return {
    id: capability.id,
    name: capability.description,
    nameEs: capability.description,
    description: capability.description,
    provider,
    toolIds: [capability.id],
  };
}

export interface CapabilityAvailability {
  readonly capability: BusinessCapability;
  readonly available: boolean;
  readonly provider: CredentialProvider;
  readonly reason: "available" | "credentials_missing" | "unsupported_provider";
}

/**
 * Per-organization availability check. Today the resolver is
 * system-wide (env), so all orgs see the same availability. The
 * signature is per-org so a future per-org credential store slots
 * in without changing callers.
 */
export function isCapabilityAvailable(
  organizationId: string,
  capability: BusinessCapability,
): CapabilityAvailability {
  void organizationId;
  const descriptor = CAPABILITY_REGISTRY[capability];
  if (!descriptor) {
    return {
      capability,
      available: false,
      provider: "mautic",
      reason: "unsupported_provider",
    };
  }
  if (!hasConfiguredCredentials(descriptor.provider)) {
    return {
      capability,
      available: false,
      provider: descriptor.provider,
      reason: "credentials_missing",
    };
  }
  return { capability, available: true, provider: descriptor.provider, reason: "available" };
}

/**
 * Bulk: returns the availability of every registered capability. The runtime
 * manifest applies the additional tenant-scoped filtering needed before this
 * surface reaches engine context.
 */
export function listAvailableCapabilities(organizationId: string): readonly CapabilityAvailability[] {
  return (Object.keys(CAPABILITY_REGISTRY) as BusinessCapability[]).map((cap) =>
    isCapabilityAvailable(organizationId, cap),
  );
}

/**
 * Filter to only those capabilities that are available. Useful when
 * passing the capability surface to Elvira: she only sees what she
 * can actually use.
 */
export function listReadyCapabilities(organizationId: string): readonly BusinessCapability[] {
  return listAvailableCapabilities(organizationId)
    .filter((c) => c.available)
    .map((c) => c.capability);
}
