import { useMemo } from "react";
import { useStore, type Screen } from "../lib/store-context";
import {
  IconHome,
  IconLibrary,
  IconMoon,
  IconPlaylist,
  IconQueue,
  IconSettings,
  IconSun,
} from "./Icons";
import { Toasts } from "./Toasts";
import { ClipboardBar } from "./ClipboardBar";
import { ContextMenu } from "./ContextMenu";
import { ToolsBadge } from "./ToolsBadge";

const NAV: Array<{ id: Screen; label: string; icon: typeof IconHome }> = [
  { id: "download", label: "Home", icon: IconHome },
  { id: "queue", label: "Queue", icon: IconQueue },
  { id: "library", label: "Library", icon: IconLibrary },
  { id: "playlists", label: "Collections", icon: IconPlaylist },
  { id: "settings", label: "Settings", icon: IconSettings },
];

function Wordmark() {
  return (
    <div className="wordmark" aria-label="Vyder">
      <svg viewBox="0 0 34 34" className="wordmark__mark" aria-hidden="true">
        <rect x="1" y="1" width="32" height="32" rx="10" fill="var(--accent)" />
        <path d="M9 10.5 17 24l8-13.5" stroke="#000" strokeWidth="2.8" fill="none" />
      </svg>
      <div className="wordmark__text">
        <span className="wordmark__name display">Vyder</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { screen, setScreen, queue, library, settings, updateSettings } = useStore();

  const counts = useMemo(() => {
    const active = queue.filter(
      (item) => item.status === "downloading" || item.status === "processing",
    ).length;
    const waiting = queue.filter((item) => item.status === "queued").length;
    return { active, waiting, queue: active + waiting, library: library.length };
  }, [queue, library]);

  const badgeFor = (id: Screen) => {
    if (id === "queue") return counts.queue || null;
    if (id === "library") return counts.library || null;
    return null;
  };

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__top">
          <Wordmark />
        </div>

        <nav className="rail__nav" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            const badge = badgeFor(item.id);
            return (
              <button
                key={item.id}
                className={`nav-item ${screen === item.id ? "is-active" : ""}`}
                onClick={() => setScreen(item.id)}
                aria-current={screen === item.id ? "page" : undefined}
              >
                <span className="nav-item__icon">
                  <Icon size={19} />
                </span>
                <span className="nav-item__label">{item.label}</span>
                {badge ? <span className="nav-item__badge">{badge}</span> : null}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="topbar__heading display">{titleFor(screen)}</h1>
          </div>
          <div className="topbar__tools">
            <ToolsBadge />
            <button
              className="icon-btn icon-btn--bordered theme-toggle"
              aria-label={settings.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() =>
                updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })
              }
              title={settings.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {settings.theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
            </button>
          </div>
        </header>

        <ClipboardBar />

        <main className="content" key={screen}>
          {children}
        </main>
      </div>

      <Toasts />
      <ContextMenu />
    </div>
  );
}

function titleFor(screen: Screen) {
  switch (screen) {
    case "download":
      return "Home";
    case "queue":
      return "Queue";
    case "library":
      return "Library";
    case "playlists":
      return "Collections";
    case "settings":
      return "Settings";
    default:
      return "Vyder";
  }
}
