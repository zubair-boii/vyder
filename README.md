# Vyder

[![CI](https://github.com/zubair-boii/vyder/actions/workflows/ci.yml/badge.svg)](https://github.com/zubair-boii/vyder/actions/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-1ed760)](#platform-support)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)

A quiet downloader for social video, on desktop and Android. Paste a link, pick a
stream, and keep the file — without a browser tab full of overlays.

Vyder is built with **Tauri 2**, **React 19** and **TypeScript**. Desktop downloads
are delegated to a bundled [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) with FFmpeg for
merging and audio extraction. Android uses the native
[`youtubedl-android`](https://github.com/yausername/youtubedl-android) runtime and a
foreground service, so transfers keep running when the app is backgrounded.

## Features

- **One link, one action.** The home screen is a paste field, a download button, and
  recent files — nothing else.
- **Compact inspector.** Choose video or audio, then a quality/format. One
  **Add to queue** action.
- **Real queue controls.** Pause, resume, retry, cancel, remove, and clear finished
  rows. Progress is byte-based; unknown sizes use an indeterminate bar.
- **Offline desktop engine.** yt-dlp and FFmpeg ship with the installer. Custom
  executable paths are supported in Settings.
- **Android background downloads.** A `dataSync` foreground service and progress
  notification keep the engine alive while the app is not visible.
- **Native Android clipboard.** The Paste button reads the system clipboard through
  Kotlin instead of the restricted WebView clipboard API.
- **Library and collections.** Finished files are indexed with title, channel,
  thumbnail, size, quality, and source URL. Collections are stored locally.
- **Adaptive Android icon.** Green launcher icon, round icon, and monochrome themed
  icon generated from the same source as the desktop icons.

## Platform support

| Platform | Status | Engine |
| --- | --- | --- |
| Windows 10/11 x64 | Primary | Bundled yt-dlp + FFmpeg |
| macOS | Buildable | Bundled yt-dlp + FFmpeg |
| Linux | Buildable | Bundled yt-dlp + FFmpeg |
| Android 8.0+ (API 26) | Tested on arm64 | `youtubedl-android` 0.18.1 |

The Android APK currently packages `arm64-v8a` only. This keeps the APK from carrying
four copies of Python and FFmpeg. See [MOBILE.md](MOBILE.md) for device setup and the
Windows prebuilt-`.so` fallback.

## Quick start

Requirements:

- Node.js 20+
- Rust stable
- WebView2 on Windows
- Android SDK 37, build-tools 36+, NDK 28.2+, and JDK 17+ for Android

```bash
pnpm install

# UI-only preview in a normal browser, with a mock download engine
pnpm dev

# The real desktop app (Tauri + Rust + bundled engine)
pnpm desktop:dev

# Android device/emulator
pnpm android:dev
```

`pnpm dev` is intentionally useful for design work: it simulates inspection,
progress, pause/resume, completion, and a seeded library using `localStorage` under
`vyder.mock.v1`. The Tauri app ignores the mock entirely.

### Desktop build

```bash
pnpm check         # TypeScript only
pnpm build         # type-check + production frontend bundle
pnpm desktop:build # installers / bundles
```

Desktop output goes to `src-tauri/target/release/bundle/`. The release copy of the
current build lives in `release/` (gitignored):

- `Vyder_0.1.0_x64-setup.exe`
- `Vyder_0.1.0_x64_en-US.msi`
- `android/Vyder-0.1.0-arm64.apk`

`src-tauri/target/` is Cargo's scratch directory. A fresh release build can make it
1.5 GB or more; it is never part of the app. Remove it after packaging with:

```powershell
Remove-Item -Recurse -Force src-tauri/target
```

The installed desktop footprint is about 100 MB, almost entirely the bundled tools
(FFmpeg ~79 MB, yt-dlp ~17 MB). The Vyder shell itself is ~4.5 MB.

## How a download works

1. **Inspect** runs `yt-dlp -J --no-playlist` and parses title, channel, duration,
   thumbnail, and available formats.
2. **Enqueue** adds a row owned by the React store. A small pump respects the
   concurrency setting.
3. **Download** spawns the resolved `yt-dlp` with a machine-readable progress template
   (`download:VYDER|downloaded|total|estimate|speed|eta|percent`) and passes
   `--ffmpeg-location` when a bundled or custom FFmpeg is available. `--continue` is
   always set so a paused or interrupted transfer can resume from its `.part` file.
4. Progress, completion, and failure are emitted as Tauri events
   (`vyder://download-progress`, `vyder://download-done`, `vyder://download-failed`).
5. After `after_move`, yt-dlp writes the final file path to a sidecar file, which
   becomes the library entry. The UI then shows open/reveal/delete actions.

On Android, the same Rust commands route into `EnginePlugin.kt`. The plugin starts
`DownloadService` before the first-run Python/FFmpeg extraction, reports progress via
JNI, and stops the service when the transfer ends. Pausing stops the process but keeps
the partial file; resuming enqueues the same URL under a fresh request id with
`--continue`, so late events from the stopped process cannot touch the new row.

Quick-added links are held for a moment while their metadata resolves, so the library
does not end up with raw URLs as titles.

## Where things are stored

| Data | Location |
| --- | --- |
| Settings | Tauri app-data dir → `settings.json` |
| Library index | Tauri app-data dir → `library.json` |
| Downloads (desktop) | `~/Downloads/Vyder` by default (editable in Settings) |
| Downloads (Android) | App-private storage (`files/downloads`) |
| Collections | WebView `localStorage` (`vyder.playlists.v1`) |

The app-data dir is managed by Tauri (on Windows, usually
`%APPDATA%\com.zubairkhan.vyder`). On Android the app-private folder keeps downloads
inside the app sandbox; exporting to the shared `Downloads` collection is a future
improvement.

Deleting a library entry can either forget the row or delete the file. Deletion is
permanent: Vyder does **not** send files to the recycle bin, and the confirmation
dialog says so.

## Project map

```text
src/
  components/      App shell, rail, topbar, UI atoms, icons, posters, toasts
  lib/
    bridge.ts      Tauri command/event bridge + browser mock backend
    store.tsx      Settings, library, queue pump, pause/resume, events, collections
    format.ts      Platform detection, byte/time formatting, generated posters
    types.ts       Shared frontend types
  screens/         Download, Queue, Library, Collections, Settings
  styles/          theme.css (tokens) + app.css (layout) + spotify.css (skin)
  assets/fonts/    Local WOFF2 files
src-tauri/
  src/lib.rs       Commands, persistence, tool discovery, desktop process management,
                   Android JNI callbacks and the mobile plugin bridge
  gen/android/     Generated Android project plus Vyder's Kotlin engine/service
  binaries/        Downloaded desktop sidecars (gitignored)
  tauri.*.conf.json  Per-platform sidecar lists (desktop only)
  capabilities/    Tauri permission capability
  icons/           App icon sources and generated platform icons
scripts/
  fetch-tools.mjs  Cross-platform yt-dlp + FFmpeg downloader
docs/
  RELEASING.md     Maintainer checklist for installers, APK, hashes, and releases
.github/           CI, Dependabot, issue/PR templates
```

## Design notes

Vyder is deliberately not a Fluent/Windows 11 app. The interface is a dark,
Spotify-inspired media app: a black navigation rail, one raised charcoal content
panel, green primary actions, album-style artwork, flat cards, and a dense bottom tab
bar on phones.

Everything visual lives in three files:

| File | Purpose |
| --- | --- |
| `src/styles/theme.css` | Palette, type stack, radius/shadow scales, rail colours, themes |
| `src/styles/app.css` | Layout, components, and responsive/mobile rules |
| `src/styles/spotify.css` | Visual skin loaded last: colours, radii, cards, controls |

Change `--accent`, `--paper-*`, or `--radius-*` in `theme.css` to retune the whole app.
The app uses a single Spotify-style green accent (`#1ed760`) with black text on primary
buttons. **Instrument Sans** is bundled locally, so the UI works offline.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues should go through
[private vulnerability reporting](SECURITY.md), not a public issue.

Good first issues:

- MediaStore export on Android so files also appear in the gallery.
- Audio-only and separate-stream merge regression tests on Android.
- A release workflow for signed desktop/Android artifacts.
- More robust queue reconciliation after the Android app returns from background.

## Notes & limits

- Vyder does not host, mirror, or redistribute media. Download only what you have
  permission to keep.
- DRM-protected sources are not supported.
- Playlist URLs are not expanded as downloads in this version; use Collections to keep
  a named set of links and queue them together.
- Desktop downloads run as child processes. Cancelling kills the process tree; partial
  files may be left behind by yt-dlp. Pausing intentionally keeps them.
- The Rust backend must be compiled on the target platform. The frontend is fully typed
  and can be previewed without Rust.
- Android files are app-private. The FileProvider lets other apps open them, but they
  are not yet exported to the public `Downloads` collection.
- Release APKs are currently debug-signed for sideload testing. Replace the key before
  publishing to a store.

## License

The project license is still being selected. Until a license is added, do not
redistribute builds or assume that contributions may be used outside this repository.
Bundled tools keep their own licenses: **yt-dlp** is Unlicense; the FFmpeg builds come
from [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) and are GPL. If you
redistribute Vyder installers, comply with the GPL (including source-offer
requirements) or replace FFmpeg with a build you are licensed to ship.
