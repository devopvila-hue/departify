import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = "https://app.departify.app";
const authStatePath = new URL("./.auth/production.json", import.meta.url)
  .pathname;
const email = process.env.DEPARTIFY_E2E_EMAIL;
const password = process.env.DEPARTIFY_E2E_PASSWORD;

await mkdir(new URL("./.auth", import.meta.url), { recursive: true });
console.log("Launching browser...");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

console.log("Navigating to URL...");
await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });

console.log("Waiting for app to load...");
const loginHeading = page.getByRole("heading", { name: "Entra en tu empresa" });
const navPrincipal = page.getByRole("navigation", { name: "Navegación principal" });

await Promise.race([
  loginHeading.waitFor({ state: "visible", timeout: 15_000 }).catch(() => null),
  navPrincipal.waitFor({ state: "visible", timeout: 15_000 }).catch(() => null),
]);

console.log("Checking if login heading is visible...");
if (await loginHeading.isVisible().catch(() => false)) {
  console.log("Login heading is visible!");
  if (email && password) {
    console.log(`Attempting login for email: ${email}`);
    await page.getByLabel("Email").fill(email);
    console.log("Filled email field.");
    await page.getByLabel("Contraseña").fill(password);
    console.log("Filled password field.");
    await page.getByRole("button", { name: "Entrar" }).click();
    console.log("Clicked Entrar button.");
  } else {
    console.log("Se ha abierto la pantalla de login de Departify.");
    console.log(
      "Inicia sesión normalmente en la ventana y espera a que aparezca Tu empresa.",
    );
  }
  console.log("Waiting for login heading to be hidden...");
  await loginHeading.waitFor({ state: "hidden", timeout: 15_000 }).catch((err) => {
    console.error("Timeout waiting for login heading to hide:", err.message);
  });
  await page.waitForTimeout(1_500);
  if (await loginHeading.isVisible().catch(() => false)) {
    throw new Error(
      "El login no ha terminado. No se ha guardado ninguna sesión.",
    );
  }
} else {
  console.log("Login heading not visible. Already logged in?");
}

console.log("Waiting for principal navigation to be visible...");
await page.getByRole("navigation", { name: "Navegación principal" }).waitFor({
  state: "visible",
  timeout: 15_000,
}).catch((err) => {
  console.error("Timeout waiting for navigation principal:", err.message);
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
