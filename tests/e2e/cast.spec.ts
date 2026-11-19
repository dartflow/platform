import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI supplies the local fixture environment. */
}
const origin = "http://localhost:3000";
async function login(page: Page) {
  await page.goto("/inloggen?next=/app/events");
  await page.getByRole("button", { name: /Danny Goldenbelt/ }).click();
  await expect(page).toHaveURL(`${origin}/app/events`);
}
test("a real event publishes a separate preview and revocable public OBS program", async ({
  browser,
}) => {
  test.setTimeout(90000);
  if (process.env.DARTFLOW_DATA_MODE !== "local")
    throw new Error("This browser scenario requires local fixture accounts.");
  const organizer = await browser.newContext(),
    viewer = await browser.newContext();
  const page = await organizer.newPage(),
    screen = await viewer.newPage();
  const name = `Browsercast ${randomUUID().slice(0, 8)}`;
  await login(page);
  await page
    .getByRole("button", { name: "Nieuw toernooi", exact: true })
    .click();
  const form = page.locator("form").filter({
    has: page.getByRole("heading", {
      name: "Toernooi aanmaken",
      exact: true,
    }),
  });
  await form.getByLabel("Naam", { exact: true }).fill(name);
  await form.getByLabel("Datum", { exact: true }).fill("2030-01-20");
  await form
    .getByRole("combobox", { name: "Format", exact: true })
    .selectOption("knockout");
  await form.getByLabel("Aantal banen", { exact: true }).fill("2");
  await form
    .getByRole("button", { name: "Evenement aanmaken", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/hall\/[a-f0-9-]{36}/);
  const eventId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto(`/app/venue-cast/studio?event=${eventId}`);
  await expect(
    page.getByRole("combobox", { name: "Speeldag", exact: true }),
  ).toHaveValue(eventId);
  await page
    .getByRole("button", { name: "Schermlinks uitgeven", exact: true })
    .click();
  const output = page
    .locator(".cast-share-links .workspace-row")
    .first()
    .getByRole("link", { name: "Openen" });
  const url = await output.getAttribute("href");
  expect(url).toMatch(/\/cast\//);
  await screen.goto(url!);
  await expect(
    screen.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  expect((await viewer.request.get("/api/platform")).status()).toBe(401);
  await page
    .getByRole("combobox", { name: "Scene", exact: true })
    .selectOption("180");
  await page
    .getByRole("button", { name: "Preview klaarzetten", exact: true })
    .click();
  await expect(
    page
      .locator(".workspace-cast-preview")
      .first()
      .getByRole("heading", { name: "180!", exact: true }),
  ).toBeVisible();
  await expect(screen.locator(".cast-output-moment")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Zet preview live", exact: true })
    .click();
  await expect(screen.locator(".cast-output-moment > strong")).toHaveText(
    "180",
  );
  await screen.screenshot({
    path: "test-results/evidence/v15-public-cast.png",
    fullPage: true,
  });
  await screen.goto(url!.replace("view=hall", "view=obs"));
  await expect
    .poll(() =>
      screen.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
  await page
    .getByRole("button", { name: "Schermlinks intrekken", exact: true })
    .click();
  await expect(
    screen.getByRole("heading", {
      name: "Scherm niet beschikbaar",
      exact: true,
    }),
  ).toBeVisible();
  await organizer.close();
  await viewer.close();
});

test("a pending tournament application needs real approval and preserves editable venue settings", async ({
  browser,
}) => {
  test.setTimeout(90000);
  if (process.env.DARTFLOW_DATA_MODE !== "local")
    throw new Error("This browser scenario requires local fixture accounts.");
  const organizer = await browser.newContext(),
    player = await browser.newContext();
  const page = await organizer.newPage(),
    applicant = await player.newPage();
  const name = `Browseraanmelding ${randomUUID().slice(0, 8)}`;
  await login(page);
  await page
    .getByRole("button", { name: "Nieuw toernooi", exact: true })
    .click();
  const creation = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", {
        name: "Toernooi aanmaken",
        exact: true,
      }),
    });
  await creation.getByLabel("Naam", { exact: true }).fill(name);
  await creation.getByRole("combobox", {name:"Zichtbaarheid",exact:true}).selectOption("public");
  await creation.getByLabel("Locatie", { exact: true }).fill("Zaal A");
  await creation.getByLabel("Datum", { exact: true }).fill("2030-02-20");
  await creation
    .getByLabel("Aanmeldingen eerst door de organisatie laten goedkeuren")
    .check();
  await creation
    .getByRole("button", { name: "Evenement aanmaken", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/hall\/[a-f0-9-]{36}/);
  const route = new URL(page.url()).pathname;
  await applicant.goto(`/inloggen?next=${encodeURIComponent(route)}`);
  await applicant.getByRole("button", { name: /Michael de Groot/ }).click();
  await expect(applicant).toHaveURL(new URL(route, origin).href);
  await applicant
    .getByRole("button", { name: "Inschrijven", exact: true })
    .click();
  await expect(
    applicant.getByRole("button", { name: "Ik ben aanwezig", exact: true }),
  ).toBeDisabled();
  await expect(
    applicant.getByText("In behandeling", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    applicant.getByRole("link", { name: /Toernooikamer openen/ }),
  ).toHaveCount(0);
  const row = page
    .locator(".workspace-row")
    .filter({ has: page.getByText("Michael de Groot", { exact: true }) });
  await expect(row.getByText("In behandeling", { exact: true })).toBeVisible();
  await page.getByText("Instellingen & baanbeheer", { exact: true }).click();
  const settings = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", {
        name: "Speeldaginstellingen",
        exact: true,
      }),
    });
  await expect(
    settings.getByLabel(
      "Aanmeldingen eerst door de organisatie laten goedkeuren",
    ),
  ).toBeDisabled();
  await settings.getByLabel("Locatie", { exact: true }).fill("Zaal B");
  await settings.getByRole("button", { name: "Opslaan", exact: true }).click();
  await expect(
    page
      .locator(".workspace-heading")
      .filter({ has: page.getByRole("heading", { name, exact: true }) }),
  ).toContainText("Zaal B");
  await row
    .getByRole("button", { name: "Aanmelding goedkeuren", exact: true })
    .click();
  await expect(
    applicant.getByRole("button", { name: "Ik ben aanwezig", exact: true }),
  ).toBeEnabled();
  const checkedIn = applicant.waitForResponse((response) => {
    if (!response.url().endsWith('/api/platform/actions') || response.request().method() !== 'POST') return false;
    return response.request().postDataJSON()?.action?.type === 'competition.checkin';
  });
  await applicant
    .getByRole("button", { name: "Ik ben aanwezig", exact: true })
    .click();
  const checkInResponse=await checkedIn;
  expect(checkInResponse.status(),await checkInResponse.text()).toBe(200);
  await page.bringToFront();
  await expect(row.getByText("Ingecheckt", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) =>
    dialog.accept("Deze aanmelding is na overleg met de speler ingetrokken."),
  );
  await row
    .getByRole("button", { name: "Aanmelding weigeren", exact: true })
    .click();
  await expect(
    applicant.getByRole("button", { name: "Inschrijven", exact: true }),
  ).toBeVisible();
  await organizer.close();
  await player.close();
});
