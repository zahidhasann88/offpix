export interface View {
  scale: number;
  cx: number;
  cy: number;
}
export interface Size {
  w: number;
  h: number;
}

function fitScale(img: Size, vp: Size): number {
  return Math.min(vp.w / img.w, vp.h / img.h);
}

export function scaleLimits(img: Size, vp: Size): { min: number; max: number } {
  const fit = fitScale(img, vp);
  return { min: Math.min(fit, 1), max: Math.max(8, fit) };
}

export function fitView(img: Size, vp: Size): View {
  return { scale: fitScale(img, vp), cx: img.w / 2, cy: img.h / 2 };
}

export function clampView(v: View, img: Size, vp: Size): View {
  const { min, max } = scaleLimits(img, vp);
  const scale = Math.min(max, Math.max(min, v.scale));
  const axis = (c: number, imgLen: number, vpLen: number) => {
    const half = vpLen / (2 * scale);
    return imgLen <= 2 * half
      ? imgLen / 2
      : Math.min(imgLen - half, Math.max(half, c));
  };
  return { scale, cx: axis(v.cx, img.w, vp.w), cy: axis(v.cy, img.h, vp.h) };
}

export function zoomAt(
  v: View,
  factor: number,
  px: number,
  py: number,
  img: Size,
  vp: Size,
): View {
  const ix = v.cx + (px - vp.w / 2) / v.scale;
  const iy = v.cy + (py - vp.h / 2) / v.scale;
  const next = clampView({ ...v, scale: v.scale * factor }, img, vp);
  return clampView(
    {
      scale: next.scale,
      cx: ix - (px - vp.w / 2) / next.scale,
      cy: iy - (py - vp.h / 2) / next.scale,
    },
    img,
    vp,
  );
}

export function panBy(
  v: View,
  dx: number,
  dy: number,
  img: Size,
  vp: Size,
): View {
  return clampView(
    { ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale },
    img,
    vp,
  );
}

export function visibleRegion(v: View, img: Size, vp: Size) {
  const sx0 = Math.max(0, v.cx - vp.w / (2 * v.scale));
  const sy0 = Math.max(0, v.cy - vp.h / (2 * v.scale));
  const sx1 = Math.min(img.w, v.cx + vp.w / (2 * v.scale));
  const sy1 = Math.min(img.h, v.cy + vp.h / (2 * v.scale));
  const toVp = (ix: number, iy: number) => [
    (ix - v.cx) * v.scale + vp.w / 2,
    (iy - v.cy) * v.scale + vp.h / 2,
  ];
  const [dx, dy] = toVp(sx0, sy0);
  return {
    sx: sx0,
    sy: sy0,
    sw: sx1 - sx0,
    sh: sy1 - sy0,
    dx,
    dy,
    dw: (sx1 - sx0) * v.scale,
    dh: (sy1 - sy0) * v.scale,
  };
}
