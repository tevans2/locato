import { el } from "../dom/createElement";
import type { WikipediaSummary } from "../../core/maptap/wikipedia";

export interface MapTapInfoOverlay {
  readonly element: HTMLElement;
  readonly show: (name: string, summary: WikipediaSummary | null) => void;
  readonly hide: () => void;
}

export function createMapTapInfoOverlay(): MapTapInfoOverlay {
  const photo = el("img", { className: "maptap-info-photo", attrs: { alt: "", loading: "lazy" } }) as HTMLImageElement;
  const photoWrap = el("div", { className: "maptap-info-photo-wrap", children: [photo] });
  const nameEl = el("h2", { className: "maptap-info-name" });
  const extractEl = el("p", { className: "maptap-info-extract" });
  const closeBtn = el("button", { className: "maptap-info-close", attrs: { type: "button", "aria-label": "Close" }, text: "×" });
  const card = el("div", {
    className: "maptap-info-card",
    children: [photoWrap, el("div", { className: "maptap-info-body", children: [nameEl, extractEl] }), closeBtn],
  });
  const overlay = el("div", { className: "maptap-info-overlay", attrs: { hidden: "true" }, children: [card] });

  closeBtn.addEventListener("click", () => {
    overlay.hidden = true;
  });

  return {
    element: overlay,
    show(name, summary) {
      nameEl.textContent = name;

      if (summary?.thumbnail?.source) {
        photo.src = summary.thumbnail.source;
        photoWrap.hidden = false;
      } else {
        photo.src = "";
        photoWrap.hidden = true;
      }

      if (summary?.extract) {
        // Trim to roughly 3 sentences for readability
        const sentences = summary.extract.match(/[^.!?]+[.!?]+/g) ?? [];
        extractEl.textContent = sentences.slice(0, 3).join(" ").trim() || summary.extract;
      } else {
        extractEl.textContent = "No description available.";
      }

      overlay.hidden = false;
    },
    hide() {
      overlay.hidden = true;
    },
  };
}
