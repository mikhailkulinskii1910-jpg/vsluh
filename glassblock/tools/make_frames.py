"""Кадры для виджета «Стеклоблок».

Из art/glassblock.jpg делает:
  res/drawable-nodpi/glass_frame.png  — стеклянная рамка (центр прозрачный, вокруг блока — мягкая тень);
  res/drawable-nodpi/water_NN.webp    — кадры воды внутри блока (растения качаются, рябь, блики, пузырьки);
  res/drawable-nodpi/water_scene.webp — неподвижная сцена в полном размере для приложения (там анимация живая);
  res/drawable-nodpi/widget_preview.png — превью в списке виджетов.
Кадры зациклены: все движения укладываются в целое число периодов за круг.

Запуск: python3 tools/make_frames.py (из папки glassblock).
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "art", "glassblock.jpg")
OUT = os.path.join(HERE, "..", "app", "src", "main", "res", "drawable-nodpi")

FRAMES = 20          # кадров за круг (интервал смены — в layout/widget_glassblock.xml)
FRAME_PX = 400       # размер кадра воды
CROP = (8, 8, 728, 728)              # квадрат вокруг блока с запасом под тень
BLOCK = (26, 25, 709, 703, 38)       # внешний контур стекла, радиус угла
WINDOW = (104, 92, 642, 630, 45)     # «окно» с водой внутри толстого стекла

# Те же параметры — в WaterView.kt
SWAY = 9.0      # качание растений, px исходника
SWAY2 = 3.0
BOB = 2.5
RIPPLE = 1.3


def rounded_mask(size, box, feather, inset=0.0):
    w, h = size
    x0, y0, x1, y1, r = box
    x0 += inset; y0 += inset; x1 -= inset; y1 -= inset; r = max(r - inset, 1)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    cx = np.clip(xs, x0 + r, x1 - r); cy = np.clip(ys, y0 + r, y1 - r)
    d = np.hypot(xs - cx, ys - cy) - r          # <0 внутри
    return np.clip(0.5 - d / max(feather, 1e-3), 0, 1)


def displacement(xs, ys, t):
    """Смещение (dx, dy) в пикселях исходника для момента t ∈ [0, 1)."""
    x0, y0, x1, y1, _ = WINDOW
    u = (xs - x0) / (x1 - x0)
    v = np.clip((ys - y0) / (y1 - y0), 0, 1)
    s = (1 - v) ** 1.6                          # стебли закреплены у дна, верх качается сильнее
    a = 2 * math.pi * (t + 0.8 * u)
    dx = SWAY * s * np.sin(a) + SWAY2 * s * np.sin(2 * math.pi * (2 * t + 1.7 * u + 0.3))
    dy = BOB * s * np.sin(a + 1.2)
    dx += RIPPLE * np.sin(2 * math.pi * (6 * v - t))
    dy += RIPPLE * np.sin(2 * math.pi * (5 * u + t))
    return dx, dy


def bilinear(img, sx, sy):
    h, w = img.shape[:2]
    sx = np.clip(sx, 0, w - 1.001); sy = np.clip(sy, 0, h - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


BUBBLES = [  # x (в долях окна), фаза, радиус px, качание
    (0.18, 0.05, 4.0, 5), (0.33, 0.55, 2.6, 3), (0.52, 0.30, 3.4, 4),
    (0.71, 0.80, 2.2, 3), (0.84, 0.15, 3.8, 6), (0.62, 0.65, 1.8, 2),
]


def bubble_layer(size, t):
    """RGBA-слой пузырьков (рисуется в 4× и уменьшается)."""
    k = 4
    w, h = size
    lay = Image.new("RGBA", (w * k, h * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    x0, y0, x1, y1, _ = WINDOW
    for bx, ph, r, wob in BUBBLES:
        p = (t + ph) % 1.0
        y = y1 - 20 - p * (y1 - y0 - 30)
        x = x0 + bx * (x1 - x0) + wob * math.sin(2 * math.pi * (3 * p + bx))
        fade = min(1.0, p / 0.12, (1 - p) / 0.15)
        x -= CROP[0]; y -= CROP[1]
        al = int(170 * fade)
        d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k],
                  outline=(225, 245, 235, al), width=max(1, int(0.9 * k)), fill=(200, 230, 220, al // 5))
        hr = r * 0.35
        d.ellipse([(x - r * 0.4 - hr) * k, (y - r * 0.4 - hr) * k, (x - r * 0.4 + hr) * k, (y - r * 0.4 + hr) * k],
                  fill=(255, 255, 255, int(220 * fade)))
    return lay.resize(size, Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGB")
    full = np.asarray(src).astype(np.float32)
    cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
    crop = src.crop(CROP)
    shift = lambda b: (b[0] - CROP[0], b[1] - CROP[1], b[2] - CROP[0], b[3] - CROP[1], b[4])

    # Рамка: стекло вне окна непрозрачно, окно прозрачно (с растушёвкой), вокруг блока — тень.
    block = rounded_mask((cw, ch), shift(BLOCK), 1.5)
    window = rounded_mask((cw, ch), shift(WINDOW), 10, inset=4)
    shadow_box = shift(BLOCK)
    shadow = Image.fromarray((rounded_mask((cw, ch), (shadow_box[0] + 2, shadow_box[1] + 6, shadow_box[2] - 2,
                                                       shadow_box[3] + 4, shadow_box[4]), 1) * 150).astype(np.uint8))
    shadow = np.asarray(shadow.filter(ImageFilter.GaussianBlur(5))).astype(np.float32) / 255
    glass_a = block * (1 - window)
    rgb = np.asarray(crop).astype(np.float32)
    out_a = glass_a + shadow * (1 - glass_a) * (1 - block)
    out_rgb = np.where(glass_a[..., None] > 0, rgb, 0)
    frame = np.dstack([out_rgb, out_a * 255]).clip(0, 255).astype(np.uint8)
    Image.fromarray(frame, "RGBA").save(os.path.join(OUT, "glass_frame.png"), optimize=True)

    # Сцена для приложения: исходник внутри блока, снаружи прозрачно.
    scene = np.dstack([rgb, block * 255]).astype(np.uint8)
    Image.fromarray(scene, "RGBA").save(os.path.join(OUT, "water_scene.webp"), quality=92, method=6)

    # Кадры воды: только окно (+ запас под растушёвкой), размер FRAME_PX.
    sc = cw / FRAME_PX
    ys, xs = np.mgrid[0:FRAME_PX, 0:FRAME_PX].astype(np.float32)
    xs = (xs + 0.5) * sc + CROP[0]; ys = (ys + 0.5) * sc + CROP[1]
    weight = rounded_mask((full.shape[1], full.shape[0]), WINDOW, 24, inset=-6)
    wgt = bilinear(weight[..., None], xs, ys)[..., 0]
    alpha = (bilinear(rounded_mask((full.shape[1], full.shape[0]), WINDOW, 2, inset=-3)[..., None], xs, ys)[..., 0])
    x0, y0, x1, y1, _ = WINDOW
    u = (xs - x0) / (x1 - x0); v = np.clip((ys - y0) / (y1 - y0), 0, 1)
    blur = np.asarray(src.filter(ImageFilter.GaussianBlur(sc * 0.5))).astype(np.float32)
    for i in range(FRAMES):
        t = i / FRAMES
        dx, dy = displacement(xs, ys, t)
        img = bilinear(blur, xs - dx * wgt, ys - dy * wgt)
        # Блики на воде: два бегущих синуса, ярче у поверхности.
        c = np.clip(np.sin(2 * math.pi * (4 * u + 2 * v - t)) + np.sin(2 * math.pi * (-3 * u + 5 * v + t)), 0, 2) / 2
        light = 0.20 * (1 - v) ** 1.3 * c ** 2 * wgt
        img = img + light[..., None] * np.array([255, 240, 190], np.float32)
        lay = Image.fromarray(np.dstack([img, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA")
        bub = bubble_layer((cw, ch), t).resize((FRAME_PX, FRAME_PX), Image.LANCZOS)
        lay = Image.alpha_composite(lay, bub)
        lay.save(os.path.join(OUT, f"water_{i:02d}.webp"), quality=86, method=6)
        if i == 0:
            first = lay

    prev = Image.alpha_composite(first.resize((cw, ch), Image.LANCZOS), Image.fromarray(frame, "RGBA"))
    prev.resize((360, 360), Image.LANCZOS).save(os.path.join(OUT, "widget_preview.png"), optimize=True)
    print("ok:", FRAMES, "кадров")


if __name__ == "__main__":
    main()
