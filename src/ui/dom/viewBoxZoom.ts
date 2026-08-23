export interface ZoomViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ZoomPoint = readonly [number, number];

/**
 * Resize a viewBox around a map-space focal point. Clamping the size before
 * moving the origin keeps repeated wheel events stationary at either limit.
 */
export function zoomViewBoxAroundPoint(
  viewBox: ZoomViewBox,
  [mapX, mapY]: ZoomPoint,
  factor: number,
  minWidth: number,
  maxWidth: number,
): ZoomViewBox {
  const width = Math.min(maxWidth, Math.max(minWidth, viewBox.width * factor));
  if (width === viewBox.width) return { ...viewBox };

  const ratio = width / viewBox.width;
  const height = viewBox.height * ratio;
  return {
    x: mapX - (mapX - viewBox.x) * ratio,
    y: mapY - (mapY - viewBox.y) * ratio,
    width,
    height,
  };
}
