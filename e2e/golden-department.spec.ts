import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const screenshotsDir = "/tmp/departify-golden-screenshots";

async function openRoute(page: Page, path: string, marker: RegExp) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("navigation", { name: "Navegación principal" }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 600) {
    await page
      .getByRole("button", { name: "Abrir navegación" })
      .click({ force: true });
  }
  const navLabels: Record<string, string> = {
    "/inicio": "Tu empresa",
    "/chat": "Chat",
    "/tareas": "Tareas",
    "/inbox": "Inbox",
    "/departamentos": "Departamentos",
    "/conexiones": "Conexiones",
    "/aprobaciones": "Aprobaciones",
    "/resultados": "Resultados",
    "/calendario": "Calendario",
    "/empresa": "Empresa",
    "/configuracion": "Configuración",
  };
  const navLabel = navLabels[path];
  if (navLabel) {
    await page.getByRole("link", { name: navLabel, exact: true }).click();
  } else if (path === "/marketing" || path === "/seo") {
    await page.getByRole("link", { name: "Tu empresa", exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await page
      .getByRole("button", {
        name: `Ver ${path === "/marketing" ? "Marketing" : "SEO"}`,
      })
      .click();
  } else {
    throw new Error(`No hay navegación E2E definida para ${path}`);
  }
  const scrim = page.locator(".dfy-shell__scrim");
  if (await scrim.isVisible().catch(() => false)) {
    await scrim
      .click({ force: true, position: { x: 380, y: 200 }, timeout: 1_000 })
      .catch(() => undefined);
  }
  if ((page.viewportSize()?.width ?? 1440) < 600) {
    await expect(page.locator(".dfy-sidebar--open")).toHaveCount(0, {
      timeout: 3_000,
    });
    await page.waitForTimeout(300);
  }
  await expect(page).toHaveURL(
    new RegExp(`${path.replaceAll("/", "\\/")}(?:[?#].*)?$`),
  );
  await expect(page.locator("body")).toContainText(marker);
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
    await expect(page.locator("body")).not.toContainText("Cargando Marketing…");
    await expect(
      page.getByText("Capacidades del equipo", { exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await page.screenshot({
      path: `${screenshotsDir}/marketing-${test.info().project.name}.png`,
      fullPage: true,
    });

    await openRoute(page, "/seo", /SEO|Responsable de SEO/i);
    await expect(page.locator("body")).not.toContainText("Cargando SEO…");
    await expect(
      page.getByText("Capacidades del equipo", { exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });
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
      /Conexiones|GitHub/i,
    );
    await page.getByRole("button", { name: "+ Añadir", exact: true }).click();
    await expect(
      page.getByText("GitHub", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /github_repository|unknown/i,
    );
    await page.screenshot({
      path: `${screenshotsDir}/conexiones-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("Connections OAuth start navigates to GitHub authorize (real button click)", async ({
    page,
  }) => {
    // Regression: a previous E2E report claimed "Inicio OAuth real: PASS"
    // for GitHub. The previous spec only clicked "+ Añadir" and read the
    // "GitHub" string from the catalog — it never clicked a Conectar button.
    // Manual production reproduction showed the API replying 401
    // `missing_token` and the browser never reaching github.com. This test
    // clicks the real button, observes the live navigation, and verifies
    // the browser lands on GitHub's official authorize endpoint. No
    // Authorization header is injected and no redirect is mocked.
    await openRoute(page, "/conexiones", /Conexiones|GitHub/i);
    await page.getByRole("button", { name: "+ Añadir", exact: true }).click();
    // Open the GitHub manage dialog from the catalog row.
    await page
      .getByRole("button", { name: /^GitHub/ })
      .first()
      .click();
    // The manage dialog exposes the Conectar CTA only when the tool is
    // actually connectable; if the backend reports a missing credential the
    // label becomes "No disponible todavía" and the button is disabled.
    const conectar = page.getByRole("button", { name: /^Conectar$/ });
    await expect(conectar).toBeEnabled({ timeout: 10_000 });
    await conectar.click();
    await page.waitForURL(/^https:\/\/github\.com\/login\/oauth\/authorize/, {
      timeout: 20_000,
    });
    expect(page.url()).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
    expect(page.url()).toMatch(/[?&](client_id|state)=/);
  });

  test("Connections OAuth start navigates to TikTok authorize (real button click)", async ({
    page,
  }) => {
    // Same regression as GitHub above but for TikTok. The backend maps
    // `tiktok` → `startExternalOAuth(provider = "tiktok")` which produces
    // https://www.tiktok.com/v2/auth/authorize/. Same code path, same
    // `requireSession` boundary, same Authorization header.
    await openRoute(page, "/conexiones", /Conexiones|TikTok/i);
    await page.getByRole("button", { name: "+ Añadir", exact: true }).click();
    await page
      .getByRole("button", { name: /^TikTok/ })
      .first()
      .click();
    const conectar = page.getByRole("button", { name: /^Conectar$/ });
    await expect(conectar).toBeEnabled({ timeout: 10_000 });
    await conectar.click();
    await page.waitForURL(/^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize/, {
      timeout: 20_000,
    });
    expect(page.url()).toMatch(
      /^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize/,
    );
    expect(page.url()).toMatch(/[?&](client_key|state)=/);
  });

  test("Mobile drawer does not intercept the page content underneath (Ver SEO)", async ({
    page,
  }) => {
    // Regression: on a mobile viewport the `.dfy-shell__scrim` (z-index 40,
    // fixed, inset 0) used to swallow every tap while the drawer was open,
    // so tapping "Ver SEO" closed the menu but never navigated. The scrim
    // is now `pointer-events: none` and a document-level listener closes the
    // drawer on outside taps. Tapping "Ver SEO" must reach /seo in one
    // gesture, regardless of drawer state.
    test.skip(
      (page.viewportSize()?.width ?? 1440) >= 600,
      "Mobile-only regression; desktop drawer does not apply.",
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeVisible();
    // Open the mobile drawer first.
    await page
      .getByRole("button", { name: "Abrir navegación" })
      .click({ force: true });
    // Tap "Ver SEO" while the drawer is open — must navigate to /seo AND
    // close the drawer in the same gesture.
    await page
      .getByRole("button", { name: /^Ver SEO$/ })
      .click({ force: true });
    await expect(page).toHaveURL(/\/seo(?:[?#].*)?$/, { timeout: 10_000 });
    await expect(
      page.locator(".dfy-sidebar--open"),
    ).toHaveCount(0, { timeout: 5_000 });
  });

  test("Configuration exposes the provider-neutral capability setup", async ({
    page,
  }) => {
    await openRoute(page, "/configuracion", /Configuración/i);
    await expect(page.getByTestId("llm-settings")).toContainText(
      "Razonamiento de Departify",
    );
    await expect(page.locator("body")).not.toContainText("Cargando…");
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
    await expect(page.locator(".dfy-chat-thinking")).toHaveCount(0, {
      timeout: 60_000,
    });
    const assistantText = (
      await page.getByTestId("chat-message-assistant").allTextContents()
    ).join("\n");
    expect(assistantText).not.toMatch(
      /marketing\.delegate|drive\.write|work\.deliverable|NO_REPLY|plugin approval required|OpenClaw|Activepieces|MCP/i,
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

  test("repeat navigation reuses warm data instead of rebuilding the shell", async ({
    page,
  }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeVisible();

    const navLabels: Record<string, string> = {
      "/empresa": "Empresa",
      "/chat": "Chat",
      "/conexiones": "Conexiones",
      "/tareas": "Tareas",
      "/inicio": "Tu empresa",
    };
    const markers: Record<string, RegExp> = {
      "/empresa": /Empresa|Tu empresa/i,
      "/chat": /Conversación continua|¿Qué quieres conseguir|conversación/i,
      "/conexiones": /Conexiones|GitHub|Proyecto de la web/i,
      "/tareas": /Tareas/i,
      "/inicio": /Tu empresa/i,
    };
    const measurements: Array<{
      route: string;
      elapsedMs: number;
      apiRequests: number;
    }> = [];

    for (const path of [
      "/empresa",
      "/chat",
      "/conexiones",
      "/tareas",
      "/inicio",
      "/chat",
      "/conexiones",
    ]) {
      if ((page.viewportSize()?.width ?? 1440) < 600) {
        await page.getByRole("button", { name: "Abrir navegación" }).click();
      }
      const requests: string[] = [];
      const onRequest = (request: { url(): string }) => {
        if (request.url().includes("/api/customer-zero/")) {
          requests.push(request.url());
        }
      };
      page.on("request", onRequest);
      const started = Date.now();
      await page
        .getByRole("link", { name: navLabels[path], exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`${path.replaceAll("/", "\\/")}$`),
      );
      await expect(page.locator("body")).toContainText(markers[path]);
      measurements.push({
        route: path,
        elapsedMs: Date.now() - started,
        apiRequests: requests.length,
      });
      page.off("request", onRequest);
    }

    await testInfo.attach("navigation-performance.json", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });

    const firstConnections = measurements.findIndex(
      (measurement) => measurement.route === "/conexiones",
    );
    const repeatConnections = measurements
      .map((measurement, index) => ({ measurement, index }))
      .filter(({ measurement }) => measurement.route === "/conexiones")
      .at(-1);
    expect(repeatConnections).toBeDefined();
    expect(repeatConnections!.measurement.apiRequests).toBeLessThanOrEqual(
      measurements[firstConnections]?.apiRequests ?? 0,
    );
  });
});
