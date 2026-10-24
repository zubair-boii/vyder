#!/usr/bin/env node
/**
 * Download the yt-dlp and FFmpeg binaries that ship inside Vyder.
 *
 * The desktop bundle points Tauri at `src-tauri/binaries` through the
 * platform-specific config files. This script is deliberately dependency-free:
 * it uses Node's fetch (with curl as a Windows fallback) and nothing else.
 *
 * Usage:
 *   node scripts/fetch-tools.mjs            # only fills missing files
 *   node scripts/fetch-tools.mjs --force    # refresh everything
 *
 * Cross-compiling? Set TAURI_ENV_TARGET_TRIPLE (and optionally
 * TAURI_ENV_PLATFORM) before running. Android/iOS builds skip the download
 * because Tauri does not support desktop sidecars on mobile.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, chmodSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binDir = path.join(root, "src-tauri", "binaries");
const force = process.argv.includes("--force");

function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

function platformFamily(triple) {
  if (process.env.TAURI_ENV_PLATFORM === "android" || triple.includes("android")) return "android";
  if (process.env.TAURI_ENV_PLATFORM === "ios" || triple.includes("apple-ios")) return "ios";
  if (triple.includes("windows")) return "windows";
  if (triple.includes("darwin")) return "macos";
  return "linux";
}

const triple = targetTriple();
const family = platformFamily(triple);

if (family === "android" || family === "ios") {
  console.log(`[vyder] ${family} detected — desktop sidecars are not downloaded for mobile.`);
  process.exit(0);
}

const ext = family === "windows" ? ".exe" : "";
mkdirSync(binDir, { recursive: true });

async function download(url, destination) {
  console.log(`[vyder] downloading ${url}`);
  const partial = `${destination}.part`;
  try {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    } catch (error) {
      // Some Windows setups route direct Node sockets differently from the
      // system proxy. curl is shipped with Windows 10+ and honours that proxy.
      if (process.platform !== "win32") throw error;
      console.warn(`[vyder] Node fetch failed (${error.message}); retrying with curl`);
      run("curl.exe", [
        "-L",
        "--fail",
        "--retry",
        "2",
        "--connect-timeout",
        "30",
        "-o",
        partial,
        url,
      ]);
    }
    renameSync(partial, destination);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  console.log(`[vyder] saved ${path.basename(destination)} (${(statSync(destination).size / 1024 / 1024).toFixed(1)} MB)`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", ...options });
}

function toolPath(name) {
  return path.join(binDir, `${name}-${triple}${ext}`);
}

async function fetchYtDlp() {
  const output = toolPath("yt-dlp");
  if (existsSync(output) && !force) {
    console.log(`[vyder] yt-dlp already present (${path.basename(output)})`);
    return;
  }
  const urls = {
    windows: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    macos: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
    linux: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
  };
  const archUrls = {
    linux: {
      aarch64: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64",
      armv7: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_armv7l",
    },
  };
  const arch = triple.split("-")[0];
  const url = archUrls[family]?.[arch] ?? urls[family];
  if (!url) throw new Error(`No yt-dlp download URL for ${family}.`);
  await download(url, output);
  if (family !== "windows") chmodSync(output, 0o755);
}

async function fetchFfmpeg() {
  const output = toolPath("ffmpeg");
  if (existsSync(output) && !force) {
    console.log(`[vyder] FFmpeg already present (${path.basename(output)})`);
    return;
  }

  // ffmpeg-static publishes single-file builds for every desktop platform.
  // We only need ffmpeg itself: yt-dlp uses it for merging and audio
  // conversion, while probing is handled by yt-dlp's own metadata.
  const platform = family === "windows" ? "win32" : family === "macos" ? "darwin" : "linux";
  const arch = triple.split("-")[0];
  let nodeArch;
  if (arch === "aarch64" || arch === "arm64") nodeArch = "arm64";
  else if (arch === "x86_64" || arch === "x64") nodeArch = "x64";
  else {
    throw new Error(`No FFmpeg build is available for ${triple}. Set a custom FFmpeg path in Settings.`);
  }
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-${platform}-${nodeArch}`;
  await download(url, output);
  if (family !== "windows") chmodSync(output, 0o755);
}

console.log(`[vyder] tools for ${triple}`);
await fetchYtDlp();
await fetchFfmpeg();

console.log("[vyder] embedded engine is ready.");
