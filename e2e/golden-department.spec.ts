import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const screenshotsDir = "/tmp/departify-golden-screenshots";

async function openRoute(page: Page, path: string, marker: RegExp) {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(
    new RegExp(`${path.replaceAll("/", "\\/")}(?:[?#].*)?$`),
  );
  await expect(page.locator("body")).toContainText(marker);
  await expect(page.locator("body")).not.toContainText(
    /Unknown|undefined|OpenClaw|Activepieces|MCP/i,
  );
}

test.describe("Golden Department production acceptance", () => {
  test.beforeAll(async () => {
    await mkdir(screenshotsDir, { recursive: true });
  });

  test("CEO surfaces load with real business content", async ({ page }) => {
    await openRoute(page, "/empresa", /Empresa|Tu empresa/i);
    await page.screenshot({
      path: `${screenshotsDir}/empresa-${test.info().project.name}.png`,
      fullPage: true,
    });

    await openRoute(page, "/marketing", /Marketing|Elvira/i);
    await page.screenshot({
      path: `${screenshotsDir}/marketing-${test.info().project.name}.png`,
      fullPage: true,
    });

    await openRoute(page, "/seo", /SEO|Responsable de SEO/i);
    await page.screenshot({
      path: `${screenshotsDir}/seo-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("Connections exposes the canonical GitHub project and catalog", async ({
    page,
  }) => {
    await openRoute(
      page,
      "/conexiones",
      /Conexiones|GitHub|Proyecto de la web/i,
    );
    await expect(
      page.getByText("Proyecto de la web", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /github_repository|unknown/i,
    );
    await page.screenshot({
      path: `${screenshotsDir}/conexiones-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("Configuration exposes the provider-neutral capability setup", async ({
    page,
  }) => {
    await openRoute(page, "/configuracion", /Configuración/i);
    await expect(page.getByTestId("llm-settings")).toContainText(
      "Razonamiento de Departify",
    );
    await expect(page.getByLabel("Proveedor")).toHaveValue("openai");
    await expect(page.getByLabel("Modelo")).toHaveValue("gpt-4o-mini");
    await expect(
      page.getByRole("link", { name: /Obtener API key/i }),
    ).toHaveAttribute("href", "https://platform.openai.com/api-keys");
    await page.screenshot({
      path: `${screenshotsDir}/configuracion-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("Chat sends a real message and preserves the visible conversation", async ({
    page,
  }) => {
    await openRoute(
      page,
      "/chat",
      /Conversación continua|¿Qué quieres conseguir|conversación/i,
    );
    const scroller = page.getByTestId("chat-scroller");
    await expect(scroller).toBeVisible();
    await page.screenshot({
      path: `${screenshotsDir}/chat-before-${test.info().project.name}.png`,
      fullPage: true,
    });

    const composer = page.getByPlaceholder(
      "Pregunta o pide algo a tu empresa…",
    );
    await composer.fill("¿Qué está disponible ahora mismo?");
    await page.getByRole("button", { name: /Enviar/i }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Departify está pensando/i }),
    )
      .toBeVisible()
      .catch(() => undefined);
    await expect(composer).toHaveValue("");
    await expect(page.locator(".dfy-thread")).toContainText(
      "¿Qué está disponible ahora mismo?",
      { timeout: 60_000 },
    );
    await expect(page.locator(".dfy-thread")).toHaveCount(1);

    const viewport = await scroller.evaluate((element) => ({
      top: element.scrollTop,
      distance: element.scrollHeight - element.scrollTop - element.clientHeight,
      overflow: element.scrollHeight > element.clientHeight,
    }));
    expect(viewport.distance).toBeLessThan(120);
    await page.screenshot({
      path: `${screenshotsDir}/chat-after-${test.info().project.name}.png`,
      fullPage: true,
    });

    if (viewport.overflow) {
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll"));
      });
      await expect(page.getByTestId("chat-jump-latest")).toBeVisible();
      const beforeJump = await scroller.evaluate(
        (element) => element.scrollTop,
      );
      expect(beforeJump).toBeLessThan(80);
      await page.getByTestId("chat-jump-latest").click();
      await expect
        .poll(() =>
          scroller.evaluate(
            (element) =>
              element.scrollHeight - element.scrollTop - element.clientHeight,
          ),
        )
        .toBeLessThan(120);
    }
  });

  test("remaining operational routes render without internal infrastructure copy", async ({
    page,
  }) => {
    for (const [path, marker] of [
      ["/tareas", /Tareas/i],
      ["/inbox", /Inbox/i],
      ["/aprobaciones", /Aprobaciones/i],
      ["/resultados", /Resultados/i],
      ["/calendario", /Calendario/i],
    ] as const) {
      await openRoute(page, path, marker);
    }
  });
});
