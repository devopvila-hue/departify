import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../..", import.meta.url));
const renderer = join(root, "departify-engine/scripts/render-config.mjs");

function runRenderer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [renderer], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("founder-development keeps native OpenClaw compaction enabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "departify-render-config-"));
  const stateDir = join(directory, "state");
  const configPath = join(stateDir, "openclaw.json");
  const result = await runRenderer({
    PATH: process.env.PATH,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_TOKEN: "test-token",
    OPENCLAW_MODEL_PROVIDER: "minimax",
    OPENCLAW_MODEL_NAME: "MiniMax-M3",
    OPENCLAW_MODEL_API_KEY: "test-key",
    OPENCLAW_MODEL_BASE_URL: "https://example.invalid/v1",
    OPENCLAW_FALLBACK_PROVIDER: "disabled",
    DEPARTIFY_OPENCLAW_MODE: "founder-development",
  });

  assert.equal(result.code, 0, result.stderr);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.agents.defaults.compaction.enabled, undefined);
  assert.equal(config.agents.defaults.compaction.mode, "safeguard");
  assert.equal(config.agents.defaults.compaction.memoryFlush.enabled, false);
  assert.equal(config.agents.defaults.contextInjection, "continuation-skip");
  assert.equal(config.tools.profile, "full");
  assert.equal(config.tools.deny, undefined);
});
