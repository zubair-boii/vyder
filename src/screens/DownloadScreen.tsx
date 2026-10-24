import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store-context";
import type { MediaInfo } from "../lib/types";
import {
  detectPlatform,
  formatDuration,
  isMobileApp,
  isProbablyUrl,
  platformLabel,
} from "../lib/format";
import { Button, Segmented, Select } from "../components/Ui";
import { bridge } from "../lib/bridge";
import {
  IconAlert,
  IconClipboard,
  IconDownload,
  IconLink,
  IconMusic,
  IconRefresh,
  IconX,
} from "../components/Icons";
import { Poster } from "../components/Poster";

const QUALITIES = [
  { value: "2160", label: "4K" },
  { value: "1440", label: "1440p" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
  { value: "360", label: "360p" },
];

const FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
];

export function DownloadScreen() {
  const { settings, inspect, enqueue, toast, library, tools, setScreen } = useStore();

  const audioDefault = settings.defaultQuality === "audio";
  const videoDefault = settings.defaultFormat === "mkv" ? "mkv" : "mp4";
  const mobile = isMobileApp();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [quality, setQuality] = useState(audioDefault ? "1080" : settings.defaultQuality);
  const [format, setFormat] = useState(audioDefault ? "mp3" : videoDefault);
  const [mode, setMode] = useState<"video" | "audio">(audioDefault ? "audio" : "video");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const platform = useMemo(() => detectPlatform(url), [url]);
  const valid = isProbablyUrl(url);

  /** Audio mode must never hand yt-dlp a video container. */
  const audioFormat = format === "mp4" || format === "mkv" ? "mp3" : format;
  const finalFormat = mode === "audio" ? audioFormat : format;

  useEffect(() => {
    const wantsAudio = settings.defaultQuality === "audio";
    setMode(wantsAudio ? "audio" : "video");
    setQuality(wantsAudio ? "1080" : settings.defaultQuality);
    setFormat(wantsAudio ? "mp3" : videoDefault);
  }, [settings.defaultQuality, settings.defaultFormat, videoDefault]);

  useEffect(() => {
    const onPasteLink = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (!next) return;
      setUrl(next);
      setMedia(null);
      setStatus("idle");
      setError("");
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("vyder:paste-link", onPasteLink);
    return () => window.removeEventListener("vyder:paste-link", onPasteLink);
  }, []);

  async function runInspect() {
    const trimmed = url.trim();
    if (!isProbablyUrl(trimmed)) {
      setStatus("error");
      setError("Paste a full link beginning with https://");
      return;
    }
    setStatus("loading");
    setError("");
    setMedia(null);
    try {
      const info = await inspect(trimmed);
      setMedia(info);
      setStatus("ready");
      const has1080 = info.formats.some((f) => f.height === 1080 && !f.audioOnly);
      if (!has1080) {
        const best = info.formats.find((f) => !f.audioOnly);
        if (best) setQuality(best.resolution.replace("p", ""));
      }
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function addToQueue() {
    if (!media) return;
    setBusy(true);
    try {
      await enqueue(media, mode === "audio" ? "audio" : quality, finalFormat);
      setMedia(null);
      setUrl("");
      setStatus("idle");
      setScreen("queue");
    } finally {
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await bridge.readClipboard();
      if (text.trim()) {
        setUrl(text.trim());
        setStatus("idle");
      } else {
        toast("info", "Clipboard is empty", "Copy a video link first.");
      }
    } catch {
      toast(
        "error",
        "Clipboard access was blocked",
        mobile
          ? "Copy the link, then tap Paste again."
          : "Paste the link with Ctrl+V instead.",
      );
    }
  }

  const recent = library.slice(0, 3);

  return (
    <div className="page page--download">
      {tools && !tools.ytDlp.found ? (
        <div className="engine-notice" role="status">
          <span className="engine-notice__icon">
            <IconAlert size={16} />
          </span>
          <div className="engine-notice__copy">
            <strong>Download engine not available</strong>
            <span>
              {mobile
                ? "The built-in Android engine could not be loaded. Reinstall Vyder and try again."
                : "The bundled engine is missing. Reinstall Vyder, run the tools fetch, or choose a custom path."}
            </span>
          </div>
          <button className="engine-notice__action" onClick={() => setScreen("settings")}>
            Open settings
          </button>
        </div>
      ) : null}

      <section className={`grabber grabber--home ${status === "error" ? "has-error" : ""}`}>
        <div className="grabber__row">
          <span className="grabber__prefix">
            <IconLink size={18} />
          </span>
          <input
            ref={inputRef}
            className="grabber__input"
            placeholder="Paste a video link"
            value={url}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            inputMode="url"
            onChange={(event) => {
              setUrl(event.target.value);
              if (status === "error") {
                setStatus("idle");
                setError("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runInspect();
            }}
          />
          {url ? (
            <button
              className="icon-btn grabber__clear"
              onClick={() => {
                setUrl("");
                setMedia(null);
                setStatus("idle");
              }}
              aria-label="Clear"
            >
              <IconX size={14} />
            </button>
          ) : null}
          <button className="grabber__paste" onClick={pasteFromClipboard} type="button">
            <IconClipboard size={14} />
            Paste
          </button>
        </div>

        {valid && platform !== "web" ? (
          <p className="grabber__detected">{platformLabel(platform)} link</p>
        ) : null}

        {status === "error" ? (
          <p className="grabber__error">
            <IconAlert size={14} />
            {error}
          </p>
        ) : null}

        <div className="grabber__actions">
          <Button
            variant="solid"
            size="lg"
            onClick={runInspect}
            disabled={!valid || status === "loading"}
            icon={<IconDownload size={16} />}
          >
            {status === "loading" ? "Checking…" : "Download"}
          </Button>
        </div>
      </section>

      {status === "loading" ? <InspectSkeleton /> : null}

      {media && status === "ready" ? (
        <section className="inspector corner-ticks">
          <div className="inspector__media">
            <div className="inspector__thumb">
              <Poster
                seed={media.id || media.url}
                src={media.thumbnail}
                alt={media.title}
                ratio="16 / 9"
                badge={formatDuration(media.duration)}
              />
            </div>
            <div className="inspector__meta">
              <p className="inspector__kicker">{platformLabel(media.platform)}</p>
              <h3 className="inspector__title display">{media.title}</h3>
              <p className="inspector__byline">
                {media.uploader || "Unknown channel"}
                <span className="dot-sep">·</span>
                {formatDuration(media.duration)}
              </p>
            </div>
          </div>

          <div className="inspector__options">
            <Segmented
              value={mode}
              onChange={(next) => setMode(next)}
              options={[
                { value: "video", label: "Video" },
                { value: "audio", label: "Audio" },
              ]}
              ariaLabel="Media type"
            />

            {mode === "video" ? (
              <div className="option-grid">
                <div className="option-block">
                  <span className="field__label">Quality</span>
                  <Select
                    value={quality}
                    onChange={(event) => setQuality(event.target.value)}
                    options={QUALITIES}
                  />
                </div>
                <div className="option-block">
                  <span className="field__label">Format</span>
                  <Select
                    value={format}
                    onChange={(event) => setFormat(event.target.value)}
                    options={FORMATS.filter((item) => item.value === "mp4" || item.value === "mkv")}
                  />
                </div>
              </div>
            ) : (
              <div className="option-grid">
                <div className="option-block">
                  <span className="field__label">Format</span>
                  <Select
                    value={audioFormat}
                    onChange={(event) => setFormat(event.target.value)}
                    options={FORMATS.filter((item) => item.value === "mp3" || item.value === "m4a")}
                  />
                </div>
                <div className="option-block">
                  <span className="field__label">Quality</span>
                  <Select
                    value="0"
                    onChange={() => undefined}
                    options={[{ value: "0", label: "Best" }]}
                  />
                </div>
              </div>
            )}
          </div>

          <footer className="inspector__foot">
            <span className="inspector__summary">
              {mode === "audio" ? "Audio" : `${quality}p`} · {finalFormat.toUpperCase()}
            </span>
            <div className="inspector__foot-actions">
              <Button
                variant="quiet"
                onClick={() => {
                  setMedia(null);
                  setStatus("idle");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                onClick={addToQueue}
                disabled={busy}
                icon={mode === "audio" ? <IconMusic size={16} /> : <IconDownload size={16} />}
              >
                {busy ? "Adding…" : "Add to queue"}
              </Button>
            </div>
          </footer>
        </section>
      ) : null}

      {status === "idle" && !media ? (
        <section className="recent">
          <header className="section-head">
            <h3 className="section-head__title display">Recent</h3>
            <button className="link-btn" onClick={() => setScreen("library")}>
              Open library
            </button>
          </header>
          {recent.length === 0 ? (
            <p className="recent__empty">Your downloads will appear here.</p>
          ) : (
            <div className="recent__grid">
              {recent.map((item) => (
                <article key={item.id} className="recent__card">
                  <Poster
                    seed={item.id}
                    src={item.thumbnail}
                    alt={item.title}
                    ratio="16 / 9"
                    badge={formatDuration(item.duration)}
                  />
                  <div className="recent__body">
                    <h4 className="recent__title">{item.title}</h4>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function InspectSkeleton() {
  return (
    <section className="inspector inspector--loading corner-ticks">
      <div className="inspector__media">
        <div className="skeleton skeleton--thumb" />
        <div className="inspector__meta">
          <div className="skeleton skeleton--line" style={{ width: "22%" }} />
          <div className="skeleton skeleton--line skeleton--lg" style={{ width: "76%" }} />
          <div className="skeleton skeleton--line" style={{ width: "46%" }} />
        </div>
      </div>
      <div className="skeleton-strip">
        <IconRefresh size={15} className="spin" />
        <span>Reading link…</span>
      </div>
    </section>
  );
}
