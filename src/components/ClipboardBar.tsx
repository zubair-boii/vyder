import { useStore } from "../lib/store-context";
import { IconClipboard, IconX } from "./Icons";

export function ClipboardBar() {
  const { clipboardOffer, dismissClipboard, useClipboardOffer } = useStore();
  if (!clipboardOffer) return null;

  return (
    <div className="clipbar">
      <span className="clipbar__icon">
        <IconClipboard size={15} />
      </span>
      <span className="clipbar__text">
        <span className="eyebrow">Link detected on clipboard</span>
        <span className="clipbar__url mono">{clipboardOffer}</span>
      </span>
      <button className="clipbar__action" onClick={useClipboardOffer}>
        Add to queue
      </button>
      <button
        className="icon-btn"
        onClick={dismissClipboard}
        aria-label="Dismiss clipboard suggestion"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
