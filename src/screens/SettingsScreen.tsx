import { useEffect, useState } from "react";
import { useStore } from "../lib/store-context";
import { bridge } from "../lib/bridge";
import { Button, Field, Segmented, Select, TextInput, Toggle } from "../components/Ui";
import { isMobileApp, plural } from "../lib/format";
import { IconAlert, IconCheck, IconFolder, IconRefresh } from "../components/Icons";

function originLabel(origin: string | undefined): string {
  switch (origin) {
    case "bundled":
      return "Bundled with Vyder";
    case "custom":
      return "Custom override";
    case "system":
      return "System install";
    default:
      return "Not found";
  }
}

export function SettingsScreen() {
  const {
    settings,
    updateSettings,
    tools,
    refreshTools,
    version,
    library,
    toast,
  } = useStore();

  const [ytPath, setYtPath] = useState(settings.ytDlpPath);
  const [ffPath, setFfPath] = useState(settings.ffmpegPath);
  const [checking, setChecking] = useState(false);
  const mobile = isMobileApp();

  useEffect(() => {
    setYtPath(settings.ytDlpPath);
    setFfPath(settings.ffmpegPath);
  }, [settings.ytDlpPath, settings.ffmpegPath]);

  async function chooseFolder() {
    const folder = await bridge.pickFolder(settings.outputDir);
    if (folder) updateSettings({ outputDir: folder });
  }

  async function recheck() {
    setChecking(true);
    const next = await refreshTools(ytPath, ffPath);
    setChecking(false);
    if (next) {
      toast(
        next.ytDlp.found ? "ok" : "error",
        next.ytDlp.found ? "yt-dlp found" : "yt-dlp still missing",
        next.ytDlp.version ?? "Check the path and try again.",
      );
    }
  }

  const diskUsage = library.reduce((sum, item) => sum + item.fileSize, 0);

  return (
    <div className="page page--settings">
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel corner-ticks">
            <header className="panel__head">
              <div>
                <span className="eyebrow">Appearance</span>
                <h3 className="panel__title display">Theme</h3>
              </div>
            </header>

            <div className="panel__body">
              <div className="setting-row">
                <div className="setting-row__label">
                  <span className="field__label">Colour mode</span>
                  <span className="field__hint">Dark is the default. Light keeps the same green accent.</span>
                </div>
                <Segmented
                  value={settings.theme}
                  onChange={(value) => updateSettings({ theme: value })}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  ariaLabel="Theme"
                />
              </div>
            </div>
          </section>

          <section className="panel corner-ticks">
            <header className="panel__head">
              <div>
                <span className="eyebrow">Storage</span>
                <h3 className="panel__title display">Where files land</h3>
              </div>
            </header>
            <div className="panel__body">
              <Field
                label={mobile ? "App folder" : "Output folder"}
                hint={mobile ? "private app storage" : "created automatically"}
              >
                <div className="inline-control">
                  <TextInput
                    value={settings.outputDir}
                    onChange={(event) => updateSettings({ outputDir: event.target.value })}
                    spellCheck={false}
                    readOnly={mobile}
                  />
                  <Button
                    variant="outline"
                    onClick={chooseFolder}
                    icon={<IconFolder size={14} />}
                    disabled={mobile}
                  >
                    Browse
                  </Button>
                </div>
              </Field>
              {mobile ? (
                <p className="field-note">
                  On Android, downloads are saved inside Vyder's private app storage and removed with
                  the app. Use the library's Open action to play them.
                </p>
              ) : null}

              <Field
                label="Filename template"
                hint="yt-dlp syntax"
                htmlFor="filename-template"
              >
                <TextInput
                  id="filename-template"
                  value={settings.filenameTemplate}
                  onChange={(event) => updateSettings({ filenameTemplate: event.target.value })}
                  spellCheck={false}
                />
              </Field>
              <p className="field-note">
                Tokens: <code>%(title)s</code>, <code>%(uploader)s</code>,{" "}
                <code>%(upload_date)s</code>, <code>%(resolution)s</code>,{" "}
                <code>%(ext)s</code>.
              </p>

              <div className="disk-meter">
                <div className="disk-meter__head">
                  <span className="eyebrow">Library footprint</span>
                  <span className="mono">{(diskUsage / 1024 ** 3).toFixed(2)} GB</span>
                </div>
                <div className="disk-meter__track">
                  <span
                    className="disk-meter__fill"
                    style={{ width: `${Math.min(100, (diskUsage / (50 * 1024 ** 3)) * 100)}%` }}
                  />
                </div>
                <span className="field__hint">
                  {plural(library.length, "file")} tracked by Vyder.
                </span>
              </div>
            </div>
          </section>

          <section className="panel corner-ticks">
            <header className="panel__head">
              <div>
                <span className="eyebrow">Defaults</span>
                <h3 className="panel__title display">Download behaviour</h3>
              </div>
            </header>
            <div className="panel__body">
              <div className="two-col">
                <Field label="Default quality">
                  <Select
                    value={settings.defaultQuality}
                    onChange={(event) => updateSettings({ defaultQuality: event.target.value })}
                    options={[
                      { value: "2160", label: "4K · 2160p" },
                      { value: "1440", label: "1440p" },
                      { value: "1080", label: "1080p" },
                      { value: "720", label: "720p" },
                      { value: "480", label: "480p" },
                      { value: "360", label: "360p" },
                      { value: "audio", label: "Audio only" },
                    ]}
                  />
                </Field>
                <Field label="Default container">
                  <Select
                    value={settings.defaultFormat}
                    onChange={(event) => updateSettings({ defaultFormat: event.target.value })}
                    options={[
                      { value: "mp4", label: "MP4" },
                      { value: "mkv", label: "MKV" },
                      { value: "mp3", label: "MP3" },
                      { value: "m4a", label: "M4A" },
                    ]}
                  />
                </Field>
              </div>

              <Field label="Parallel downloads" hint="1–5">
                <Segmented
                  value={String(settings.concurrency)}
                  onChange={(value) => updateSettings({ concurrency: Number(value) })}
                  options={[
                    { value: "1", label: "1" },
                    { value: "2", label: "2" },
                    { value: "3", label: "3" },
                    { value: "4", label: "4" },
                    { value: "5", label: "5" },
                  ]}
                  ariaLabel="Parallel downloads"
                />
              </Field>

              <div className="toggle-list">
                <Toggle
                  checked={settings.embedMetadata}
                  onChange={(value) => updateSettings({ embedMetadata: value })}
                  label="Embed metadata"
                  description="Write title, channel and date into the file."
                />
                <Toggle
                  checked={settings.embedThumbnail}
                  onChange={(value) => updateSettings({ embedThumbnail: value })}
                  label="Embed thumbnail"
                  description="Add cover art where the container supports it."
                />
                <Toggle
                  checked={settings.sponsorblock}
                  onChange={(value) => updateSettings({ sponsorblock: value })}
                  label="Remove sponsor segments"
                  description="Uses SponsorBlock chapters, when available."
                />
                <Toggle
                  checked={settings.clipboardWatch}
                  onChange={(value) => updateSettings({ clipboardWatch: value })}
                  label="Watch the clipboard"
                  description="Offer to queue links copied from a supported site."
                />
                <Toggle
                  checked={settings.notifications}
                  onChange={(value) => {
                    updateSettings({ notifications: value });
                    if (value && "Notification" in window && Notification.permission === "default") {
                      void Notification.requestPermission();
                    }
                  }}
                  label="Desktop notifications"
                  description="Ping when a download finishes."
                />
              </div>
            </div>
          </section>

          <section className="panel corner-ticks">
            <header className="panel__head">
              <div>
                <span className="eyebrow">Engine</span>
                <h3 className="panel__title display">Tools</h3>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={recheck}
                disabled={checking}
                icon={<IconRefresh size={13} />}
              >
                {checking ? "Checking…" : "Re-check"}
              </Button>
            </header>
            <div className="panel__body">
              <p className="field-note">
                yt-dlp and FFmpeg ship inside Vyder. There is nothing to install,
                and the engine keeps working offline. Override a path below only
                when you want to run a different build.
              </p>

              <div className="tool-row">
                <div className="tool-row__info">
                  <span className={`tool-row__dot ${tools?.ytDlp.found ? "is-ok" : "is-bad"}`} />
                  <div>
                    <span className="field__label">yt-dlp</span>
                    <span className="mono tool-row__detail">
                      {tools?.ytDlp.found
                        ? `${originLabel(tools.ytDlp.origin)} · ${tools.ytDlp.version ?? "found"}`
                        : "The bundled engine could not start. Re-check or set a custom path."}
                    </span>
                    {tools?.ytDlp.path ? (
                      <span className="mono tool-row__path">{tools.ytDlp.path}</span>
                    ) : null}
                  </div>
                </div>
                {tools?.ytDlp.found ? <IconCheck size={15} /> : <IconAlert size={15} />}
              </div>

              <div className="tool-row">
                <div className="tool-row__info">
                  <span className={`tool-row__dot ${tools?.ffmpeg.found ? "is-ok" : "is-warn"}`} />
                  <div>
                    <span className="field__label">ffmpeg</span>
                    <span className="mono tool-row__detail">
                      {tools?.ffmpeg.found
                        ? `${originLabel(tools.ffmpeg.origin)} · needed for merging and audio`
                        : "The bundled engine could not start. Re-check or set a custom path."}
                    </span>
                    {tools?.ffmpeg.path ? (
                      <span className="mono tool-row__path">{tools.ffmpeg.path}</span>
                    ) : null}
                  </div>
                </div>
                {tools?.ffmpeg.found ? <IconCheck size={15} /> : <IconAlert size={15} />}
              </div>

              <div className="two-col">
                <Field label="Custom yt-dlp path" hint="optional">
                  <TextInput
                    value={ytPath}
                    onChange={(event) => setYtPath(event.target.value)}
                    placeholder="Leave empty for the bundled build"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Custom ffmpeg path" hint="optional">
                  <TextInput
                    value={ffPath}
                    onChange={(event) => setFfPath(event.target.value)}
                    placeholder="Leave empty for the bundled build"
                    spellCheck={false}
                  />
                </Field>
              </div>

              <div className="button-row">
                <Button
                  variant="solid"
                  size="sm"
                  onClick={() => {
                    updateSettings({ ytDlpPath: ytPath, ffmpegPath: ffPath });
                    void recheck();
                  }}
                >
                  Save tool paths
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setYtPath("");
                    setFfPath("");
                    updateSettings({ ytDlpPath: "", ffmpegPath: "" });
                    void refreshTools("", "");
                  }}
                >
                  Use bundled engine
                </Button>
              </div>
            </div>
          </section>
        </div>

        <aside className="settings-side">
          <section className="panel panel--flat">
            <span className="eyebrow">About</span>
            <h3 className="panel__title display">Vyder v{version}</h3>
            <p className="settings-side__copy">
              Keep the videos and audio you have permission to download. Vyder does
              not host or redistribute anything — it saves the file to your disk.
            </p>
            <ul className="settings-list">
              <li>
                <span className="eyebrow">Downloads</span>
                <span className="mono">{library.length}</span>
              </li>
              <li>
                <span className="eyebrow">Engine</span>
                <span className="mono">
                  {tools?.ytDlp.found ? originLabel(tools.ytDlp.origin) : "Missing"}
                </span>
              </li>
              <li>
                <span className="eyebrow">Platform</span>
                <span className="mono">{isMobileApp() ? "Mobile" : "Desktop"}</span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
