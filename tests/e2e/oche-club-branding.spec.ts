import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ClubhouseView } from "../../lib/clubhouse-types";
import type {
  OcheDisplaySnapshot,
  OcheManagement,
} from "../../lib/oche-device-types";

const origin = "http://localhost:3000";
async function post<T>(
  context: BrowserContext,
  path: string,
  data: unknown,
): Promise<T> {
  const response = await context.request.post(path, {
    headers: { Origin: origin },
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
const action = <T>(
  context: BrowserContext,
  path: string,
  action: Record<string, unknown>,
  expectedRevision?: number,
) =>
  post<T>(context, path, {
    requestId: randomUUID(),
    action,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  });

test("a physical manager explicitly chooses a published club style; browser frames expire offline and reset after location consent is revoked", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150000);
  if (
    !baseURL ||
    !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)
  )
    throw Error("Local synthetic acceptance only.");
  const owner = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    }),
    screen = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
  const suffix = randomUUID().slice(0, 8);
  let clubId = "",
    deviceId = "",
    grantId = "",
    grantRevision = 0;
  try {
    expect((await (await owner.request.get("/api/session")).json()).local).toBe(
      true,
    );
    await post(owner, "/api/auth/local", {
      userId: "00000000-0000-4000-8000-000000000001",
      next: "/app/schermen",
    });
    clubId = (
      await action<{ id: string }>(owner, "/api/platform/actions", {
        type: "club.create",
        name: `Ocheclub ${suffix}`,
      })
    ).id;
    await action(owner, "/api/clubhouse/actions", {
      type: "entitlement.grant",
      clubId,
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2099-01-01T00:00:00Z",
    });
    let club: ClubhouseView = await (
      await owner.request.get(`/api/clubhouse/${clubId}?page=manage`)
    ).json();
    await action(
      owner,
      "/api/clubhouse/actions",
      {
        type: "branding.save",
        clubId,
        design: {
          name: `Ontwerp ${suffix}`,
          primary: "#1558cc",
          secondary: "#c2185b",
          logoData: null,
        },
      },
      club.branding!.revision,
    );
    club = await (
      await owner.request.get(`/api/clubhouse/${clubId}?page=manage`)
    ).json();
    await action(
      owner,
      "/api/clubhouse/actions",
      { type: "branding.publish", clubId },
      club.branding!.revision,
    );
    await action(owner, "/api/platform/actions", {
      type: "location.enable-venue",
    });
    const location = await action<{ id: string }>(
      owner,
      "/api/platform/actions",
      {
        type: "location.create",
        name: `Ochelocatie ${suffix}`,
        timezone: "Europe/Amsterdam",
      },
    );
    const board = await action<{ id: string }>(owner, "/api/platform/actions", {
      type: "location.board.create",
      locationId: location.id,
      name: `Ochebaan ${suffix}`,
    });
    const grant = await post<{ grant: { id: string; revision: number } }>(
      owner,
      "/api/competition-wizard",
      {
        requestId: randomUUID(),
        action: {
          type: "planning.grant",
          clubId,
          locationId: location.id,
          expectedRevision: 0,
          boardIds: [board.id],
          windows: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            startTime: "00:00",
            endTime: "23:59",
          })),
          reason: "Expliciete lokale locatiegoedkeuring voor de schermstijl.",
        },
      },
    );
    grantId = grant.grant.id;
    grantRevision = grant.grant.revision;
    const display = await screen.newPage();
    await display.goto("/oche-live");
    await expect(display.locator(".oche-device-code")).toBeVisible();
    await post(owner, "/api/oche/v1/claim", {
      code: await display.locator(".oche-device-code").innerText(),
      scope: "location",
      locationId: location.id,
      boardId: board.id,
      name: `Ochescherm ${suffix}`,
      requestId: randomUUID(),
    });
    await expect(display.locator(".oche-screen-theme")).toHaveAttribute(
      "data-oche-theme",
      "dartflow",
    );
    await expect(display.locator(".oche-device-display")).toHaveAttribute(
      "data-device-state",
      "display",
    );
    const context: OcheManagement = await (
      await owner.request.get("/api/oche/v1/context")
    ).json();
    deviceId = context.devices.find(
      (d) => d.name === `Ochescherm ${suffix}`,
    )!.id;
    const manager = await owner.newPage();
    await manager.goto("/app/schermen");
    const card = manager.getByRole("article", {
      name: `Ochescherm ${suffix}`,
      exact: true,
    });
    await card
      .getByRole("combobox", { name: "Huisstijl", exact: true })
      .selectOption(`club:${clubId}`);
    await expect(
      manager
        .getByRole("status")
        .filter({ hasText: "De scherminstelling is opgeslagen." }),
    ).toBeVisible();
    await expect(display.locator(".oche-screen-theme")).toHaveAttribute(
      "data-oche-theme",
      "club",
    );
    const snapshot: OcheDisplaySnapshot = await (
      await screen.request.get("/api/oche/v1/snapshot")
    ).json();
    expect(snapshot.theme?.id).toBe("club");
    expect(snapshot.permissions).toEqual({
      read: true,
      score: false,
      extend: false,
    });
    expect(JSON.stringify(snapshot.theme)).not.toMatch(
      new RegExp(
        `${clubId}|${deviceId}|brandingClubId|preference|actorId|fullName`,
      ),
    );
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
    ]) {
      await display.setViewportSize(viewport);
      await expect(display.locator(".oche-screen-theme")).toHaveAttribute(
        "data-oche-theme",
        "club",
      );
      expect(
        await display.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      expect(
        await display
          .locator(".oche-device-display")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe(
        snapshot.theme?.id === "club"
          ? `rgb(${snapshot.theme.tokens.dark.background
              .slice(1)
              .match(/../g)!
              .map((x) => parseInt(x, 16))
              .join(", ")})`
          : "unreachable",
      );
      await info.attach(
        `published-physical-club-browser-${viewport.width}x${viewport.height}`,
        { body: await display.screenshot(), contentType: "image/png" },
      );
    }
    await display.clock.install();
    await screen.setOffline(true);
    // Moving the OS clock backwards must not extend the approved server lease.
    await display.clock.setSystemTime(new Date(Date.now() - 3600000));
    await display.clock.fastForward(300001);
    await expect(display.locator(".oche-screen-theme")).toHaveAttribute(
      "data-oche-theme",
      "dartflow",
    );
    await expect(
      display.getByText(`Ocheclub ${suffix}`, { exact: true }),
    ).toHaveCount(0);
    expect(
      await display.locator(".oche-screen-theme").getAttribute("style"),
    ).not.toContain("--oche-club-");
    await screen.setOffline(false);
    await display.reload();
    await expect(display.locator(".oche-screen-theme")).toHaveAttribute(
      "data-oche-theme",
      "club",
    );
    await post(owner, "/api/competition-wizard", {
      requestId: randomUUID(),
      action: {
        type: "planning.revoke",
        id: grantId,
        expectedRevision: grantRevision,
        reason: "Locatiebeheer trekt de schermtoestemming in.",
      },
    });
    await expect(display.locator(".oche-screen-theme")).toHaveAttribute(
      "data-oche-theme",
      "dartflow",
    );
    await manager.reload();
    const unavailable = manager.getByRole("article", {
      name: `Ochescherm ${suffix}`,
      exact: true,
    });
    await expect(
      unavailable.getByRole("combobox", { name: "Huisstijl", exact: true }),
    ).toHaveValue(`club:${clubId}`);
    await expect(
      unavailable.getByRole("option", {
        name: "Eerder gekozen vereniging · niet beschikbaar",
      }),
    ).toBeDisabled();
    await unavailable
      .getByRole("combobox", { name: "Huisstijl", exact: true })
      .selectOption("dartflow");
    await expect
      .poll(
        async () =>
          (
            (await (
              await owner.request.get("/api/oche/v1/context")
            ).json()) as OcheManagement
          ).devices.find((d) => d.id === deviceId)?.brandingClubId,
      )
      .toBe(null);
  } finally {
    await screen.setOffline(false);
    if (deviceId)
      await post(owner, `/api/oche/v1/devices/${deviceId}`, {
        action: "revoke",
        requestId: randomUUID(),
      });
    if (clubId) {
      await action(owner, "/api/clubhouse/actions", {
        type: "entitlement.revoke",
        clubId,
      });
      await action(owner, "/api/platform/actions", {
        type: "club.deactivate",
        id: clubId,
      });
    }
    await Promise.allSettled([owner.close(), screen.close()]);
  }
});
