# Capability Truth Implementation Summary

## Problem
The query "tienes el pat en env file sigue valido" triggered a generic failure because:
1. GitHub integration EXISTS (seo-repository.ts, external-oauth-tokens.ts) but was NOT exposed as capabilities
2. The capability registry had NO GitHub capabilities
3. The engine had NO GitHub context in its runtime business context
4. When the engine couldn't process the message, it returned empty/failed → generic error fallback

## Solution
Added GitHub capabilities to the capability system and implemented execution-first policy for capability queries.

## Changes Made

### 1. Capability Registry (`capability-registry.ts`)
- Added `"github"` to `CredentialProvider` type
- Added `"github.repository.read"` and `"github.repository.write"` to `BusinessCapability` type
- Added capability descriptors for both GitHub capabilities

### 2. Credential Resolver (`credential-resolver.ts`)
- Added `"github"` to `CredentialProvider` type
- Added `resolveGitHubCredentials()` function to resolve GitHub credentials from external OAuth token store
- Added `hasGitHubCredentials()` function to check if GitHub credentials exist
- Added GitHub credential type to `ResolvedCredential` type
- Updated `hasConfiguredCredentials()` to return `false` for GitHub (async check required)

### 3. Department Context Compiler (`department-context-compiler.ts`)
- Added GitHub capabilities to execution truth section in both `renderRuntimeBusinessContextForEngine()` and `renderRuntimeBusinessContextForNativeEngine()`

### 4. Native Business Tools (`native-business-tools.ts`)
- Added `"departify.github.repos.list"` and `"departify.github.repos.inspect"` to `NATIVE_READ_TOOL_NAMES`
- Added required capability mappings for both tools

### 5. Capability Manifest (`capability-manifest.ts`)
- Added `"repository.read"` and `"repository.write"` to `RUNTIME_CAPABILITY_RULES`

### 6. Response Sanitizer (`response-sanitizer.ts`)
- Added `sanitizeToolError()` function to prevent internal leakage in tool errors
- Removes internal paths, stack traces, env vars, and sensitive details

### 7. Customer Zero V2 (`customer-zero-v2.ts`)
- Added capability query detection for GitHub and credential queries
- Added deterministic responses for capability queries (connected/not connected)

### 8. Tests (`test/capability-truth.test.ts`)
- Added tests for GitHub capability availability
- Added tests for credential safety (no leakage)
- Added tests for execution-first policy
- Added tests for Product Identity Boundary

## Verification

1. **Typecheck**: ✅ Clean
2. **Build**: ✅ Clean
3. **Tests**: ✅ All 1335 tests passing (26 new tests)

## Expected Behavior

### Before
```
User: "tienes el pat en env file sigue valido"
Departify: "No pude completar esa solicitud. No se tomó ninguna acción — puedes intentarlo de nuevo o pedirme algo diferente."
```

### After (GitHub connected)
```
User: "tienes el pat en env file sigue valido"
Departify: "GitHub está conectado. Puedes listar tus repositorios o inspeccionarlos para problemas de SEO. ¿Qué quieres hacer?"
```

### After (GitHub not connected)
```
User: "tienes el pat en env file sigue valido"
Departify: "GitHub aún no está conectado. Puedes conectarlo desde la sección de Conexiones para acceder a tus repositorios."
```

## Security Boundary

### What NEVER leaks:
- GitHub PAT/token values
- Service account emails
- Runtime internal paths (/home/node, /Volumes)
- Environment variable names/values
- Stack traces
- MCP/Activepieces internals
- OpenClaw internals

### What CAN be shown:
- "GitHub is connected" / "GitHub is not connected"
- Repository names (public info)
- Capability status (available/not available)
- Generic error messages (no internal details)

## Next Steps

1. Deploy to production
2. Verify with Customer Zero E2E test
3. Monitor for any regressions
