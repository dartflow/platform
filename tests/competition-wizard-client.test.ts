import { test } from "node:test";
import assert from "node:assert/strict";
import { wizardConfigKey } from "../lib/competition-wizard-client";
test("a JSONB-reordered server acknowledgement is the same wizard content, while roster order and rules changes remain dirty", () => {
  const draft = {
    version: 1,
    title: "Competitie",
    rules: { startScore: 501, startProcedure: "bull" },
    teams: [{ name: "Thuis", playerIds: ["a", "b"] }],
  };
  const jsonb = {
    teams: [{ playerIds: ["a", "b"], name: "Thuis" }],
    rules: { startProcedure: "bull", startScore: 501 },
    title: "Competitie",
    version: 1,
  };
  assert.notEqual(JSON.stringify(draft), JSON.stringify(jsonb));
  assert.equal(wizardConfigKey(draft), wizardConfigKey(jsonb));
  assert.notEqual(
    wizardConfigKey(draft),
    wizardConfigKey({
      ...jsonb,
      teams: [{ name: "Thuis", playerIds: ["b", "a"] }],
    }),
  );
  assert.notEqual(
    wizardConfigKey(draft),
    wizardConfigKey({
      ...jsonb,
      rules: { startScore: 301, startProcedure: "bull" },
    }),
  );
});
