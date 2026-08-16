import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = "https://app.departify.app";
const authStatePath = new URL("./.auth/production.json", import.meta.url);
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

await context.storageState({ path: authStatePath });
console.log(`Sesión guardada localmente en ${authStatePath.pathname}.`);
await browser.close();
