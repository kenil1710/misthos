"use client";

import { TOC } from "fumadocs-ui/layouts/docs/page/slots/toc";
import type { ComponentProps } from "react";

/**
 * Fumadocs' table of contents inside a landmark, so every part of a docs page belongs to one (axe "region").
 * `display: contents` keeps it a direct item of the docs layout grid.
 */
export function DocsToc(props: ComponentProps<typeof TOC>) {
  return (
    <aside aria-label="On this page" className="contents">
      <TOC {...props} />
    </aside>
  );
}
