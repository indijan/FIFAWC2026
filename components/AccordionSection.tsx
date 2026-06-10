"use client";

import { useState } from "react";

export function AccordionSection({
  title,
  subtitle,
  defaultOpen = false,
  forcedOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  forcedOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || forcedOpen);
  const expanded = forcedOpen || open;
  const contentId = `accordion-content-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <section className="panel-surface rounded-[2rem] p-4 md:p-5">
      <button
        type="button"
        onClick={() => {
          if (!forcedOpen) {
            setOpen((current) => !current);
          }
        }}
        className="flex w-full items-center justify-between gap-4 text-left"
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <div>
          <h2 className="font-display text-3xl text-ink">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-mist">{subtitle}</p> : null}
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-mist">
          {forcedOpen ? "Pinned open" : expanded ? "Collapse" : "Expand"}
        </span>
      </button>
      <div
        id={contentId}
        className={`${expanded ? "mt-5 block" : "hidden"}`}
        aria-hidden={!expanded}
      >
        {children}
      </div>
    </section>
  );
}

