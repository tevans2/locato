import { el } from "./createElement";

export function createBrandLockup(onHome?: () => void): HTMLElement {
  const children = [
    el("img", { className: "brand-logo", attrs: { src: "/logo.svg", alt: "" } }),
    el("span", { className: "brand-name", text: "locato" }),
  ];

  if (!onHome) {
    return el("div", { className: "brand-lockup compact", children });
  }

  return el("button", {
    className: "brand-lockup compact brand-home-button",
    attrs: { type: "button", "aria-label": "Go to home page" },
    children,
    on: { click: () => onHome() },
  });
}
