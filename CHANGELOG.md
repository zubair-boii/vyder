# Changelog

All notable changes to Vyder are documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

## [0.1.0] - 2026-10-24

### Added

- Spotify-inspired dark desktop and mobile interface with a single green accent.
- Inspect, queue, download, pause, resume, retry, cancel, open, reveal, and delete flows.
- Desktop engine discovery: bundled yt-dlp/FFmpeg, custom paths, then `PATH`.
- Native Android engine based on `youtubedl-android` with a foreground download service.
- Android notification progress, pause/resume, and native clipboard paste.
- Adaptive Android launcher icon and monochrome themed icon.
- Library persistence, generated poster fallbacks, collections, and browser mock backend.
- NSIS/MSI installers and an arm64 Android APK.

### Fixed

- Release-only Android engine failure caused by R8 stripping Apache Commons Compress
  reflection targets.
- Clipboard paste on Android now uses the native `ClipboardManager` instead of the
  WebView clipboard API.
- Download progress no longer regresses when yt-dlp switches from a video stream to
  an audio stream.
- Pausing or cancelling no longer produces a failure toast from the stopped engine
  process, and late events cannot overwrite the paused/cancelled row.
- The Android round launcher icon now uses the adaptive icon resource on API 26+.
