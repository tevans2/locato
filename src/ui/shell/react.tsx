import { useEffect, useRef } from "react";
import { createSiteHeader, type SiteHeaderOptions } from "./SiteHeader";
import type { ShellContext } from "./types";

/**
 * React islands (landing, Atlas) render the vanilla shell through these wrappers: the element
 * is built in an effect, appended into a ref'd container and torn down on unmount/prop change.
 */

export interface SiteHeaderMountProps extends SiteHeaderOptions {
  readonly ctx: ShellContext;
  /** Receives the heading band (title/back) if one was requested, to render it elsewhere. */
  readonly onHeading?: (heading: HTMLElement | null) => void;
}

export function SiteHeaderMount({ ctx, section, title, subtitle, back, onHeading }: SiteHeaderMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const header = createSiteHeader(ctx, { section, ...(title ? { title } : {}), ...(subtitle ? { subtitle } : {}), ...(back ? { back } : {}) });
    host.replaceChildren(header.element);
    onHeading?.(header.heading);
    return () => {
      header.destroy();
      header.element.remove();
    };
    // `back`/`onHeading` are callbacks; rebuild only when what is shown changes.
  }, [ctx, section, title, subtitle, back?.label]);
  return <div className="shell-mount" ref={ref} />;
}

/** Mount any shell-built element (GameBar, FocusBar, results card) inside React. */
export function ShellElementMount({ create, className }: { readonly create: () => { readonly element: HTMLElement; readonly destroy?: () => void }; readonly className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const built = create();
    host.replaceChildren(built.element);
    return () => {
      built.destroy?.();
      built.element.remove();
    };
  }, [create]);
  return <div className={className ?? "shell-mount"} ref={ref} />;
}
