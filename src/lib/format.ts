import type { Platform } from "./types";

export function platformLabel(platform: Platform | string): string {
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "x":
      return "X";
    case "reddit":
      return "Reddit";
    case "facebook":
      return "Facebook";
    case "vimeo":
      return "Vimeo";
    case "twitch":
      return "Twitch";
    case "soundcloud":
      return "SoundCloud";
    default:
      return "Web";
  }
}

export function detectPlatform(url: string): Platform {
  const value = url.toLowerCase();
  if (value.includes("youtube.") || value.includes("youtu.be")) return "youtube";
  if (value.includes("tiktok.")) return "tiktok";
  if (value.includes("instagram.")) return "instagram";
  if (value.includes("twitter.") || value.includes("x.com")) return "x";
  if (value.includes("reddit.") || value.includes("redd.it")) return "reddit";
  if (value.includes("facebook.") || value.includes("fb.watch")) return "facebook";
  if (value.includes("vimeo.")) return "vimeo";
  if (value.includes("twitch.")) return "twitch";
  if (value.includes("soundcloud.")) return "soundcloud";
  return "web";
}

export function isProbablyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Tauri's mobile webview still reports a normal browser UA. */
export function isMobileApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const unique: string[] = [];
  for (const match of matches) {
    const clean = match.replace(/[.,;]+$/, "");
    if (!unique.includes(clean)) unique.push(clean);
  }
  return unique;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const fixed = value >= 100 || index === 0 ? 0 : digits;
  return `${value.toFixed(fixed)} ${units[index]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (total >= 60) {
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}m ${secs}s`;
  }
  return `${total}s`;
}

export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "—";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function relativeTime(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(ms);
}

export function parseUploadDate(value: string): string {
  if (!value || value.length !== 8) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function safeFilename(template: string): string {
  return template
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic album-cover artwork used when a thumbnail is missing or fails.
 * Purely geometric so the app never shows a wall of identical placeholders.
 */
export function posterFor(seed: string, palette = 0): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const palettes = [
    ["#1ed760", "#0d5b32", "#06180d"],
    ["#7c9cf5", "#1d2d5c", "#080d1c"],
    ["#f0b45a", "#5a3414", "#1b0f07"],
    ["#ef7d9c", "#4b1828", "#1b070d"],
    ["#a88bff", "#2b1d5a", "#0e0820"],
    ["#d9d9d9", "#303030", "#090909"],
  ];
  const [accent, mid, deep] = palettes[(hash + palette) % palettes.length];
  const cx = 90 + (hash % 300);
  const cy = 40 + (hash % 190);
  const radius = 80 + (hash % 90);
  const ringX = 60 + (hash % 360);
  const ringY = 60 + (hash % 150);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${mid}"/>
        <stop offset="1" stop-color="${deep}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.92"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="shade" cx="55%" cy="45%" r="75%">
        <stop offset="55%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
      </radialGradient>
    </defs>
    <rect width="480" height="270" fill="url(#bg)"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#glow)"/>
    <circle cx="${ringX}" cy="${ringY}" r="${radius * 0.74}" fill="none" stroke="#fff" stroke-width="1" opacity="0.16"/>
    <circle cx="${ringX}" cy="${ringY}" r="${radius * 0.74 + 26}" fill="none" stroke="${accent}" stroke-width="1" opacity="0.35"/>
    <rect width="480" height="270" fill="url(#shade)"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
