"use client";
import { useEffect, useState, type FormEvent } from "react";
type Policy = {
  revision: number;
  paused: boolean;
  reminderHours: number;
  fromName: string | null;
  replyTo: string | null;
};
export default function MailPolicyPanel({ scope }: { scope: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null),
    [settings, setSettings] = useState<{
      mode: string;
      from: string;
      replyTo: string;
      testRecipients: string[];
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let canceled = false;
    fetch(`/api/mail/settings?scope=${encodeURIComponent(scope)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(
            data.error || "Mailinstellingen zijn niet beschikbaar.",
          );
        if (!canceled) {
          setPolicy(data.policy);
          setSettings(data.settings);
        }
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      });
    return () => {
      canceled = true;
    };
  }, [scope]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!policy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(e.currentTarget);
    try {
      const response = await fetch(
        `/api/mail/settings?scope=${encodeURIComponent(scope)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope,
            expectedRevision: policy.revision,
            paused: form.get("paused") === "on",
            reminderHours: Number(form.get("reminderHours")),
            fromName: String(form.get("fromName") || "") || null,
            replyTo: String(form.get("replyTo") || "") || null,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Opslaan is niet gelukt.");
      setPolicy(data.policy || { ...policy, revision: policy.revision + 1 });
      setNotice("Mailbeleid opgeslagen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Automatisering & verzendbeleid</h2>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="workspace-feedback" role="status">
          {notice}
        </p>
      )}
      {policy && (
        <form onSubmit={save}>
          <div className="field-grid">
            <label className="field">
              Afzendernaam
              <input name="fromName" defaultValue={policy.fromName || ""} />
            </label>
            <label className="field">
              Reply-To
              <input
                name="replyTo"
                type="email"
                defaultValue={policy.replyTo || ""}
              />
            </label>
            <label className="field">
              Herinnering vooraf (uren)
              <input
                name="reminderHours"
                type="number"
                min="1"
                max="168"
                defaultValue={policy.reminderHours}
              />
            </label>
          </div>
          <label className="workspace-checkbox">
            <input
              type="checkbox"
              name="paused"
              defaultChecked={policy.paused}
            />
            Automatische berichten voor deze omgeving pauzeren
          </label>
          <p className="muted-copy">
            Verzendmodus: <strong>{settings?.mode || "Niet ingesteld"}</strong>{" "}
            · Afzender: {settings?.from || "Niet ingesteld"}. Een herinnering
            vereist een vastgelegde start- of afspraakdatum met tijd.
          </p>
          <button className="button gold" disabled={busy}>
            Mailbeleid opslaan
          </button>
        </form>
      )}
    </section>
  );
}
export function MailPreferences() {
  const [items, setItems] = useState<{ category: string; enabled: boolean }[]>(
      [],
    ),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/mail/preferences", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(
            data.error || "Mailvoorkeuren zijn niet beschikbaar.",
          );
        setItems(data.preferences);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function update(category: string, enabled: boolean) {
    try {
      const response = await fetch("/api/mail/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, enabled }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Opslaan is niet gelukt.");
      setItems((v) =>
        v.map((item) =>
          item.category === category ? { ...item, enabled } : item,
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan is niet gelukt.");
    }
  }
  return (
    <section className="panel">
      <h2>E-mailvoorkeuren</h2>
      <p className="muted-copy">
        Kies welke appberichten je ontvangt. Inlogcodes worden apart door
        Supabase Auth verstuurd.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {items.map((item) => (
        <label className="workspace-checkbox" key={item.category}>
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => void update(item.category, e.target.checked)}
          />
          {item.category}
        </label>
      ))}
    </section>
  );
}
