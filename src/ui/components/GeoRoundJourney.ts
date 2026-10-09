import { el } from "../dom/createElement";

/** A lightweight, location-neutral travel animation: no map requests or hidden-location hints. */
export function createGeoRoundJourney(rounds: number) {
  const globe = el("div", { className: "geo-journey-globe", children: [
    ...Array.from({ length: 5 }, (_, i) => el("span", { className: "geo-journey-meridian", attrs: { style: `--angle:${i * 36}deg` } })),
    el("span", { className: "geo-journey-latitude" }),
    el("span", { className: "geo-journey-latitude geo-journey-latitude-south" }),
    el("span", { className: "geo-journey-equator" }),
  ] });
  const pin = el("div", { className: "geo-journey-pin", children: [el("span")] });
  const countdown = el("div", { className: "geo-journey-countdown" });
  const illustration = el("div", { className: "geo-journey-art", attrs: { "aria-hidden": "true" }, children: [
    el("div", { className: "geo-journey-halo" }),
    el("div", { className: "geo-journey-orbit", children: [el("span")] }),
    el("div", { className: "geo-journey-orbit geo-journey-orbit-outer", children: [el("span")] }),
    globe, pin, countdown,
    el("span", { className: "geo-journey-star geo-journey-star-one", text: "+" }),
    el("span", { className: "geo-journey-star geo-journey-star-two", text: "+" }),
  ] });
  const label = el("span", { className: "geo-journey-label" });
  const route = el("ol", { className: "geo-journey-route", attrs: { "aria-hidden": "true" }, children: Array.from({ length: rounds }, (_, i) => el("li", { text: String(i + 1) })) });
  const element = el("div", { className: "geo-journey", children: [illustration, label, route] });
  function setRound(index: number): void {
    label.textContent = `Round ${String(index + 1).padStart(2, "0")} / ${String(rounds).padStart(2, "0")}`;
    [...route.children].forEach((step, i) => {
      step.classList.toggle("is-complete", i < index);
      step.classList.toggle("is-next", i === index);
      step.textContent = i < index ? "✓" : String(i + 1);
    });
  }
  setRound(0);
  function setCountdown(remaining: number | null): void {
    element.classList.toggle("is-counting", remaining !== null);
    countdown.replaceChildren();
    if (remaining !== null) {
      countdown.append(el("span", { className: "geo-countdown-ring" }), el("strong", { text: remaining === 0 ? "GO" : String(remaining) }));
      label.textContent = remaining === 0 ? "Let’s explore" : `Starting in ${remaining}`;
    }
  }
  return { element, setRound, setCountdown };
}
