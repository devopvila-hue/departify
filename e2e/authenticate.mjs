import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = "https://app.departify.app";
const authStatePath = new URL("./.auth/production.json", import.meta.url)
  .pathname;
const email = process.env.DEPARTIFY_E2E_EMAIL;
const password = process.env.DEPARTIFY_E2E_PASSWORD;

await mkdir(new URL("./.auth", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
const loginHeading = page.getByRole("heading", { name: "Entra en tu empresa" });

if (await loginHeading.isVisible().catch(() => false)) {
  if (email && password) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
  } else {
    console.log("Se ha abierto la pantalla de login de Departify.");
    console.log(
      "Inicia sesión normalmente en la ventana y espera a que aparezca Tu empresa.",
    );
  }
  await loginHeading.waitFor({ state: "hidden", timeout: 300_000 });
  await page.waitForTimeout(1_500);
  if (await loginHeading.isVisible().catch(() => false)) {
    throw new Error(
      "El login no ha terminado. No se ha guardado ninguna sesión.",
    );
  }
}

await page.getByRole("navigation", { name: "Navegación principal" }).waitFor({
  state: "visible",
  timeout: 300_000,
});

await context.storageState({ path: authStatePath });

// Guardrail: refuse to save a session whose Supabase token is missing or
// already past `expires_at`. Without this, the OAuth-start E2E would
// silently POST without an Authorization header and fail with
// `401 missing_token` — exactly the false-positive we are closing.
const persistedSession = await page.evaluate(() => {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.endsWith("-auth-token")) continue;
    try {
      return JSON.parse(window.localStorage.getItem(key) || "");
    } catch {
      return null;
    }
  }
  return null;
});
const expiresAtMs = persistedSession?.expires_at
  ? persistedSession.expires_at * 1000
  : 0;
if (!persistedSession?.access_token || expiresAtMs < Date.now()) {
  throw new Error(
    "La sesión de Supabase no está disponible o ha caducado. Vuelve a iniciar sesión en la ventana.",
  );
}

console.log(`Sesión guardada localmente en ${authStatePath}.`);
await browser.close();
