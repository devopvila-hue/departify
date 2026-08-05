# Config

Shared configuration package boundary.

Golden Image rule: this package is the only authorized source for reading runtime configuration.

Application code must not read `process.env` directly. Node runtimes use `loadBackendConfig()`, and tests may pass an explicit environment record for deterministic validation.

No provider clients, credentials, network calls, database connections, or product behavior are implemented here.
