import { useMemo, useState } from "react";
import { useStore } from "../lib/store-context";
import {
  formatBytes,
  formatDate,
  formatDuration,
  platformLabel,
  plural,
} from "../lib/format";
import { Button, EmptyState, Modal, Segmented, Select, Tag } from "../components/Ui";
import {
  IconDownload,
  IconExternal,
  IconFolder,
  IconLibrary,
  IconPlay,
  IconSearch,
  IconTrash,
  IconX,
} from "../components/Icons";
import { Poster } from "../components/Poster";
import type { LibraryItem } from "../lib/types";

type View = "grid" | "list";
type Sort = "recent" | "oldest" | "largest" | "title";

export function LibraryScreen() {
  const {
    library,
    setScreen,
    openFile,
    revealFile,
    removeLibraryItem,
    clearLibrary,
  } = useStore();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("grid");
  const [sort, setSort] = useState<Sort>("recent");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);

  const platforms = useMemo(() => {
    const set = new Set(library.map((item) => item.platform));
    return [
      { value: "all", label: "All platforms" },
      ...Array.from(set).map((platform) => ({
        value: platform,
        label: platformLabel(platform),
      })),
    ];
  }, [library]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = library.filter((item) => {
      const matchesQuery =
        !needle ||
        item.title.toLowerCase().includes(needle) ||
        item.uploader.toLowerCase().includes(needle);
      const matchesPlatform = platformFilter === "all" || item.platform === platformFilter;
      return matchesQuery && matchesPlatform;
    });

    return [...list].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.downloadedAt - b.downloadedAt;
        case "largest":
          return b.fileSize - a.fileSize;
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return b.downloadedAt - a.downloadedAt;
      }
    });
  }, [library, query, platformFilter, sort]);

  const totalSize = useMemo(
    () => library.reduce((sum, item) => sum + item.fileSize, 0),
    [library],
  );

  if (library.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon={<IconLibrary size={22} />}
          title="Your library is bare"
          body="Everything Vyder downloads lands here with its file path, format and size. Start with a link from the download desk."
          action={
            <Button variant="solid" onClick={() => setScreen("download")} icon={<IconDownload size={15} />}>
              Fetch a video
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page page--library">
      <div className="library-head">
        <div className="library-head__stats">
          <span className="eyebrow">{plural(library.length, "file")}</span>
          <span className="dot-sep">·</span>
          <span className="eyebrow">{formatBytes(totalSize)} on disk</span>
        </div>
        <div className="library-head__controls">
          <label className="search">
            <IconSearch size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title or channel"
              aria-label="Search library"
            />
            {query ? (
              <button className="search__clear" onClick={() => setQuery("")} aria-label="Clear search">
                <IconX size={12} />
              </button>
            ) : null}
          </label>
          <Select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value)}
            options={platforms}
          />
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            options={[
              { value: "recent", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "largest", label: "Largest first" },
              { value: "title", label: "Title A–Z" },
            ]}
          />
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
            ariaLabel="Library view"
          />
        </div>
      </div>

      <div className="library-meta">
        <span className="mono">
          showing {filtered.length} of {library.length}
        </span>
        <button className="link-btn link-btn--danger" onClick={() => setConfirmClear(true)}>
          Clear library
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="library-empty mono">No files match that search.</p>
      ) : view === "grid" ? (
        <div className="library-grid">
          {filtered.map((item) => (
            <article key={item.id} className="library-card">
              <button
                className="library-card__thumb"
                onClick={() => openFile(item)}
                title="Play file"
                aria-label={`Play ${item.title}`}
              >
                <Poster
                  seed={item.id}
                  src={item.thumbnail}
                  alt={item.title}
                  ratio="16 / 9"
                  badge={formatDuration(item.duration)}
                />
                <span className="library-card__play">
                  <IconPlay size={16} />
                </span>
              </button>
              <div className="library-card__body">
                <div className="library-card__topline">
                  <span className="eyebrow">{platformLabel(item.platform)}</span>
                  <span className="mono library-card__format">
                    {item.format.toUpperCase()}
                    {item.quality !== "audio" ? ` · ${item.quality}p` : ""}
                  </span>
                </div>
                <h3 className="library-card__title" title={item.title}>
                  {item.title}
                </h3>
                <p className="library-card__byline">
                  {item.uploader || "Unknown"} <span className="dot-sep">·</span>{" "}
                  {formatBytes(item.fileSize)}
                </p>
                <div className="library-card__actions">
                  <button className="mini-btn" onClick={() => revealFile(item)} title="Show in folder">
                    <IconFolder size={13} /> Folder
                  </button>
                  <button className="mini-btn" onClick={() => openFile(item)} title="Open file">
                    <IconExternal size={13} /> Open
                  </button>
                  <button
                    className="mini-btn mini-btn--danger"
                    onClick={() => setPendingDelete(item)}
                    title="Remove"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="library-table">
          <div className="library-table__head mono">
            <span />
            <span>Title</span>
            <span>Platform</span>
            <span>Format</span>
            <span>Size</span>
            <span>Saved</span>
            <span />
          </div>
          {filtered.map((item) => (
            <div key={item.id} className="library-table__row">
              <button className="library-table__thumb" onClick={() => openFile(item)}>
                <Poster seed={item.id} src={item.thumbnail} alt={item.title} ratio="16 / 9" />
              </button>
              <div className="library-table__title">
                <span>{item.title}</span>
                <span className="mono">{item.uploader || "—"}</span>
              </div>
              <span className="mono">{platformLabel(item.platform)}</span>
              <span className="mono">
                {item.format.toUpperCase()}
                {item.quality !== "audio" ? ` ${item.quality}p` : ""}
              </span>
              <span className="mono">{formatBytes(item.fileSize)}</span>
              <span className="mono">{formatDate(item.downloadedAt)}</span>
              <div className="library-table__actions">
                <button className="icon-btn" onClick={() => revealFile(item)} aria-label="Show in folder">
                  <IconFolder size={14} />
                </button>
                <button className="icon-btn" onClick={() => openFile(item)} aria-label="Open file">
                  <IconExternal size={14} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setPendingDelete(item)}
                  aria-label="Remove"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(pendingDelete)}
        eyebrow="Remove file"
        title="Take this out of the library?"
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!pendingDelete) return;
                void removeLibraryItem(pendingDelete.id, false);
                setPendingDelete(null);
              }}
            >
              Remove entry
            </Button>
            <Button
              variant="solid"
              onClick={() => {
                if (!pendingDelete) return;
                void removeLibraryItem(pendingDelete.id, true);
                setPendingDelete(null);
              }}
            >
              Delete file too
            </Button>
          </>
        }
      >
        <p className="modal__copy">
          <strong>{pendingDelete?.title}</strong> will be removed from Vyder. You can keep
          the file on disk or delete it as well.
        </p>
        <p className="mono modal__path">{pendingDelete?.filePath}</p>
      </Modal>

      <Modal
        open={confirmClear}
        eyebrow="Danger zone"
        title="Clear the whole library?"
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void clearLibrary(false);
                setConfirmClear(false);
              }}
            >
              Forget entries
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void clearLibrary(true);
                setConfirmClear(false);
              }}
            >
              Delete every file
            </Button>
          </>
        }
      >
        <p className="modal__copy">
          This removes {library.length} entries. Deleting the files is permanent — Vyder
          will not send them to the recycle bin.
        </p>
        <div className="modal__tags">
          <Tag tone="warn">irreversible</Tag>
          <Tag>{formatBytes(totalSize)}</Tag>
        </div>
      </Modal>
    </div>
  );
}
