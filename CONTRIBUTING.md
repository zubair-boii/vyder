# Contributing to Vyder

Vyder is a small Tauri app. The fastest way to help is to reproduce a bug, improve
the docs, or send a focused pull request that keeps the existing visual language and
download pipeline intact.

## Before you start

- Search existing issues and pull requests.
- For a large change, open an issue first so the approach can be discussed.
- Never include downloaded media, credentials, keystores, or personal paths in a PR.

## Development setup

Requirements:

- Node.js 20+
- Rust stable
- WebView2 on Windows
- For Android: Android SDK 37, build-tools 36+, NDK 28.2+, and JDK 17+

```bash
pnpm install
pnpm dev          # UI preview with the mock engine
pnpm desktop:dev  # real Tauri app
pnpm android:dev  # Android device/emulator
```

`pnpm dev` uses a mock backend in `src/lib/bridge.ts`, so you can work on the
interface without compiling Rust or downloading the engine binaries.

## Useful checks

```bash
pnpm check
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

Android builds and the Windows prebuilt-`.so` fallback are documented in
[MOBILE.md](MOBILE.md). Release steps are in [docs/RELEASING.md](docs/RELEASING.md).
Android build output is intentionally ignored by git.

## What to keep in mind

- The library index is owned by the Rust backend. The queue is a React-owned scheduler
  that calls backend commands; do not duplicate library state in the frontend.
- Desktop downloads are child processes. Android downloads use the native
  `youtubedl-android` plugin and a foreground service.
- Progress is byte-based. Do not invent percentages when the total size is unknown;
  use the indeterminate state.
- Keep the UI compact: one green accent, no dashboard-style stats, no duplicate
  instructions.
- Preserve offline behavior. The bundled yt-dlp/FFmpeg path must keep working without
  a network round-trip for settings or metadata.

## Commit and PR style

- Keep commits focused and describe the behavior change.
- Include a short test note in the PR: platform, device/API level, URL type, and the
  quality/format combination you exercised.
- UI changes should include before/after screenshots.
- Update `README.md`, `MOBILE.md`, or `CHANGELOG.md` when setup or behavior changes.

## License

The project license is still being selected. Until a license is added, do not
redistribute builds or assume that contributions may be used outside this repository.
This note will be replaced when the license is finalized.
