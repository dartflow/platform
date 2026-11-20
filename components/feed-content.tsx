"use client";
import { useState } from "react";
import type { FeedAction, FeedItem } from "@/lib/feed-types";
import type { FeedPoll } from "@/lib/feed-content-types";
export type ComposeExtras = {
  attachments: { name: string; data: string }[];
  poll: {
    enabled: boolean;
    options: string;
    endsAt: string;
    multiple: boolean;
    allowChange: boolean;
  };
};
export const emptyComposeExtras = (): ComposeExtras => ({
  attachments: [],
  poll: {
    enabled: false,
    options: "",
    endsAt: "",
    multiple: false,
    allowChange: true,
  },
});
export function FeedComposerExtras({
  value,
  onChange,
  disabled,
}: {
  value: ComposeExtras;
  onChange: (value: ComposeExtras) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <details className="df-feed-compose-extras">
      <summary>Afbeelding of peiling toevoegen</summary>
      <label>
        Afbeelding (PNG, JPEG of WebP, maximaal 96 kB)
        <input
          disabled={disabled}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 96 * 1024) {
              setError("Kies een afbeelding van maximaal 96 kB.");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              onChange({
                ...value,
                attachments: [{ name: file.name, data: String(reader.result) }],
              });
              setError("");
            };
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {value.attachments.map((image) => (
        <div key={image.name}>
          <img
            className="df-feed-attachment"
            src={image.data}
            alt={image.name}
          />
          <button
            className="df-feed-button"
            disabled={disabled}
            type="button"
            onClick={() => onChange({ ...value, attachments: [] })}
          >
            Afbeelding verwijderen
          </button>
        </div>
      ))}
      <label>
        <input
          type="checkbox"
          checked={value.poll.enabled}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              poll: { ...value.poll, enabled: e.target.checked },
            })
          }
        />
        Peiling toevoegen
      </label>
      {value.poll.enabled && (
        <fieldset>
          <legend>Peiling</legend>
          <label>
            Opties (twee tot acht, één per regel)
            <textarea
              value={value.poll.options}
              disabled={disabled}
              rows={4}
              onChange={(e) =>
                onChange({
                  ...value,
                  poll: { ...value.poll, options: e.target.value },
                })
              }
            />
          </label>
          <label>
            Stemmen tot (tijd van dit toestel)
            <input
              type="datetime-local"
              disabled={disabled}
              value={value.poll.endsAt}
              onChange={(e) =>
                onChange({
                  ...value,
                  poll: { ...value.poll, endsAt: e.target.value },
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.poll.multiple}
              onChange={(e) =>
                onChange({
                  ...value,
                  poll: { ...value.poll, multiple: e.target.checked },
                })
              }
            />
            Meerdere antwoorden mogelijk
          </label>
          <label>
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.poll.allowChange}
              onChange={(e) =>
                onChange({
                  ...value,
                  poll: { ...value.poll, allowChange: e.target.checked },
                })
              }
            />
            Leden mogen hun stem wijzigen
          </label>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export function FeedContent({
  item,
  busy,
  onAction,
}: {
  item: FeedItem;
  busy: boolean;
  onAction: (action: FeedAction, done?: () => void) => void;
}) {
  const [editing, setEditing] = useState(false),
    [body, setBody] = useState(item.body),
    [attachments, setAttachments] = useState(item.extras?.attachments ?? []);
  const [shareLink, setShareLink] = useState("");
  const share = async () => {
    const channel = item.channel;
    const club = channel.startsWith("club:") ? channel.slice(5) : null;
    const path = club
      ? `/app/clubs/${club}/feed?post=${item.id}`
      : `/app/feed/${channel.replace(":", "/")}?post=${item.id}`;
    const url = new URL(path, location.origin).href;
    setShareLink(url);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* The exact link remains selectable below. */
    }
  };
  return (
    <>
      <div className="df-feed-post-share">
        <button className="df-feed-button" onClick={() => void share()}>
          Link naar bericht delen
        </button>
        {shareLink && (
          <label>
            Link naar dit bericht
            <input
              aria-label="Link naar dit bericht"
              readOnly
              value={shareLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <small>
              Alleen mensen die nu toegang hebben tot dit kanaal kunnen het
              bericht lezen.
            </small>
          </label>
        )}
      </div>
      {item.extras?.attachments.map((image) => (
        <a
          href={image.data}
          target="_blank"
          rel="noreferrer"
          key={image.id}
          aria-label={`Afbeelding openen: ${image.name}`}
        >
          <img
            className="df-feed-attachment"
            src={image.data}
            alt={image.name}
            loading="lazy"
          />
        </a>
      ))}
      {item.extras?.poll && (
        <Poll
          key={
            item.extras.poll.id +
            item.extras.poll.myOptionIds.join(",") +
            item.extras.poll.closed
          }
          itemId={item.id}
          poll={item.extras.poll}
          busy={busy}
          canManage={item.canManage || item.extras.canEdit}
          onAction={onAction}
        />
      )}{" "}
      {item.extras?.canEdit && (
        <button
          className="df-feed-button"
          disabled={busy}
          onClick={() => setEditing(!editing)}
        >
          Bericht bewerken
        </button>
      )}
      {editing && item.extras?.canEdit && (
        <form
          className="df-feed-edit"
          onSubmit={(e) => {
            e.preventDefault();
            onAction(
              {
                type: "edit",
                itemId: item.id,
                expectedRevision: item.extras!.revision,
                body,
                attachments: attachments.map((a) => ({
                  name: a.name,
                  data: a.data,
                })),
              },
              () => setEditing(false),
            );
          }}
        >
          <label>
            Bericht bewerken
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={900}
            />
          </label>
          {attachments.length > 0 && (
            <button
              type="button"
              className="df-feed-button"
              onClick={() => setAttachments([])}
            >
              Afbeelding verwijderen
            </button>
          )}
          <p>De bestaande peiling en stemmen worden niet gewijzigd.</p>
          <button className="df-feed-button primary" disabled={busy}>
            Wijzigingen opslaan
          </button>
          <button
            type="button"
            className="df-feed-button"
            onClick={() => setEditing(false)}
          >
            Annuleren
          </button>
        </form>
      )}
    </>
  );
}
function Poll({
  itemId,
  poll,
  busy,
  canManage,
  onAction,
}: {
  itemId: string;
  poll: FeedPoll;
  busy: boolean;
  canManage: boolean;
  onAction: (action: FeedAction) => void;
}) {
  const [selected, setSelected] = useState(poll.myOptionIds);
  const frozen =
    poll.closed || (!poll.allowChange && poll.myOptionIds.length > 0);
  return (
    <section className="df-feed-poll" aria-label="Peiling">
      <h3>Peiling</h3>
      <p>
        {poll.closed
          ? "Gesloten"
          : `Stemmen tot ${new Date(poll.endsAt).toLocaleString("nl-NL")}`}{" "}
        · {poll.totalVoters} stemmers
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAction({ type: "poll.vote", itemId, optionIds: selected });
        }}
      >
        {poll.options.map((option) => (
          <label key={option.id}>
            <input
              type={poll.multiple ? "checkbox" : "radio"}
              name={`poll-${poll.id}`}
              value={option.id}
              checked={selected.includes(option.id)}
              disabled={busy || frozen}
              onChange={() =>
                setSelected(
                  poll.multiple
                    ? selected.includes(option.id)
                      ? selected.filter((id) => id !== option.id)
                      : [...selected, option.id]
                    : [option.id],
                )
              }
            />
            <span>{option.label}</span>
            <strong>{option.votes}</strong>
          </label>
        ))}
        {!poll.closed && (
          <button
            className="df-feed-button"
            disabled={busy || frozen || selected.length === 0}
          >
            {poll.myOptionIds.length ? "Stem wijzigen" : "Stemmen"}
          </button>
        )}
        {!poll.allowChange && poll.myOptionIds.length > 0 && (
          <p>Je stem staat vast.</p>
        )}
      </form>
      {canManage && !poll.closed && (
        <button
          className="df-feed-button"
          disabled={busy}
          onClick={() => onAction({ type: "poll.close", itemId })}
        >
          Peiling sluiten
        </button>
      )}
    </section>
  );
}
