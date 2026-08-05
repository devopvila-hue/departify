import type { FilterSet } from "../filters/filters.js";
import type { CursorPageRequest } from "../pagination/pagination.js";

export interface Specification<TCandidate> {
  readonly name: string;
  isSatisfiedBy(candidate: TCandidate): boolean;
}

export interface PersistenceSpecification<TCandidate> {
  readonly name: string;
  readonly filters?: FilterSet;
  readonly pagination?: CursorPageRequest;
  isSatisfiedBy?(candidate: TCandidate): boolean;
}

export type OrganizationSpecification<TCandidate> =
  PersistenceSpecification<TCandidate>;

export type WorkspaceSpecification<TCandidate> =
  PersistenceSpecification<TCandidate>;

export type ProvisioningSpecification<TCandidate> =
  PersistenceSpecification<TCandidate>;
