import type {
  Bootstrap,
  DownloadFailure,
  DownloadProgress,
  DownloadRequest,
  LibraryItem,
  MediaInfo,
  Settings,
  Tools,
} from "./types";
import { detectPlatform, posterFor } from "./format";

type Unlisten = () => void;
type Handler<T> = (payload: T) => void;

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* -------------------------------------------------------------------------- */
/* Mock backend — used when the app runs in a plain browser (design preview).  */
/* -------------------------------------------------------------------------- */

const MOCK_KEY = "vyder.mock.v1";

interface MockStore {
  settings: Settings;
  library: LibraryItem[];
}

const MOCK_SEED: MockStore = {
  settings: {
    accent: "green",
    theme: "dark",
    outputDir: "C:\\Users\\grand\\Downloads\\Vyder",
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
  },
  library: [
    {
      id: "lib-1",
      title: "The Sound of a City Waking Up — 4AM Field Recording",
      uploader: "Quiet Hours",
      platform: "youtube",
      thumbnail: null,
      duration: 512,
      filePath: "C:\\Users\\grand\\Downloads\\Vyder\\sound-of-a-city.mp4",
      fileSize: 148_912_000,
      format: "mp4",
      quality: "1080",
      sourceUrl: "https://youtube.com/watch?v=example1",
      downloadedAt: Date.now() - 1000 * 60 * 34,
    },
    {
      id: "lib-2",
      title: "studio tour: 12 square metres of organised chaos",
      uploader: "@northlight",
      platform: "tiktok",
      thumbnail: null,
      duration: 58,
      filePath: "C:\\Users\\grand\\Downloads\\Vyder\\studio-tour.mp4",
      fileSize: 24_117_000,
      format: "mp4",
      quality: "720",
      sourceUrl: "https://tiktok.com/@northlight/video/1",
      downloadedAt: Date.now() - 1000 * 60 * 60 * 5,
    },
    {
      id: "lib-3",
      title: "How linen gets made, start to finish",
      uploader: "Field Notes",
      platform: "instagram",
      thumbnail: null,
      duration: 143,
      filePath: "C:\\Users\\grand\\Downloads\\Vyder\\linen.mp4",
      fileSize: 61_440_000,
      format: "mp4",
      quality: "1080",
      sourceUrl: "https://instagram.com/p/example",
      downloadedAt: Date.now() - 1000 * 60 * 60 * 27,
    },
    {
      id: "lib-4",
      title: "Radio mix — late summer, no vocals",
      uploader: "Third Coast",
      platform: "soundcloud",
      thumbnail: null,
      duration: 2841,
      filePath: "C:\\Users\\grand\\Downloads\\Vyder\\late-summer.mp3",
      fileSize: 78_200_000,
      format: "mp3",
      quality: "audio",
      sourceUrl: "https://soundcloud.com/thirdcoast/late-summer",
      downloadedAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
    },
    {
      id: "lib-5",
      title: "a very long argument about fonts",
      uploader: "The Margin",
      platform: "x",
      thumbnail: null,
      duration: 2310,
      filePath: "C:\\Users\\grand\\Downloads\\Vyder\\fonts.mp4",
      fileSize: 402_653_000,
      format: "mkv",
      quality: "2160",
      sourceUrl: "https://x.com/themargin/status/1",
      downloadedAt: Date.now() - 1000 * 60 * 60 * 24 * 11,
    },
  ],
};

function loadMock(): MockStore {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MockStore>;
      return {
        settings: { ...MOCK_SEED.settings, ...(parsed.settings ?? {}) },
        library: parsed.library ?? MOCK_SEED.library,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    settings: { ...MOCK_SEED.settings },
    library: MOCK_SEED.library.map((item) => ({ ...item })),
  };
}

let mock = loadMock();

function persistMock() {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(mock));
  } catch {
    /* ignore */
  }
}

const mockListeners = {
  progress: new Set<Handler<DownloadProgress>>(),
  done: new Set<Handler<LibraryItem>>(),
  failed: new Set<Handler<DownloadFailure>>(),
};

const mockTimers = new Map<string, number[]>();

function mockTools(): Tools {
  return {
    ytDlp: {
      found: true,
      path: "Vyder\\engine\\yt-dlp.exe",
      version: "2026.10.11",
      origin: "bundled",
    },
    ffmpeg: {
      found: true,
      path: "Vyder\\engine\\ffmpeg.exe",
      version: "ffmpeg version 8.1",
      origin: "bundled",
    },
    outputDir: mock.settings.outputDir,
  };
}

function mockMedia(url: string): MediaInfo {
  const platform = detectPlatform(url);
  const seed = url.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const titles = [
    "A quiet morning in the workshop",
    "This is what 40 hours of editing looks like",
    "field notes: coastal path, no narration",
    "the whole process, unedited",
    "Late night drive through the old town",
  ];
  const uploaders = ["@northlight", "Quiet Hours", "Field Notes", "The Margin", "@slowframe"];
  const heights = [2160, 1440, 1080, 720, 480, 360];
  return {
    id: `mock-${seed}`,
    url,
    title: titles[seed % titles.length],
    uploader: uploaders[seed % uploaders.length],
    platform,
    thumbnail: posterFor(url, seed),
    duration: 60 + (seed % 900),
    viewCount: 4_200 + (seed % 900_000),
    uploadDate: "20260912",
    description:
      "A slow, mostly unedited look at the process. Shot on a single lens, recorded with one microphone, cut in the order it happened.",
    isPlaylist: false,
    entryCount: 0,
    formats: [
      ...heights.map((height, index) => ({
        formatId: `${height}`,
        ext: height >= 1440 ? "webm" : "mp4",
        resolution: height >= 2160 ? "4K" : `${height}p`,
        height,
        fps: index < 2 ? 60 : 30,
        vcodec: "avc1",
        acodec: "mp4a",
        filesize: height * 240_000,
        tbr: height * 0.6,
        note: index < 2 ? "high bitrate" : "",
        audioOnly: false,
      })),
      {
        formatId: "audio-128",
        ext: "m4a",
        resolution: "audio",
        height: 0,
        fps: 0,
        vcodec: "none",
        acodec: "mp4a",
        filesize: 4_900_000,
        tbr: 128,
        note: "medium",
        audioOnly: true,
      },
      {
        formatId: "audio-256",
        ext: "m4a",
        resolution: "audio",
        height: 0,
        fps: 0,
        vcodec: "none",
        acodec: "mp4a",
        filesize: 9_100_000,
        tbr: 256,
        note: "high",
        audioOnly: true,
      },
    ],
  };
}

function mockStart(request: DownloadRequest) {
  const started = Date.now();
  const total = 40_000_000 + Math.round(Math.random() * 120_000_000);
  const timers: number[] = [];
  mockTimers.set(request.id, timers);

  let percent = 0;
  const interval = window.setInterval(() => {
    percent = Math.min(100, percent + 3.2 + Math.random() * 2.6);
    const downloaded = Math.round((total * percent) / 100);
    const speed = 2_400_000 + Math.random() * 5_000_000;
    const progress: DownloadProgress = {
      id: request.id,
      percent,
      downloaded,
      total,
      speed,
      eta: percent >= 100 ? 0 : Math.round((total - downloaded) / speed),
      stage: percent >= 100 ? "processing" : "downloading",
    };
    mockListeners.progress.forEach((handler) => handler(progress));

    if (percent >= 100) {
      window.clearInterval(interval);
      const finish = window.setTimeout(() => {
        const item: LibraryItem = {
          id: request.id,
          title: request.title,
          uploader: request.uploader,
          platform: request.platform,
          thumbnail: request.thumbnail,
          duration: request.duration,
          filePath: `${mock.settings.outputDir}\\${request.title.slice(0, 40)}.${request.format}`,
          fileSize: total,
          format: request.format,
          quality: request.quality,
          sourceUrl: request.url,
          downloadedAt: Date.now(),
        };
        mock.library = [item, ...mock.library];
        persistMock();
        mockListeners.done.forEach((handler) => handler(item));
      }, 900);
      timers.push(finish);
    }
  }, 320);

  timers.push(interval);
  void started;
}

function mockCancel(id: string) {
  const timers = mockTimers.get(id);
  timers?.forEach((timer) => {
    window.clearInterval(timer);
    window.clearTimeout(timer);
  });
  mockTimers.delete(id);
}

/* -------------------------------------------------------------------------- */
/* Bridge                                                                     */
/* -------------------------------------------------------------------------- */

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import("@tauri-apps/api/core");
  return api.invoke<T>(command, args);
}

async function listen<T>(event: string, handler: Handler<T>): Promise<Unlisten> {
  const api = await import("@tauri-apps/api/event");
  const unlisten = await api.listen<T>(event, (payload) => handler(payload.payload));
  return unlisten;
}

export const bridge = {
  async bootstrap(): Promise<Bootstrap> {
    if (!isTauri) {
      return {
        settings: mock.settings,
        library: mock.library,
        tools: mockTools(),
        version: "0.1.0",
      };
    }
    return invoke<Bootstrap>("bootstrap");
  },

  async saveSettings(settings: Settings): Promise<Settings> {
    if (!isTauri) {
      mock.settings = settings;
      persistMock();
      return settings;
    }
    return invoke<Settings>("save_settings", { settings });
  },

  async probeTools(ytDlpPath: string, ffmpegPath: string): Promise<Tools> {
    if (!isTauri) {
      return mockTools();
    }
    return invoke<Tools>("probe_tools", { ytDlpPath, ffmpegPath });
  },

  async pickFolder(start?: string): Promise<string | null> {
    if (!isTauri) {
      const value = window.prompt("Folder path", start || mock.settings.outputDir);
      return value || null;
    }
    return invoke<string | null>("pick_folder", { start });
  },

  /** Read the system clipboard through Rust/Android instead of the WebView. */
  async readClipboard(): Promise<string> {
    if (!isTauri) {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    }
    return invoke<string>("read_clipboard");
  },

  async fetchMedia(url: string): Promise<MediaInfo> {
    if (!isTauri) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (url.includes("fail")) {
        throw new Error("Unsupported URL: this link does not point to a video.");
      }
      return mockMedia(url);
    }
    return invoke<MediaInfo>("fetch_media", { url });
  },

  async startDownload(request: DownloadRequest): Promise<void> {
    if (!isTauri) {
      mockStart(request);
      return;
    }
    return invoke<void>("start_download", { request });
  },

  async cancelDownload(id: string): Promise<void> {
    if (!isTauri) {
      mockCancel(id);
      return;
    }
    return invoke<void>("cancel_download", { id });
  },

  async pauseDownload(id: string): Promise<void> {
    if (!isTauri) {
      mockCancel(id);
      return;
    }
    // Pausing is a process stop that keeps the partial file. Resume starts a
    // fresh request id with --continue, so late events from the stopped
    // process cannot touch the new row.
    return invoke<void>("cancel_download", { id });
  },

  async openPath(path: string): Promise<void> {
    if (!isTauri) {
      console.info("[mock] open", path);
      return;
    }
    return invoke<void>("open_path", { path });
  },

  async revealPath(path: string): Promise<void> {
    if (!isTauri) {
      console.info("[mock] reveal", path);
      return;
    }
    return invoke<void>("reveal_path", { path });
  },

  async deleteLibraryItem(id: string, deleteFile: boolean): Promise<LibraryItem[]> {
    if (!isTauri) {
      const target = mock.library.find((item) => item.id === id);
      mock.library = mock.library.filter((item) => item.id !== id);
      persistMock();
      void deleteFile;
      void target;
      return mock.library;
    }
    return invoke<LibraryItem[]>("delete_library_item", { id, deleteFile });
  },

  async clearLibrary(deleteFiles: boolean): Promise<LibraryItem[]> {
    if (!isTauri) {
      mock.library = [];
      persistMock();
      void deleteFiles;
      return [];
    }
    return invoke<LibraryItem[]>("clear_library", { deleteFiles });
  },

  async onProgress(handler: Handler<DownloadProgress>): Promise<Unlisten> {
    if (!isTauri) {
      mockListeners.progress.add(handler);
      return () => mockListeners.progress.delete(handler);
    }
    return listen<DownloadProgress>("vyder://download-progress", handler);
  },

  async onDone(handler: Handler<LibraryItem>): Promise<Unlisten> {
    if (!isTauri) {
      mockListeners.done.add(handler);
      return () => mockListeners.done.delete(handler);
    }
    return listen<LibraryItem>("vyder://download-done", handler);
  },

  async onFailed(handler: Handler<DownloadFailure>): Promise<Unlisten> {
    if (!isTauri) {
      mockListeners.failed.add(handler);
      return () => mockListeners.failed.delete(handler);
    }
    return listen<DownloadFailure>("vyder://download-failed", handler);
  },

  /** Show the file in the OS file manager. */
  async revealItem(item: LibraryItem): Promise<void> {
    return bridge.revealPath(item.filePath);
  },
};

export type Bridge = typeof bridge;
