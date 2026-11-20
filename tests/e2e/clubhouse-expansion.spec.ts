import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ThemeView, ClubhouseView } from "../../lib/clubhouse-types";
import type { CompetitionWizardContext } from "../../lib/competition-wizard-types";
const origin = "http://localhost:3000";
const actors = {
  owner: "00000000-0000-4000-8000-000000000001",
  player: "00000000-0000-4000-8000-000000000002",
};
async function local(context: BrowserContext, baseURL: string | undefined) {
  if (
    !baseURL ||
    !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) ||
    (await (await context.request.get("/api/session")).json()).local !== true
  )
    throw Error("Clubhouse browser acceptance requires loopback fixtures.");
}
async function login(context: BrowserContext, userId = actors.owner) {
  const response = await context.request.post("/api/auth/local", {
    headers: { Origin: origin },
    data: { userId, next: "/app" },
  });
  expect(response.status(), await response.text()).toBe(200);
}
async function command(
  context: BrowserContext,
  path: string,
  action: Record<string, unknown>,
  expectedRevision?: number,
) {
  const response = await context.request.post(path, {
    headers: { Origin: origin },
    data: {
      requestId: randomUUID(),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      action,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function club(owner: BrowserContext, member?: BrowserContext) {
  const suffix = randomUUID().slice(0, 8),
    result = await command(owner, "/api/platform/actions", {
      type: "club.create",
      name: `Clubhouse browser ${suffix}`,
    });
  await command(owner, "/api/platform/actions", {
    type: "club.settings",
    id: result.id,
    joinPolicy: "open",
  });
  if (member)
    await command(member, "/api/platform/actions", {
      type: "club.request",
      id: result.id,
    });
  return {
    id: result.id as string,
    name: `Clubhouse browser ${suffix}`,
    suffix,
  };
}
async function view(
  context: BrowserContext,
  id: string,
  page = "overview",
): Promise<ClubhouseView> {
  const response = await context.request.get(
    `/api/clubhouse/${id}?page=${page}`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await info.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}
async function next(page: Page) {
  await page
    .getByRole("button", { name: "Volgende stap", exact: true })
    .click();
}

async function deactivate(owner: BrowserContext, clubId: string) {
  await command(owner, "/api/platform/actions", {
    type: "club.deactivate",
    id: clubId,
  });
}

test("six real wizard steps publish one canonical club competition using only an explicitly granted board", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const owner = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    player = await browser.newContext();
  let id = "";
  try {
    await local(owner, baseURL);
    await login(owner);
    await login(player, actors.player);
    const c = await club(owner, player);
    id = c.id;
    await command(owner, "/api/platform/actions", {
      type: "location.enable-venue",
    });
    const location = await command(owner, "/api/platform/actions", {
        type: "location.create",
        name: `Wizardlocatie ${c.suffix}`,
        timezone: "Europe/Amsterdam",
      }),
      board = await command(owner, "/api/platform/actions", {
        type: "location.board.create",
        locationId: location.id,
        name: `Wizardbaan ${c.suffix}`,
      });
    const granted = await owner.request.post("/api/competition-wizard", {
      headers: { Origin: origin },
      data: {
        requestId: randomUUID(),
        action: {
          type: "planning.grant",
          clubId: c.id,
          locationId: location.id,
          expectedRevision: 0,
          boardIds: [board.id],
          windows: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            startTime: "00:00",
            endTime: "23:59",
          })),
          reason: "Eigen lokale acceptatieproef: precies één toegekende baan.",
        },
      },
    });
    expect(granted.status(), await granted.text()).toBe(200);
    const page = await owner.newPage();
    await page.goto(`/app/clubs/${c.id}/competities`);
    await page
      .getByRole("button", { name: "Nieuwe competitie", exact: true })
      .click();
    const wizard = page.getByRole("region", { name: "Competitiewizard" });
    await wizard
      .getByLabel("Competitienaam", { exact: true })
      .fill(`  Vrijdag singles ${c.suffix}  `);
    await wizard
      .getByLabel("Seizoen / editie", { exact: true })
      .fill("Zomer 2090");
    await wizard
      .getByRole("button", { name: "Concept opslaan", exact: true })
      .click();
    await expect(
      wizard.getByLabel("Competitienaam", { exact: true }),
    ).toHaveValue(`Vrijdag singles ${c.suffix}`);
    await next(page);
    await wizard.getByRole("checkbox", { name: /Danny Goldenbelt/ }).check();
    await wizard.getByRole("checkbox", { name: /Michael de Groot/ }).check();
    await next(page);
    await expect(
      wizard.getByRole("heading", { name: "3. Spelregels en reglement" }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("combobox", { name: "Startprocedure", exact: true }),
    ).toHaveValue("bull");
    await next(page);
    await wizard
      .getByRole("checkbox", { name: `Wizardbaan ${c.suffix}`, exact: true })
      .check();
    await next(page);
    await wizard.getByLabel("Startdatum", { exact: true }).fill("2090-06-02");
    await wizard
      .getByLabel("Uiterste einddatum", { exact: true })
      .fill("2090-07-30");
    await next(page);
    await wizard
      .getByRole("button", { name: "Programma controleren", exact: true })
      .click();
    await expect(
      wizard.getByRole("heading", {
        name: "Voorvertoning wedstrijdprogramma",
        exact: true,
      }),
    ).toBeVisible();
    await expect(wizard.locator(".ch-preview tbody tr")).toHaveCount(1);
    let idleSaves = 0;
    const countIdleSave = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/competition-wizard") &&
        request.postDataJSON()?.action?.type === "wizard.save"
      )
        idleSaves++;
    };
    page.on("request", countIdleSave);
    await page.waitForTimeout(1800);
    page.off("request", countIdleSave);
    expect(idleSaves).toBe(0);
    await expect(wizard.locator(".ch-preview tbody tr")).toHaveCount(1);
    await expect(
      wizard.getByRole("button", {
        name: "Competitie definitief publiceren",
        exact: true,
      }),
    ).toBeEnabled();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await screenshot(page, info, `wizard-review-${viewport.width}`);
    }
    const previewResponse = await owner.request.get(
      `/api/competition-wizard/${c.id}`,
    );
    const context: CompetitionWizardContext = await previewResponse.json();
    const draft = context.drafts.find(
      (d) => d.config.title === `Vrijdag singles ${c.suffix}`,
    )!;
    expect(draft.config.playerIds.sort()).toEqual(
      [actors.owner, actors.player].sort(),
    );
    expect(draft.config.boardIds).toEqual([board.id]);
    expect(draft.config.rules.startProcedure).toBe("bull");
    await wizard
      .getByRole("button", {
        name: "Competitie definitief publiceren",
        exact: true,
      })
      .click();
    await expect(
      wizard.getByRole("heading", {
        name: "De competitie is gepubliceerd",
        exact: true,
      }),
    ).toBeVisible();
    const href = await wizard
      .getByRole("link", { name: "Competitie openen", exact: true })
      .getAttribute("href");
    expect(href).toMatch(/^\/app\/competities\/[a-f0-9-]{36}$/);
    const canonical = await (
      await owner.request.get(`/api/seasons/${href!.split("/").at(-1)}`)
    ).json();
    expect(canonical.season.clubId).toBe(c.id);
    expect(canonical.season.fixtures).toHaveLength(1);
    expect(canonical.season.fixtures[0].boardIds).toEqual([board.id]);
    expect(canonical.season.fixtures[0].slots[0].matchId).toBeUndefined();
    expect(canonical.season.rulesVersion).toBeGreaterThan(0);
    await page.goto(`/app/clubs/${c.id}`);
    const nav = page.getByRole("navigation", { name: "Hoofdnavigatie" });
    await expect(nav.getByRole("link")).toHaveText([
      "Vandaag",
      "Spelen",
      "Competities",
      "Toernooien",
    ]);
    await nav.getByRole("button", { name: "Meer", exact: true }).click();
    const more = page.getByRole("dialog", { name: "Meer DartFlow" });
    await expect(
      more.getByRole("heading", { name: "Jouw DartFlow" }),
    ).toBeVisible();
    await more
      .getByRole("link", { name: "Help & FAQ", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      more.getByRole("link", { name: "Help & FAQ", exact: true }),
    ).toBeVisible();
    await screenshot(page, info, "android-reference-more-desktop");
    await page.keyboard.press("Escape");
    await expect(more).not.toBeVisible();
  } finally {
    if (id) await deactivate(owner, id);
    await Promise.allSettled([owner.close(), player.close()]);
  }
});

test("wizard drafts survive reload and offline editing, and a real concurrent revision offers an explicit safe copy", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const owner = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    other = await browser.newContext({
      viewport: { width: 768, height: 1024 },
    });
  let id = "";
  try {
    await local(owner, baseURL);
    await login(owner);
    await login(other);
    const c = await club(owner);
    id = c.id;
    const a = await owner.newPage(),
      b = await other.newPage();
    await a.goto(`/app/clubs/${id}/competities?nieuw=1`);
    await a
      .getByLabel("Competitienaam", { exact: true })
      .fill(`Concept ${c.suffix}`);
    await a
      .getByLabel("Seizoen / editie", { exact: true })
      .fill("Conceptseizoen");
    await a
      .getByRole("button", { name: "Concept opslaan", exact: true })
      .click();
    await expect(a.locator(".ch-save-state")).toContainText("Opgeslagen");
    const url = a.url();
    expect(new URL(url).searchParams.get("concept")).toMatch(/^[a-f0-9-]{36}$/);
    await a.reload();
    await expect(a.getByLabel("Competitienaam", { exact: true })).toHaveValue(
      `Concept ${c.suffix}`,
    );
    await b.goto(url);
    await expect(b.getByLabel("Competitienaam", { exact: true })).toHaveValue(
      `Concept ${c.suffix}`,
    );
    await a
      .getByLabel("Competitienaam", { exact: true })
      .fill(`Serverversie ${c.suffix}`);
    await a
      .getByRole("button", { name: "Concept opslaan", exact: true })
      .click();
    await expect(a.locator(".ch-save-state")).toContainText("Opgeslagen");
    await b
      .getByLabel("Competitienaam", { exact: true })
      .fill(`Mijn lokale versie ${c.suffix}`);
    await b
      .getByRole("button", { name: "Concept opslaan", exact: true })
      .click();
    await expect(
      b.getByRole("heading", {
        name: "Nieuwere versie beschikbaar",
        exact: true,
      }),
    ).toBeVisible();
    const noticeContrast = await b.locator(".notice.error").evaluate((node) => {
      const style = getComputedStyle(node);
      const luminance = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const n = v / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const a = luminance(style.color),
        c = luminance(style.backgroundColor);
      return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
    });
    expect(noticeContrast).toBeGreaterThanOrEqual(4.5);
    await screenshot(b, info, "wizard-concurrent-safe-copy");
    await b
      .getByRole("button", {
        name: "Mijn wijzigingen als kopie bewaren",
        exact: true,
      })
      .click();
    await expect(
      b.getByRole("heading", {
        name: "Nieuwere versie beschikbaar",
        exact: true,
      }),
    ).toHaveCount(0);
    await b
      .getByRole("button", { name: "Concept opslaan", exact: true })
      .click();
    await other.setOffline(true);
    await b
      .getByRole("textbox", { name: "Omschrijving", exact: true })
      .fill("Op dit toestel bewaard terwijl de verbinding weg is.");
    await expect(b.locator(".ch-save-state")).toContainText("Offline");
    await other.setOffline(false);
    await b
      .getByRole("button", { name: "Concept opslaan", exact: true })
      .click();
    await expect(b.locator(".ch-save-state")).toContainText("Opgeslagen");
    await b.reload();
    await expect(
      b.getByRole("textbox", { name: "Omschrijving", exact: true }),
    ).toHaveValue("Op dit toestel bewaard terwijl de verbinding weg is.");
    const ctx: CompetitionWizardContext = await (
      await owner.request.get(`/api/competition-wizard/${id}`)
    ).json();
    expect(ctx.drafts.map((d) => d.config.title)).toContain(
      `Serverversie ${c.suffix}`,
    );
    expect(ctx.drafts.map((d) => d.config.title)).toContain(
      `Mijn lokale versie ${c.suffix}`,
    );
    expect(ctx.drafts).toHaveLength(2);
  } finally {
    await other.setOffline(false);
    if (id) await deactivate(owner, id);
    await Promise.allSettled([owner.close(), other.close()]);
  }
});

test("real club tasks, wait-list, private feed poll and exact message links stay scoped while chat drafts survive closing", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const owner = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    member = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    outsider = await browser.newContext();
  let id = "";
  try {
    await local(owner, baseURL);
    await login(owner);
    await login(member, actors.player);
    await login(outsider, "00000000-0000-4000-8000-000000000003");
    const c = await club(owner, member);
    id = c.id;
    for (const ctx of [owner, member]) {
      const state = await command(ctx, "/api/platform/actions", {
        type: "safety.state",
      });
      if (state.requiresAcceptance)
        await command(ctx, "/api/platform/actions", {
          type: "safety.accept",
          version: state.rulesVersion,
          accepted: true,
          ageConfirmed: true,
        });
    }
    const manager = await owner.newPage(),
      phone = await member.newPage();
    await manager.goto(`/app/clubs/${id}/taken`);
    await manager
      .getByRole("button", { name: "Nieuwe taak", exact: true })
      .click();
    const taskForm = manager.locator("form").filter({
      has: manager.getByRole("heading", { name: "Nieuwe taak", exact: true }),
    });
    await taskForm
      .getByLabel("Titel", { exact: true })
      .fill(`Baancontrole ${c.suffix}`);
    await taskForm
      .getByRole("textbox", { name: "Omschrijving", exact: true })
      .fill("Samen de eigen clubavond klaarzetten.");
    await taskForm
      .getByRole("combobox", { name: "Taakeigenaar", exact: true })
      .selectOption(actors.player);
    await taskForm
      .getByLabel("Privé beheernotitie", { exact: true })
      .fill("Alleen huidige taakbeheerders zien dit.");
    await taskForm
      .getByRole("button", { name: "Taak opslaan", exact: true })
      .click();
    await expect(
      manager.getByRole("heading", {
        name: `Baancontrole ${c.suffix}`,
        exact: true,
      }),
    ).toBeVisible();
    await phone.goto(`/app/clubs/${id}/taken`);
    const task = phone.getByRole("article").filter({
      has: phone.getByRole("heading", {
        name: `Baancontrole ${c.suffix}`,
        exact: true,
      }),
    });
    await task
      .getByRole("button", { name: "Ik help mee", exact: true })
      .click();
    await expect(
      task.getByRole("button", {
        name: "Afmelden als vrijwilliger",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      phone.getByText("Alleen huidige taakbeheerders zien dit.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await task
      .getByRole("button", { name: "Taak afronden", exact: true })
      .click();
    await phone
      .getByRole("combobox", { name: "Taken tonen", exact: true })
      .selectOption("done");
    await expect(task.getByText("Afgerond", { exact: true })).toBeVisible();
    await manager.goto(`/app/clubs/${id}/agenda`);
    await manager
      .getByRole("button", { name: "Activiteit toevoegen", exact: true })
      .click();
    const activityForm = manager.locator("form").filter({
      has: manager.getByRole("heading", {
        name: "Nieuwe activiteit",
        exact: true,
      }),
    });
    await activityForm
      .getByLabel("Titel", { exact: true })
      .fill(`Clubavond ${c.suffix}`);
    await activityForm
      .getByLabel("Begint (tijd van dit toestel)", { exact: true })
      .fill("2090-06-02T19:30");
    await activityForm
      .getByLabel("Eindigt (tijd van dit toestel)", { exact: true })
      .fill("2090-06-02T22:30");
    await activityForm.getByLabel("Capaciteit", { exact: true }).fill("1");
    await activityForm
      .getByRole("combobox", { name: "Soort activiteit", exact: true })
      .selectOption("social");
    await activityForm
      .getByLabel("Locatie", { exact: true })
      .fill("Eigen clubruimte");
    await activityForm
      .getByRole("button", { name: "Activiteit opslaan", exact: true })
      .click();
    const activity = (await view(owner, id, "calendar")).activities.find(
      (a) => a.title === `Clubavond ${c.suffix}`,
    )!;
    expect(activity.type).toBe("social");
    await phone.goto(`/app/clubs/${id}/agenda?activiteit=${activity.id}`);
    const details = phone.getByRole("region", { name: "Activiteitdetails" });
    await details
      .getByRole("button", { name: "Aanmelden", exact: true })
      .click();
    expect(
      (await view(member, id, "calendar")).activities.find(
        (a) => a.id === activity.id,
      )?.myStatus,
    ).toBe("registered");
    await manager.goto(`/app/clubs/${id}/agenda?activiteit=${activity.id}`);
    await manager
      .getByRole("region", { name: "Activiteitdetails" })
      .getByRole("button", { name: "Op de wachtlijst", exact: true })
      .click();
    expect(
      (await view(owner, id, "calendar")).activities.find(
        (a) => a.id === activity.id,
      )?.myStatus,
    ).toBe("waitlisted");
    await phone.reload();
    await phone
      .getByRole("region", { name: "Activiteitdetails" })
      .getByRole("button", { name: "Afmelden", exact: true })
      .click();
    expect(
      (await view(owner, id, "calendar")).activities.find(
        (a) => a.id === activity.id,
      )?.myStatus,
    ).toBe("registered");
    await manager.goto(`/app/clubs/${id}/feed`);
    await manager
      .getByLabel("Bericht", { exact: true })
      .fill(`Welke clubavond kiezen we ${c.suffix}?`);
    await manager
      .locator("summary")
      .filter({ hasText: "Afbeelding of peiling toevoegen" })
      .click();
    await manager.getByLabel("Peiling toevoegen", { exact: true }).check();
    await manager
      .getByLabel("Opties (twee tot acht, één per regel)", { exact: true })
      .fill("Vrijdag\nZaterdag");
    await manager
      .getByLabel("Stemmen tot (tijd van dit toestel)", { exact: true })
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await manager
      .getByRole("button", { name: "Plaatsen", exact: true })
      .click();
    const card = manager
      .locator(".df-feed-card")
      .filter({ hasText: `Welke clubavond kiezen we ${c.suffix}?` });
    await expect(card).toHaveCount(1);
    const postId = (await card.getAttribute("id"))!.replace("feed-post-", "");
    await card
      .getByRole("button", { name: "Link naar bericht delen", exact: true })
      .click();
    await expect(
      card.getByRole("textbox", { name: "Link naar dit bericht", exact: true }),
    ).toHaveValue(`${origin}/app/clubs/${id}/feed?post=${postId}`);
    const forbidden = await outsider.request.get(
      `/api/feed/post/${postId}?channel=club:${id}`,
    );
    expect(forbidden.status()).toBe(403);
    await phone.goto(`/app/clubs/${id}/feed?post=${postId}`);
    const phoneCard = phone.locator(`#feed-post-${postId}`);
    await expect(phoneCard).toHaveAttribute("data-focused", "true");
    await phoneCard.getByRole("radio", { name: /Vrijdag/ }).check();
    await phoneCard
      .getByRole("button", { name: "Stemmen", exact: true })
      .click();
    await expect(
      phoneCard
        .getByRole("region", { name: "Peiling" })
        .getByText("1 stemmers", { exact: false }),
    ).toBeVisible();
    await screenshot(phone, info, "clubhouse-poll-private-link-phone");
    await phone
      .getByRole("button", { name: "Verenigingschat", exact: false })
      .click();
    const chat = phone.getByRole("dialog", {
      name: "Verenigingschat",
      exact: true,
    });
    await chat
      .getByRole("textbox", { name: "Chatbericht", exact: true })
      .fill(`Bewaar concept ${c.suffix}`);
    await chat
      .getByRole("button", { name: "Chat sluiten", exact: true })
      .click();
    await phone
      .getByRole("button", { name: "Verenigingschat", exact: false })
      .click();
    await expect(
      chat.getByRole("textbox", { name: "Chatbericht", exact: true }),
    ).toHaveValue(`Bewaar concept ${c.suffix}`);
    await chat
      .getByRole("textbox", { name: "Chatbericht", exact: true })
      .fill(`Echt clubbericht ${c.suffix}`);
    let lost = false;
    const messageRequests: string[] = [];
    await phone.route("**/api/clubhouse/actions", async (route) => {
      const body = route.request().postDataJSON();
      if (body.action?.type !== "channel.message") return route.continue();
      messageRequests.push(body.requestId);
      if (lost) return route.continue();
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    await chat
      .getByRole("button", { name: "Bericht versturen", exact: true })
      .click();
    await expect(
      chat.getByRole("button", {
        name: "Dezelfde actie opnieuw proberen",
        exact: true,
      }),
    ).toBeVisible();
    await phone.reload();
    await phone
      .getByRole("button", { name: "Verenigingschat", exact: false })
      .click();
    await chat
      .getByRole("button", {
        name: "Dezelfde actie opnieuw proberen",
        exact: true,
      })
      .click();
    await expect(
      chat.getByRole("button", {
        name: "Dezelfde actie opnieuw proberen",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(lost).toBe(true);
    expect(messageRequests).toHaveLength(2);
    expect(messageRequests[0]).toBe(messageRequests[1]);

    await expect(
      chat
        .getByRole("log")
        .getByText(`Echt clubbericht ${c.suffix}`, { exact: true }),
    ).toBeVisible();
    await screenshot(phone, info, "clubhouse-chat-phone");
    await phone.goBack();
    await expect(chat).toHaveCount(0);
    await expect(phoneCard).toBeVisible();
    const channel = await (
      await owner.request.get(`/api/clubhouse/${id}/channels/${id}`)
    ).json();
    const message = channel.messages.find(
      (item: { body: string }) => item.body === `Echt clubbericht ${c.suffix}`,
    );
    expect(message).toBeTruthy();
    await command(owner, "/api/platform/actions", {
      type: "report.create",
      targetType: "message",
      targetId: message.id,
      scopeKind: "club",
      scopeId: id,
      category: "other",
      reason: `Lokale moderatieproef ${c.suffix}`,
    });
    await manager.goto(`/app/clubs/${id}/beheer`);
    const report = manager.getByRole("article").filter({
      hasText: `Lokale moderatieproef ${c.suffix}`,
    });
    await expect(report).toBeVisible();
    await report
      .getByRole("combobox", { name: "Besluit", exact: true })
      .selectOption("no-action");
    await report
      .getByLabel("Reden van het besluit", { exact: true })
      .fill("Alleen een synthetische acceptatieproef; geen overtreding.");
    await report.getByRole("button", { name: "Besluit vastleggen" }).click();
    await expect(
      report.getByRole("button", { name: "Besluit vastleggen" }),
    ).toHaveCount(0);
    expect(
      (await view(owner, id, "manage")).reports.find(
        (r) => r.reason === `Lokale moderatieproef ${c.suffix}`,
      )?.status,
    ).toBe("resolved");
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      await manager.setViewportSize(viewport);
      await manager.goto(`/app/clubs/${id}`);
      await expect(
        manager
          .locator(".ch-list-item")
          .filter({ hasText: `Welke clubavond kiezen we ${c.suffix}?` }),
      ).toHaveAttribute("href", `/app/clubs/${id}/feed?post=${postId}`);
      await screenshot(manager, info, `clubhouse-overview-${viewport.width}`);
    }
  } finally {
    if (id) await deactivate(owner, id);
    await Promise.allSettled([owner.close(), member.close(), outsider.close()]);
  }
});

test("premium theme preview stays local, published club contexts override personal preference and revocation falls back to DartFlow", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150000);
  const owner = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    member = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  const clubs: string[] = [];
  let before: ThemeView | null = null;
  try {
    await local(owner, baseURL);
    await login(owner);
    await login(member, actors.player);
    before = await (await member.request.get("/api/theme")).json();
    const a = await club(owner, member),
      b = await club(owner, member);
    clubs.push(a.id, b.id);
    const manager = await owner.newPage(),
      phone = await member.newPage();
    for (const [c, color] of [
      [a, "#58a6ff"],
      [b, "#f785cf"],
    ] as const) {
      await command(owner, "/api/clubhouse/actions", {
        type: "entitlement.grant",
        clubId: c.id,
        startsAt: "2020-01-01T00:00:00Z",
        endsAt: "2099-01-01T00:00:00Z",
      });
      await manager.goto(`/app/clubs/${c.id}/beheer`);
      const branding = manager.locator("section.panel").filter({
        has: manager.getByRole("heading", {
          name: "Clubhuisstijl",
          exact: true,
        }),
      });
      const settledTheme: ThemeView = await (
        await owner.request.get(`/api/theme?clubId=${c.id}`)
      ).json();
      const colorMode =
        settledTheme.preference.colorMode === "system"
          ? await manager.evaluate(() =>
              matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light",
            )
          : settledTheme.preference.colorMode;
      await expect
        .poll(() =>
          manager.evaluate(
            () => document.documentElement.dataset.dartflowTheme,
          ),
        )
        .toBe(colorMode);
      await expect
        .poll(() =>
          manager.evaluate(() =>
            document.documentElement.style.getPropertyValue("--ch-primary"),
          ),
        )
        .toBe(settledTheme.effective.tokens[colorMode].primary);
      const beforeTokens = await manager.evaluate(() =>
        document.documentElement.style.getPropertyValue("--ch-primary"),
      );
      await branding.getByLabel("Primaire kleur", { exact: true }).fill(color);
      await branding
        .getByLabel("Naam huisstijl", { exact: true })
        .fill(`Huisstijl ${c.suffix}`);
      expect(
        await manager.evaluate(() =>
          document.documentElement.style.getPropertyValue("--ch-primary"),
        ),
      ).toBe(beforeTokens);
      await branding
        .getByRole("button", { name: "Ontwerp opslaan", exact: true })
        .click();
      await expect(
        branding.getByRole("button", {
          name: "Opgeslagen huisstijl publiceren",
          exact: true,
        }),
      ).toBeEnabled();
      await branding
        .getByRole("button", {
          name: "Opgeslagen huisstijl publiceren",
          exact: true,
        })
        .click();
      await expect(
        branding.getByText(`Gepubliceerd: Huisstijl ${c.suffix}`, {
          exact: false,
        }),
      ).toBeVisible();
    }
    let pref: ThemeView = await (await member.request.get("/api/theme")).json();
    expect(pref.options.some((x) => x.clubId === a.id)).toBe(true);
    expect(pref.options.some((x) => x.clubId === b.id)).toBe(true);
    await member.request.post("/api/theme/actions", {
      headers: { Origin: origin },
      data: {
        requestId: randomUUID(),
        expectedRevision: pref.preference.revision,
        action: {
          type: "preference",
          mode: "club",
          clubId: a.id,
          colorMode: "dark",
        },
      },
    });
    await phone.goto("/app/settings");
    await expect(
      phone.getByRole("combobox", { name: "Uitstraling", exact: true }),
    ).toHaveValue(`club:${a.id}`);
    for (const [target, label] of [
      [null, "standard"],
      [a, "blue"],
      [b, "pink"],
    ] as const) {
      for (const colorMode of ["dark", "light"] as const) {
        const current: ThemeView = await (
          await member.request.get("/api/theme")
        ).json();
        const chosen = await member.request.post("/api/theme/actions", {
          headers: { Origin: origin },
          data: {
            requestId: randomUUID(),
            expectedRevision: current.preference.revision,
            action: {
              type: "preference",
              mode: target ? "club" : "dartflow",
              clubId: target ? a.id : null,
              colorMode,
            },
          },
        });
        expect(chosen.status(), await chosen.text()).toBe(200);
        const expected: ThemeView = await (
          await member.request.get(
            `/api/theme${target ? `?clubId=${target.id}` : ""}`,
          )
        ).json();
        expect(expected.effective.clubId).toBe(target?.id ?? null);
        for (const viewport of [
          { width: 390, height: 844 },
          { width: 1440, height: 1000 },
        ]) {
          await phone.setViewportSize(viewport);
          await phone.goto(
            target ? `/app/clubs/${target.id}` : "/app/settings",
          );
          await expect
            .poll(() =>
              phone.evaluate(
                () => document.documentElement.dataset.dartflowTheme,
              ),
            )
            .toBe(colorMode);
          await expect(phone.locator(".mobile-brand img")).toHaveAttribute(
            "src",
            colorMode === "dark"
              ? "/assets/dartflow-logo.svg"
              : "/assets/dartflow-logo-on-light.svg",
          );
          await expect
            .poll(() =>
              phone.evaluate(() =>
                document.documentElement.style.getPropertyValue("--ch-primary"),
              ),
            )
            .toBe(expected.effective.tokens[colorMode].primary);
          if (target) {
            await expect(
              phone.getByRole("heading", { name: target.name, exact: true }),
            ).toBeVisible();
            if (viewport.width <= 600) {
              const launcher = await phone
                .getByRole("button", {
                  name: "Verenigingschat",
                  exact: true,
                })
                .boundingBox();
              const action = await phone
                .locator(".ch-hero .button")
                .first()
                .boundingBox();
              expect(launcher).not.toBeNull();
              expect(action).not.toBeNull();
              expect(launcher!.width).toBeGreaterThanOrEqual(48);
              expect(launcher!.width).toBeLessThanOrEqual(56);
              expect(launcher!.height).toBeGreaterThanOrEqual(48);
              expect(
                Math.max(
                  0,
                  Math.min(launcher!.x + launcher!.width, action!.x + action!.width) -
                    Math.max(launcher!.x, action!.x),
                ) *
                  Math.max(
                    0,
                    Math.min(launcher!.y + launcher!.height, action!.y + action!.height) -
                      Math.max(launcher!.y, action!.y),
                  ),
              ).toBe(0);
            }
          } else {
            await expect(
              phone.getByRole("textbox", {
                name: "Volledige naam",
                exact: true,
              }),
            ).toBeVisible();
            await expect(
              phone.getByRole("combobox", {
                name: "Uitstraling",
                exact: true,
              }),
            ).toHaveValue("dartflow");
          }
          await screenshot(
            phone,
            info,
            `clubhouse-matrix-${label}-${colorMode}-${viewport.width}`,
          );
        }
      }
    }
    const lastPref: ThemeView = await (
      await member.request.get("/api/theme")
    ).json();
    await member.request.post("/api/theme/actions", {
      headers: { Origin: origin },
      data: {
        requestId: randomUUID(),
        expectedRevision: lastPref.preference.revision,
        action: {
          type: "preference",
          mode: "club",
          clubId: a.id,
          colorMode: "dark",
        },
      },
    });
    await command(owner, "/api/clubhouse/actions", {
      type: "entitlement.revoke",
      clubId: a.id,
    });
    await phone.goto("/app/settings");
    pref = await (await member.request.get("/api/theme")).json();
    expect(pref.effective.clubId).toBeNull();
    expect(pref.preference.clubId).toBe(a.id);
    await expect(
      phone.getByRole("combobox", { name: "Uitstraling", exact: true }),
    ).toHaveValue(`club:${a.id}`);
    await expect(
      phone.getByRole("option", {
        name: "Eerdere clubhuisstijl niet meer beschikbaar",
      }),
    ).toBeDisabled();
    expect(pref.options.some((x) => x.clubId === b.id)).toBe(true);
    await screenshot(phone, info, "theme-revoked-explicit-choice-desktop");
  } finally {
    for (const id of clubs) {
      await command(owner, "/api/clubhouse/actions", {
        type: "entitlement.revoke",
        clubId: id,
      });
      await deactivate(owner, id);
    }
    if (before) {
      const current: ThemeView = await (
        await member.request.get("/api/theme")
      ).json();
      await member.request.post("/api/theme/actions", {
        headers: { Origin: origin },
        data: {
          requestId: randomUUID(),
          expectedRevision: current.preference.revision,
          action: {
            type: "preference",
            mode: before.preference.mode,
            clubId: before.preference.clubId,
            colorMode: before.preference.colorMode,
          },
        },
      });
    }
    await Promise.allSettled([owner.close(), member.close()]);
  }
});
