"use client";
import { useCallback, useEffect, useState } from "react";
import MailPolicyPanel from "./mail-policy-panel";
import type { MailFields, MailTemplate } from "@/lib/integrations-catalog";
type Template = MailTemplate & {
  revision: number;
  publishedVersion: number;
  version: number;
};
type Job = {
  id: string;
  recipient: string;
  kind: string;
  status: string;
  attempts: number;
  templateId: string;
  templateVersion: number;
  createdAt: string;
  errorCategory?: string;
  subject?: string;
  html?: string;
  text?: string;
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "De mailactie is niet uitgevoerd.",
    );
  return data as T;
}
export default function MailWorkspace({ clubId = "" }: { clubId?: string }) {
  const scope = clubId ? `club:${clubId}` : "platform";
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("templates");
  const [fields, setFields] = useState<MailFields>({
    subject: "",
    preheader: "",
    title: "",
    body: "",
    cta: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [real, setReal] = useState(false);
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
    text: string;
  } | null>(null);
  const [mobile, setMobile] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [list, log] = await Promise.all([
        api<{ templates: Template[] }>(
          `/api/mail/templates?scope=${encodeURIComponent(scope)}`,
        ),
        api<{ jobs: Job[] }>(
          `/api/mail/log?scope=${encodeURIComponent(scope)}`,
        ),
      ]);
      setTemplates(list.templates);
      setJobs(log.jobs);
      setLoaded(true);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Mailbeheer is niet beschikbaar.",
      );
      setLoaded(true);
    }
  }, [scope]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const template = templates.find((t) => t.id === selected);
  const templateFields = JSON.stringify(template?.fields);
  useEffect(() => {
    if (templateFields) {
      setFields(JSON.parse(templateFields) as MailFields);
      setPreview(null);
    }
  }, [selected, template?.revision, templateFields]);
  async function action(type: "save" | "publish" | "reset" | "test") {
    if (!template || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (type === "test") {
        const result = await api<{
          preview: { subject: string; html: string; text: string };
          status: string;
        }>("/api/mail/test", "POST", {
          scope,
          templateId: template.id,
          recipient: recipient || undefined,
          real,
          fields,
        });
        setPreview(result.preview);
        setNotice(
          real
            ? `Testbericht: ${result.status}`
            : "Voorbeeld gerenderd. Er is geen bericht verstuurd.",
        );
      } else {
        await api(
          `/api/mail/templates/${encodeURIComponent(template.id)}${type === "save" ? "" : `/${type}`}`,
          type === "save" ? "PATCH" : "POST",
          { scope, expectedRevision: template.revision, fields },
        );
        setNotice(
          type === "save"
            ? "Concept opgeslagen."
            : type === "publish"
              ? "Sjabloon gepubliceerd. Nieuwe berichten gebruiken deze versie."
              : "Concept teruggezet.",
        );
        await refresh();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "De mailactie is niet uitgevoerd.",
      );
    } finally {
      setBusy(false);
    }
  }
  function exportTemplate() {
    if (!template) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { id: template.id, scope, fields, version: template.version },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dartflow-${template.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mail-workspace">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{clubId ? "CLUBBEHEER" : "PLATFORMBEHEER"}</p>
          <h1>Mailbeheer</h1>
          <p>Sjablonen, publicaties en de echte status van je berichten.</p>
        </div>
        <span className="badge">
          {clubId ? "Cluboverschrijvingen" : "Platformdefaults"}
        </span>
      </header>
      <div className="tabs">
        <button
          className={tab === "templates" ? "active" : ""}
          onClick={() => setTab("templates")}
        >
          Sjablonen
        </button>
        <button
          className={tab === "log" ? "active" : ""}
          onClick={() => {
            setTab("log");
            void refresh();
          }}
        >
          Verzendlog
        </button>
        <a className="button ghost small" href="/app/platform/integraties">
          Integraties ↗
        </a>
      </div>
      {tab === "templates" && <MailPolicyPanel scope={scope} />}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="workspace-feedback" role="status">
          {notice}
        </div>
      )}
      {!loaded ? (
        <p>Mailbeheer ophalen…</p>
      ) : tab === "log" ? (
        <section className="panel">
          <h2>Verzendlog</h2>
          {jobs.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Bericht</th>
                    <th>Ontvanger</th>
                    <th>Status</th>
                    <th>Pogingen</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{job.subject || job.templateId}</strong>
                        <small>
                          {new Date(job.createdAt).toLocaleString("nl-NL")} ·
                          versie {job.templateVersion}
                        </small>
                      </td>
                      <td>{job.recipient}</td>
                      <td>
                        <span className="badge muted">{job.status}</span>
                        {job.errorCategory && (
                          <small>{job.errorCategory}</small>
                        )}
                      </td>
                      <td>{job.attempts}</td>
                      <td>
                        {["failed", "retry", "bounced"].includes(
                          job.status,
                        ) && (
                          <button
                            className="button ghost small"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await api(
                                  `/api/mail/jobs/${job.id}/retry`,
                                  "POST",
                                  {},
                                );
                                await refresh();
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Opnieuw versturen is niet gelukt.",
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Opnieuw proberen
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="workspace-empty">
              <p>Er zijn nog geen verzendopdrachten in deze omgeving.</p>
            </div>
          )}
        </section>
      ) : (
        <div className="mail-editor-layout">
          <aside className="panel mail-template-list">
            <h2>
              Sjablonen <small>{templates.length}</small>
            </h2>
            {templates.map((t) => (
              <button
                className={t.id === selected ? "selected" : ""}
                key={t.id}
                onClick={() => setSelected(t.id)}
              >
                <strong>{t.label}</strong>
                <small>
                  {t.category} ·{" "}
                  {t.readOnly
                    ? "Supabase Auth"
                    : t.publishedVersion
                      ? `Gepubliceerd v${t.publishedVersion}`
                      : "Concept"}
                </small>
              </button>
            ))}
          </aside>
          <section className="panel mail-editor">
            {!template ? (
              <div className="workspace-empty">
                <p>
                  Kies een sjabloon om de inhoud, publicatie en
                  voorbeeldweergave te openen.
                </p>
              </div>
            ) : (
              <>
                <div className="section-heading">
                  <h2>{template.label}</h2>
                  <span className="badge muted">
                    Revisie {template.revision}
                  </span>
                </div>
                {template.readOnly ? (
                  <div className="notice">
                    Dit bericht loopt via Supabase Auth. Wijzig het
                    Auth-sjabloon en de SMTP-instellingen in het juiste
                    Supabase-project. DartFlow slaat geen OTP-codes op.
                  </div>
                ) : (
                  <>
                    <p className="muted-copy">
                      Trigger: {template.trigger}. Een publicatie wijzigt
                      uitsluitend nieuwe verzendopdrachten.
                    </p>
                    {(Object.keys(fields) as (keyof MailFields)[]).map(
                      (name) => (
                        <label className="field" key={name}>
                          {
                            {
                              subject: "Onderwerp",
                              preheader: "Preheader",
                              title: "Titel",
                              body: "Bericht",
                              cta: "Knoptekst",
                            }[name]
                          }
                          {name === "body" ? (
                            <textarea
                              rows={7}
                              value={fields[name]}
                              onChange={(e) =>
                                setFields((v) => ({
                                  ...v,
                                  [name]: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            <input
                              value={fields[name]}
                              onChange={(e) =>
                                setFields((v) => ({
                                  ...v,
                                  [name]: e.target.value,
                                }))
                              }
                            />
                          )}
                        </label>
                      ),
                    )}
                    <p className="muted-copy">
                      Variabelen:{" "}
                      {template.variables.map((v) => `{{${v}}}`).join(", ")}
                    </p>
                    <div className="button-row">
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() => void action("save")}
                      >
                        Concept opslaan
                      </button>
                      <button
                        className="button gold"
                        disabled={busy}
                        onClick={() => void action("publish")}
                      >
                        Publiceren
                      </button>
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() => void action("reset")}
                      >
                        Terugzetten
                      </button>
                      <button className="button ghost" onClick={exportTemplate}>
                        Exporteren
                      </button>
                    </div>
                    <div className="divider" />
                    <h3>Voorbeeld & testbericht</h3>
                    <label className="field">
                      Toegelaten testontvanger
                      <input
                        type="email"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="ontvanger@voorbeeld.nl"
                      />
                    </label>
                    <label className="workspace-checkbox">
                      <input
                        type="checkbox"
                        checked={real}
                        onChange={(e) => setReal(e.target.checked)}
                      />
                      Werkelijke testmail versturen binnen de ingestelde
                      ontvangersgrens
                    </label>
                    <div className="button-row">
                      <button
                        className="button gold"
                        disabled={busy}
                        onClick={() => void action("test")}
                      >
                        {real ? "Testmail versturen" : "Voorbeeld renderen"}
                      </button>
                      <button
                        className="button ghost"
                        onClick={() => setMobile((v) => !v)}
                      >
                        {mobile ? "Desktopweergave" : "Mobiele weergave"}
                      </button>
                    </div>
                    {preview && (
                      <div className={`mail-preview ${mobile ? "mobile" : ""}`}>
                        <p>
                          <strong>{preview.subject}</strong>
                        </p>
                        <iframe
                          title="E-mailvoorbeeld"
                          sandbox=""
                          srcDoc={preview.html}
                        />
                        <details>
                          <summary>Tekstversie</summary>
                          <pre>{preview.text}</pre>
                        </details>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
