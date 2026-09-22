import { describe, expect, it } from "vitest";
import { zoomViewBoxAroundPoint } from "../src/ui/dom/viewBoxZoom";

describe("zoomViewBoxAroundPoint", () => {
  it("does not move a map that is already at maximum zoom", () => {
    const viewBox = { x: 120, y: 80, width: 30, height: 15 };

    expect(zoomViewBoxAroundPoint(viewBox, [148, 94], 0.7, 30, 600)).toEqual(viewBox);
  });

  it("does not move a map that is already fully zoomed out", () => {
    const viewBox = { x: 0, y: 0, width: 600, height: 300 };

    expect(zoomViewBoxAroundPoint(viewBox, [550, 275], 1.3, 30, 600)).toEqual(viewBox);
  });

  it("keeps the selected map point under the same relative position", () => {
    const viewBox = { x: 100, y: 50, width: 400, height: 200 };
    const focalPoint = [420, 170] as const;
    const zoomed = zoomViewBoxAroundPoint(viewBox, focalPoint, 0.5, 25, 600);

    expect((focalPoint[0] - zoomed.x) / zoomed.width).toBeCloseTo((focalPoint[0] - viewBox.x) / viewBox.width);
    expect((focalPoint[1] - zoomed.y) / zoomed.height).toBeCloseTo((focalPoint[1] - viewBox.y) / viewBox.height);
  });
});
