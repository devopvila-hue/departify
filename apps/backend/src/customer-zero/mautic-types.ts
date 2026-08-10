/**
 * Mautic normalized types — Customer Zero 01.
 *
 * Departify-owned domain types that the rest of the system consumes.
 * The Mautic adapter maps its raw API responses to these shapes; no
 * Mautic-specific field names leak past this file.
 *
 * Only fields actually verified to exist on the Customer Zero
 * instance are populated; the rest stay `undefined`.
 */

export interface CRMContact {
  /** Provider-stable id (Mautic contact id). */
  readonly id: number;
  /** Display name as the CEO would read it. */
  readonly displayName: string;
  /** Primary email, lower-cased. */
  readonly email?: string;
  /** Company name if Mautic has it. */
  readonly company?: string;
  /** Free-form tags from Mautic. */
  readonly tags?: readonly string[];
  /** Segment ids the contact belongs to. */
  readonly segments?: readonly number[];
  /** ISO 8601 created-at from Mautic (`dateAdded`). */
  readonly createdAt?: string;
  /** ISO 8601 last activity timestamp (`lastActive`). */
  readonly lastActivityAt?: string;
  /** Optional score (points) — only present when the field exists. */
  readonly score?: number;
  /** Optional lifecycle status (lead, customer, etc.). */
  readonly status?: string;
}

/** A paginated read of CRM contacts. */
export interface CRMContactPage {
  readonly total: number;
  readonly contacts: readonly CRMContact[];
  /** Next page offset (only present when more pages exist). */
  readonly nextOffset?: number;
}

export interface CRMSegment {
  readonly id: number;
  readonly name: string;
  readonly description?: string;
  readonly contactCount?: number;
}

export interface CRMCampaign {
  readonly id: number;
  readonly name: string;
  readonly description?: string;
  readonly status?: string;
  readonly isPublished?: boolean;
}

export interface CRMActivity {
  readonly id: number;
  readonly contactId: number;
  readonly type: string;
  readonly name: string;
  readonly timestamp: string;
  readonly details?: string;
}

export interface CRMSummary {
  readonly totalContacts: number;
  readonly totalSegments: number;
  readonly totalCampaigns: number;
  readonly contactsWithoutRecentActivity?: number;
  readonly topSegments?: readonly { id: number; name: string; count: number }[];
}
