# Vyder on Android

Vyder has a native Android download engine. It uses the bundled
[`youtubedl-android`](https://github.com/yausername/youtubedl-android) runtime instead
of desktop sidecars, because Tauri's `externalBin` mechanism does not exist on Android.

## What works

- Native yt-dlp + FFmpeg engine (`youtubedl-android` 0.18.1).
- Inspect, download, progress, ETA, pause, resume, cancel, retry, queue, and library
  persistence.
- A `dataSync` foreground service with a progress notification, so downloads continue
  while the app is backgrounded or the screen is locked.
- Pause/resume using yt-dlp's partial `.part` file and `--continue`.
- Native clipboard paste through Android's `ClipboardManager`; the Paste button no
  longer depends on the WebView clipboard API.
- Files are stored in the app sandbox (`files/downloads`) and opened with the system
  viewer through a `FileProvider`.
- Adaptive launcher icon, round icon, and monochrome themed icon generated from
  `src-tauri/icons/app-icon.manifest.json`.
- Responsive phone layout, bottom navigation, safe-area padding, and a dark-first
  Spotify-style skin.

The first time a link is inspected or downloaded, the library extracts its Python and
FFmpeg payloads. That can take tens of seconds on a phone; later runs are fast.

## Requirements

- Android SDK with API 37 platforms, build-tools 36+, NDK 28.2+
- JDK 17 or newer. Android Studio's bundled JBR works with the generated Gradle 9.6.0
  / Android Gradle Plugin 9.3.1 project.
- Rust targets: `aarch64-linux-android`, `armv7-linux-androideabi`,
  `i686-linux-android`, `x86_64-linux-android`

The generated project currently packages the `arm64-v8a` ABI only. That covers current
phones and keeps the APK from carrying four copies of Python + FFmpeg.

## Build and install

Point the build at the SDK and Android Studio's JDK:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\28.2.13676358"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

pnpm android:dev
```

For a debug APK:

```powershell
npx tauri android build --debug --apk --target aarch64 --ci
```

For a release APK/AAB:

```powershell
npx tauri android build --target aarch64 --ci
```

The Tauri CLI creates a symlink from the Cargo output into `app/src/main/jniLibs`.
Windows refuses that symlink unless Developer Mode (or the "Create symbolic links"
policy) is enabled. If the build stops with a symbolic-link error, use the
prebuilt-library path below.

### Windows prebuilt-`.so` fallback

The committed Gradle project keeps the normal `rust` plugin and `buildSrc`. The fallback
sets `VYDER_ANDROID_PREBUILT=1`, so the plugin copies the library that the Tauri CLI
already compiled instead of invoking Cargo a second time:

```powershell
# 1. Compile the Android Rust library. The CLI may still fail at its symlink
#    step; that is expected. The .so is already on disk at this point.
npx tauri android build --debug --apk --target aarch64 --ci

# 2. Package with the normal Gradle project. The rust plugin copies
#    target/aarch64-linux-android/debug/libvyder_lib.so into jniLibs.
$env:VYDER_ANDROID_PREBUILT = "1"
Push-Location src-tauri\gen\android
.\gradlew.bat :app:assembleArm64Debug --no-daemon --no-configuration-cache
Pop-Location
```

For a smaller release APK, use the same fallback with the release profile:

```powershell
npx tauri android build --apk --target aarch64 --ci
$env:VYDER_ANDROID_PREBUILT = "1"
Push-Location src-tauri\gen\android
.\gradlew.bat :app:assembleArm64Release --no-daemon --no-configuration-cache
Pop-Location
```

The APKs are written to:

```text
src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk
src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk
```

The release output is unsigned. Sign it with your keystore before publishing. The release
APK in `release/android` was signed with the standard Android debug key so it can be
sideloaded for testing.

### Release shrinking (R8)

`app/proguard-rules.pro` keeps `com.yausername.**`, `org.apache.commons.compress.**`,
`org.apache.commons.io.**`, `EnginePlugin`, `EngineNative`, `Engine*Args`, and
`DownloadService`. `youtubedl-android` reflects over Apache Commons Compress extra-field
classes while unpacking its Python runtime on first use. Without those keeps, a release
build initializes the engine but fails extraction with an error such as
`class ... is not a concrete class`; the debug build still works. Keep the rules when
changing the R8 configuration.

### Maven mirrors and the local cache

`dl.google.com` and `repo.maven.apache.org` are not reachable from every network. The
generated project keeps Aliyun mirrors as fallbacks. For the two large
`youtubedl-android` AARs (`library` and `ffmpeg`), you can point Gradle at a local Maven
cache with `VYDER_ANDROID_M2`; the directory is ignored by git and must not be included
in a release. Huawei Cloud is a useful fallback for the large AARs when Aliyun is slow:

```text
https://repo.huaweicloud.com/repository/maven/
```

The wrapper is pinned to Gradle 9.6.0 for reproducible builds.

Install and launch on the connected device:

```powershell
# Debug build (normal Gradle flavors)
adb install -r src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk

# Or the signed release build
adb install -r release\android\Vyder-0.1.0-arm64.apk

adb shell monkey -p com.zubairkhan.vyder -c android.intent.category.LAUNCHER 1
```

## Architecture

- `src-tauri/src/lib.rs` routes Android inspect/download/cancel calls into a Tauri mobile
  plugin. It still emits the same `vyder://download-*` events the frontend listens to.
- `EnginePlugin.kt` owns `youtubedl-android`, builds yt-dlp arguments, extracts the
  runtime, reports progress through JNI, and starts/stops the foreground service.
- `EngineNative.kt` is the small JNI surface (`progress`, `done`, `failed`).
- `DownloadService.kt` keeps the process alive with a `dataSync` foreground service and
  updates the notification. It does not own the download; `EnginePlugin` does.
- `AndroidManifest.xml` declares the service, notification permission, and the
  `FileProvider` used to open downloaded files in a player or gallery app.
- The Paste button calls Rust's `read_clipboard`, which calls the Kotlin
  `readClipboard` command on Android and `arboard` on desktop.

### Pause and resume

Pausing stops the yt-dlp process but leaves the partial `.part` file in
`files/downloads`. Resuming enqueues the same URL under a fresh request id, and the
engine runs with `--continue`, so it picks up from the partial file. The fresh id keeps
late progress or failure events from the stopped process from touching the new row. The
foreground service is stopped only when no downloads remain active. A cancelled download
also stops the process; the difference is the UI state (paused vs. cancelled) and the fact
that paused rows keep their progress and resume action.

### Notifications

Android 13+ needs `POST_NOTIFICATIONS` for the progress notification to appear in the
drawer. The first download requests it if the setting is enabled. The foreground service
itself still starts if permission is denied; Android may hide the notification but keeps
the process alive. The notification is low-importance, ongoing, and updates at most once
per second.

## Still to do

- Save to the public `Downloads` collection through MediaStore, so files also appear in
  the gallery without a share step.
- Ship armv7/x86_64 APKs as separate splits if older devices are needed.
- Signed release builds with a stable keystore.
- An "update yt-dlp" action for sites that change their extraction rules.
- Queue reconciliation after returning from a long background period, so the UI can
  reflect completions that happened while the WebView was paused.
