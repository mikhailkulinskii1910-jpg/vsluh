"""Кадры для виджета «Стеклоблок».

Растения отделяются от воды по цвету (красные стебли, жёлтые и красные листья на зелёной воде),
вода под ними дорисовывается размытием соседних пикселей — и качаются только растения.

Из art/glassblock.jpg делает (res/drawable-nodpi):
  glass_frame.png    — стеклянная рамка (окно прозрачное, вокруг блока — мягкая тень);
  water_NN.webp      — кадры виджета: неподвижная вода + качающиеся растения;
  water_bg.webp      — вода без растений и plants.webp — слой растений (для живой анимации в приложении);
  widget_preview.png — превью в списке виджетов.
Кадры зациклены: все движения укладываются в целое число периодов за круг.

Запуск: python3 tools/make_frames.py (из папки glassblock).
"""
import math
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "art", "glassblock.jpg")
OUT = os.path.join(HERE, "..", "app", "src", "main", "res", "drawable-nodpi")

FRAMES = 20          # кадров за круг; интервал — в layout/widget_glassblock.xml (круг 2,88 с, как LOOP_MS)
FRAME_PX = 576       # размер кадра
CROP = (8, 8, 728, 728)              # квадрат вокруг блока с запасом под тень
BLOCK = (26, 25, 709, 703, 38)       # внешний контур стекла, радиус угла
WINDOW = (104, 92, 642, 630, 45)     # «окно» с водой внутри толстого стекла

# Те же параметры — в WaterView.kt
SWAY = 8.0      # качание растений, px исходника
SWAY2 = 2.5
BOB = 2.5


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rounded_mask(size, box, feather, inset=0.0):
    w, h = size
    x0, y0, x1, y1, r = box
    x0 += inset; y0 += inset; x1 -= inset; y1 -= inset; r = max(r - inset, 1)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    cx = np.clip(xs, x0 + r, x1 - r); cy = np.clip(ys, y0 + r, y1 - r)
    d = np.hypot(xs - cx, ys - cy) - r          # <0 внутри
    return np.clip(0.5 - d / max(feather, 1e-3), 0, 1)


def blur(a, r):
    """Гауссоподобное размытие: три прохода скользящего среднего радиуса r."""
    a = a.astype(np.float32)
    for axis in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * a.ndim; pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis)
            n = a.shape[axis]
            a = (np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, range(0, n), axis=axis)) / (2 * r + 1)
    return a


def plant_matte(img):
    r, g, b = img[..., 0] / 255, img[..., 1] / 255, img[..., 2] / 255
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / (mx + 1e-4)
    m = smoothstep(0.05, 0.15, r - 0.8 * g - 0.2 * b) * smoothstep(0.15, 0.3, mx) * smoothstep(0.35, 0.55, sat)
    return m * rounded_mask((img.shape[1], img.shape[0]), WINDOW, 6, inset=2)


def inpaint(img, matte):
    """Вода под растениями: нормированное размытие известных пикселей, крупный радиус — для больших листьев."""
    grown = np.asarray(Image.fromarray((matte * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) / 255.0
    known = 1 - smoothstep(0.03, 0.35, grown)
    k = known[..., None]
    f1 = blur(img * k, 6) / (blur(k, 6) + 1e-4)
    f2 = blur(img * k, 22) / (blur(k, 22) + 1e-4)
    w1 = np.clip(blur(k, 6) * 5, 0, 1)
    fill = f1 * w1 + f2 * (1 - w1)
    return img * k + fill * (1 - k)


def displacement(xs, ys, t):
    """Смещение растений (dx, dy) в пикселях исходника для момента t ∈ [0, 1)."""
    x0, y0, x1, y1, _ = WINDOW
    u = (xs - x0) / (x1 - x0)
    v = np.clip((ys - y0) / (y1 - y0), 0, 1)
    s = (1 - v) ** 1.6                          # стебли закреплены у дна, верх качается сильнее
    a = 2 * math.pi * (t + 0.6 * u - 0.25 * (1 - v))   # волна бежит по стеблю вверх
    dx = SWAY * s * np.sin(a) + SWAY2 * s * np.sin(2 * math.pi * (2 * t + 1.3 * u + 0.5 * v + 0.3))
    dy = BOB * s * np.sin(a + 1.2)
    return dx, dy


def bilinear(img, sx, sy):
    h, w = img.shape[:2]
    sx = np.clip(sx, 0, w - 1.001); sy = np.clip(sy, 0, h - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def save_rgba(rgb, a, name, **kw):
    im = Image.fromarray(np.dstack([rgb, a * 255]).clip(0, 255).astype(np.uint8), "RGBA")
    im.save(os.path.join(OUT, name), **kw)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
    full = np.asarray(src).astype(np.float32)
    H, W = full.shape[:2]
    cx0, cy0, cx1, cy1 = CROP
    cw, ch = cx1 - cx0, cy1 - cy0
    shift = lambda b: (b[0] - cx0, b[1] - cy0, b[2] - cx0, b[3] - cy0, b[4])

    # Рамка: стекло вне окна непрозрачно, окно прозрачно (с растушёвкой), вокруг блока — тень.
    rgb = full[cy0:cy1, cx0:cx1]
    block = rounded_mask((cw, ch), shift(BLOCK), 1.5)
    window = rounded_mask((cw, ch), shift(WINDOW), 10, inset=4)
    b = shift(BLOCK)
    shadow = blur(rounded_mask((cw, ch), (b[0] + 2, b[1] + 6, b[2] - 2, b[3] + 4, b[4]), 1) * 0.6, 3)
    glass_a = block * (1 - window)
    out_a = glass_a + shadow * (1 - glass_a) * (1 - block)
    frame = save_rgba(np.where(glass_a[..., None] > 0, rgb, 0), out_a, "glass_frame.png", optimize=True)

    # Слои: вода без растений и сами растения.
    matte = plant_matte(full)
    bg = inpaint(full, matte)
    win_a = rounded_mask((W, H), WINDOW, 2, inset=-3)
    save_rgba(bg[cy0:cy1, cx0:cx1], win_a[cy0:cy1, cx0:cx1], "water_bg.webp", quality=95, method=6)
    save_rgba(full[cy0:cy1, cx0:cx1], matte[cy0:cy1, cx0:cx1], "plants.webp", quality=95, method=6)

    # Кадры виджета: вода + сдвинутые растения, сразу в размере FRAME_PX.
    sc = cw / FRAME_PX
    ys, xs = np.mgrid[0:FRAME_PX, 0:FRAME_PX].astype(np.float32)
    xs = (xs + 0.5) * sc + cx0; ys = (ys + 0.5) * sc + cy0
    weight = rounded_mask((W, H), WINDOW, 24, inset=-6)
    wgt = bilinear(weight[..., None], xs, ys)[..., 0]
    alpha = bilinear(win_a[..., None], xs, ys)[..., 0]
    bg_s = bilinear(bg, xs, ys)
    plants = np.dstack([full * matte[..., None], matte])        # премультиплицированный слой
    for i in range(FRAMES):
        dx, dy = displacement(xs, ys, i / FRAMES)
        p = bilinear(plants, xs - dx * wgt, ys - dy * wgt)
        img = bg_s * (1 - p[..., 3:]) + p[..., :3]
        lay = save_rgba(img, alpha, f"water_{i:02d}.webp", quality=93, method=6)
        if i == 0:
            first = lay

    prev = Image.alpha_composite(first.resize((cw, ch), Image.LANCZOS), frame)
    prev.resize((360, 360), Image.LANCZOS).save(os.path.join(OUT, "widget_preview.png"), optimize=True)
    print("ok:", FRAMES, "кадров")


if __name__ == "__main__":
    main()
