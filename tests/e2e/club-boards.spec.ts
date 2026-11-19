import {openMatchDetails} from './helpers/score-console';
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { MatchView } from "../../lib/types";

test.use({ actionTimeout: 10000 });

const origin = "http://localhost:3000";
async function login(page: Page, name: string, next: string) {
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(new URL(next, origin).href);
}
async function matchAction(context: BrowserContext, id: string, action: Record<string, unknown>) {
  const response = await context.request.get(`/api/matches/${id}`);
  expect(response.status()).toBe(200);
  const state: MatchView = await response.json();
  const result = await context.request.post(`/api/matches/${id}/actions`, {
    headers: { Origin: origin },
    data: { requestId: randomUUID(), matchId: id, expectedRevision: state.revision, action },
  });
  expect(result.status(), await result.text()).toBe(200);
  return result.json() as Promise<MatchView>;
}

test("club boards provide permanent registration QR and live read-only scoring without event signup", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
    throw new Error("Club board browser tests require the local fixture application.");
  }
  const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const first = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const second = await browser.newContext();
  const viewer = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: "block" });
  let fixtureMatchId: string | undefined;
  try {
    const session = await owner.request.get("/api/session");
    if (!(await session.json()).local) throw new Error("Local fixture authentication is required.");
    let publicAuthRequests = 0;
    await viewer.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (/^\/(?:api\/auth|auth)(?:\/|$)/.test(url.pathname) || url.pathname === "/api/session") {
        publicAuthRequests++;
        return route.abort("blockedbyclient");
      }
      if (url.origin !== origin || !["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.abort("blockedbyclient");
      return route.continue();
    });
    const manager = await owner.newPage(), a = await first.newPage(), b = await second.newPage(), screen = await viewer.newPage();
    const suffix = randomUUID().slice(0, 8);
    const clubName = `Verenigingsbanen ${suffix}`, openName = `Vrij bord ${suffix}`, restrictedName = `Ledenbord ${suffix}`;
    await login(manager, "Danny Goldenbelt", "/app/clubs");
    const activated=await owner.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'location.enable-venue'}}});
    expect(activated.status(),await activated.text()).toBe(200);
    const clubForm = manager.locator("form").filter({ has: manager.getByRole("heading", { name: "Vereniging oprichten", exact: true }) });
    await clubForm.getByLabel("Naam", { exact: true }).fill(clubName);
    await clubForm.getByRole("button", { name: "Vereniging aanmaken", exact: true }).click();
    await expect(manager).toHaveURL(/\/app\/clubs\/[a-f0-9-]{36}(?:\?|$)/);
    const clubId = new URL(manager.url()).pathname.split("/").at(-1)!;
    await manager.getByRole("navigation", { name: "Vereniging", exact: true }).getByRole("link", { name: "Banen", exact: true }).click();
    await expect(manager).toHaveURL(`/app/clubs/${clubId}/banen`);
    await manager.getByRole("button", { name: "Baan toevoegen", exact: true }).click();
    let create = manager.locator("form").filter({ has: manager.getByRole("heading", { name: "Baan toevoegen", exact: true }) });
    await expect(create.getByRole("combobox", { name: "Wie mag spelen?", exact: true })).toHaveValue("all");
    await expect(create.getByLabel("Naam van de baan", { exact: true })).toHaveAttribute("maxlength", "80");
    await create.getByLabel("Naam van de baan", { exact: true }).fill(openName);
    await create.getByRole("button", { name: "Baan aanmaken", exact: true }).click();
    const board = manager.getByRole("article", { name: openName, exact: true });
    await expect(board).toBeVisible();
    const playUrl = await board.getByRole("link", { name: "Open deze baan ↗", exact: true }).getAttribute("href");
    expect(playUrl).toMatch(/^\/baan\/[a-f0-9-]{36}$/);
    const screenUrl = await board.getByRole("link", { name: "Open baanscherm", exact: false }).getAttribute("href");
    expect(screenUrl).toMatch(/^\/baanscherm\/[a-f0-9-]{36}$/);
    await expect(board.getByRole("img", { name: /QR-code:/ })).toHaveAttribute("src", /^data:image\/png/);
    await screen.goto(screenUrl!);
    await expect(screen.getByRole("heading", { name: openName, exact: true })).toBeVisible();
    await expect(screen.getByRole("heading", { name: "Scan en speel.", exact: true })).toBeVisible();
    await expect(screen.getByRole("link", { name: "Open deze baan ↗", exact: true })).toHaveAttribute("href", playUrl!);

    // A visitor follows the permanent QR, authenticates as their own fixture account,
    // and returns to the board without joining the club or entering an event.
    await a.goto(playUrl!);
    await a.getByRole("link", { name: "Registreren of aanmelden", exact: true }).click();
    expect(new URL(a.url()).searchParams.get("next")).toBe(playUrl);
    await a.getByRole("button", { name: /Michael de Groot/ }).click();
    await expect(a).toHaveURL(playUrl!);
    await expect(a.getByRole("heading", { name: "Vrij spelen op deze baan", exact: true })).toBeVisible();
    await a.getByRole("combobox", { name: "Spelvorm", exact: true }).selectOption("local");
    await a.getByRole("combobox", { name: "Startscore", exact: true }).selectOption("301");
    await a.getByRole("combobox", { name: "Best of legs", exact: true }).selectOption("1");
    // Keep this registration/binding case on its published fixed opener; the
    // separate release-bull-start case verifies the complete bull procedure.
    await a.locator('select[name="startProcedure"]').selectOption('home-first');
    await a.getByRole("button", { name: "Op deze baan starten", exact: true }).click();
    await expect(a).toHaveURL(/\/app\/lobby\/[a-f0-9-]{36}/);
    await expect(screen.getByRole("heading", { name: "Jouw tegenstander staat klaar.", exact: true })).toBeVisible();
    await expect(screen.getByRole("link", { name: "Open deze baan ↗", exact: true })).toHaveAttribute("href", playUrl!);
    await login(b, "Raymond van Dijk", playUrl!);
    await b.getByRole("button", { name: "Meedoen aan deze baan", exact: true }).click();
    await expect(b).toHaveURL(/\/app\/lobby\/[a-f0-9-]{36}/);
    await expect(a.getByText("Raymond van Dijk", { exact: true }).first()).toBeVisible();
    await a.getByRole("button", { name: "Ik sta klaar aan het bord", exact: true }).click();
    await expect(b.locator(".workspace-row").filter({ hasText: "Michael de Groot" }).getByText("Gereed", { exact: true })).toBeVisible();
    await b.getByRole("button", { name: "Ik sta klaar aan het bord", exact: true }).click();
    await expect(a.getByRole("button", { name: "Wedstrijd starten", exact: true })).toBeEnabled();
    await a.getByRole("button", { name: "Wedstrijd starten", exact: true }).click();
    await expect(a).toHaveURL(/\/wedstrijd\/[a-f0-9-]{36}$/);
    const matchId = new URL(a.url()).pathname.split("/").at(-1)!;
    fixtureMatchId = matchId;
    await b.goto(playUrl!);
    await expect(b.locator(".scoreboard")).toBeVisible();
    await a.getByRole("button", { name: "Ik ben klaar om te spelen", exact: true }).click();
    await expect(b.locator(".match-details").getByText("1 / 2 bevestigd", { exact: true })).toBeVisible();
    await b.getByRole("button", { name: "Ik ben klaar om te spelen", exact: true }).click();
    await expect(a.getByRole("button", { name: "Wedstrijd starten", exact: true })).toBeEnabled();
    await a.getByRole("button", { name: "Wedstrijd starten", exact: true }).click();
    await openMatchDetails(a);await openMatchDetails(b);
    await a.locator("#visit-score").fill("100");
    await a.getByRole("button", { name: "Score invoeren", exact: true }).click();
    await expect(screen.locator(".sprint-number").first()).toHaveText("201");
    await expect(screen.locator(".score-form, .sidebar")).toHaveCount(0);
    await screen.locator('summary[aria-label="Wedstrijdinformatie"]').click();
    await expect(screen.getByRole("link", { name: "Registreren, aanmelden en spelen", exact: true })).toHaveAttribute("href", playUrl!);
    await expect(screen.locator(".sprint-writer")).toHaveText("Scan om te registreren of aan te melden en mee te spelen");
    expect(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const context of [first, second]) {
      const overview = await (await context.request.get("/api/platform")).json();
      const visibleClub = overview.clubs.find((club: { id: string }) => club.id === clubId);
      expect(visibleClub?.members.some((member: { id: string }) => member.id === overview.profile.id) || false).toBe(false);
      expect(overview.tournaments.filter((event: { clubId: string }) => event.clubId === clubId)).toHaveLength(0);
      expect(overview.leagues.filter((event: { clubId: string }) => event.clubId === clubId)).toHaveLength(0);
    }

    await manager.getByRole("button", { name: "Baan toevoegen", exact: true }).click();
    create = manager.locator("form").filter({ has: manager.getByRole("heading", { name: "Baan toevoegen", exact: true }) });
    await create.getByLabel("Naam van de baan", { exact: true }).fill(restrictedName);
    await create.getByRole("combobox", { name: "Wie mag spelen?", exact: true }).selectOption("club");
    await create.getByRole("button", { name: "Baan aanmaken", exact: true }).click();
    const restricted = manager.getByRole("article", { name: restrictedName, exact: true });
    const restrictedUrl = await restricted.getByRole("link", { name: "Open deze baan ↗", exact: true }).getAttribute("href");
    const restrictedId = restrictedUrl!.split("/").at(-1)!;
    const denial = await first.request.get(`/api/boards/${restrictedId}`);
    expect(denial.status()).toBe(403);
    const rejectedStart = await first.request.post("/api/platform/actions", {
      headers: { Origin: origin }, data: { requestId: randomUUID(), action: { type: "board.start", boardId: restrictedId, mode: "solo" } },
    });
    expect(rejectedStart.status()).toBe(403);
    const outsider = await first.newPage();
    await outsider.goto(restrictedUrl!);
    await expect(outsider.getByRole("heading", { name: "Baan niet beschikbaar", exact: true })).toBeVisible();
    await expect(outsider.getByRole("button", { name: "Op deze baan starten", exact: true })).toHaveCount(0);
    await restricted.getByText("Baan beheren", { exact: true }).click();
    await restricted.getByRole("button", { name: "Baan blokkeren", exact: true }).click();
    await expect(restricted.getByText("Geblokkeerd", { exact: true })).toBeVisible();
    const restrictedScreen = await viewer.newPage();
    await restrictedScreen.goto(`/baanscherm/${restrictedId}`);
    await expect(restrictedScreen.getByText("Buiten gebruik", { exact: true })).toBeVisible();
    await expect(restrictedScreen.getByRole("link", { name: "Open deze baan ↗", exact: true })).toHaveAttribute("href", restrictedUrl!);
    await restricted.getByRole("button", { name: "Baan vrijgeven", exact: true }).click();
    await expect(restrictedScreen.getByText("Baan vrij", { exact: true })).toBeVisible();
    expect(publicAuthRequests).toBe(0);

    // Finish this fixture match through the real scorer and both actual players.
    // The same public board display then returns to its permanent idle QR.
    let state: MatchView = await (await first.request.get(`/api/matches/${matchId}`)).json();
    for (let turn = 0; state.status === "live" && turn < 8; turn++) {
      const remaining = state.remaining[0];
      state = await matchAction(first, matchId, {
        type: "score", score: state.turn === 0 ? remaining > 170 ? remaining - 40 : remaining : 0,
        ...(state.turn === 0 && remaining <= 170 ? { doubleConfirmed: true } : {}),
      });
    }
    expect(state.status).toBe("result");
    await matchAction(first, matchId, { type: "confirm" });
    await matchAction(second, matchId, { type: "confirm" });
    await expect(screen.getByRole("heading", { name: "Scan en speel.", exact: true })).toBeVisible();
    await expect(screen.getByRole("link", { name: "Open deze baan ↗", exact: true })).toHaveAttribute("href", playUrl!);
    expect(publicAuthRequests).toBe(0);
  } finally {
    // Keep a failed display assertion from leaving the shared local test players busy.
    if (fixtureMatchId) try {
      let state: MatchView = await (await first.request.get(`/api/matches/${fixtureMatchId}`)).json();
      // A failure before the first dart can leave the new bull flow pending.
      // Complete only this fixture through its ordinary two authenticated sides.
      if (['called','ready'].includes(state.status)) {
        if (!state.accepted[0]) state = await matchAction(first, fixtureMatchId, {type:'accept'});
        if (!state.accepted[1]) state = await matchAction(second, fixtureMatchId, {type:'accept'});
        for(let round=0;state.bull&&state.bull.status!=='complete'&&round<8;round++) {
          if(state.bull.status==='throwing')state=await matchAction(first,fixtureMatchId,{type:'bull-throw',hit:state.bull.throws.some(hit=>hit.round===state.bull!.round)?'outside':'DB'});
          else {
            for(const context of[first,second]){
              const own:MatchView=await(await context.request.get(`/api/matches/${fixtureMatchId}`)).json();
              if(own.permissions.canBullConfirm)state=await matchAction(context,fixtureMatchId,{type:'bull-confirm'});
            }
          }
        }
        if(state.status==='ready')state=await matchAction(first,fixtureMatchId,{type:'start'});
      }
      for (let turn = 0; state.status === "live" && turn < 8; turn++) {
        const remaining = state.remaining[0];
        state = await matchAction(first, fixtureMatchId, {
          type: "score", score: state.turn === 0 ? remaining > 170 ? Math.min(180,remaining - 40) : remaining : 0,
          ...(state.turn === 0 && remaining <= 170 ? { doubleConfirmed: true } : {}),
        });
      }
      if (state.status === "result") {
        await matchAction(first, fixtureMatchId, { type: "confirm" });
        await matchAction(second, fixtureMatchId, { type: "confirm" });
      }
    } catch { /* Preserve the original failure; cleanup only targets this fixture match. */ }
    await Promise.allSettled([owner.close(), first.close(), second.close(), viewer.close()]);
  }
});
