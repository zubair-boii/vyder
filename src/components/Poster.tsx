import { useEffect, useState } from "react";
import { posterFor } from "../lib/format";

interface PosterProps {
  seed: string;
  src?: string | null;
  alt: string;
  ratio?: string;
  badge?: string;
  className?: string;
  palette?: number;
}

export function Poster({
  seed,
  src,
  alt,
  ratio = "16 / 9",
  badge,
  className = "",
  palette = 0,
}: PosterProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const generated = posterFor(seed, palette);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={`poster ${className}`.trim()} style={{ aspectRatio: ratio }}>
      {showImage ? (
        <img
          className="poster__img"
          src={src ?? undefined}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <img className="poster__img poster__img--generated" src={generated} alt="" aria-hidden="true" />
      )}
      {badge ? <span className="poster__badge">{badge}</span> : null}
    </div>
  );
}
