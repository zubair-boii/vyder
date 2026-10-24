import { useStore } from "../lib/store-context";
import { IconAlert, IconCheck } from "./Icons";

export function ToolsBadge() {
  const { tools, setScreen } = useStore();
  const yt = tools?.ytDlp.found;
  const ff = tools?.ffmpeg.found;

  let tone = "ok";
  let label = "engine ready";
  if (!yt) {
    tone = "bad";
    label = "yt-dlp missing";
  } else if (!ff) {
    tone = "warn";
    label = "ffmpeg missing";
  }

  return (
    <button
      className={`tools-badge tools-badge--${tone}`}
      onClick={() => setScreen("settings")}
      title={tools?.ytDlp.path ?? "Set the yt-dlp path in Settings"}
    >
      <span className="tools-badge__dot" />
      <span className="mono tools-badge__label">{label}</span>
      {tone === "ok" ? <IconCheck size={12} /> : <IconAlert size={12} />}
    </button>
  );
}
