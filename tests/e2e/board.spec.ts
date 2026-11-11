import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI supplies fixture credentials. */
}
const origin = "http://localhost:3000";
const eventId = randomUUID(),
  boardId = randomUUID();
const club = "10000000-0000-4000-8000-000000000001";
const organizerId = "00000000-0000-4000-8000-000000000001";
const players = [
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const boardName = `QR-vrijspelen ${boardId.slice(0, 8)}`;
let owner: pg.Client;
async function login(page: Page, name: string, next: string) {
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(new URL(next, origin).href);
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
      "Board browser tests require the explicit local fixture database.",
    );
  owner = new pg.Client({
    connectionString: process.env.DARTFLOW_DATABASE_ADMIN_URL,
  });
  await owner.connect();
  await owner.query(
    "insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,2)",
    [eventId, club, boardName],
  );
  await owner.query(
    "insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)",
    [eventId, organizerId],
  );
  await owner.query(
    "insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)",
    [boardId, eventId, boardName],
  );
  for (const id of players)
    await owner.query(
      "insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,'registered',true)",
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
    "platform_match_links",
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
  await owner.query(
    "delete from dartflow_private.platform_audit where entity_id in(select id from dartflow_private.platform_entities where state->>'boardId'=$1)",
    [boardId],
  );
  await owner.query(
    "delete from dartflow_private.platform_entities where state->>'boardId'=$1",
    [boardId],
  );
  await owner.query("delete from dartflow_private.events where id=$1", [
    eventId,
  ]);
  await owner.end();
});

test("one physical QR binds persisted solo and two real local players to its read-only Sprint screen", async ({
  browser,
}) => {
  test.setTimeout(120000);
  await mkdir("test-results/evidence", { recursive: true });
  const first = await browser.newContext(),
    second = await browser.newContext(),
    manager = await browser.newContext(),
    publicViewer = await browser.newContext();
  const a = await first.newPage(),
    b = await second.newPage(),
    m = await manager.newPage(),
    screen = await publicViewer.newPage();
  await login(m, "Danny Goldenbelt", "/app");
  const issued = await manager.request.post("/api/screens", {
    headers: { Origin: origin },
    data: { eventId, boardId },
  });
  expect(issued.status(), await issued.text()).toBe(200);
  const grant = await issued.json();
  await screen.goto(grant.url);
  await login(a, "Michael de Groot", `/baan/${boardId}`);
  await expect(
    a.getByRole("heading", { name: "Vrij spelen op deze baan" }),
  ).toBeVisible();
  await a
    .getByRole("combobox", { name: "Spelvorm", exact: true })
    .selectOption("solo");
  await a
    .getByRole("button", { name: "Op deze baan starten", exact: true })
    .click();
  await expect(a).toHaveURL(/\/app\/training\/[a-f0-9-]{36}$/);
  await a.getByLabel("Beurtscore", { exact: true }).fill("180");
  await a.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(a.locator(".training-remaining")).toHaveText("321");
  await expect(screen.locator(".sprint-number").first()).toHaveText("321");
  await screen.screenshot({
    path: "test-results/evidence/v15-bound-solo-sprint.png",
    fullPage: true,
  });
  await a
    .getByRole("button", { name: "Sprint-scherm koppelen", exact: true })
    .click();
  const participantLink = await a
    .getByRole("link", { name: "Alleen-lezen Sprint openen", exact: true })
    .getAttribute("href");
  expect(participantLink).toMatch(/^\/scherm\/[A-Za-z0-9_-]{64}$/);
  const limitedScreen = await publicViewer.newPage();
  await limitedScreen.goto(participantLink!);
  await expect(limitedScreen.locator(".sprint-number").first()).toHaveText(
    "321",
  );
  await limitedScreen.goto(
    `/app/spectator/${participantLink!.split("/").at(-1)}`,
  );
  await expect(limitedScreen.locator(".sprint-number").first()).toHaveText(
    "321",
  );
  await a.goto(`/baan/${boardId}`);
  await expect(a.locator(".training-remaining")).toHaveText("321");
  await a.reload();
  await expect(a.locator(".training-remaining")).toHaveText("321");
  await a
    .getByRole("button", {
      name: "Training bewaren en beëindigen",
      exact: true,
    })
    .click();
  await expect(
    limitedScreen.getByRole("heading", {
      name: "Scherm niet beschikbaar",
      exact: true,
    }),
  ).toBeVisible();
  await a.goto(`/baan/${boardId}`);
  await expect(
    a.getByRole("button", { name: "Op deze baan starten", exact: true }),
  ).toBeVisible();
  await a
    .getByRole("combobox", { name: "Spelvorm", exact: true })
    .selectOption("local");
  await a
    .getByRole("combobox", { name: "Best of legs", exact: true })
    .selectOption("1");
  await a
    .getByRole("button", { name: "Op deze baan starten", exact: true })
    .click();
  await expect(a).toHaveURL(/\/app\/lobby\/[a-f0-9-]{36}/);
  await login(b, "Raymond van Dijk", `/baan/${boardId}`);
  await b
    .getByRole("button", { name: "Meedoen aan deze baan", exact: true })
    .click();
  await expect(b).toHaveURL(/\/app\/lobby\/[a-f0-9-]{36}/);
  await expect(
    a.getByText("Raymond van Dijk", { exact: true }).first(),
  ).toBeVisible();
  await a
    .getByRole("button", { name: "Ik sta klaar aan het bord", exact: true })
    .click();
  await expect(
    b.getByRole("button", { name: "Ik sta klaar aan het bord", exact: true }),
  ).toBeEnabled();
  // Let the independent second browser receive the first readiness revision.
  await expect(
    b
      .locator(".workspace-row")
      .filter({ hasText: "Michael de Groot" })
      .getByText("Gereed", { exact: true }),
  ).toBeVisible();
  await b
    .getByRole("button", { name: "Ik sta klaar aan het bord", exact: true })
    .click();
  await expect(
    a.getByRole("button", { name: "Wedstrijd starten", exact: true }),
  ).toBeEnabled();
  await a
    .getByRole("button", { name: "Wedstrijd starten", exact: true })
    .click();
  await expect(a).toHaveURL(/\/wedstrijd\/[a-f0-9-]{36}$/);
  const matchId = new URL(a.url()).pathname.split("/").at(-1)!;
  await b.goto(`/baan/${boardId}`);
  await expect(b.locator(".scoreboard")).toBeVisible();
  await a
    .getByRole("button", { name: "Ik ben klaar om te spelen", exact: true })
    .click();
  await expect(
    b.locator(".match-details").getByText("1 / 2 bevestigd", { exact: true }),
  ).toBeVisible();
  await b
    .getByRole("button", { name: "Ik ben klaar om te spelen", exact: true })
    .click();
  await a
    .getByRole("button", { name: "Wedstrijd starten", exact: true })
    .click();
  await expect(a.locator(".score-form")).toBeVisible();
  await a.locator("#visit-score").fill("100");
  await a.getByRole("button", { name: "Score invoeren", exact: true }).click();
  await expect(screen.locator(".sprint-number").first()).toHaveText("401");
  await a.screenshot({
    path: "test-results/evidence/v15-physical-board-match.png",
    fullPage: true,
  });
  const readOnly = await first.newPage();
  await readOnly.goto(`/app/spectator/${matchId}`);
  await expect(readOnly.locator(".sprint-number").first()).toHaveText("401");
  await expect(readOnly.locator(".score-form, .sidebar")).toHaveCount(0);
  await screen.goto(`/app/overlay/${grant.token}`);
  await expect(screen.locator(".readonly-overlay")).toContainText("401");
  await expect
    .poll(() =>
      screen.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
  await screen.goto(`/app/spectator/${matchId}`);
  await expect(
    screen.getByRole("link", {
      name: "Inloggen om deze wedstrijd te bekijken",
    }),
  ).toBeVisible();
  await screen.goto("/app/spectator/12345");
  await expect(
    screen.getByRole("heading", {
      name: "Scherm niet beschikbaar",
      exact: true,
    }),
  ).toBeVisible();
  await first.close();
  await second.close();
  await manager.close();
  await publicViewer.close();
});
