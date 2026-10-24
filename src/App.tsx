import { useEffect } from "react";
import { StoreProvider } from "./lib/store";
import { useStore } from "./lib/store-context";
import { AppShell } from "./components/AppShell";
import { DownloadScreen } from "./screens/DownloadScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { PlaylistsScreen } from "./screens/PlaylistsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

function Router() {
  const { screen, setScreen, ready } = useStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= 5) {
        event.preventDefault();
        const order = ["download", "queue", "library", "playlists", "settings"] as const;
        setScreen(order[index - 1]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setScreen]);

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot__mark" aria-hidden="true">
          <span className="boot__glyph display">V</span>
        </div>
        <p className="eyebrow">Vyder</p>
      </div>
    );
  }

  return (
    <AppShell>
      {screen === "download" ? <DownloadScreen /> : null}
      {screen === "queue" ? <QueueScreen /> : null}
      {screen === "library" ? <LibraryScreen /> : null}
      {screen === "playlists" ? <PlaylistsScreen /> : null}
      {screen === "settings" ? <SettingsScreen /> : null}
    </AppShell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
