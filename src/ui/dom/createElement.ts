export interface ElementOptions<K extends keyof HTMLElementTagNameMap> {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly Node[];
  readonly on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tagName: K, options: ElementOptions<K> = {}): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;

  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) element.setAttribute(name, value);
  }

  if (options.children) element.append(...options.children);

  if (options.on) {
    for (const [eventName, handler] of Object.entries(options.on)) {
      element.addEventListener(eventName, handler as EventListener);
    }
  }

  return element;
}

export function clearNode(node: HTMLElement): void {
  node.replaceChildren();
}

/**
 * A real link (so crawlers and "open in new tab" work) that the app handles itself on a plain
 * click. Modified clicks (cmd, ctrl, shift, middle button) fall through to the browser.
 */
export function appLink(href: string, onNavigate: () => void, options: ElementOptions<"a"> = {}): HTMLAnchorElement {
  const anchor = el("a", { ...options, attrs: { ...options.attrs, href } });
  anchor.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate();
  });
  return anchor;
}
