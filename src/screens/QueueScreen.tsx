import { useMemo, useState } from "react";
import { useStore } from "../lib/store-context";
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatSpeed,
  platformLabel,
} from "../lib/format";
import { Button, EmptyState, ProgressBar, Tag } from "../components/Ui";
import {
  IconCheck,
  IconDownload,
  IconPause,
  IconPlay,
  IconQueue,
  IconRefresh,
  IconTrash,
  IconX,
} from "../components/Icons";
import { Poster } from "../components/Poster";
import type { QueueItem } from "../lib/types";

type Filter = "all" | "active" | "done" | "failed";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "In progress" },
  { value: "done", label: "Finished" },
  { value: "failed", label: "Failed" },
];

export function QueueScreen() {
  const { queue, cancel, pause, resume, retry, removeFromQueue, clearFinished, setScreen, settings } =
    useStore();
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    switch (filter) {
      case "active":
        return queue.filter((item) =>
          ["queued", "downloading", "processing", "paused"].includes(item.status),
        );
      case "done":
        return queue.filter((item) => item.status === "done");
      case "failed":
        return queue.filter((item) => item.status === "failed" || item.status === "cancelled");
      default:
        return queue;
    }
  }, [queue, filter]);

  const counts = useMemo(
    () => ({
      active: queue.filter((item) =>
        ["queued", "downloading", "processing", "paused"].includes(item.status),
      ).length,
      done: queue.filter((item) => item.status === "done").length,
      failed: queue.filter((item) => item.status === "failed").length,
      bytes: queue.reduce((sum, item) => sum + item.downloaded, 0),
    }),
    [queue],
  );

  const finished = queue.some(
    (item) => item.status === "done" || item.status === "failed" || item.status === "cancelled",
  );

  if (queue.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon={<IconQueue size={22} />}
          title="The queue is empty"
          body="Add a link from the download desk and it will show up here with live progress, speed and time remaining."
          action={
            <Button variant="solid" onClick={() => setScreen("download")} icon={<IconDownload size={15} />}>
              Fetch a video
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page page--queue">
      <div className="queue-head">
        <div className="queue-summary">
          <div className="queue-summary__item">
            <span className="eyebrow">Active</span>
            <span className="display queue-summary__value">{counts.active}</span>
          </div>
          <div className="queue-summary__item">
            <span className="eyebrow">Finished</span>
            <span className="display queue-summary__value">{counts.done}</span>
          </div>
          <div className="queue-summary__item">
            <span className="eyebrow">Transferred</span>
            <span className="display queue-summary__value">{formatBytes(counts.bytes)}</span>
          </div>
          <div className="queue-summary__item">
            <span className="eyebrow">Slots</span>
            <span className="display queue-summary__value">{settings.concurrency}</span>
          </div>
        </div>
        <div className="queue-actions">
          <div className="filter-row" role="tablist" aria-label="Filter queue">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                role="tab"
                aria-selected={filter === item.value}
                className={`filter-pill ${filter === item.value ? "is-active" : ""}`}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
                {item.value === "failed" && counts.failed > 0 ? (
                  <span className="filter-pill__count mono">{counts.failed}</span>
                ) : null}
              </button>
            ))}
          </div>
          <Button
            variant="quiet"
            size="sm"
            disabled={!finished}
            onClick={clearFinished}
            icon={<IconTrash size={14} />}
          >
            Clear finished
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="queue-empty mono">Nothing in this view.</p>
      ) : (
        <ol className="queue-list">
          {visible.map((item, index) => (
            <QueueRow
              key={item.id}
              item={item}
              index={index}
              onCancel={() => cancel(item.id)}
              onPause={() => pause(item.id)}
              onResume={() => resume(item.id)}
              onRetry={() => retry(item.id)}
              onRemove={() => removeFromQueue(item.id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function QueueRow({
  item,
  index,
  onCancel,
  onPause,
  onResume,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  index: number;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const active = item.status === "downloading" || item.status === "processing";
  const isPaused = item.status === "paused";
  const unknownSize =
    active && item.total === 0 && item.percent === 0;
  const isDone = item.status === "done";
  const isFailed = item.status === "failed";
  const isCancelled = item.status === "cancelled";
  const isQueued = item.status === "queued";

  const tone = isDone
    ? "good"
    : isFailed
      ? "bad"
      : isCancelled
        ? "muted"
        : "accent";

  const statusLabel =
    item.status === "queued"
      ? "waiting"
      : item.status === "downloading"
        ? "downloading"
        : item.status === "processing"
          ? "processing"
          : item.status === "paused"
            ? "paused"
            : item.status === "done"
              ? "saved"
              : item.status === "cancelled"
                ? "cancelled"
                : "failed";

  return (
    <li className={`queue-row queue-row--${item.status}`}>
      <span className="queue-row__index mono">{String(index + 1).padStart(2, "0")}</span>

      <div className="queue-row__thumb">
        <Poster seed={item.id} src={item.thumbnail} alt={item.title} ratio="16 / 9" />
      </div>

      <div className="queue-row__body">
        <div className="queue-row__top">
          <div className="queue-row__titles">
            <h3 className="queue-row__title" title={item.title}>
              {item.title}
            </h3>
            <p className="queue-row__sub">
              <span className="eyebrow">{platformLabel(item.platform)}</span>
              {item.uploader ? (
                <>
                  <span className="dot-sep">·</span>
                  <span>{item.uploader}</span>
                </>
              ) : null}
              <span className="dot-sep">·</span>
              <span className="mono">{formatDuration(item.duration)}</span>
            </p>
          </div>
          <div className="queue-row__state">
            {isQueued ? <Tag>queued</Tag> : null}
            {active ? <Tag tone="accent">{statusLabel}</Tag> : null}
            {isPaused ? <Tag tone="warn">paused</Tag> : null}
            {isDone ? <Tag tone="good">saved</Tag> : null}
            {isFailed ? <Tag tone="bad">failed</Tag> : null}
            {isCancelled ? <Tag>cancelled</Tag> : null}
          </div>
        </div>

        {isFailed && item.error ? (
          <p className="queue-row__error">
            <IconX size={12} />
            {item.error}
          </p>
        ) : null}

        {!isDone && !isFailed && !isCancelled ? (
          <div className="queue-row__progress">
            <ProgressBar
              value={item.status === "processing" ? 100 : item.percent}
              tone={tone}
              striped={active}
              indeterminate={unknownSize}
            />
            <div className="queue-row__metrics mono">
              <span>
                {item.status === "processing"
                  ? "muxing"
                  : isPaused
                    ? "paused"
                    : unknownSize
                      ? "downloading"
                      : `${item.percent.toFixed(1)}%`}
              </span>
              <span>
                {formatBytes(item.downloaded)}
                {item.total ? ` / ${formatBytes(item.total)}` : ""}
              </span>
              <span>{formatSpeed(item.speed)}</span>
              <span>{item.eta ? `${formatEta(item.eta)} left` : "—"}</span>
            </div>
          </div>
        ) : null}

        {isDone ? (
          <div className="queue-row__done">
            <IconCheck size={13} />
            <span className="mono">
              {item.quality === "audio" ? "audio" : `${item.quality}p`} ·{" "}
              {item.format.toUpperCase()}
            </span>
          </div>
        ) : null}
      </div>

      <div className="queue-row__actions">
        {active ? (
          <button className="icon-btn icon-btn--bordered" onClick={onPause} aria-label="Pause download">
            <IconPause size={14} />
          </button>
        ) : null}
        {active ? (
          <button className="icon-btn" onClick={onCancel} aria-label="Cancel download">
            <IconX size={14} />
          </button>
        ) : null}
        {isPaused ? (
          <button className="icon-btn icon-btn--bordered" onClick={onResume} aria-label="Resume download">
            <IconPlay size={14} />
          </button>
        ) : null}
        {isFailed || isCancelled ? (
          <button className="icon-btn icon-btn--bordered" onClick={onRetry} aria-label="Retry download">
            <IconRefresh size={14} />
          </button>
        ) : null}
        {!active ? (
          <button className="icon-btn" onClick={onRemove} aria-label="Remove from queue">
            <IconX size={14} />
          </button>
        ) : null}
      </div>
    </li>
  );
}
