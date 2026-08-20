/**
 * Sprint 67 P0.7 — Founder Build Executor tests.
 *
 * Tests the REAL privileged execution plane:
 * - Skill installation via OpenClaw native skill management
 * - Skill removal, update, listing, inspection
 * - URL domain validation
 * - Forbidden path detection
 * - Founder build command detection
 * - EngineAdapter integration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectFounderBuildCommand,
  isFounderBuildCommand,
  isAuthorizedSkillSource,
  containsForbiddenPath,
  FounderBuildExecutor,
} from "../src/customer-zero/founder-build-executor.js";
import type { EngineAdapter } from "@departify/engine-adapter";

// ---------------------------------------------------------------------------
// N1: detectFounderBuildCommand — skill installation
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.7 — Founder Build Executor", () => {
  describe("N1: detectFounderBuildCommand — skill installation", () => {
    it("should detect 'instala esta skill: https://...'", () => {
      const cmd = detectFounderBuildCommand(
        "instala esta skill: https://github.com/glebis/claude-skills/blob/main/pdf-generation/SKILL.md"
      );
      expect(cmd).not.toBeNull();
      expect(cmd?.type).toBe("install_skill");
      if (cmd?.type === "install_skill") {
        expect(cmd.url).toBe("https://github.com/glebis/claude-skills/blob/main/pdf-generation/SKILL.md");
      }
    });

    it("should detect 'install skill: https://...'", () => {
      const cmd = detectFounderBuildCommand(
        "install skill: https://example.com/SKILL.md"
      );
      expect(cmd?.type).toBe("install_skill");
    });

    it("should detect 'instala skill https://...'", () => {
      const cmd = detectFounderBuildCommand(
        "instala skill https://example.com/SKILL.md"
      );
      expect(cmd?.type).toBe("install_skill");
    });

    it("should detect 'descarga esta skill: https://...'", () => {
      const cmd = detectFounderBuildCommand(
        "descarga esta skill: https://example.com/SKILL.md"
      );
      expect(cmd?.type).toBe("install_skill");
    });

    it("should detect URL with SKILL.md without explicit 'skill' keyword", () => {
      const cmd = detectFounderBuildCommand(
        "instala https://github.com/glebis/claude-skills/blob/main/pdf-generation/SKILL.md"
      );
      expect(cmd?.type).toBe("install_skill");
    });
  });

  // ---------------------------------------------------------------------------
  // N2: detectFounderBuildCommand — skill removal
  // ---------------------------------------------------------------------------
  describe("N2: detectFounderBuildCommand — skill removal", () => {
    it("should detect 'elimina skill pdf-generation'", () => {
      const cmd = detectFounderBuildCommand("elimina skill pdf-generation");
      expect(cmd?.type).toBe("remove_skill");
      if (cmd?.type === "remove_skill") {
        expect(cmd.name).toBe("pdf-generation");
      }
    });

    it("should detect 'remove skill seo-audit'", () => {
      const cmd = detectFounderBuildCommand("remove skill seo-audit");
      expect(cmd?.type).toBe("remove_skill");
    });

    it("should detect 'desinstala skill analytics'", () => {
      const cmd = detectFounderBuildCommand("desinstala skill analytics");
      expect(cmd?.type).toBe("remove_skill");
    });
  });

  // ---------------------------------------------------------------------------
  // N3: detectFounderBuildCommand — skill update
  // ---------------------------------------------------------------------------
  describe("N3: detectFounderBuildCommand — skill update", () => {
    it("should detect 'actualiza skill pdf-generation'", () => {
      const cmd = detectFounderBuildCommand("actualiza skill pdf-generation");
      expect(cmd?.type).toBe("update_skill");
      if (cmd?.type === "update_skill") {
        expect(cmd.name).toBe("pdf-generation");
      }
    });

    it("should detect 'update skill seo-audit'", () => {
      const cmd = detectFounderBuildCommand("update skill seo-audit");
      expect(cmd?.type).toBe("update_skill");
    });
  });

  // ---------------------------------------------------------------------------
  // N4: detectFounderBuildCommand — list skills
  // ---------------------------------------------------------------------------
  describe("N4: detectFounderBuildCommand — list skills", () => {
    it("should detect 'lista las skills'", () => {
      const cmd = detectFounderBuildCommand("lista las skills");
      expect(cmd?.type).toBe("list_skills");
    });

    it("should detect 'list skills'", () => {
      const cmd = detectFounderBuildCommand("list skills");
      expect(cmd?.type).toBe("list_skills");
    });

    it("should detect 'muestra las skills'", () => {
      const cmd = detectFounderBuildCommand("muestra las skills");
      expect(cmd?.type).toBe("list_skills");
    });
  });

  // ---------------------------------------------------------------------------
  // N5: detectFounderBuildCommand — inspect skill
  // ---------------------------------------------------------------------------
  describe("N5: detectFounderBuildCommand — inspect skill", () => {
    it("should detect 'inspecciona skill pdf-generation'", () => {
      const cmd = detectFounderBuildCommand("inspecciona skill pdf-generation");
      expect(cmd?.type).toBe("inspect_skill");
      if (cmd?.type === "inspect_skill") {
        expect(cmd.name).toBe("pdf-generation");
      }
    });

    it("should detect 'inspect skill seo-audit'", () => {
      const cmd = detectFounderBuildCommand("inspect skill seo-audit");
      expect(cmd?.type).toBe("inspect_skill");
    });
  });

  // ---------------------------------------------------------------------------
  // N6: detectFounderBuildCommand — execute command
  // ---------------------------------------------------------------------------
  describe("N6: detectFounderBuildCommand — execute command", () => {
    it("should detect 'ejecuta: npm run build'", () => {
      const cmd = detectFounderBuildCommand("ejecuta: npm run build");
      expect(cmd?.type).toBe("execute_command");
      if (cmd?.type === "execute_command") {
        expect(cmd.command).toBe("npm run build");
      }
    });

    it("should detect 'run npm test'", () => {
      const cmd = detectFounderBuildCommand("run npm test");
      expect(cmd?.type).toBe("execute_command");
    });
  });

  // ---------------------------------------------------------------------------
  // N7: detectFounderBuildCommand — non-build messages
  // ---------------------------------------------------------------------------
  describe("N7: detectFounderBuildCommand — non-build messages", () => {
    it("should return null for 'hola'", () => {
      expect(detectFounderBuildCommand("hola")).toBeNull();
    });

    it("should return null for 'analiza el SEO de mi web'", () => {
      expect(detectFounderBuildCommand("analiza el SEO de mi web")).toBeNull();
    });

    it("should return null for 'cuántos contactos tengo'", () => {
      expect(detectFounderBuildCommand("cuántos contactos tengo")).toBeNull();
    });

    it("should return null for 'haz un PDF'", () => {
      expect(detectFounderBuildCommand("haz un PDF")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // N8: isFounderBuildCommand — fast check
  // ---------------------------------------------------------------------------
  describe("N8: isFounderBuildCommand — fast check", () => {
    it("should return true for skill install", () => {
      expect(isFounderBuildCommand("instala skill https://example.com/SKILL.md")).toBe(true);
    });

    it("should return false for business messages", () => {
      expect(isFounderBuildCommand("analiza mi marketing")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N9: isAuthorizedSkillSource — domain validation
  // ---------------------------------------------------------------------------
  describe("N9: isAuthorizedSkillSource — domain validation", () => {
    it("should allow github.com URLs", () => {
      expect(isAuthorizedSkillSource("https://github.com/glebis/claude-skills/blob/main/SKILL.md")).toBe(true);
    });

    it("should allow raw.githubusercontent.com URLs", () => {
      expect(isAuthorizedSkillSource("https://raw.githubusercontent.com/glebis/claude-skills/main/SKILL.md")).toBe(true);
    });

    it("should allow gitlab.com URLs", () => {
      expect(isAuthorizedSkillSource("https://gitlab.com/user/repo/-/raw/main/SKILL.md")).toBe(true);
    });

    it("should allow clawhub.ai URLs", () => {
      expect(isAuthorizedSkillSource("https://clawhub.ai/skills/pdf-generation")).toBe(true);
    });

    it("should block unknown domains", () => {
      expect(isAuthorizedSkillSource("https://evil.com/malware/SKILL.md")).toBe(false);
    });

    it("should block malformed URLs", () => {
      expect(isAuthorizedSkillSource("not-a-url")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N10: containsForbiddenPath — path safety
  // ---------------------------------------------------------------------------
  describe("N10: containsForbiddenPath — path safety", () => {
    it("should detect /opt/moon-ai", () => {
      expect(containsForbiddenPath("cat /opt/moon-ai/config.json")).toBe(true);
    });

    it("should detect nivel-oculto", () => {
      expect(containsForbiddenPath("ls nivel-oculto")).toBe(true);
    });

    it("should detect /root/.ssh", () => {
      expect(containsForbiddenPath("cat /root/.ssh/id_rsa")).toBe(true);
    });

    it("should allow safe commands", () => {
      expect(containsForbiddenPath("npm run build")).toBe(false);
    });

    it("should allow openclaw commands", () => {
      expect(containsForbiddenPath("openclaw skills list")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N11: FounderBuildExecutor — constructor
  // ---------------------------------------------------------------------------
  describe("N11: FounderBuildExecutor — constructor", () => {
    it("should create executor with engine adapter", () => {
      const mockEngine = {
        sendMessage: vi.fn().mockResolvedValue({ text: "ok", status: "completed" }),
        createSession: vi.fn().mockResolvedValue({ sessionId: "test-session" }),
        getSession: vi.fn().mockResolvedValue(null),
        getHistory: vi.fn().mockResolvedValue({ messages: [] }),
        closeSession: vi.fn().mockResolvedValue(undefined),
        getUsage: vi.fn().mockResolvedValue({ tokens: 0 }),
        getToolState: vi.fn().mockResolvedValue({ tools: [] }),
        health: vi.fn().mockResolvedValue({ status: "ok" }),
      } satisfies EngineAdapter;

      const executor = new FounderBuildExecutor(mockEngine);
      expect(executor).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // N12: FounderBuildExecutor — install sends to OpenClaw
  // ---------------------------------------------------------------------------
  describe("N12: FounderBuildExecutor — install sends to OpenClaw", () => {
    it("should send install command to OpenClaw via EngineAdapter", async () => {
      const sendMessage = vi.fn().mockResolvedValue({
        text: 'Skill "pdf-generation" instalada correctamente.',
        status: "completed",
      });
      const createSession = vi.fn().mockResolvedValue({ id: "founder-session-1" });

      const mockEngine = {
        sendMessage,
        createSession,
        getSession: vi.fn().mockResolvedValue(null),
        getHistory: vi.fn().mockResolvedValue({ messages: [] }),
        closeSession: vi.fn().mockResolvedValue(undefined),
        getUsage: vi.fn().mockResolvedValue({ tokens: 0 }),
        getToolState: vi.fn().mockResolvedValue({ tools: [] }),
        health: vi.fn().mockResolvedValue({ status: "ok" }),
      } satisfies EngineAdapter;

      const executor = new FounderBuildExecutor(mockEngine);
      const result = await executor.execute(
        {
          type: "install_skill",
          url: "https://github.com/glebis/claude-skills/blob/main/pdf-generation/SKILL.md",
        },
        "org-123",
        "user-456",
      );

      // Should succeed
      expect(result.success).toBe(true);
      expect(result.message).toContain("pdf-generation");

      // Should create a session
      expect(createSession).toHaveBeenCalledWith({ agentId: "main" });

      // Should send message to OpenClaw
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "founder-session-1",
          nativeBusinessTools: false,
        })
      );

      // Message should contain the converted raw URL (github.com/blob → raw.githubusercontent.com)
      const sentMessage = sendMessage.mock.calls[0]?.[0]?.message;
      expect(sentMessage).toContain("https://raw.githubusercontent.com/glebis/claude-skills/main/pdf-generation/SKILL.md");
      expect(sentMessage).toContain("FOUNDER BUILD MODE");
    });

    it("should reject unauthorized domains", async () => {
      const mockEngine = {
        sendMessage: vi.fn(),
        createSession: vi.fn(),
        getSession: vi.fn(),
        getHistory: vi.fn(),
        closeSession: vi.fn(),
        getUsage: vi.fn(),
        getToolState: vi.fn(),
        health: vi.fn(),
      } satisfies EngineAdapter;

      const executor = new FounderBuildExecutor(mockEngine);
      const result = await executor.execute(
        {
          type: "install_skill",
          url: "https://evil.com/malware/SKILL.md",
        },
        "org-123",
        "user-456",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("no autorizado");
      // Should NOT send to OpenClaw
      expect(mockEngine.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // N13: FounderBuildExecutor — list sends to OpenClaw
  // ---------------------------------------------------------------------------
  describe("N13: FounderBuildExecutor — list sends to OpenClaw", () => {
    it("should send list command to OpenClaw", async () => {
      const sendMessage = vi.fn().mockResolvedValue({
        text: "Skills instaladas (2):\n- pdf-generation: Professional PDF generation\n- seo-audit: SEO audit tool",
        status: "completed",
      });
      const createSession = vi.fn().mockResolvedValue({ id: "founder-session-1" });

      const mockEngine = {
        sendMessage,
        createSession,
        getSession: vi.fn().mockResolvedValue(null),
        getHistory: vi.fn().mockResolvedValue({ messages: [] }),
        closeSession: vi.fn().mockResolvedValue(undefined),
        getUsage: vi.fn().mockResolvedValue({ tokens: 0 }),
        getToolState: vi.fn().mockResolvedValue({ tools: [] }),
        health: vi.fn().mockResolvedValue({ status: "ok" }),
      } satisfies EngineAdapter;

      const executor = new FounderBuildExecutor(mockEngine);
      const result = await executor.execute(
        { type: "list_skills" },
        "org-123",
        "user-456",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("pdf-generation");
      expect(result.message).toContain("seo-audit");

      // Should send to OpenClaw
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          nativeBusinessTools: false,
        })
      );

      const sentMessage = sendMessage.mock.calls[0]?.[0]?.message;
      expect(sentMessage).toContain("list");
    });
  });

  // ---------------------------------------------------------------------------
  // N14: FounderBuildExecutor — forbidden path in command
  // ---------------------------------------------------------------------------
  describe("N14: FounderBuildExecutor — forbidden path in command", () => {
    it("should reject commands with forbidden paths", async () => {
      const mockEngine = {
        sendMessage: vi.fn(),
        createSession: vi.fn(),
        getSession: vi.fn(),
        getHistory: vi.fn(),
        closeSession: vi.fn(),
        getUsage: vi.fn(),
        getToolState: vi.fn(),
        health: vi.fn(),
      } satisfies EngineAdapter;

      const executor = new FounderBuildExecutor(mockEngine);
      const result = await executor.execute(
        { type: "execute_command", command: "cat /opt/moon-ai/config.json" },
        "org-123",
        "user-456",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("prohibida");
      expect(mockEngine.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // N15: FounderBuildExecutor — session reuse
  // ---------------------------------------------------------------------------
  describe("N15: FounderBuildExecutor — session reuse", () => {
    it("should reuse existing session for same org+user", async () => {
      const sendMessage = vi.fn().mockResolvedValue({
        text: "ok",
        status: "completed",
      });
      const createSession = vi.fn().mockResolvedValue({ id: "founder-session-1" });

      const mockEngine = {
        sendMessage,
        createSession,
        getSession: vi.fn().mockResolvedValue(null),
        getHistory: vi.fn().mockResolvedValue({ messages: [] }),
        closeSession: vi.fn().mockResolvedValue(undefined),
        getUsage: vi.fn().mockResolvedValue({ tokens: 0 }),
        getToolState: vi.fn().mockResolvedValue({ tools: [] }),
        health: vi.fn().mockResolvedValue({ status: "ok" }),
      } satisfies EngineAdapter;

      const executor = new FounderBuildExecutor(mockEngine);

      // First call creates session
      await executor.execute({ type: "list_skills" }, "org-123", "user-456");
      expect(createSession).toHaveBeenCalledTimes(1);

      // Second call reuses session
      await executor.execute({ type: "list_skills" }, "org-123", "user-456");
      expect(createSession).toHaveBeenCalledTimes(1); // Not called again

      // Different org creates new session
      await executor.execute({ type: "list_skills" }, "org-789", "user-456");
      expect(createSession).toHaveBeenCalledTimes(2);
    });
  });
});
