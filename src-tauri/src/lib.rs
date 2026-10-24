// Vyder — a small, opinionated desktop downloader for social video.
//
// The frontend talks to this module through a handful of commands. All of the
// actual downloading is delegated to yt-dlp, which we locate on PATH, next to
// the executable, or via an explicit path in settings.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

const PROGRESS_EVENT: &str = "vyder://download-progress";
const DONE_EVENT: &str = "vyder://download-done";
const FAILED_EVENT: &str = "vyder://download-failed";

// ---------------------------------------------------------------------------
// Android engine bridge
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
static ANDROID_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
static MOBILE_REQUESTS: std::sync::OnceLock<Mutex<HashMap<String, DownloadRequest>>> =
    std::sync::OnceLock::new();

#[cfg(target_os = "android")]
#[derive(Clone)]
struct EngineHandle(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
fn mobile_requests() -> &'static Mutex<HashMap<String, DownloadRequest>> {
    MOBILE_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileStartArgs {
    id: String,
    url: String,
    title: String,
    quality: String,
    format: String,
    audio_only: bool,
    output_dir: String,
    filename_template: String,
    embed_metadata: bool,
    embed_thumbnail: bool,
    sponsorblock: bool,
    notifications: bool,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
struct MobileEmptyArgs {}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Deserialize)]
struct MobileClipboardResult {
    text: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
struct MobileUrlArgs {
    url: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
struct MobileIdArgs {
    id: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
struct MobilePathArgs {
    path: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Deserialize)]
struct MobileInspectResult {
    json: String,
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub accent: String,
    pub theme: String,
    pub output_dir: String,
    pub default_quality: String,
    pub default_format: String,
    pub filename_template: String,
    pub concurrency: u32,
    pub clipboard_watch: bool,
    pub notifications: bool,
    pub embed_metadata: bool,
    pub embed_thumbnail: bool,
    pub sponsorblock: bool,
    pub yt_dlp_path: String,
    pub ffmpeg_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            accent: "green".to_string(),
            theme: "dark".to_string(),
            output_dir: default_output_dir().to_string_lossy().to_string(),
            default_quality: "1080".to_string(),
            default_format: "mp4".to_string(),
            filename_template: "%(title)s.%(ext)s".to_string(),
            concurrency: 2,
            clipboard_watch: true,
            notifications: true,
            embed_metadata: true,
            embed_thumbnail: false,
            sponsorblock: false,
            yt_dlp_path: String::new(),
            ffmpeg_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// "bundled", "custom", "system" or "missing". The UI uses this to explain
    /// where the engine came from without making the user guess.
    pub origin: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tools {
    pub yt_dlp: ToolInfo,
    pub ffmpeg: ToolInfo,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: Settings,
    pub library: Vec<LibraryItem>,
    pub tools: Tools,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub title: String,
    pub uploader: String,
    pub platform: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub duration: f64,
    pub file_path: String,
    #[serde(default)]
    pub file_size: u64,
    pub format: String,
    pub quality: String,
    pub source_url: String,
    #[serde(default)]
    pub downloaded_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub format_id: String,
    pub ext: String,
    pub resolution: String,
    pub height: u32,
    pub fps: f64,
    pub vcodec: String,
    pub acodec: String,
    pub filesize: u64,
    pub tbr: f64,
    pub note: String,
    pub audio_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub id: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub platform: String,
    pub thumbnail: Option<String>,
    pub duration: f64,
    pub view_count: u64,
    pub upload_date: String,
    pub description: String,
    pub formats: Vec<FormatOption>,
    pub is_playlist: bool,
    pub entry_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub uploader: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub quality: String,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub playlist: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub percent: f64,
    pub downloaded: u64,
    pub total: u64,
    pub speed: f64,
    pub eta: f64,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFailure {
    pub id: String,
    pub message: String,
}

struct AppState {
    settings: Arc<Mutex<Settings>>,
    library: Arc<Mutex<Vec<LibraryItem>>>,
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
    data_dir: PathBuf,
}

// ---------------------------------------------------------------------------
// Paths & persistence
// ---------------------------------------------------------------------------

fn home_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn default_output_dir() -> PathBuf {
    home_dir().join("Downloads").join("Vyder")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            // Windows will not rename over an existing file.
            let _ = std::fs::remove_file(path);
            if std::fs::rename(&tmp, path).is_err() {
                let _ = std::fs::remove_file(&tmp);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tool discovery
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}

#[cfg(not(target_os = "windows"))]
fn hide_console(_cmd: &mut Command) {}

fn executable_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

#[cfg_attr(target_os = "android", allow(dead_code))]
struct ResolvedTool {
    path: PathBuf,
    origin: &'static str,
}

fn resolve_tool(configured: &str, name: &str) -> Option<ResolvedTool> {
    let configured = configured.trim();
    if !configured.is_empty() {
        let candidate = PathBuf::from(configured);
        if candidate.is_file() {
            return Some(ResolvedTool {
                path: candidate,
                origin: "custom",
            });
        }
    }

    let file = executable_name(name);

    // Tauri copies external binaries next to the app executable (and into
    // `bin` on some Linux bundles). This is the copy that ships with Vyder, so
    // users never have to install yt-dlp or FFmpeg themselves.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join(&file), dir.join("bin").join(&file)] {
                if candidate.is_file() {
                    return Some(ResolvedTool {
                        path: candidate,
                        origin: "bundled",
                    });
                }
            }
        }
    }

    // A system install remains a valid fallback for developers and for users
    // who prefer a package-manager build.
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(&file);
            if candidate.is_file() {
                return Some(ResolvedTool {
                    path: candidate,
                    origin: "system",
                });
            }
        }
    }

    None
}

#[cfg_attr(target_os = "android", allow(dead_code))]
fn tool_version(bin: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::null());
    hide_console(&mut cmd);
    let output = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

fn probe(settings: &Settings) -> Tools {
    #[cfg(target_os = "android")]
    {
        return Tools {
            yt_dlp: ToolInfo {
                found: true,
                path: Some("youtubedl-android".to_string()),
                version: Some("built in".to_string()),
                origin: "bundled".to_string(),
            },
            ffmpeg: ToolInfo {
                found: true,
                path: Some("youtubedl-android ffmpeg".to_string()),
                version: Some("bundled".to_string()),
                origin: "bundled".to_string(),
            },
            output_dir: settings.output_dir.clone(),
        };
    }

    #[cfg(not(target_os = "android"))]
    {
        let yt = resolve_tool(&settings.yt_dlp_path, "yt-dlp");
        let ff = resolve_tool(&settings.ffmpeg_path, "ffmpeg");

        Tools {
            yt_dlp: match &yt {
                Some(tool) => ToolInfo {
                    found: true,
                    path: Some(tool.path.to_string_lossy().to_string()),
                    version: tool_version(&tool.path, &["--version"]),
                    origin: tool.origin.to_string(),
                },
                None => ToolInfo {
                    found: false,
                    path: None,
                    version: None,
                    origin: "missing".to_string(),
                },
            },
            ffmpeg: match &ff {
                Some(tool) => ToolInfo {
                    found: true,
                    path: Some(tool.path.to_string_lossy().to_string()),
                    version: tool_version(&tool.path, &["-version"]),
                    origin: tool.origin.to_string(),
                },
                None => ToolInfo {
                    found: false,
                    path: None,
                    version: None,
                    origin: "missing".to_string(),
                },
            },
            output_dir: settings.output_dir.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn number(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn integer(value: &Value, key: &str) -> u64 {
    value
        .get(key)
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
        .unwrap_or(0)
}

fn platform_from_extractor(extractor: &str) -> String {
    let key = extractor.to_lowercase();
    for (needle, platform) in [
        ("youtube", "youtube"),
        ("tiktok", "tiktok"),
        ("instagram", "instagram"),
        ("twitter", "x"),
        ("reddit", "reddit"),
        ("facebook", "facebook"),
        ("vimeo", "vimeo"),
        ("twitch", "twitch"),
        ("dailymotion", "dailymotion"),
        ("soundcloud", "soundcloud"),
    ] {
        if key.contains(needle) {
            return platform.to_string();
        }
    }
    if extractor.is_empty() {
        "web".to_string()
    } else {
        extractor.to_lowercase()
    }
}

fn human_resolution(height: u32) -> String {
    match height {
        0 => "audio".to_string(),
        h if h >= 2160 => "4K".to_string(),
        h if h >= 1440 => "1440p".to_string(),
        h if h >= 1080 => "1080p".to_string(),
        h if h >= 720 => "720p".to_string(),
        h if h >= 480 => "480p".to_string(),
        h => format!("{h}p"),
    }
}

fn parse_media(value: &Value, url: &str) -> MediaInfo {
    let extractor = value
        .get("extractor_key")
        .and_then(Value::as_str)
        .or_else(|| value.get("extractor").and_then(Value::as_str))
        .unwrap_or("");

    let is_playlist = value
        .get("_type")
        .and_then(Value::as_str)
        .map(|t| t == "playlist" || t == "multi_video")
        .unwrap_or(false);

    let entry_count = value
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| entries.len() as u32)
        .unwrap_or(0);

    let mut formats: Vec<FormatOption> = Vec::new();
    let mut seen: HashSet<(u32, String)> = HashSet::new();

    if let Some(list) = value.get("formats").and_then(Value::as_array) {
        for format in list {
            let vcodec = text(format, "vcodec");
            let acodec = text(format, "acodec");
            let height = integer(format, "height") as u32;
            let ext = text(format, "ext");
            let audio_only = vcodec == "none" && acodec != "none";
            let has_video = vcodec != "none" && !vcodec.is_empty();

            if !audio_only && !has_video {
                continue;
            }
            if has_video && height == 0 {
                continue;
            }
            if !seen.insert((height, ext.clone())) {
                continue;
            }

            let filesize = {
                let exact = integer(format, "filesize");
                if exact > 0 {
                    exact
                } else {
                    integer(format, "filesize_approx")
                }
            };

            formats.push(FormatOption {
                format_id: text(format, "format_id"),
                ext,
                resolution: if audio_only {
                    "audio".to_string()
                } else {
                    human_resolution(height)
                },
                height,
                fps: number(format, "fps"),
                vcodec: if vcodec == "none" {
                    String::new()
                } else {
                    vcodec
                },
                acodec: if acodec == "none" {
                    String::new()
                } else {
                    acodec
                },
                filesize,
                tbr: number(format, "tbr"),
                note: text(format, "format_note"),
                audio_only,
            });
        }
    }

    formats.sort_by(|a, b| {
        b.height.cmp(&a.height).then_with(|| {
            b.tbr
                .partial_cmp(&a.tbr)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    formats.truncate(24);

    MediaInfo {
        id: text(value, "id"),
        url: value
            .get("webpage_url")
            .and_then(Value::as_str)
            .unwrap_or(url)
            .to_string(),
        title: text(value, "title"),
        uploader: {
            let uploader = text(value, "uploader");
            if uploader.is_empty() {
                let channel = text(value, "channel");
                if channel.is_empty() {
                    text(value, "creator")
                } else {
                    channel
                }
            } else {
                uploader
            }
        },
        platform: platform_from_extractor(extractor),
        thumbnail: value
            .get("thumbnail")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                value
                    .get("thumbnails")
                    .and_then(Value::as_array)
                    .and_then(|list| list.last())
                    .and_then(|t| t.get("url"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }),
        duration: number(value, "duration"),
        view_count: integer(value, "view_count"),
        upload_date: text(value, "upload_date"),
        description: {
            let description = text(value, "description");
            description.chars().take(420).collect()
        },
        formats,
        is_playlist,
        entry_count,
    }
}

fn quality_filter(quality: &str) -> String {
    match quality {
        "2160" => "bv*[height<=2160]+ba/b[height<=2160]/b".to_string(),
        "1440" => "bv*[height<=1440]+ba/b[height<=1440]/b".to_string(),
        "1080" => "bv*[height<=1080]+ba/b[height<=1080]/b".to_string(),
        "720" => "bv*[height<=720]+ba/b[height<=720]/b".to_string(),
        "480" => "bv*[height<=480]+ba/b[height<=480]/b".to_string(),
        "360" => "bv*[height<=360]+ba/b[height<=360]/b".to_string(),
        _ => "bv*+ba/b".to_string(),
    }
}

fn parse_progress_line(line: &str) -> Option<(u64, u64, f64, f64, f64)> {
    let rest = line.strip_prefix("VYDER|")?;
    let parts: Vec<&str> = rest.split('|').collect();
    if parts.len() < 6 {
        return None;
    }
    // yt-dlp writes "NA" for values that are not known yet. Treat those as
    // missing rather than zero so the percentage can fall back to the byte
    // counters.
    let num = |raw: &str| {
        raw.trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite() && *value >= 0.0)
    };
    let downloaded = num(parts[0]).unwrap_or(0.0);
    let exact_total = num(parts[1]).unwrap_or(0.0);
    let estimated_total = num(parts[2]).unwrap_or(0.0);
    let total = if exact_total > 0.0 {
        exact_total
    } else {
        estimated_total
    };
    let reported_percent = num(parts[5]);
    let percent = if total > 0.0 {
        (downloaded / total) * 100.0
    } else {
        reported_percent.unwrap_or(0.0)
    };

    Some((
        downloaded as u64,
        total as u64,
        num(parts[3]).unwrap_or(0.0),
        num(parts[4]).unwrap_or(0.0),
        percent.clamp(0.0, 100.0),
    ))
}

fn kill_tree(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id();
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console(&mut cmd);
        let _ = cmd.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn bootstrap(app: AppHandle) -> Result<Bootstrap, String> {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let library = state.library.lock().map_err(|e| e.to_string())?.clone();
    let tools = probe(&settings);

    Ok(Bootstrap {
        settings,
        library,
        tools,
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let mut guard = state.settings.lock().map_err(|e| e.to_string())?;
    *guard = settings.clone();
    write_json(&state.data_dir.join("settings.json"), &settings);
    Ok(settings)
}

#[tauri::command]
async fn probe_tools(
    app: AppHandle,
    yt_dlp_path: String,
    ffmpeg_path: String,
) -> Result<Tools, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
        settings.yt_dlp_path = yt_dlp_path;
        settings.ffmpeg_path = ffmpeg_path;
        Ok(probe(&settings))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pick_folder(start: Option<String>) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = start;
        // Android scoped storage needs the Storage Access Framework. Until the
        // mobile adapter lands, Vyder keeps downloads in its private app
        // folder, which needs no permission prompt.
        Ok(None)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut dialog = rfd::FileDialog::new().set_title("Choose a download folder");
            if let Some(start) = start {
                if Path::new(&start).is_dir() {
                    dialog = dialog.set_directory(start);
                }
            }
            Ok(dialog
                .pick_folder()
                .map(|path| path.to_string_lossy().to_string()))
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
async fn read_clipboard(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<EngineHandle>().0.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            handle
                .run_mobile_plugin::<MobileClipboardResult>("readClipboard", MobileEmptyArgs {})
                .map(|result| result.text)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        return tauri::async_runtime::spawn_blocking(|| {
            let mut clipboard =
                arboard::Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?;
            clipboard
                .get_text()
                .map_err(|e| format!("Clipboard is empty or unavailable: {e}"))
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "ios")]
    {
        let _ = app;
        Err("Reading the clipboard is not available on iOS yet.".to_string())
    }
}

#[tauri::command]
async fn fetch_media(app: AppHandle, url: String) -> Result<MediaInfo, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<EngineHandle>().0.clone();
        let source = url.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            handle
                .run_mobile_plugin::<MobileInspectResult>("inspect", MobileUrlArgs { url: source })
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        let value: Value = serde_json::from_str(&result.json)
            .map_err(|_| "The Android engine returned an unexpected response.".to_string())?;
        if value.get("entries").is_some() && value.get("title").is_none() {
            return Err("This link is a playlist. Import it from the Playlists tab.".to_string());
        }
        let media = parse_media(&value, &url);
        if media.title.is_empty() {
            return Err("No media was found at that link.".to_string());
        }
        return Ok(media);
    }

    #[cfg(not(target_os = "android"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<AppState>();
        let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
        let bin = resolve_tool(&settings.yt_dlp_path, "yt-dlp")
            .ok_or_else(|| "The bundled yt-dlp engine is missing. Reinstall Vyder or set a custom path in Settings → Tools.".to_string())?
            .path;

        let mut cmd = Command::new(&bin);
        cmd.args([
            "-J",
            "--no-playlist",
            "--no-warnings",
            "--no-call-home",
            "--socket-timeout",
            "20",
        ])
        .arg(&url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        hide_console(&mut cmd);

        let output = cmd
            .output()
            .map_err(|e| format!("Could not start yt-dlp: {e}"))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let message = err
                .lines()
                .filter(|line| line.contains("ERROR"))
                .last()
                .unwrap_or("The link could not be inspected.")
                .trim()
                .to_string();
            return Err(message.replace("ERROR: ", ""));
        }

        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "yt-dlp returned an unexpected response.".to_string())?;

        if value.get("entries").is_some() && value.get("title").is_none() {
            return Err("This link is a playlist. Import it from the Playlists tab.".to_string());
        }

        let media = parse_media(&value, &url);
        if media.title.is_empty() {
            return Err("No media was found at that link.".to_string());
        }
        Ok(media)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
#[allow(unreachable_code)]
fn start_download(app: AppHandle, request: DownloadRequest) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();

    #[cfg(target_os = "android")]
    {
        let output_dir = request
            .output_dir
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| settings.output_dir.clone());
        std::fs::create_dir_all(&output_dir)
            .map_err(|e| format!("Could not create the output folder: {e}"))?;

        let template = if settings.filename_template.trim().is_empty() {
            "%(title)s.%(ext)s".to_string()
        } else {
            settings.filename_template.clone()
        };
        let audio_only = request.quality == "audio"
            || matches!(request.format.as_str(), "mp3" | "m4a" | "wav" | "opus");

        if let Ok(mut guard) = mobile_requests().lock() {
            guard.insert(request.id.clone(), request.clone());
        }
        if let Ok(mut cancelled) = state.cancelled.lock() {
            cancelled.remove(&request.id);
        }

        let args = MobileStartArgs {
            id: request.id.clone(),
            url: request.url.clone(),
            title: request.title.clone(),
            quality: request.quality.clone(),
            format: request.format.clone(),
            audio_only,
            output_dir,
            filename_template: template,
            embed_metadata: settings.embed_metadata,
            embed_thumbnail: settings.embed_thumbnail,
            sponsorblock: settings.sponsorblock,
            notifications: settings.notifications,
        };
        let handle = app.state::<EngineHandle>().0.clone();
        let app_handle = app.clone();
        let id = request.id.clone();
        std::thread::spawn(move || {
            let result = handle.run_mobile_plugin::<Value>("startDownload", args);
            let was_cancelled = app_handle
                .state::<AppState>()
                .cancelled
                .lock()
                .map(|set| set.contains(&id))
                .unwrap_or(false);
            if !was_cancelled {
                if let Ok(value) = &result {
                    if let Some(path) = value.get("path").and_then(Value::as_str) {
                        finish_mobile_download(&app_handle, &id, path);
                    }
                }
            }
            let pending = mobile_requests()
                .lock()
                .map(|mut guard| guard.remove(&id).is_some())
                .unwrap_or(false);
            let cancelled = app_handle
                .state::<AppState>()
                .cancelled
                .lock()
                .map(|mut set| set.remove(&id))
                .unwrap_or(false);
            if pending && !cancelled {
                let message = result
                    .err()
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "The Android engine stopped unexpectedly.".to_string());
                let _ = app_handle.emit(FAILED_EVENT, DownloadFailure { id, message });
            }
        });
        return Ok(());
    }

    let bin = resolve_tool(&settings.yt_dlp_path, "yt-dlp")
        .ok_or_else(|| "The bundled yt-dlp engine is missing. Reinstall Vyder or set a custom path in Settings → Tools.".to_string())?
        .path;
    let ffmpeg = resolve_tool(&settings.ffmpeg_path, "ffmpeg").map(|tool| tool.path);

    let output_dir = request
        .output_dir
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| settings.output_dir.clone());
    let output_dir = PathBuf::from(&output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Could not create the output folder: {e}"))?;

    let template = if settings.filename_template.trim().is_empty() {
        "%(title)s.%(ext)s".to_string()
    } else {
        settings.filename_template.clone()
    };

    let audio_only = request.quality == "audio"
        || matches!(request.format.as_str(), "mp3" | "m4a" | "wav" | "opus");
    let audio_codec = if matches!(request.format.as_str(), "mp3" | "m4a" | "wav" | "opus") {
        request.format.clone()
    } else {
        "mp3".to_string()
    };

    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--continue".into(),
        "--newline".into(),
        "--progress".into(),
        "--no-simulate".into(),
        "--no-warnings".into(),
        "--no-call-home".into(),
        "--socket-timeout".into(),
        "20".into(),
        "--progress-template".into(),
        "download:VYDER|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.percent)s".into(),
        "-o".into(),
        output_dir.join(&template).to_string_lossy().to_string(),
    ];

    if let Some(playlist) = request.playlist.as_ref() {
        if !playlist.trim().is_empty() {
            args.push("--yes-playlist".into());
        }
    }

    if audio_only {
        args.push("-f".into());
        args.push("ba/b".into());
        args.push("-x".into());
        args.push("--audio-format".into());
        args.push(audio_codec.clone());
        args.push("--audio-quality".into());
        args.push("0".into());
    } else {
        args.push("-f".into());
        args.push(quality_filter(&request.quality));
        args.push("--merge-output-format".into());
        args.push(if request.format == "mkv" {
            "mkv".into()
        } else {
            "mp4".into()
        });
    }

    if settings.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if settings.embed_thumbnail {
        args.push("--embed-thumbnail".into());
        args.push("--convert-thumbnails".into());
        args.push("jpg".into());
    }
    if settings.sponsorblock && !audio_only {
        args.push("--sponsorblock-remove".into());
        args.push("sponsor".into());
    }
    if let Some(ffmpeg) = &ffmpeg {
        if let Some(parent) = ffmpeg.parent() {
            args.push("--ffmpeg-location".into());
            args.push(parent.to_string_lossy().to_string());
        }
    }

    let final_path_file = state.data_dir.join(format!("last-{}.path", request.id));
    let _ = std::fs::remove_file(&final_path_file);
    args.push("--print-to-file".into());
    args.push("after_move:filepath".into());
    args.push(final_path_file.to_string_lossy().to_string());

    args.push(request.url.clone());

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start yt-dlp: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    state
        .children
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request.id.clone(), child.clone());
    if let Ok(mut cancelled) = state.cancelled.lock() {
        cancelled.remove(&request.id);
    }

    let library = state.library.clone();
    let children = state.children.clone();
    let cancelled = state.cancelled.clone();
    let data_dir = state.data_dir.clone();
    let id = request.id.clone();
    let request_clone = request.clone();
    let output_format = if audio_only {
        audio_codec.clone()
    } else {
        request_clone.format.clone()
    };

    std::thread::spawn(move || {
        let mut tail: Vec<String> = Vec::new();

        let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let stderr_handle = stderr.map(|handle| {
            let sink = stderr_tail.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(handle).lines().map_while(Result::ok) {
                    if let Ok(mut guard) = sink.lock() {
                        guard.push(line);
                        if guard.len() > 30 {
                            guard.remove(0);
                        }
                    }
                }
            })
        });

        if let Some(handle) = stdout {
            for line in BufReader::new(handle).lines().map_while(Result::ok) {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }

                if let Some((downloaded, total, speed, eta, percent)) = parse_progress_line(&line) {
                    // A video + audio download emits two progress cycles. Keep
                    // the bar live on the second stream instead of leaving it
                    // stuck at 100% from the first one.
                    let stage = if percent >= 99.9 {
                        "processing"
                    } else {
                        "downloading"
                    };
                    let payload = DownloadProgress {
                        id: id.clone(),
                        percent: percent.clamp(0.0, 100.0),
                        downloaded,
                        total,
                        speed,
                        eta,
                        stage: stage.to_string(),
                    };
                    let _ = app.emit(PROGRESS_EVENT, payload);
                } else if line.contains("Merger")
                    || line.contains("ExtractAudio")
                    || line.contains("EmbedThumbnail")
                    || line.contains("Metadata")
                {
                    let payload = DownloadProgress {
                        id: id.clone(),
                        percent: 100.0,
                        downloaded: 0,
                        total: 0,
                        speed: 0.0,
                        eta: 0.0,
                        stage: "processing".to_string(),
                    };
                    let _ = app.emit(PROGRESS_EVENT, payload);
                }

                tail.push(line);
                if tail.len() > 30 {
                    tail.remove(0);
                }
            }
        }

        if let Some(handle) = stderr_handle {
            let _ = handle.join();
        }

        let status = child.lock().ok().and_then(|mut guard| guard.wait().ok());

        if let Ok(mut map) = children.lock() {
            map.remove(&id);
        }

        let was_cancelled = cancelled
            .lock()
            .map(|mut set| set.remove(&id))
            .unwrap_or(false);

        let success = status.map(|s| s.success()).unwrap_or(false);

        if success {
            let mut file_path = std::fs::read_to_string(&final_path_file)
                .ok()
                .map(|value| value.lines().last().unwrap_or("").trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_default();
            let _ = std::fs::remove_file(&final_path_file);

            if file_path.is_empty() {
                // Fall back to yt-dlp's destination log lines.
                for line in tail.iter().rev() {
                    if let Some(rest) = line.split("Destination: ").nth(1) {
                        file_path = rest.trim().to_string();
                        break;
                    }
                }
            }

            let size = std::fs::metadata(&file_path)
                .map(|meta| meta.len())
                .unwrap_or(0);

            let item = LibraryItem {
                id: request_clone.id.clone(),
                title: request_clone.title.clone(),
                uploader: request_clone.uploader.clone(),
                platform: request_clone.platform.clone(),
                thumbnail: request_clone.thumbnail.clone(),
                duration: request_clone.duration,
                file_path,
                file_size: size,
                format: output_format.clone(),
                quality: request_clone.quality.clone(),
                source_url: request_clone.url.clone(),
                downloaded_at: now_ms(),
            };

            if let Ok(mut guard) = library.lock() {
                guard.retain(|existing| existing.id != item.id);
                guard.insert(0, item.clone());
                write_json(&data_dir.join("library.json"), &*guard);
            }

            let _ = app.emit(DONE_EVENT, item);
        } else if !was_cancelled {
            let mut message = String::new();
            if let Ok(guard) = stderr_tail.lock() {
                for line in guard.iter().rev() {
                    if line.contains("ERROR") {
                        message = line.trim().replace("ERROR: ", "");
                        break;
                    }
                }
            }
            if message.is_empty() {
                message = tail
                    .iter()
                    .rev()
                    .find(|line| !line.starts_with('['))
                    .cloned()
                    .unwrap_or_else(|| "The download did not finish.".to_string());
            }
            let _ = app.emit(
                FAILED_EVENT,
                DownloadFailure {
                    id: id.clone(),
                    message,
                },
            );
        }
    });

    Ok(())
}

#[tauri::command]
#[allow(unreachable_code)]
fn cancel_download(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    if let Ok(mut set) = state.cancelled.lock() {
        set.insert(id.clone());
    }

    #[cfg(target_os = "android")]
    {
        let handle = app.state::<EngineHandle>().0.clone();
        let process_id = id.clone();
        std::thread::spawn(move || {
            let _ = handle
                .run_mobile_plugin::<Value>("cancelDownload", MobileIdArgs { id: process_id });
        });
        return Ok(());
    }

    let child = state
        .children
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    if let Some(child) = child {
        if let Ok(mut guard) = child.lock() {
            kill_tree(&mut guard);
        }
    }
    Ok(())
}

#[tauri::command]
#[allow(unreachable_code)]
async fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let _ = &app;
    if !Path::new(&path).exists() {
        return Err("That file is no longer on disk.".to_string());
    }

    #[cfg(target_os = "android")]
    {
        let handle = app.state::<EngineHandle>().0.clone();
        let target = path.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            handle
                .run_mobile_plugin::<Value>("openFile", MobilePathArgs { path: target })
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &path])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console(&mut cmd);
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[allow(unreachable_code)]
async fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let _ = &app;
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("That file is no longer on disk.".to_string());
    }

    #[cfg(target_os = "android")]
    {
        // Android has no file-manager folder to reveal. Open the media in the
        // player instead, which is the closest useful action.
        let handle = app.state::<EngineHandle>().0.clone();
        let target = path.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            handle
                .run_mobile_plugin::<Value>("openFile", MobilePathArgs { path: target })
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", target.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(&target);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_library_item(
    app: AppHandle,
    id: String,
    delete_file: bool,
) -> Result<Vec<LibraryItem>, String> {
    let state = app.state::<AppState>();
    let mut guard = state.library.lock().map_err(|e| e.to_string())?;

    if let Some(item) = guard.iter().find(|item| item.id == id).cloned() {
        if delete_file && !item.file_path.is_empty() {
            let _ = std::fs::remove_file(&item.file_path);
        }
        guard.retain(|entry| entry.id != id);
        write_json(&state.data_dir.join("library.json"), &*guard);
    }

    Ok(guard.clone())
}

#[tauri::command]
fn clear_library(app: AppHandle, delete_files: bool) -> Result<Vec<LibraryItem>, String> {
    let state = app.state::<AppState>();
    let mut guard = state.library.lock().map_err(|e| e.to_string())?;
    if delete_files {
        for item in guard.iter() {
            if !item.file_path.is_empty() {
                let _ = std::fs::remove_file(&item.file_path);
            }
        }
    }
    guard.clear();
    write_json(&state.data_dir.join("library.json"), &*guard);
    Ok(guard.clone())
}

// ---------------------------------------------------------------------------
// Android JNI callbacks
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
fn android_string(env: &mut jni::JNIEnv, value: &jni::objects::JString) -> String {
    env.get_string(value)
        .ok()
        .and_then(|text| text.to_str().ok().map(str::to_owned))
        .unwrap_or_default()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_zubairkhan_vyder_EngineNative_progress(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    id: jni::objects::JString,
    downloaded: i64,
    total: i64,
    speed: f64,
    eta: f64,
    percent: f64,
    stage: jni::objects::JString,
) {
    let id = android_string(&mut env, &id);
    let stage = android_string(&mut env, &stage);
    if id.is_empty() {
        return;
    }
    let Some(app) = ANDROID_APP.get() else {
        return;
    };
    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            id,
            percent: percent.clamp(0.0, 100.0),
            downloaded: downloaded.max(0) as u64,
            total: total.max(0) as u64,
            speed: speed.max(0.0),
            eta: eta.max(0.0),
            stage: if stage.is_empty() {
                "downloading".to_string()
            } else {
                stage
            },
        },
    );
}

#[cfg(target_os = "android")]
fn finish_mobile_download(app: &AppHandle, id: &str, path: &str) {
    let request = mobile_requests()
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(id));

    let Some(request) = request else {
        return;
    };

    if path.is_empty() {
        let _ = app.emit(
            FAILED_EVENT,
            DownloadFailure {
                id: id.to_string(),
                message: "The download finished without a file.".to_string(),
            },
        );
        return;
    }

    let size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    let item = LibraryItem {
        id: request.id.clone(),
        title: request.title.clone(),
        uploader: request.uploader.clone(),
        platform: request.platform.clone(),
        thumbnail: request.thumbnail.clone(),
        duration: request.duration,
        file_path: path.to_string(),
        file_size: size,
        format: request.format.clone(),
        quality: request.quality.clone(),
        source_url: request.url.clone(),
        downloaded_at: now_ms(),
    };

    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.library.lock() {
        guard.retain(|existing| existing.id != item.id);
        guard.insert(0, item.clone());
        write_json(&state.data_dir.join("library.json"), &*guard);
    }
    let _ = app.emit(DONE_EVENT, item);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_zubairkhan_vyder_EngineNative_done(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    id: jni::objects::JString,
    path: jni::objects::JString,
) {
    let id = android_string(&mut env, &id);
    let path = android_string(&mut env, &path);
    if id.is_empty() {
        return;
    }
    let Some(app) = ANDROID_APP.get() else {
        return;
    };
    finish_mobile_download(app, &id, &path);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_zubairkhan_vyder_EngineNative_failed(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    id: jni::objects::JString,
    message: jni::objects::JString,
) {
    let id = android_string(&mut env, &id);
    let message = android_string(&mut env, &message);
    if id.is_empty() {
        return;
    }
    let Some(app) = ANDROID_APP.get() else {
        return;
    };
    let pending = mobile_requests()
        .lock()
        .map(|mut guard| guard.remove(&id).is_some())
        .unwrap_or(false);
    if pending {
        let _ = app.emit(
            FAILED_EVENT,
            DownloadFailure {
                id,
                message: if message.is_empty() {
                    "The download did not finish.".to_string()
                } else {
                    message
                },
            },
        );
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_plugin = tauri::plugin::Builder::<tauri::Wry>::new("engine")
        .setup(|app, api| {
            let _ = (&app, &api);
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.zubairkhan.vyder", "EnginePlugin")?;
                app.manage(EngineHandle(handle));
                let _ = ANDROID_APP.set(app.clone());
            }
            Ok(())
        })
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(engine_plugin)
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| default_output_dir());
            let _ = std::fs::create_dir_all(&data_dir);

            let settings_path = data_dir.join("settings.json");
            let settings: Settings = read_json(&settings_path).unwrap_or_default();
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let mut settings = settings;
            let library: Vec<LibraryItem> =
                read_json(&data_dir.join("library.json")).unwrap_or_default();

            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                // Mobile has no desktop Downloads folder. Always keep files
                // inside the app sandbox, even if an older settings.json still
                // contains a desktop path. The Paste button uses the native
                // clipboard bridge; the desktop clipboard watcher stays off
                // because Android restricts background clipboard access.
                // Store downloads under the app's files directory so the
                // Android FileProvider can share them with external players.
                let mobile_dir = data_dir
                    .join("files")
                    .join("downloads")
                    .to_string_lossy()
                    .to_string();
                let mut changed = !settings_path.exists();
                if settings.output_dir != mobile_dir {
                    settings.output_dir = mobile_dir;
                    changed = true;
                }
                if settings.clipboard_watch {
                    settings.clipboard_watch = false;
                    changed = true;
                }
                if changed {
                    write_json(&settings_path, &settings);
                }
            }

            let _ = std::fs::create_dir_all(&settings.output_dir);

            app.manage(AppState {
                settings: Arc::new(Mutex::new(settings)),
                library: Arc::new(Mutex::new(library)),
                children: Arc::new(Mutex::new(HashMap::new())),
                cancelled: Arc::new(Mutex::new(HashSet::new())),
                data_dir,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_settings,
            probe_tools,
            pick_folder,
            read_clipboard,
            fetch_media,
            start_download,
            cancel_download,
            open_path,
            reveal_path,
            delete_library_item,
            clear_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vyder");
}
