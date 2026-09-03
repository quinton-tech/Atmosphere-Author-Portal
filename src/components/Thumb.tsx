"use client";

import { useState } from "react";

/** Thumbnail image that falls back to a quiet label when the proxy has no preview (404). */
export function Thumb({ src, fallback }: { src: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="eyebrow flex h-32 w-full items-center justify-center bg-surface text-muted">{fallback}</div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-32 w-full bg-surface object-cover" onError={() => setFailed(true)} />;
}
