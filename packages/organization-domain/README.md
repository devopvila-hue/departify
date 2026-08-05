# Organization Domain

`@departify/organization-domain` is the canonical, provider-independent domain model for an organization in Departify.

It contains the `Organization` aggregate root, domain value objects, domain events, lifecycle policy, and pure domain validations. It does not contain persistence, application services, adapters, provider SDKs, environment access, or product features.

The Provisioning Engine remains the only authorized boundary for orchestrating organization creation. Future persistence must adapt to this domain model, never the opposite.
