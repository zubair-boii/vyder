import { useEffect, useRef, useState, type ReactNode } from "react";
import { isProbablyUrl, isMobileApp } from "../lib/format";
import { bridge } from "../lib/bridge";
import { useStore } from "../lib/store-context";
import { IconCopy, IconCut, IconPaste, IconTextSelect } from "./Icons";

type Editable = HTMLInputElement | HTMLTextAreaElement;

interface MenuState {
  x: number;
  y: number;
  editable: Editable | null;
  selection: string;
  anchor: string | null;
}

type MenuAction = {
  id: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  disabled?: boolean;
  separator?: boolean;
  run: () => void | Promise<void>;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function replaceSelection(element: Editable, text: string) {
  element.focus();
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  element.setRangeText(text, start, end, "end");
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function ContextMenu() {
  const { setScreen, toast } = useStore();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobile = isMobileApp();
  const ctrl = (key: string) => (mobile ? undefined : `Ctrl ${key}`);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // Never hand a right-click back to the webview's browser menu. On the
      // menu itself, just keep the current menu open.
      event.preventDefault();
      if (menuRef.current?.contains(target)) return;

      const editable = target.closest("input, textarea") as Editable | null;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      const selection = window.getSelection()?.toString() ?? "";
      const width = 232;
      const height = editable ? 238 : 132;
      setMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
        editable,
        selection,
        anchor: anchor?.href ?? null,
      });
    };

    const close = () => setMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("contextmenu", open);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("contextmenu", open);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, []);

  if (!menu) return null;

  const editable = menu.editable;
  const selected = editable
    ? editable.value.slice(editable.selectionStart ?? 0, editable.selectionEnd ?? 0)
    : menu.selection;
  const hasSelection = selected.length > 0;

  const actions: MenuAction[] = [];

  if (editable) {
    actions.push(
      {
        id: "cut",
        label: "Cut",
        shortcut: ctrl("X"),
        icon: <IconCut size={15} />,
        disabled: !hasSelection,
        run: () => {
          void copyText(selected);
          replaceSelection(editable, "");
        },
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: ctrl("C"),
        icon: <IconCopy size={15} />,
        disabled: !hasSelection,
        run: () => copyText(selected),
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: ctrl("V"),
        icon: <IconPaste size={15} />,
        run: async () => {
          try {
            replaceSelection(editable, await bridge.readClipboard());
          } catch {
            document.execCommand("paste");
          }
        },
      },
      {
        id: "select-all",
        label: "Select all",
        shortcut: ctrl("A"),
        icon: <IconTextSelect size={15} />,
        separator: true,
        run: () => {
          editable.focus();
          editable.select();
        },
      },
    );
  } else if (hasSelection) {
    actions.push(
      {
        id: "copy",
        label: "Copy",
        shortcut: ctrl("C"),
        icon: <IconCopy size={15} />,
        run: () => copyText(selected),
      },
      {
        id: "select-all",
        label: "Select all",
        shortcut: ctrl("A"),
        icon: <IconTextSelect size={15} />,
        separator: true,
        run: () => {
          document.execCommand("selectAll");
        },
      },
    );
  } else if (menu.anchor) {
    actions.push({
      id: "copy-link",
      label: "Copy link",
      icon: <IconCopy size={15} />,
      run: () => copyText(menu.anchor ?? ""),
    });
  }

  if (!editable && !menu.anchor) {
    actions.push({
      id: "paste-link",
      label: "Paste a link",
      shortcut: ctrl("V"),
      icon: <IconPaste size={15} />,
      run: async () => {
        try {
          const text = (await bridge.readClipboard()).trim();
          if (!text) {
            toast("info", "Clipboard is empty", "Copy a video link first.");
            return;
          }
          if (!isProbablyUrl(text)) {
            toast("info", "No link found", "The clipboard does not contain a video URL.");
            return;
          }
          setScreen("download");
          // Let the download desk mount before handing it the link.
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("vyder:paste-link", { detail: text }));
          }, 30);
        } catch {
          toast("error", "Clipboard unavailable", "Allow clipboard access and try again.");
        }
      },
    });
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      aria-label="Context menu"
      onMouseDown={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <div key={action.id}>
          {action.separator ? <div className="context-menu__rule" /> : null}
          <button
            type="button"
            className="context-menu__item"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              setMenu(null);
              void action.run();
            }}
          >
            <span className="context-menu__icon">{action.icon}</span>
            <span className="context-menu__label">{action.label}</span>
            {action.shortcut ? (
              <span className="context-menu__key mono">{action.shortcut}</span>
            ) : null}
          </button>
        </div>
      ))}
    </div>
  );
}
