"use client";

import { useState } from "react";

/** Long teasers start truncated; "Read more" swaps in the full text in place (no duplicate copy). */
export function TeaserToggle({ text, limit = 380 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  const needsToggle = text.length > limit + 100;
  const shown = open || !needsToggle ? text : text.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return (
    <p className="mt-4 border-l-2 border-teal pl-4 text-lg text-ink-2">
      {shown}
      {needsToggle && (
        <>
          {" "}
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-base font-medium text-teal-ink underline-offset-2 hover:underline">
            {open ? "Show less" : "Read more"}
          </button>
        </>
      )}
    </p>
  );
}
