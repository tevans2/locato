import type { GeoStreetView } from "./GeoStreetView";
import type { RankedSession } from "../screens/RankedSession";
import { el } from "../dom/createElement";

/** Private image surface inside the original panorama layout; never exposes Google's origin. */
export function createPrivateStreetView(session: RankedSession, signal: AbortSignal, frameIndex: () => number = () => 0): GeoStreetView {
  const image = el("img", { className: "private-street-image", attrs: { alt: "Explore the mystery Street View" } }) as HTMLImageElement;
  const element = el("div", { className: "geo-panorama private-street-view", children: [image] });
  let turn = 0;
  let asset: string | null = null;
  const show = () => {
    if (asset) image.src = `${asset}&turn=${turn}`;
  };
  const controls = el("div", { className: "private-street-controls" });
  for (const [label, delta] of [["Look left", -90], ["Look right", 90]] as const) {
    const button = el("button", { className: "geo-button", text: delta < 0 ? "←" : "→", attrs: { type: "button", "aria-label": label, title: label } });
    button.addEventListener("click", () => { turn = (turn + delta + 360) % 360; show(); }, { signal });
    controls.append(button);
  }
  element.append(controls);
  image.addEventListener("error", () => element.setAttribute("aria-label", "Street View could not load. Try loading the location again."), { signal });
  return { element, show: async () => {
    const frame = session.state.question?.frames?.[frameIndex()];
    if (!frame) throw new Error("Street View unavailable.");
    asset = frame.asset; turn = 0; show(); return { lat: 0, lng: 0 };
  }, reset: () => { turn = 0; show(); }, destroy: () => element.replaceChildren() };
}
