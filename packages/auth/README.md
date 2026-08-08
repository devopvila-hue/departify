# Auth

Authentication and authorization boundary — Phase P0-A.

Framework-independent contracts and enforcement for identity and tenant
access:

- `AuthenticatedUser` / `AuthContext` / `OrganizationMembership`
- `AuthError` / `AuthorizationError` taxonomy (401 vs 403)
- `IdentityVerifier` / `MembershipResolver` ports
- `extractBearerToken` / `authenticateToken` / `assertOrganizationAccess`

The package holds no provider SDK and no HTTP layer. Supabase Auth is the
identity authority; the backend adapts it to these contracts. The browser is
never trusted to decide organization ownership.
