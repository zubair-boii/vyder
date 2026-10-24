import { useMemo, useState } from "react";
import { useStore } from "../lib/store-context";
import { detectPlatform, extractUrls, formatDate, platformLabel, plural } from "../lib/format";
import { Button, EmptyState, Modal, Select, TextInput } from "../components/Ui";
import {
  IconArrowRight,
  IconDownload,
  IconLink,
  IconPlaylist,
  IconPlus,
  IconTrash,
} from "../components/Icons";

export function PlaylistsScreen() {
  const { playlists, savePlaylist, deletePlaylist, enqueueUrl, setScreen, toast, settings } =
    useStore();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [quality, setQuality] = useState(settings.defaultQuality);

  const parsed = useMemo(() => extractUrls(raw), [raw]);

  function create() {
    if (parsed.length === 0) {
      toast("error", "No links found", "Paste one URL per line, or separate them with spaces.");
      return;
    }
    savePlaylist(name, parsed);
    setName("");
    setRaw("");
    setCreating(false);
    toast("ok", "Collection saved", `${parsed.length} links ready to download.`);
  }

  async function runPlaylist(urls: string[]) {
    if (urls.length === 0) return;
    for (const url of urls) {
      await enqueueUrl(url, quality, settings.defaultFormat);
    }
    toast("info", "Queued a collection", `${urls.length} downloads added.`);
    setScreen("queue");
  }

  return (
    <div className="page page--playlists">
      <div className="playlists-head">
        <div>
          <p className="playlists-lede">
            Group links that belong together — a research folder, a week of clips, a
            course. Send the whole set to the queue at once.
          </p>
        </div>
        <Button variant="solid" onClick={() => setCreating(true)} icon={<IconPlus size={15} />}>
          New collection
        </Button>
      </div>

      <div className="playlists-toolbar">
        <label className="playlists-toolbar__quality">
          <span className="eyebrow">Queue at</span>
          <Select
            value={quality}
            onChange={(event) => setQuality(event.target.value)}
            options={[
              { value: "2160", label: "4K · 2160p" },
              { value: "1080", label: "1080p" },
              { value: "720", label: "720p" },
              { value: "480", label: "480p" },
              { value: "audio", label: "Audio only" },
            ]}
          />
        </label>
        <span className="mono playlists-toolbar__count">
          {plural(playlists.length, "collection")} ·{" "}
          {plural(
            playlists.reduce((sum, item) => sum + item.urls.length, 0),
            "link",
          )}
        </span>
      </div>

      {playlists.length === 0 ? (
        <EmptyState
          icon={<IconPlaylist size={22} />}
          title="No collections yet"
          body="A collection is just a named list of links. Build one for the things you keep meaning to save."
          action={
            <Button variant="solid" onClick={() => setCreating(true)} icon={<IconPlus size={15} />}>
              New collection
            </Button>
          }
        />
      ) : (
        <div className="playlists-grid">
          {playlists.map((playlist) => (
            <article key={playlist.id} className="playlist-card corner-ticks">
              <header className="playlist-card__head">
                <div>
                  <span className="eyebrow">Collection</span>
                  <h3 className="playlist-card__title display">{playlist.name}</h3>
                </div>
                <span className="playlist-card__count display">
                  {String(playlist.urls.length).padStart(2, "0")}
                </span>
              </header>

              <ul className="playlist-card__list">
                {playlist.urls.slice(0, 4).map((url, index) => {
                  const platform = detectPlatform(url);
                  return (
                    <li key={`${playlist.id}-${index}`} className="playlist-card__link">
                      <span className={`platform-dot platform-dot--${platform}`} />
                      <span className="mono playlist-card__url">{url}</span>
                      <span className="eyebrow">{platformLabel(platform)}</span>
                    </li>
                  );
                })}
                {playlist.urls.length > 4 ? (
                  <li className="playlist-card__more mono">
                    +{playlist.urls.length - 4} more
                  </li>
                ) : null}
              </ul>

              <footer className="playlist-card__foot">
                <span className="mono playlist-card__date">
                  made {formatDate(playlist.createdAt)}
                </span>
                <div className="playlist-card__actions">
                  <button
                    className="icon-btn"
                    onClick={() => setPendingDelete(playlist.id)}
                    aria-label="Delete collection"
                  >
                    <IconTrash size={14} />
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runPlaylist(playlist.urls)}
                    icon={<IconDownload size={13} />}
                  >
                    Download all
                  </Button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        eyebrow="New collection"
        title="Gather some links"
        onClose={() => setCreating(false)}
        width={560}
        footer={
          <>
            <Button variant="quiet" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="solid" onClick={create} icon={<IconArrowRight size={15} />}>
              Save collection
            </Button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span className="field__head">
              <span className="field__label">Name</span>
              <span className="field__hint">optional</span>
            </span>
            <span className="field__control">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Reference — slow cinema"
                autoFocus
              />
            </span>
          </label>

          <label className="field">
            <span className="field__head">
              <span className="field__label">Links</span>
              <span className="field__hint">{parsed.length} detected</span>
            </span>
            <span className="field__control">
              <textarea
                className="input input--area"
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                placeholder={"https://www.youtube.com/watch?v=…\nhttps://www.tiktok.com/@user/video/…"}
                rows={7}
                spellCheck={false}
              />
            </span>
          </label>

          {parsed.length > 0 ? (
            <ul className="parsed-links">
              {parsed.slice(0, 6).map((url) => (
                <li key={url}>
                  <IconLink size={12} />
                  <span className="mono">{url}</span>
                </li>
              ))}
              {parsed.length > 6 ? (
                <li className="mono parsed-links__more">+{parsed.length - 6} more</li>
              ) : null}
            </ul>
          ) : (
            <p className="modal__hint">
              Paste full URLs. Anything that looks like a link will be picked up
              automatically.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        eyebrow="Delete collection"
        title="Remove this collection?"
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) deletePlaylist(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="modal__copy">
          The links are only a list — nothing is deleted from your disk or library.
        </p>
      </Modal>
    </div>
  );
}
