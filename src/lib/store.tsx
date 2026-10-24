import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bridge, isTauri } from "./bridge";
import type {
  DownloadProgress,
  LibraryItem,
  MediaInfo,
  QueueItem,
  Settings,
  Tools,
} from "./types";
import { detectPlatform, isProbablyUrl } from "./format";
import {
  StoreContext,
  type Playlist,
  type Screen,
  type StoreValue,
  type Toast,
} from "./store-context";

const PLAYLIST_KEY = "vyder.playlists.v1";

function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(PLAYLIST_KEY);
    if (raw) return JSON.parse(raw) as Playlist[];
  } catch {
    /* ignore */
  }
  return [];
}

const FALLBACK_SETTINGS: Settings = {
  accent: "green",
  theme: "dark",
  outputDir: "",
  defaultQuality: "1080",
  defaultFormat: "mp4",
  filenameTemplate: "%(title)s.%(ext)s",
  concurrency: 2,
  clipboardWatch: true,
  notifications: true,
  embedMetadata: true,
  embedThumbnail: false,
  sponsorblock: false,
  ytDlpPath: "",
  ffmpegPath: "",
};

let counter = 0;
function nextId(prefix = "dl") {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Keep audio requests out of video containers, whatever the defaults say. */
function normalizeFormat(quality: string, format: string): string {
  if (quality !== "audio") return format;
  return ["mp3", "m4a", "wav", "opus"].includes(format) ? format : "mp3";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS);
  const [tools, setTools] = useState<Tools | null>(null);
  const [version, setVersion] = useState("0.1.0");
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [screen, setScreen] = useState<Screen>("download");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists);
  const [clipboardOffer, setClipboardOffer] = useState<string | null>(null);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const startingRef = useRef<Set<string>>(new Set());
  const resolvingRef = useRef<Set<string>>(new Set());
  // Requests the user has stopped. Late engine events for these ids are ignored.
  const stoppingRef = useRef<Set<string>>(new Set());

  const toast = useCallback((tone: Toast["tone"], title: string, detail?: string) => {
    const id = nextId("toast");
    setToasts((current) => [...current.slice(-3), { id, tone, title, detail }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, tone === "error" ? 7000 : 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  /* ---- boot ------------------------------------------------------------- */

  useEffect(() => {
    let alive = true;
    bridge
      .bootstrap()
      .then((data) => {
        if (!alive) return;
        let next = { ...FALLBACK_SETTINGS, ...data.settings };
        try {
          // One-time migration to the dark green skin for existing installs.
          if (!localStorage.getItem("vyder.skin.v2")) {
            next = { ...next, theme: "dark", accent: "green" };
            localStorage.setItem("vyder.skin.v2", "1");
            void bridge.saveSettings(next);
          }
        } catch {
          /* storage may be unavailable */
        }
        setSettings(next);
        setTools(data.tools);
        setLibrary(data.library);
        setVersion(data.version);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setReady(true);
        toast("error", "Could not start Vyder", String(error));
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  /* ---- theme ------------------------------------------------------------ */

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.accent = settings.accent;
    try {
      // Mirror the theme so index.html can paint the right colours before boot.
      localStorage.setItem(
        "vyder.theme",
        JSON.stringify({ theme: settings.theme, accent: settings.accent }),
      );
    } catch {
      /* storage may be unavailable */
    }
    if (isTauri) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(settings.theme))
        .catch(() => undefined);
    }
  }, [settings.theme, settings.accent]);

  /* ---- download events -------------------------------------------------- */

  const onProgress = useCallback((payload: DownloadProgress) => {
    if (stoppingRef.current.has(payload.id)) return;
    setQueue((current) =>
      current.map((item) => {
        if (item.id !== payload.id) return item;
        // A progress line can arrive just after the user pauses. Keep the row
        // paused until the engine has actually stopped.
        if (item.status === "paused" || item.status === "cancelled") return item;
        return {
          ...item,
          status: payload.stage === "processing" ? "processing" : "downloading",
          percent: payload.stage === "processing" ? 100 : payload.percent,
          downloaded: payload.downloaded || item.downloaded,
          total: payload.total || item.total,
          speed: payload.stage === "processing" ? 0 : payload.speed,
          eta: payload.stage === "processing" ? 0 : payload.eta,
        };
      }),
    );
  }, []);

  const onDone = useCallback(
    (item: LibraryItem) => {
      setQueue((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, status: "done", percent: 100, speed: 0, eta: 0 }
            : row,
        ),
      );
      setLibrary((current) => [item, ...current.filter((row) => row.id !== item.id)]);
      toast("ok", "Saved to your library", item.title);
      if (settingsRef.current.notifications && "Notification" in window) {
        try {
          if (Notification.permission === "granted") {
            new Notification("Vyder — download finished", { body: item.title });
          }
        } catch {
          /* ignore */
        }
      }
    },
    [toast],
  );

  const onFailed = useCallback(
    (payload: { id: string; message: string }) => {
      const row = queueRef.current.find((item) => item.id === payload.id);
      // Pausing or cancelling kills the process; the engine may report a
      // non-zero exit code before it sees the cancellation flag.
      if (
        stoppingRef.current.has(payload.id) ||
        row?.status === "paused" ||
        row?.status === "cancelled"
      ) {
        return;
      }
      setQueue((current) =>
        current.map((item) =>
          item.id === payload.id
            ? {
                ...item,
                status: "failed",
                error: payload.message,
                speed: 0,
                eta: 0,
              }
            : item,
        ),
      );
      toast("error", "Download failed", payload.message);
    },
    [toast],
  );

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let alive = true;

    // Each effect run needs its own handler identity. StrictMode mounts the
    // effect twice in development, and the mock bridge keeps handlers in a Set:
    // sharing one memoized function here would make the first cleanup remove
    // the second subscription as well.
    const handlers = {
      progress: (payload: DownloadProgress) => onProgress(payload),
      done: (item: LibraryItem) => onDone(item),
      failed: (payload: { id: string; message: string }) => onFailed(payload),
    };

    Promise.all([
      bridge.onProgress(handlers.progress),
      bridge.onDone(handlers.done),
      bridge.onFailed(handlers.failed),
    ])
      .then((results) => {
        if (alive) unlisteners.push(...results);
        else results.forEach((fn) => fn());
      })
      .catch((error) => console.error("[vyder] event subscription failed", error));

    return () => {
      alive = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [onProgress, onDone, onFailed]);

  /* ---- queue pump ------------------------------------------------------- */

  const pump = useCallback(() => {
    const current = queueRef.current;
    const config = settingsRef.current;
    const active = current.filter(
      (item) => item.status === "downloading" || item.status === "processing",
    ).length;
    let slots = Math.max(1, config.concurrency) - active;
    if (slots <= 0) return;

    for (const item of current) {
      if (slots <= 0) break;
      if (
        item.status !== "queued" ||
        startingRef.current.has(item.id) ||
        resolvingRef.current.has(item.id)
      ) {
        continue;
      }
      startingRef.current.add(item.id);
      slots -= 1;
      setQueue((rows) =>
        rows.map((row) =>
          row.id === item.id ? { ...row, status: "downloading" } : row,
        ),
      );
      bridge
        .startDownload({
          id: item.id,
          url: item.url,
          title: item.title,
          uploader: item.uploader,
          platform: item.platform,
          thumbnail: item.thumbnail,
          duration: item.duration,
          quality: item.quality,
          format: item.format,
        })
        .then(() => {
          startingRef.current.delete(item.id);
        })
        .catch((error: unknown) => {
          startingRef.current.delete(item.id);
          onFailed({ id: item.id, message: String(error) });
        });
    }
  }, [onFailed]);

  useEffect(() => {
    pump();
  }, [queue, pump]);

  /* ---- actions ---------------------------------------------------------- */

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      void bridge.saveSettings(next).catch(() => {
        /* persisted best-effort */
      });
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const next: Settings = {
      ...FALLBACK_SETTINGS,
      outputDir: settingsRef.current.outputDir,
    };
    setSettings(next);
    void bridge.saveSettings(next);
    toast("info", "Appearance reset", "Back to the original Vyder palette.");
  }, [toast]);

  const inspect = useCallback(async (url: string) => {
    return bridge.fetchMedia(url.trim());
  }, []);

  const enqueue = useCallback(
    async (media: MediaInfo, quality: string, format: string) => {
      const item: QueueItem = {
        id: nextId("dl"),
        url: media.url,
        title: media.title,
        uploader: media.uploader,
        platform: media.platform,
        thumbnail: media.thumbnail,
        duration: media.duration,
        quality,
        format: normalizeFormat(quality, format),
        status: "queued",
        percent: 0,
        downloaded: 0,
        total: 0,
        speed: 0,
        eta: 0,
        addedAt: Date.now(),
      };
      setQueue((current) => [item, ...current]);
      toast("info", "Added to the queue", media.title);
    },
    [toast],
  );

  const enqueueUrl = useCallback(
    async (url: string, quality?: string, format?: string) => {
      const trimmed = url.trim();
      if (!isProbablyUrl(trimmed)) {
        toast("error", "That doesn't look like a link", "Paste a full https:// URL.");
        return;
      }
      const config = settingsRef.current;
      const id = nextId("dl");
      const item: QueueItem = {
        id,
        url: trimmed,
        title: trimmed,
        uploader: "",
        platform: detectPlatform(trimmed),
        thumbnail: null,
        duration: 0,
        quality: quality ?? config.defaultQuality,
        format: normalizeFormat(quality ?? config.defaultQuality, format ?? config.defaultFormat),
        status: "queued",
        percent: 0,
        downloaded: 0,
        total: 0,
        speed: 0,
        eta: 0,
        addedAt: Date.now(),
      };
      // Hold the row until its metadata is known. Starting blind would store
      // the raw URL as the library title even though yt-dlp found the real one.
      resolvingRef.current.add(id);
      setQueue((current) => [item, ...current]);

      bridge
        .fetchMedia(trimmed)
        .then((media) => {
          setQueue((current) =>
            current.map((row) =>
              row.id === id
                ? {
                    ...row,
                    title: media.title,
                    uploader: media.uploader,
                    platform: media.platform,
                    thumbnail: media.thumbnail,
                    duration: media.duration,
                  }
                : row,
            ),
          );
        })
        .catch(() => {
          /* the download itself will report any real error */
        })
        .finally(() => {
          resolvingRef.current.delete(id);
          // Nudge the pump now that this row is allowed to start.
          setQueue((current) => current.map((row) => (row.id === id ? { ...row } : row)));
        });

      toast("info", "Added to the queue", trimmed);
    },
    [toast],
  );

  const cancel = useCallback(
    (id: string) => {
      startingRef.current.delete(id);
      stoppingRef.current.add(id);
      setQueue((current) =>
        current.map((row) =>
          row.id === id && (row.status === "downloading" || row.status === "processing")
            ? { ...row, status: "cancelled", speed: 0, eta: 0 }
            : row,
        ),
      );
      void bridge.cancelDownload(id).catch(() => undefined);
    },
    [],
  );

  const pause = useCallback(
    (id: string) => {
      startingRef.current.delete(id);
      stoppingRef.current.add(id);
      setQueue((current) =>
        current.map((row) =>
          row.id === id &&
          (row.status === "downloading" || row.status === "processing")
            ? { ...row, status: "paused", speed: 0, eta: 0 }
            : row,
        ),
      );
      // Pausing uses the same process stop as cancel. yt-dlp leaves its
      // partial file in place, so resuming with --continue picks up here.
      void bridge.pauseDownload(id).catch((error: unknown) => {
        stoppingRef.current.delete(id);
        setQueue((current) =>
          current.map((row) =>
            row.id === id && row.status === "paused"
              ? { ...row, status: "failed", error: String(error) }
              : row,
          ),
        );
        toast("error", "Could not pause the download", String(error));
      });
    },
    [toast],
  );

  const resume = useCallback((id: string) => {
    startingRef.current.delete(id);
    // Reuse the queue row but give the engine a fresh request id. The old
    // process may still be unwinding after pause, and yt-dlp resumes from the
    // existing .part file based on the output name, not this id.
    const next = nextId("dl");
    setQueue((current) =>
      current.map((row) =>
        row.id === id && row.status === "paused"
          ? { ...row, id: next, status: "queued", error: undefined }
          : row,
      ),
    );
  }, []);

  const retry = useCallback(
    async (id: string) => {
      startingRef.current.delete(id);
      const next = nextId("dl");
      setQueue((current) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                id: next,
                status: "queued",
                percent: 0,
                downloaded: 0,
                total: 0,
                speed: 0,
                eta: 0,
                error: undefined,
              }
            : row,
        ),
      );
    },
    [],
  );

  const removeFromQueue = useCallback((id: string) => {
    startingRef.current.delete(id);
    resolvingRef.current.delete(id);
    setQueue((current) => current.filter((row) => row.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setQueue((current) =>
      current.filter(
        (row) => row.status !== "done" && row.status !== "failed" && row.status !== "cancelled",
      ),
    );
  }, []);

  const openFile = useCallback(
    (item: LibraryItem) => {
      void bridge.openPath(item.filePath).catch((error: unknown) => {
        toast("error", "Could not open the file", String(error));
      });
    },
    [toast],
  );

  const revealFile = useCallback(
    (item: LibraryItem) => {
      void bridge.revealPath(item.filePath).catch((error: unknown) => {
        toast("error", "Could not reveal the file", String(error));
      });
    },
    [toast],
  );

  const removeLibraryItem = useCallback(
    async (id: string, deleteFile: boolean) => {
      try {
        const next = await bridge.deleteLibraryItem(id, deleteFile);
        setLibrary(next);
        toast("info", deleteFile ? "Removed and deleted" : "Removed from library");
      } catch (error) {
        toast("error", "Could not remove the item", String(error));
      }
    },
    [toast],
  );

  const clearLibrary = useCallback(
    async (deleteFiles: boolean) => {
      try {
        const next = await bridge.clearLibrary(deleteFiles);
        setLibrary(next);
        toast("info", "Library cleared");
      } catch (error) {
        toast("error", "Could not clear the library", String(error));
      }
    },
    [toast],
  );

  const refreshTools = useCallback(
    async (ytDlpPath?: string, ffmpegPath?: string) => {
      try {
        const next = await bridge.probeTools(
          ytDlpPath ?? settingsRef.current.ytDlpPath,
          ffmpegPath ?? settingsRef.current.ffmpegPath,
        );
        setTools(next);
        return next;
      } catch (error) {
        toast("error", "Tool check failed", String(error));
        return null;
      }
    },
    [toast],
  );

  const savePlaylist = useCallback((name: string, urls: string[]) => {
    const playlist: Playlist = {
      id: nextId("pl"),
      name: name.trim() || "Untitled list",
      urls,
      createdAt: Date.now(),
    };
    setPlaylists((current) => {
      const next = [playlist, ...current];
      try {
        localStorage.setItem(PLAYLIST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const deletePlaylist = useCallback((id: string) => {
    setPlaylists((current) => {
      const next = current.filter((item) => item.id !== id);
      try {
        localStorage.setItem(PLAYLIST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const dismissClipboard = useCallback(() => setClipboardOffer(null), []);

  const useClipboardOffer = useCallback(() => {
    const value = clipboardOffer;
    setClipboardOffer(null);
    if (!value) return;
    setScreen("download");
    void enqueueUrl(value);
  }, [clipboardOffer, enqueueUrl]);

  /* ---- clipboard watch -------------------------------------------------- */

  useEffect(() => {
    if (!settings.clipboardWatch) {
      setClipboardOffer(null);
      return;
    }
    let last = "";
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const text = await navigator.clipboard.readText();
        const value = text.trim();
        if (!value || value === last) return;
        last = value;
        if (isProbablyUrl(value) && detectPlatform(value) !== "web") {
          setClipboardOffer(value);
        }
      } catch {
        /* clipboard permission is optional */
      }
    };
    const interval = window.setInterval(check, 3200);
    return () => window.clearInterval(interval);
  }, [settings.clipboardWatch]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      settings,
      tools,
      version,
      library,
      queue,
      screen,
      toasts,
      playlists,
      clipboardOffer,
      setScreen,
      updateSettings,
      resetSettings,
      inspect,
      enqueue,
      enqueueUrl,
      cancel,
      pause,
      resume,
      retry,
      removeFromQueue,
      clearFinished,
      openFile,
      revealFile,
      removeLibraryItem,
      clearLibrary,
      refreshTools,
      toast,
      dismissToast,
      savePlaylist,
      deletePlaylist,
      dismissClipboard,
      useClipboardOffer,
    }),
    [
      ready,
      settings,
      tools,
      version,
      library,
      queue,
      screen,
      toasts,
      playlists,
      clipboardOffer,
      updateSettings,
      resetSettings,
      inspect,
      enqueue,
      enqueueUrl,
      cancel,
      pause,
      resume,
      retry,
      removeFromQueue,
      clearFinished,
      openFile,
      revealFile,
      removeLibraryItem,
      clearLibrary,
      refreshTools,
      toast,
      dismissToast,
      savePlaylist,
      deletePlaylist,
      dismissClipboard,
      useClipboardOffer,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
