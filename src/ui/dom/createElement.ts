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
