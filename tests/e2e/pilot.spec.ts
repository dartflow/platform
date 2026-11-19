import {openMatchDetails} from './helpers/score-console';
import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type Request,
} from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { MatchView } from "../../lib/types";
import type { CoreScoreQueue } from "../../lib/core-offline";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI uses process environment. */
}
test.use({
  launchOptions: {
    ...(process.env.DARTFLOW_BROWSER_PATH
      ? { executablePath: process.env.DARTFLOW_BROWSER_PATH }
      : {}),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});
const origin = "http://localhost:3000";
const ids = {
  organizer: "00000000-0000-4000-8000-000000000001",
  p1: "00000000-0000-4000-8000-000000000002",
  p2: "00000000-0000-4000-8000-000000000003",
  outsider: "00000000-0000-4000-8000-000000000004",
  club: "10000000-0000-4000-8000-000000000001",
};
const eventId = randomUUID(),
  boardId = randomUUID();
const eventName = `Browserpilot ${eventId.slice(0, 8)}`;
let owner: pg.Client;
async function login(page: Page, name: string, next = "/app") {
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(new URL(next, origin).href);
  await expect(page.locator(".content")).toBeVisible();
}
async function action(
  context: BrowserContext,
  id: string,
  state: MatchView,
  command: Record<string, unknown>,
  requestId = randomUUID(),
) {
  const response = await context.request.post(`/api/matches/${id}/actions`, {
    headers: { Origin: origin },
    data: {
      requestId,
      matchId: id,
      expectedRevision: state.revision,
      action: command,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MatchView;
}
test.beforeAll(async () => {
  if (
    process.env.DARTFLOW_DATA_MODE !== "local" ||
    !process.env.DARTFLOW_DATABASE_ADMIN_URL ||
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DARTFLOW_DATABASE_ADMIN_URL).hostname,
    )
  )
    throw new Error(
      "Browserpilot vereist expliciet de lokale fixture-database.",
    );
  owner = new pg.Client({
    connectionString: process.env.DARTFLOW_DATABASE_ADMIN_URL,
  });
  await owner.connect();
  await owner.query(
    "insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,2)",
    [eventId, ids.club, eventName],
  );
  await owner.query(
    "insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)",
    [eventId, ids.organizer],
  );
  await owner.query(
    "insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)",
    [boardId, eventId, "Browserbaan"],
  );
  for (const id of [ids.p1, ids.p2])
    await owner.query(
      "insert into dartflow_private.entries(id,event_id,user_id,status) values($1,$2,$3,'registered')",
      [randomUUID(), eventId, id],
    );
});
test.afterAll(async () => {
  if (!owner) return;
  for (const table of [
    "platform_signals",
    "action_receipts",
    "visits",
    "match_confirmations",
    "match_players",
  ])
    await owner.query(
      `delete from dartflow_private.${table} where match_id in(select id from dartflow_private.matches where event_id=$1)`,
      [eventId],
    );
  for (const table of [
    "audit_events",
    "match_results",
    "screen_capabilities",
    "standings",
  ])
    await owner.query(
      `delete from dartflow_private.${table} where event_id=$1`,
      [eventId],
    );
  for (const table of ["matches", "boards", "entries", "event_staff"])
    await owner.query(
      `delete from dartflow_private.${table} where event_id=$1`,
      [eventId],
    );
  await owner.query("delete from dartflow_private.events where id=$1", [
    eventId,
  ]);
  await owner.end();
});

test("two players, an organizer and independent screen complete the authoritative pilot", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const manager = await browser.newContext(),
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    p2 = await browser.newContext({ viewport: { width: 360, height: 780 } }),
    screen = await browser.newContext({
      viewport: { width: 540, height: 960 },
    });
  const m = await manager.newPage(),
    a = await p1.newPage(),
    b = await p2.newPage(),
    display = await screen.newPage();
  await login(m, "Danny Goldenbelt");
  await login(a, "Michael de Groot", "/evenementen");
  await login(b, "Raymond van Dijk", "/evenementen");
  await mkdir("test-results/evidence", { recursive: true });
  await m.setViewportSize({ width: 1440, height: 1000 });
  await m.screenshot({
    path: "test-results/evidence/dashboard.png",
    fullPage: true,
  });
  for (const page of [a, b])
    await page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: eventName, exact: true }),
      })
      .getByRole("button", { name: "Ik ben aanwezig" })
      .click();
  const plan = await manager.request.post(`/api/events/${eventId}/actions`, {
    headers: { Origin: origin },
    data: {
      type: "plan",
      playerIds: [ids.p1, ids.p2],
      settings: { startScore: 301, bestOfLegs: 1, bestOfSets: 1 },
    },
  });
  expect(plan.status()).toBe(200);
  const { matchId } = await plan.json();
  let state = (await (
    await manager.request.get(`/api/matches/${matchId}`)
  ).json()) as MatchView;
  state = await action(manager, matchId, state, { type: "call", boardId });
  const capResponse = await manager.request.post("/api/screens", {
    headers: { Origin: origin },
    data: { eventId, boardId },
  });
  expect(capResponse.status()).toBe(200);
  const capability = await capResponse.json();
  await display.goto(capability.url);
  await expect(display.locator(".sprint-board-badge")).toHaveText("Browserbaan");
  await a.goto(`/wedstrijd/${matchId}`);
  await a.getByRole("button", { name: "Ik ben klaar om te spelen" }).click();
  await b.goto(`/wedstrijd/${matchId}`);
  await b.getByRole("button", { name: "Ik ben klaar om te spelen" }).click();
  await m.goto(`/wedstrijd/${matchId}`);
  await m
    .getByRole("button", { name: "Wedstrijd starten", exact: true })
    .click();
  await openMatchDetails(a);await openMatchDetails(b);
  // Two isolated accounts exchange actual WebRTC media, with browser test devices.
  await p1.grantPermissions(["camera", "microphone"], { origin });
  await p2.grantPermissions(["camera", "microphone"], { origin });
  for (const phone of [a, b])
    await phone
      .getByRole("button", { name: "Camera en microfoon testen", exact: true })
      .click();
  for (const phone of [a, b])
    await phone
      .getByRole("button", { name: "Beeldverbinding starten", exact: true })
      .click();
  for (const phone of [a, b]) {
    await expect(
      phone.getByText("Beeld en geluid verbonden.", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect
      .poll(() =>
        phone
          .locator('video[aria-label="Gedeeld beeld van de andere speler"]')
          .evaluate(
            (video: HTMLVideoElement) =>
              video.videoWidth > 0 && video.currentTime > 0,
          ),
      )
      .toBe(true);
  }
  await a.getByRole("button", { name: "Microfoon uit", exact: true }).click();
  expect(
    await a
      .locator('video[aria-label="Je eigen camerabeeld"]')
      .evaluate(
        (video: HTMLVideoElement) =>
          (video.srcObject as MediaStream).getAudioTracks()[0].enabled,
      ),
  ).toBe(false);
  await a.screenshot({
    path: "test-results/evidence/v15-real-webrtc-media.png",
    fullPage: true,
  });
  for (const phone of [a, b])
    await phone
      .getByRole("button", { name: "Beeldverbinding verlaten", exact: true })
      .click();
  for (const phone of [a, b])
    await expect
      .poll(() =>
        phone
          .locator('video[aria-label="Je eigen camerabeeld"]')
          .evaluate((video: HTMLVideoElement) => video.srcObject === null),
      )
      .toBe(true);
  await a.getByRole("textbox", { name: "Bezoekscore" }).fill("180");
  await a.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(display.locator(".sprint-number").first()).toHaveText("121");
  await expect(b.locator(".remaining").first()).toHaveText("121");
  await a
    .getByRole("button", { name: "Wedstrijd pauzeren", exact: true })
    .click();
  await expect(
    b.getByText("Wedstrijd gepauzeerd", { exact: true }),
  ).toBeVisible();
  await b
    .getByRole("button", { name: "Wedstrijd hervatten", exact: true })
    .click();
  await expect(
    a.getByRole("button", { name: "Wedstrijd pauzeren", exact: true }),
  ).toBeVisible();
  await a
    .getByRole("button", { name: "Correctie aanvragen", exact: true })
    .click();
  await a
    .getByLabel("Wat moet er worden gecorrigeerd?")
    .fill("Mijn laatste beurt moet opnieuw worden ingevoerd.");
  await a
    .getByRole("button", { name: "Correctieverzoek versturen", exact: true })
    .click();
  await b
    .getByRole("button", { name: "Correctie goedkeuren", exact: true })
    .click();
  await expect(a.locator(".remaining").first()).toHaveText("301");
  await a.getByRole("textbox", { name: "Bezoekscore" }).fill("180");
  await a.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(display.locator(".sprint-number").first()).toHaveText("121");
  await a.screenshot({
    path: "test-results/evidence/mobile-score.png",
    fullPage: true,
  });
  await display.screenshot({
    path: "test-results/evidence/vertical-screen.png",
    fullPage: true,
  });
  state = await (await p2.request.get(`/api/matches/${matchId}`)).json();
  await expect(b.locator(".revision-label")).toContainText(
    `revisie ${state.revision}`,
  );
  await b.getByRole("button", { name: "Schrijven overnemen" }).click();
  await expect(b.getByRole("textbox", { name: "Bezoekscore" })).toBeVisible();
  await expect(a.getByRole("textbox", { name: "Bezoekscore" })).toHaveCount(0);
  await b.getByRole("textbox", { name: "Bezoekscore" }).fill("60");
  await b.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(display.locator(".sprint-number").nth(1)).toHaveText("241");
  for (const [width, height] of [
    [390, 693],
    [540, 960],
  ]) {
    await display.setViewportSize({ width, height });
    expect(
      await display.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      `Live 9:16 ${width}x${height} overflow`,
    ).toBe(true);
  }
  await b.reload();
  await openMatchDetails(b);
  await expect(b.locator(".remaining").nth(1)).toHaveText("241");
  const threeDigitFont = await display
    .locator(".sprint-number")
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize);
  const cardFont = await display
    .locator(".sprint-table tbody td")
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize);
  state = await (await p2.request.get(`/api/matches/${matchId}`)).json();
  for (let visit = 0; visit < 20; visit++)
    state = await action(p2, matchId, state, {
      type: "score",
      score: 0,
      darts: 3,
    });
  await expect(display.locator(".sprint-table tbody tr")).toHaveCount(11);
  expect(
    await display
      .locator(".sprint-table tbody td")
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe(cardFont);
  await expect
    .poll(() =>
      display
        .locator(".sprint-scroll")
        .evaluate(
          (element) =>
            element.scrollTop + element.clientHeight >=
            element.scrollHeight - 2,
        ),
    )
    .toBe(true);
  await display.screenshot({
    path: "test-results/evidence/v15-sprint-long-scorecard.png",
    fullPage: true,
  });
  // A real committed response is lost once; the durable queue retries the same action.
  // The independent phone must first receive the visits committed through the API.
  // Otherwise this scenario exercises a valid stale-revision conflict instead of recovery.
  await expect(b.locator(".revision-label")).toContainText(
    `revisie ${state.revision}`,
  );
  const queueKey = `dartflow-core-queue-v1:${ids.p2}:${matchId}`;
  await expect.poll(() => b.evaluate((key) => {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as CoreScoreQueue).base.revision : null;
  }, queueKey)).toBe(state.revision);
  const scoreAttempts: { requestId: string; expectedRevision: number }[] = [];
  const replayPath = `/api/platform/matches/${matchId}/replay`;
  const trackOfflineScore = (outgoing: Request) => {
    if (
      outgoing.method() !== "POST" ||
      !outgoing.url().endsWith(replayPath)
    )
      return;
    const body = outgoing.postDataJSON();
    for (const command of body.commands ?? []) if (command.action?.type === "score" && command.action.score === 81)
      scoreAttempts.push({
        requestId: command.requestId,
        expectedRevision: command.expectedRevision,
      });
  };
  b.on("request", trackOfflineScore);
  await p2.setOffline(true);
  await b.getByRole("textbox", { name: "Bezoekscore" }).fill("81");
  await b.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(
    b.getByText("Wacht op verbinding (1)", { exact: true }),
  ).toBeVisible();
  const pendingQueue = await b.evaluate((key) => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as CoreScoreQueue : null;
  }, queueKey);
  expect(pendingQueue?.commands).toHaveLength(1);
  const pendingScore = pendingQueue!.commands[0];
  expect(pendingScore).toMatchObject({
    matchId,
    expectedRevision: state.revision,
    action: { type: "score", score: 81 },
  });
  let serverScoreAttempts = 0, lostAcknowledgement = false;
  await b.route(`**${replayPath}`, async route => {
    const body = route.request().postDataJSON();
    if (!body.commands?.some((command: {requestId:string}) => command.requestId === pendingScore.requestId)) return route.continue();
    // Fetch the actual server result first. Aborting only its first delivery
    // simulates a lost ACK after commit, without inventing state or responses.
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).accepted).toContain(pendingScore.requestId);
    serverScoreAttempts++;
    if (!lostAcknowledgement) {lostAcknowledgement = true;return route.abort('failed');}
    return route.fulfill({response});
  });
  await p2.setOffline(false);
  await b.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => serverScoreAttempts).toBeGreaterThanOrEqual(2);
  await expect.poll(() => b.evaluate((key) => {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as CoreScoreQueue).commands.length : null;
  }, queueKey)).toBe(0);
  await expect(b.locator(".remaining").first()).toHaveText("40");
  await expect(display.locator(".sprint-number").first()).toHaveText("40");
  b.off("request", trackOfflineScore);
  await b.unroute(`**${replayPath}`);
  expect(lostAcknowledgement).toBe(true);
  expect(serverScoreAttempts).toBeGreaterThanOrEqual(2);
  expect(scoreAttempts.length).toBeGreaterThanOrEqual(2);
  expect([
    ...new Set(scoreAttempts.map((attempt) => attempt.requestId)),
  ]).toEqual([pendingScore.requestId]);
  expect([
    ...new Set(scoreAttempts.map((attempt) => attempt.expectedRevision)),
  ]).toEqual([state.revision]);
  expect(
    await b.evaluate((key) => (JSON.parse(localStorage.getItem(key)!) as CoreScoreQueue).commands, queueKey),
  ).toEqual([]);
  const recovered = (await (
    await p2.request.get(`/api/matches/${matchId}`)
  ).json()) as MatchView;
  expect(recovered.revision).toBe(state.revision + 1);
  expect(recovered.visits).toHaveLength(state.visits.length + 1);
  expect(recovered.visits.filter(visit => visit.score === 81)).toHaveLength(1);
  const receipt = await owner.query(
    "select count(*)::int n from dartflow_private.action_receipts where match_id=$1 and actor_id=$2 and request_id=$3",
    [matchId, ids.p2, pendingScore.requestId],
  );
  expect(receipt.rows[0].n).toBe(1);
  expect(
    await display
      .locator(".sprint-number")
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe(threeDigitFont);
  await b.getByRole("textbox", { name: "Bezoekscore" }).fill("0");
  await b.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(b.locator(".turn-indicator").first()).toHaveText("AAN DE BEURT");
  await b.getByRole("textbox", { name: "Bezoekscore" }).fill("39");
  await b.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(b.locator("tbody tr").first()).toContainText("BUST");
  await b.getByRole("textbox", { name: "Bezoekscore" }).fill("0");
  await b.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(b.locator(".turn-indicator").first()).toHaveText("AAN DE BEURT");
  await b.getByRole("textbox", { name: "Bezoekscore" }).fill("40");
  await expect(
    b.getByRole("button", { name: "Finish bevestigen" }),
  ).toBeDisabled();
  await b.getByRole("checkbox").check();
  await b.getByRole("button", { name: "Finish bevestigen" }).click();
  await expect(display.locator(".sprint-number").first()).toHaveText("0");
  expect(
    await display
      .locator(".sprint-number")
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe(threeDigitFont);
  await expect(
    a.getByRole("button", { name: "Uitslag bevestigen", exact: true }),
  ).toBeVisible();
  await a
    .getByRole("button", { name: "Uitslag bevestigen", exact: true })
    .click();
  state = await (await p1.request.get(`/api/matches/${matchId}`)).json();
  expect(state.status).toBe("result");
  await expect(b.locator(".confirmation-row > span").first()).toHaveClass(
    "confirmed",
  );
  await b
    .getByRole("button", { name: "Uitslag bevestigen", exact: true })
    .click();
  await expect(
    display.getByText("Uitslag bevestigd", { exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [390, 693],
    [540, 960],
  ]) {
    await display.setViewportSize({ width, height });
    expect(
      await display.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      `Result 9:16 ${width}x${height} overflow`,
    ).toBe(true);
  }
  await a.goto("/historie");
  await expect(
    a
      .locator("tbody tr")
      .filter({ hasText: "Michael de Groot — Raymond van Dijk" })
      .first(),
  ).toBeVisible();
  const row = await owner.query(
    "select count(*)::int n from dartflow_private.match_results where match_id=$1",
    [matchId],
  );
  expect(row.rows[0].n).toBe(1);
  const oldLink = await p1.request.get(`/api/matches/${matchId}`);
  expect((await oldLink.json()).id).toBe(matchId);
  await manager.close();
  await p1.close();
  await p2.close();
  await screen.close();
});

test("mobile layouts and authorization boundaries remain usable", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, "Danny Goldenbelt");
  for (const [width, height] of [
    [320, 568],
    [360, 780],
    [390, 844],
    [667, 375],
    [768, 900],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    for (const route of [
      "/app",
      "/spelen",
      "/evenementen",
      "/wedstrijdleiding",
      "/clubbeheer",
      "/historie",
    ]) {
      await page.goto(route);
      await expect(page.locator(".content")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${route} ${width} overflow`,
      ).toBe(true);
    }
  }
  const forged = await context.request.post("/api/auth/local", {
    headers: { Origin: origin, Host: "staging.dartflow.nl" },
    data: { userId: ids.organizer },
  });
  expect(forged.status()).not.toBe(200);
  const crossOrigin = await context.request.post("/api/auth/local", {
    headers: { Origin: "https://evil.example" },
    data: { userId: ids.organizer },
  });
  expect(crossOrigin.status()).toBe(403);
  const large = await context.request.post("/api/auth/local", {
    headers: { Origin: origin },
    data: { userId: ids.organizer, padding: "x".repeat(9000) },
  });
  expect(large.status()).toBe(413);
  const wrongMatch = await context.request.post(
    "/api/matches/30000000-0000-4000-8000-000000000001/actions",
    {
      headers: { Origin: origin },
      data: {
        requestId: randomUUID(),
        expectedRevision: 0,
        matchId: randomUUID(),
        action: { type: "start" },
      },
    },
  );
  expect(wrongMatch.status()).toBe(409);
  await context.close();
  const outsider = await browser.newContext();
  const o = await outsider.newPage();
  await login(o, "Speler andere club");
  const denied = await outsider.request.get("/api/overview?clubId=" + ids.club);
  expect(denied.status()).toBe(403);
  const anon = await browser.newContext();
  expect((await anon.request.get("/api/overview")).status()).toBe(401);
  await outsider.close();
  await anon.close();
});

test("v15 marketing and server-backed training preserve their own state", async ({
  browser,
}) => {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Darten, waar je ook speelt.",
  );
  await expect(page.locator("[data-score-form]")).toBeVisible();
  await page.locator('[data-visit="100"]').click();
  await expect(page.locator('[data-remaining="0"]')).toHaveText("48");
  await page.locator("[data-undo]").click();
  await expect(page.locator('[data-remaining="0"]')).toHaveText("148");
  await page.getByRole("tab", { name: "Online spelen", exact: true }).click();
  await expect(page.locator("#paneel-online")).toBeVisible();
  await page.locator("#toernooiregie").scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('img[src="/assets/marketing-venue.webp"]')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/evidence/v15-marketing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/evidence/v15-marketing-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await login(page, "Michael de Groot", "/app/training");
  await page
    .locator("form")
    .filter({
      has: page.getByRole("heading", { name: "Solo X01", exact: true }),
    })
    .getByRole("button", { name: "Start training" })
    .click();
  await expect(page).toHaveURL(/\/app\/training\/[a-f0-9-]{36}/);
  await openMatchDetails(page);
  await page.getByRole("spinbutton").fill("180");
  await page
    .getByRole("button", { name: "Score invoeren", exact: true })
    .click();
  await expect(page.locator(".training-remaining")).toHaveText("321");
  await page.reload();
  await openMatchDetails(page);
  await expect(page.locator(".training-remaining")).toHaveText("321");
  await page
    .getByRole("button", { name: "Laatste beurt terug", exact: true })
    .click();
  await expect(page.locator(".training-remaining")).toHaveText("501");
  await page
    .getByRole("button", {
      name: "Training bewaren en beëindigen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Score invoeren", exact: true }),
  ).toBeDisabled();
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("a club membership and room message are shared between separate accounts", async ({
  browser,
}) => {
  const manager = await browser.newContext(),
    member = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  const a = await manager.newPage(),
    b = await member.newPage();
  const clubName = `V15 browserclub ${randomUUID().slice(0, 8)}`;
  await login(a, "Danny Goldenbelt", "/app/clubs");
  const createClub = a.locator("form").filter({
    has: a.getByRole("heading", {
      name: "Vereniging oprichten",
      exact: true,
    }),
  });
  await createClub.getByLabel("Naam", { exact: true }).fill(clubName);
  await createClub.getByRole("button", { name: "Vereniging aanmaken" }).click();
  await expect(a).toHaveURL(/\/app\/clubs\/[a-f0-9-]{36}/);
  const clubPath = new URL(a.url()).pathname;
  await login(b, "Raymond van Dijk", clubPath);
  await b
    .getByRole("button", { name: "Aanvraag versturen", exact: true })
    .click();
  await a.getByRole("navigation", { name: "Verenigingsonderdelen" }).getByRole("button", { name: "Aanvragen", exact: true }).click();
  await a.getByRole("button", { name: "Accepteren", exact: true }).click();
  await expect(b.locator(".club-workspace .pill")).toHaveText("Clublid");
  await a.goto("/app/community");
  const roomName = `V15 browserkamer ${randomUUID().slice(0, 8)}`;
  const createRoom = a.locator("form").filter({
    has: a.getByRole("heading", { name: "Nieuwe kamer", exact: true }),
  });
  await createRoom.getByLabel("Naam", { exact: true }).fill(roomName);
  await createRoom.getByRole("button", { name: "Kamer maken" }).click();
  await expect(a).toHaveURL(/\/app\/community\/[a-f0-9-]{36}/);
  const roomPath = new URL(a.url()).pathname;
  await b.goto(roomPath);
  await b
    .getByRole("button", { name: "Kamer binnengaan", exact: true })
    .click();
  await b
    .getByRole("textbox", { name: "Bericht", exact: true })
    .fill("Deze chat staat op de server.");
  await b.getByRole("button", { name: "Verstuur", exact: true }).click();
  await expect(
    a.getByText("Deze chat staat op de server.", { exact: true }),
  ).toBeVisible();
  await a.screenshot({
    path: "test-results/evidence/v15-shared-room.png",
    fullPage: true,
  });
  await a.reload();
  await expect(
    a.getByText("Deze chat staat op de server.", { exact: true }),
  ).toBeVisible();
  await manager.close();
  await member.close();
});
