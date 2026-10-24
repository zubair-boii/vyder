export type Platform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "x"
  | "reddit"
  | "facebook"
  | "vimeo"
  | "twitch"
  | "soundcloud"
  | "web";

export type Accent = "green";

export interface Settings {
  accent: Accent;
  theme: "light" | "dark";
  outputDir: string;
  defaultQuality: string;
  defaultFormat: string;
  filenameTemplate: string;
  concurrency: number;
  clipboardWatch: boolean;
  notifications: boolean;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  sponsorblock: boolean;
  ytDlpPath: string;
  ffmpegPath: string;
}

export type ToolOrigin = "bundled" | "custom" | "system" | "missing";

export interface ToolInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  origin: ToolOrigin;
}

export interface Tools {
  ytDlp: ToolInfo;
  ffmpeg: ToolInfo;
  outputDir: string;
}

export interface LibraryItem {
  id: string;
  title: string;
  uploader: string;
  platform: Platform;
  thumbnail: string | null;
  duration: number;
  filePath: string;
  fileSize: number;
  format: string;
  quality: string;
  sourceUrl: string;
  downloadedAt: number;
}

export interface FormatOption {
  formatId: string;
  ext: string;
  resolution: string;
  height: number;
  fps: number;
  vcodec: string;
  acodec: string;
  filesize: number;
  tbr: number;
  note: string;
  audioOnly: boolean;
}

export interface MediaInfo {
  id: string;
  url: string;
  title: string;
  uploader: string;
  platform: Platform;
  thumbnail: string | null;
  duration: number;
  viewCount: number;
  uploadDate: string;
  description: string;
  formats: FormatOption[];
  isPlaylist: boolean;
  entryCount: number;
}

export interface Bootstrap {
  settings: Settings;
  library: LibraryItem[];
  tools: Tools;
  version: string;
}

export interface DownloadRequest {
  id: string;
  url: string;
  title: string;
  uploader: string;
  platform: Platform;
  thumbnail: string | null;
  duration: number;
  quality: string;
  format: string;
  outputDir?: string;
  playlist?: string | null;
}

export interface DownloadProgress {
  id: string;
  percent: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
  stage: "downloading" | "processing" | string;
}

export interface DownloadFailure {
  id: string;
  message: string;
}

/** A row in the live queue, owned by the UI. */
export interface QueueItem {
  id: string;
  url: string;
  title: string;
  uploader: string;
  platform: Platform;
  thumbnail: string | null;
  duration: number;
  quality: string;
  format: string;
  status:
    | "queued"
    | "downloading"
    | "processing"
    | "paused"
    | "done"
    | "failed"
    | "cancelled";
  percent: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
  error?: string;
  addedAt: number;
}
