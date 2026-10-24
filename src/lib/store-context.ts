import { createContext, useContext } from "react";
import type { LibraryItem, MediaInfo, QueueItem, Settings, Tools } from "./types";

export type Screen = "download" | "queue" | "library" | "playlists" | "settings";

export interface Toast {
  id: string;
  tone: "ok" | "error" | "info";
  title: string;
  detail?: string;
}

export interface Playlist {
  id: string;
  name: string;
  urls: string[];
  createdAt: number;
}

export interface StoreValue {
  ready: boolean;
  settings: Settings;
  tools: Tools | null;
  version: string;
  library: LibraryItem[];
  queue: QueueItem[];
  screen: Screen;
  toasts: Toast[];
  playlists: Playlist[];
  clipboardOffer: string | null;
  setScreen: (screen: Screen) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  inspect: (url: string) => Promise<MediaInfo>;
  enqueue: (media: MediaInfo, quality: string, format: string) => Promise<void>;
  enqueueUrl: (url: string, quality?: string, format?: string) => Promise<void>;
  cancel: (id: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  retry: (id: string) => Promise<void>;
  removeFromQueue: (id: string) => void;
  clearFinished: () => void;
  openFile: (item: LibraryItem) => void;
  revealFile: (item: LibraryItem) => void;
  removeLibraryItem: (id: string, deleteFile: boolean) => Promise<void>;
  clearLibrary: (deleteFiles: boolean) => Promise<void>;
  refreshTools: (ytDlpPath?: string, ffmpegPath?: string) => Promise<Tools | null>;
  toast: (tone: Toast["tone"], title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  savePlaylist: (name: string, urls: string[]) => void;
  deletePlaylist: (id: string) => void;
  dismissClipboard: () => void;
  useClipboardOffer: () => void;
}

export const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used inside StoreProvider");
  return context;
}
