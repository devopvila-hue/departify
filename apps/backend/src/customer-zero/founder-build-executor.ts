/**
 * Sprint 67 P0.7 — Founder Build Executor
 *
 * REAL privileged execution plane for Founder Build Mode.
 * Bypasses Marketing/SEO/Elvira entirely and executes build commands
 * directly through OpenClaw's native capabilities.
 *
 * Architecture:
 * - Founder commands are sent to OpenClaw via EngineAdapter
 * - OpenClaw (in founder-development mode) has tools.profile="full"
 *   with exec.security="full" — it can run shell commands, write files,
 *   and manage skills natively via `openclaw skills install`
 * - No parallel skill management — we use OpenClaw's native mechanism
 * - Workspace boundary enforcement happens BEFORE sending to OpenClaw
 *
 * Why NOT write files from Departify:
 * - OpenClaw runs in a Railway container with its own filesystem
 * - Skills must be in OpenClaw's workspace ({STATE_DIR}/workspace/skills/)
 * - OpenClaw's file watcher auto-discovers skills (250ms debounce)
 * - Departify writing to host paths doesn't reach OpenClaw's container
 */

import type { EngineAdapter, EngineMessageResult } from "@departify/engine-adapter";
import { OpenClawEngineAdapter } from "@departify/engine-adapter";

/** Workspace paths the founder is authorized to modify (URLs, not filesystem). */
const AUTHORIZED_WORKSPACE_DOMAINS = [
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "clawhub.ai",
] as const;

/** Paths that must NEVER be referenced in commands. */
const FORBIDDEN_PATH_PATTERNS = [
  "/opt/moon-ai",
  "/root/openclaw-mission-control",
  "nivel-oculto",
  "/root/.ssh",
  "/etc/passwd",
  "/etc/shadow",
] as const;

/** Result of a founder build command execution. */
export interface FounderBuildResult {
  readonly success: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly skillInstalled?: string;
  readonly operation?: string;
}

/** Founder build command types. */
export type FounderBuildCommand =
  | { type: "install_skill"; url: string; name?: string }
  | { type: "remove_skill"; name: string }
  | { type: "update_skill"; name: string }
  | { type: "list_skills" }
  | { type: "inspect_skill"; name: string }
  | { type: "execute_command"; command: string }
  | { type: "chat"; message: string };

/**
 * Detects founder build commands from natural language messages.
 * Returns null if the message is not a founder build command.
 */
export function detectFounderBuildCommand(message: string): FounderBuildCommand | null {
  const lower = message.toLocaleLowerCase("es-ES");

  // Skill installation from URL
  const installMatch = message.match(
    /(?:instala|instalar|install|agrega|agregar|add|descarga|download)\s+(?:esta?\s+)?skill\s*[:\s]+(https?:\/\/\S+)/i
  );
  if (installMatch?.[1]) {
    return { type: "install_skill", url: installMatch[1] };
  }

  // Skill installation from URL without explicit "skill" keyword
  const urlMatch = message.match(
    /(?:instala|instalar|install|agrega|agregar|add)\s+(https?:\/\/\S+(?:SKILL\.md|skill\.md))/i
  );
  if (urlMatch?.[1]) {
    return { type: "install_skill", url: urlMatch[1] };
  }

  // Skill removal
  const removeMatch = message.match(
    /(?:elimina|eliminar|remove|desinstala|desinstalar|uninstall|borra|borrar|delete)\s+(?:la?\s+)?skill\s+(\S+)/i
  );
  if (removeMatch?.[1]) {
    return { type: "remove_skill", name: removeMatch[1] };
  }

  // Skill update
  const updateMatch = message.match(
    /(?:actualiza|actualizar|update|upgrade)\s+(?:la?\s+)?skill\s+(\S+)/i
  );
  if (updateMatch?.[1]) {
    return { type: "update_skill", name: updateMatch[1] };
  }

  // List skills
  if (/\b(?:lista|list|enumera|enumera|muestra|show)\s+(?:las?\s+)?skills?\b/i.test(message)) {
    return { type: "list_skills" };
  }

  // Inspect skill
  const inspectMatch = message.match(
    /(?:inspecciona|inspeccionar|inspect|revisa|revisar|check|detalla|detallar)\s+(?:la?\s+)?skill\s+(\S+)/i
  );
  if (inspectMatch?.[1]) {
    return { type: "inspect_skill", name: inspectMatch[1] };
  }

  // Execute command (shell/exec)
  const execMatch = message.match(
    /(?:ejecuta|ejecutar|execute|run|corre|correr)\s*[:\s]+(.+)/i
  );
  if (execMatch?.[1]) {
    return { type: "execute_command", command: execMatch[1] };
  }

  // Build-specific commands
  if (/\b(?:build|compila|compilar|compile|construye|construir)\b/i.test(lower)) {
    return { type: "execute_command", command: message };
  }

  return null;
}

/**
 * Validates that a URL references an authorized domain.
 */
export function isAuthorizedSkillSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return AUTHORIZED_WORKSPACE_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

/**
 * Validates that a command doesn't reference forbidden paths.
 */
export function containsForbiddenPath(command: string): boolean {
  return FORBIDDEN_PATH_PATTERNS.some((pattern) =>
    command.includes(pattern)
  );
}

/**
 * Founder Build Executor — handles privileged execution plane commands.
 *
 * ALL operations go through OpenClaw via EngineAdapter.
 * OpenClaw (in founder-development mode) has:
 * - tools.profile: "full"
 * - exec.security: "full" (can run any shell command)
 * - write/edit/fs access
 * - native `openclaw skills install` CLI
 *
 * This class:
 * 1. Validates inputs (URL, path boundaries)
 * 2. Constructs the appropriate command for OpenClaw
 * 3. Sends it via EngineAdapter with founder-specific context
 * 4. Returns the result
 */
export class FounderBuildExecutor {
  private readonly engine: EngineAdapter;
  private readonly founderSessions = new Map<string, string>();

  constructor(engine: EngineAdapter) {
    this.engine = engine;
  }

  /**
   * Try to call OpenClaw gateway RPC directly (bypasses LLM).
   * Returns null if the engine doesn't support raw RPC.
   */
  private async tryDirectRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown | null> {
    if (this.engine instanceof OpenClawEngineAdapter) {
      try {
        return await this.engine.requestRpc(method, params);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Execute a founder build command.
   */
  async execute(
    command: FounderBuildCommand,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    switch (command.type) {
      case "install_skill":
        return this.installSkill(command.url, command.name, organizationId, userId);
      case "remove_skill":
        return this.removeSkill(command.name, organizationId, userId);
      case "update_skill":
        return this.updateSkill(command.name, organizationId, userId);
      case "list_skills":
        return this.listSkills(organizationId, userId);
      case "inspect_skill":
        return this.inspectSkill(command.name, organizationId, userId);
      case "execute_command":
        return this.executeCommand(command.command, organizationId, userId);
      case "chat":
        return this.founderChat(command.message, organizationId, userId);
    }
  }

  /**
   * Install a skill via OpenClaw's native skill management.
   *
   * OpenClaw handles:
   * - Downloading from the source URL
   * - Parsing SKILL.md frontmatter
   * - Writing to {workspace}/skills/
   * - Auto-discovery via file watcher (250ms debounce)
   *
   * We validate the URL domain before sending to OpenClaw.
   */
  private async installSkill(
    url: string,
    name: string | undefined,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    // Validate URL domain
    if (!isAuthorizedSkillSource(url)) {
      return {
        success: false,
        message: `Dominio no autorizado. Solo se permiten: ${AUTHORIZED_WORKSPACE_DOMAINS.join(", ")}`,
      };
    }

    // Convert GitHub blob URLs to raw URLs for download
    let downloadUrl = url;
    if (url.includes("github.com") && url.includes("/blob/")) {
      downloadUrl = url
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    // Construct the OpenClaw command
    const nameFlag = name ? ` --as ${name}` : "";
    const command = `Install the skill from ${downloadUrl} using: openclaw skills install ${downloadUrl}${nameFlag}\n\nIf that command is not available, download the SKILL.md from ${downloadUrl}, parse its frontmatter for the name field, and write it to the workspace skills directory. Then confirm the skill was installed and show its name and description from the frontmatter.`;

    return this.sendToOpenClaw(command, organizationId, userId, "install_skill");
  }

  /**
   * Remove a skill via OpenClaw.
   */
  private async removeSkill(
    name: string,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    if (containsForbiddenPath(name)) {
      return {
        success: false,
        message: "Nombre de skill contiene ruta prohibida.",
      };
    }

    const command = `Remove the skill "${name}" from the workspace. Use: openclaw skills uninstall ${name}\n\nIf that command is not available, find and delete the skill file from the workspace skills directory. Confirm the removal.`;

    return this.sendToOpenClaw(command, organizationId, userId, "remove_skill");
  }

  /**
   * Update a skill via OpenClaw.
   */
  private async updateSkill(
    name: string,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    const command = `Update the skill "${name}" to its latest version. Use: openclaw skills update ${name}\n\nIf that command is not available, find the skill's source URL in its frontmatter and re-install it. Confirm the update.`;

    return this.sendToOpenClaw(command, organizationId, userId, "update_skill");
  }

  /**
   * List installed skills via OpenClaw.
   *
   * Prefers direct gateway RPC (skills.status, ~50ms) over LLM routing
   * (~69s) for this deterministic operation.
   */
  private async listSkills(
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    // Try direct RPC first — deterministic, fast (~50ms)
    const directResult = await this.tryDirectRpc("skills.status", {});
    if (directResult && typeof directResult === "object") {
      const skills = (directResult as { skills?: unknown[] }).skills ?? [];
      if (Array.isArray(skills)) {
        console.info("[founder-build] listSkills via direct RPC", { skillCount: skills.length });
        const lines = skills.map((s: unknown, i: number) => {
          const skill = s as { name?: string; description?: string; enabled?: boolean };
          const name = skill.name ?? "unknown";
          const desc = skill.description ?? "Sin descripción";
          const status = skill.enabled === false ? " (deshabilitada)" : "";
          return `${i +1}. **${name}**${status}: ${desc}`;
        });
        const message = skills.length ===0
          ? "No hay skills instaladas actualmente."
          : `**Skills instaladas (${skills.length}):**\n\n${lines.join("\n")}`;
        return { success: true, message, operation: "list_skills" };
      }
    }

    // Fallback: send through LLM (slower, but works if RPC unavailable)
    console.info("[founder-build] listSkills falling back to LLM (direct RPC unavailable)");
    const command = `List all installed skills. Use: openclaw skills list\n\nIf that command is not available, list all SKILL.md files in the workspace skills directory and parse their frontmatter (name, description). Return a formatted list.`;
    return this.sendToOpenClaw(command, organizationId, userId, "list_skills");
  }

  /**
   * Inspect a specific skill via OpenClaw.
   *
   * Prefers direct gateway RPC (skills.status with filter) over LLM routing.
   */
  private async inspectSkill(
    name: string,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    // Try direct RPC first — deterministic, fast
    const directResult = await this.tryDirectRpc("skills.status", {});
    if (directResult && typeof directResult === "object") {
      const skills = (directResult as { skills?: unknown[] }).skills ?? [];
      if (Array.isArray(skills)) {
        const skill = skills.find((s: unknown) => {
          const sk = s as { name?: string };
          return sk.name?.toLowerCase() === name.toLowerCase();
        });
        if (skill) {
          console.info("[founder-build] inspectSkill via direct RPC", { name });
          const sk = skill as { name?: string; description?: string; version?: string; author?: string; enabled?: boolean; source?: string };
          const lines = [
            `**${sk.name ?? name}**`,
            sk.description ? `Descripción: ${sk.description}` : null,
            sk.version ? `Versión: ${sk.version}` : null,
            sk.author ? `Autor: ${sk.author}` : null,
            sk.source ? `Fuente: ${sk.source}` : null,
            sk.enabled === false ? "Estado: deshabilitada" : "Estado: habilitada",
          ].filter(Boolean);
          return { success: true, message: lines.join("\n"), operation: "inspect_skill" };
        }
        console.info("[founder-build] inspectSkill: skill not found via RPC", { name, available: skills.map((s: unknown) => (s as { name?: string }).name) });
        return {
          success: false,
          message: `Skill "${name}" no encontrada. Skills disponibles: ${skills.map((s: unknown) => (s as { name?: string }).name ?? "unknown").join(", ")}`,
          operation: "inspect_skill",
        };
      }
    }

    // Fallback: send through LLM
    console.info("[founder-build] inspectSkill falling back to LLM", { name });
    const command = `Inspect the skill "${name}". Show its full SKILL.md content, including frontmatter metadata (name, description, version, author) and the complete instruction body.`;
    return this.sendToOpenClaw(command, organizationId, userId, "inspect_skill");
  }

  /**
   * Execute a command through OpenClaw's privileged execution plane.
   */
  private async executeCommand(
    command: string,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    if (containsForbiddenPath(command)) {
      return {
        success: false,
        message: "Comando contiene ruta prohibida.",
      };
    }

    return this.sendToOpenClaw(command, organizationId, userId, "execute_command");
  }

  /**
   * Founder chat — send a message to OpenClaw with founder privileges.
   */
  private async founderChat(
    message: string,
    organizationId: string,
    userId: string,
  ): Promise<FounderBuildResult> {
    return this.sendToOpenClaw(message, organizationId, userId, "chat");
  }

  /**
   * Send a message to OpenClaw via EngineAdapter with founder context.
   *
   * This is the core execution path. All founder build commands go through
   * OpenClaw's native capabilities (exec, write, skills CLI).
   */
  private async sendToOpenClaw(
    message: string,
    organizationId: string,
    userId: string,
    commandType: string,
  ): Promise<FounderBuildResult> {
    console.info("[founder-build] sendToOpenClaw (LLM path)", { commandType, organizationId });
    try {
      const session = await this.ensureFounderSession(organizationId, userId);
      const result = await this.engine.sendMessage({
        sessionId: session,
        message: `[FOUNDER BUILD MODE — ${commandType}]\n\n${message}`,
        runtimeContext: this.buildFounderContext(organizationId),
        nativeBusinessTools: false, // Business tools disabled in build mode
      });

      console.info("[founder-build] sendToOpenClaw completed", {
        commandType,
        status: result.status,
        textLength: result.text?.length ?? 0,
      });

      // Sprint 67 P0.7 — NO fallback text. If OpenClaw returned empty,
      // surface the error explicitly instead of fabricating success.
      if (!result.text) {
        const code = (result as { errorCode?: string }).errorCode ?? "EMPTY_RESPONSE";
        console.error("[founder-build] OpenClaw returned no text", {
          commandType,
          status: result.status,
          errorCode: code,
        });
        return {
          success: false,
          message: `Error: OpenClaw no generó respuesta (status: ${result.status}, code: ${code}).`,
          details: { status: result.status, commandType, sessionId: session },
        };
      }

      return {
        success: result.status === "completed",
        message: result.text,
        details: {
          status: result.status,
          commandType,
          sessionId: session,
        },
      };
    } catch (error) {
      console.error("[founder-build] sendToOpenClaw failed", {
        commandType,
        errorType: error instanceof Error ? error.constructor.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: `Error ejecutando comando: ${error instanceof Error ? error.message : String(error)}`,
        details: { commandType, error: String(error) },
      };
    }
  }

  /**
   * Ensure a persistent engine session for founder build mode.
   */
  private async ensureFounderSession(
    organizationId: string,
    userId: string,
  ): Promise<string> {
    const key = `${organizationId}:founder:${userId}`;
    const existing = this.founderSessions.get(key);
    if (existing) return existing;

    const session = await this.engine.createSession({
      agentId: "main",
    });
    this.founderSessions.set(key, session.id);
    return session.id;
  }

  /**
   * Build the founder-specific runtime context for OpenClaw.
   *
   * This context tells the LLM it's in Founder Build Mode with full
   * filesystem and exec access. Business tools are disabled.
   */
  private buildFounderContext(organizationId: string): string {
    return [
      "=== FOUNDER BUILD MODE ===",
      `Organization: ${organizationId}`,
      "Mode: FOUNDER_BUILD (privileged development environment)",
      "",
      "You are in Founder Build Mode. You have FULL access to:",
      "- Shell execution (exec tool)",
      "- File system (read, write, edit)",
      "- Skill management (openclaw skills install/list/uninstall)",
      "- Build tools (npm, node, git, etc.)",
      "",
      "Authorized domains for skill sources:",
      "- github.com, raw.githubusercontent.com, gitlab.com, clawhub.ai",
      "",
      "NEVER touch these paths:",
      "- /opt/moon-ai, /root/openclaw-mission-control, nivel-oculto",
      "",
      "Business tools (Marketing, SEO, etc.) are DISABLED.",
      "Focus on build and development tasks only.",
      "When installing skills, use: openclaw skills install <url>",
      "When listing skills, use: openclaw skills list",
      "=== END FOUNDER BUILD MODE ===",
    ].join("\n");
  }
}

/**
 * Check if a message is a founder build command (fast, no I/O).
 */
export function isFounderBuildCommand(message: string): boolean {
  return detectFounderBuildCommand(message) !== null;
}
