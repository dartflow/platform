import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveOcheScreenTheme,
  ocheScreenServerTime,
} from "../lib/oche-screen-theme";
import { deriveThemeTokens } from "../lib/clubhouse-theme-domain";

const now = Date.parse("2026-11-20T12:00:00Z");
const theme = () => ({
  id: "club",
  version: 1,
  name: "Publieke club",
  logoData: null,
  brandingRevision: 7,
  validUntil: new Date(now + 300000).toISOString(),
  tokens: {
    light: deriveThemeTokens(
      { primary: "#1558cc", secondary: "#c2185b" },
      false,
    ),
    dark: deriveThemeTokens({ primary: "#1558cc", secondary: "#c2185b" }, true),
  },
});

test("public Oche palette expires exactly at its published deadline, including offline use", () => {
  assert.equal(effectiveOcheScreenTheme(theme(), now).id, "club");
  assert.equal(effectiveOcheScreenTheme(theme(), now + 299999).id, "club");
  assert.deepEqual(effectiveOcheScreenTheme(theme(), now + 300000), {
    id: "dartflow",
    version: 1,
  });
  assert.deepEqual(effectiveOcheScreenTheme(theme(), now + 300001), {
    id: "dartflow",
    version: 1,
  });
});
test("Oche applies only known public fields and semantic hex colours, with no account preference fallbacks", () => {
  const input = {
    ...theme(),
    clubId: "private-club",
    actorId: "private-actor",
    preference: { clubId: "other-club" },
    tokens: {
      ...theme().tokens,
      dark: { ...theme().tokens.dark, privateToken: "secret" },
    },
  };
  const result = effectiveOcheScreenTheme(input, now);
  assert.equal(result.id, "club");
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|secret|preference|other-club/,
  );
  for (const invalid of [
    undefined,
    { ...theme(), version: 2 },
    { ...theme(), validUntil: "invalid" },
    { ...theme(), name: "" },
    { ...theme(), logoData: "https://external.test/logo.png" },
    { ...theme(), logoData: "data:image/svg+xml;base64,PHN2Zz4=" },
    {
      ...theme(),
      tokens: {
        ...theme().tokens,
        dark: { ...theme().tokens.dark, primary: "url(https://external.test)" },
      },
    },
  ])
    assert.deepEqual(effectiveOcheScreenTheme(invalid, now), {
      id: "dartflow",
      version: 1,
    });
});
test("catalogue styles remain compatible and reject unversioned or private additions", () => {
  assert.deepEqual(
    effectiveOcheScreenTheme(
      { id: "onzetrots", version: 1, actorId: "secret" },
      now,
    ),
    { id: "onzetrots", version: 1 },
  );
  assert.deepEqual(
    effectiveOcheScreenTheme({ id: "club", preference: "account" }, now),
    { id: "dartflow", version: 1 },
  );
});
test("the largest supported published image remains usable and oversized image envelopes fail closed", () => {
  const logoData =
    "data:image/webp;base64," + "A".repeat(Math.ceil((128 * 1024) / 3) * 4);
  const accepted = effectiveOcheScreenTheme({ ...theme(), logoData }, now);
  assert.equal(accepted.id, "club");
  if (accepted.id === "club") assert.equal(accepted.logoData, logoData);
  assert.equal(
    effectiveOcheScreenTheme(
      { ...theme(), logoData: "data:image/webp;base64," + "A".repeat(180001) },
      now,
    ).id,
    "dartflow",
  );
});
test("screen validity follows monotonic elapsed time and never moves before the accepted server time", () => {
  assert.equal(ocheScreenServerTime(now, 100, 300100), now + 300000);
  assert.equal(
    effectiveOcheScreenTheme(theme(), ocheScreenServerTime(now, 100, 300100))
      .id,
    "dartflow",
  );
  assert.equal(ocheScreenServerTime(now, 100, 50), now);
});
