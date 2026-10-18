"""Картинки для виджета-плеера «Пластинка».

Из art/case.jpg (прозрачный бокс) и art/disc.jpg (блюдо с рыбами — это пластинка) делает (res/drawable-nodpi):
  case_front.png      — бокс поверх пластинки: место диска вырезано, шпиндель в центре остаётся, углы прозрачные;
  disc_NN.webp        — кадры вращения пластинки (полный оборот за FRAMES кадров) с неподвижным бликом винила;
  disc_art.webp       — пластинка без блика в полном размере (в приложении её крутит Canvas);
  disc_sheen.png      — блик и бороздки для приложения;
  widget_preview.png  — превью в списке виджетов.

Запуск: python3 tools/make_disc.py (из папки glassblock).
"""
import math
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "..", "art")
OUT = os.path.join(HERE, "..", "app", "src", "main", "res", "drawable-nodpi")

FRAMES = 24          # кадров на оборот; интервал — в layout/widget_disc.xml (оборот 1,92 с ≈ 31 об/мин)
FRAME_PX = 576
SIZE = 736           # размер art/case.jpg
CASE = (3, 10, 730, 726, 24)          # контур бокса, радиус угла
DISC_C = (373.0, 362.0)               # центр диска в боксе (и шпиндель)
DISC_R = 312.0
HUB_R = 93.0                          # шпиндель бокса — остаётся поверх пластинки
PLATE_C = (368.0, 381.0)              # блюдо на art/disc.jpg
PLATE_R = 314.0


def rounded_mask(size, box, feather):
    x0, y0, x1, y1, r = box
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    cx = np.clip(xs, x0 + r, x1 - r); cy = np.clip(ys, y0 + r, y1 - r)
    return np.clip(0.5 - (np.hypot(xs - cx, ys - cy) - r) / feather, 0, 1)


def bilinear(img, sx, sy):
    h, w = img.shape[:2]
    inside = (sx >= 0) & (sy >= 0) & (sx <= w - 1.001) & (sy <= h - 1.001)
    sx = np.clip(sx, 0, w - 1.001); sy = np.clip(sy, 0, h - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * inside[..., None]


def polar(px):
    """Координаты пикселей кадра размером px относительно центра диска (в пикселях art/case.jpg)."""
    sc = SIZE / px
    ys, xs = np.mgrid[0:px, 0:px].astype(np.float32)
    dx = (xs + 0.5) * sc - DISC_C[0]; dy = (ys + 0.5) * sc - DISC_C[1]
    return dx, dy, np.hypot(dx, dy), sc


def disc_alpha(rho, sc):
    return np.clip((DISC_R - rho) / sc + 0.5, 0, 1)


def sheen(dx, dy, rho):
    """Неподвижный свет на виниле: два встречных клина блика + тонкие бороздки. Возвращает (добавка яркости, тень)."""
    th = np.arctan2(dy, dx)
    wedge = np.cos(th + math.pi / 4) ** 2
    wedge = wedge ** 10 * np.clip((rho - HUB_R) / 60, 0, 1)
    rng = np.random.default_rng(7)
    rings = np.convolve(rng.standard_normal(4000), np.ones(3) / 3, mode="same")
    groove = rings[np.clip((rho * 6).astype(int), 0, 3999)]
    light = 0.16 * wedge + 0.025 * groove
    edge = np.clip((rho - (DISC_R - 10)) / 10, 0, 1)          # лёгкое затемнение к краю
    return light, 1 - 0.35 * edge


def main():
    os.makedirs(OUT, exist_ok=True)
    case = np.asarray(Image.open(os.path.join(ART, "case.jpg")).convert("RGB")).astype(np.float32)
    plate = np.asarray(Image.open(os.path.join(ART, "disc.jpg")).convert("RGB")).astype(np.float32)

    # Бокс: всё, кроме диска, плюс шпиндель; за пределами бокса прозрачно.
    dx, dy, rho, sc = polar(SIZE)
    hole = disc_alpha(rho, sc) * np.clip((rho - HUB_R) + 0.5, 0, 1)
    a = rounded_mask(SIZE, CASE, 2) * (1 - hole)
    Image.fromarray(np.dstack([case, a * 255]).astype(np.uint8), "RGBA").save(os.path.join(OUT, "case_front.png"), optimize=True)

    # Пластинка в полном размере для приложения (центр = центр картинки) и блик к ней.
    k = PLATE_R / DISC_R
    full_px = int(2 * DISC_R)
    ys, xs = np.mgrid[0:full_px, 0:full_px].astype(np.float32) + 0.5
    ddx = xs - DISC_R; ddy = ys - DISC_R; rr = np.hypot(ddx, ddy)
    art = bilinear(plate, PLATE_C[0] + ddx * k, PLATE_C[1] + ddy * k)
    al = np.clip(DISC_R - rr + 0.5, 0, 1)
    Image.fromarray(np.dstack([art, al * 255]).clip(0, 255).astype(np.uint8), "RGBA").save(
        os.path.join(OUT, "disc_art.webp"), quality=95, method=6)
    light, shade = sheen(ddx, ddy, rr)
    # Блик для приложения: белый с альфой (добавка света) поверх тени у края.
    sh_a = np.clip(light, 0, 1) * al
    dark_a = (1 - shade) * al
    sh_rgb = 255 * sh_a / np.maximum(sh_a + dark_a, 1e-4)
    Image.fromarray(np.dstack([sh_rgb, sh_rgb, sh_rgb, np.clip(sh_a + dark_a, 0, 1) * 255]).astype(np.uint8), "RGBA").save(
        os.path.join(OUT, "disc_sheen.png"), optimize=True)

    # Кадры вращения для виджета (по часовой стрелке).
    dx, dy, rho, sc = polar(FRAME_PX)
    light, shade = sheen(dx, dy, rho)
    alpha = disc_alpha(rho, sc)
    for i in range(FRAMES):
        ang = -2 * math.pi * i / FRAMES
        ca, sa = math.cos(ang), math.sin(ang)
        rx = dx * ca - dy * sa; ry = dx * sa + dy * ca
        img = bilinear(plate, PLATE_C[0] + rx * k, PLATE_C[1] + ry * k)
        img = img * shade[..., None] + 255 * light[..., None]
        lay = Image.fromarray(np.dstack([img, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA")
        lay.save(os.path.join(OUT, f"disc_{i:02d}.webp"), quality=93, method=6)
        if i == 0:
            first = lay

    case_im = Image.open(os.path.join(OUT, "case_front.png"))
    prev = Image.alpha_composite(first.resize((SIZE, SIZE), Image.LANCZOS), case_im)
    prev.resize((360, 360), Image.LANCZOS).save(os.path.join(OUT, "widget_preview.png"), optimize=True)
    print("ok:", FRAMES, "кадров")


if __name__ == "__main__":
    main()
