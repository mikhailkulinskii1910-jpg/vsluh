"""Картинки для виджета-плеера «Пластинка».

Из art/case.jpg (бокс — берутся его форма и блики пластика) и art/vinyl.jpg (пластинка) делает (res/drawable-nodpi).
Все слои — квадрат CANVAS×CANVAS, центр диска ровно в центре: виджет крутит пластинку вокруг центра картинки.
  case_front.webp     — бокс поверх пластинки: красный мутный пластик с градиентом (янтарный слева сверху →
                        красный → тёмный дымчатый справа снизу), светящиеся рёбра, блики с фото; над пластинкой —
                        лёгкая красная крышка; вокруг бокса прозрачно;
  disc_art.webp       — пластинка с маленьким отверстием в центре; её вращает drawable/disc_spin.xml;
  disc_sheen.webp     — неподвижный блик винила поверх вращающейся пластинки;
  widget_preview.png  — превью в списке виджетов.
Ещё пишет preview.gif — как крутится пластинка (для README).

Запуск: python3 tools/make_disc.py (из папки glassblock).
"""
import math
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "..", "art")
OUT = os.path.join(HERE, "..", "app", "src", "main", "res", "drawable-nodpi")

CANVAS = 740                          # размер слоёв; центр диска — CANVAS/2
CASE = (3, 10, 730, 726, 24)          # контур бокса на art/case.jpg, радиус угла
DISC_C = (373.0, 362.0)               # центр места под диск на art/case.jpg
DISC_R = 312.0
VINYL_C = (367.3, 367.4)              # пластинка на art/vinyl.jpg (центр и край подобраны по окружности)
VINYL_R = 317.9
HOLE_R = 6.5                          # отверстие пластинки, px холста
LABEL_R = 104.0                       # наклейка — на ней нет бороздок и блика

# Красный пластик (как у MiniDisc), градиент — как у стекла на референсе: янтарь → красный → тёмный.
TINT = [(0.0, (244, 112, 46)), (0.38, (206, 26, 28)), (0.72, (128, 10, 16)), (1.0, (42, 5, 8))]
BODY_ALPHA = 0.80                     # мутность пластика
RIM_ALPHA = 0.95                      # у рёбер пластик толще
LID_ALPHA = 0.16                      # крышка над пластинкой


def bilinear(img, sx, sy):
    h, w = img.shape[:2]
    inside = (sx >= 0) & (sy >= 0) & (sx <= w - 1.001) & (sy <= h - 1.001)
    sx = np.clip(sx, 0, w - 1.001); sy = np.clip(sy, 0, h - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * inside[..., None]


def gradient(t):
    """Цвет пластика по диагонали t ∈ [0, 1]."""
    out = np.zeros(t.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(TINT, TINT[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)[..., None]
        sel = ((t >= t0) & (t <= t1))[..., None]
        out = np.where(sel, np.array(c0) * (1 - k) + np.array(c1) * k, out)
    return out


def sheen(dx, dy, rho):
    """Неподвижный свет на виниле: два встречных клина блика + тонкие бороздки. Возвращает (добавка яркости, тень)."""
    th = np.arctan2(dy, dx)
    groove_zone = np.clip((rho - LABEL_R - 4) / 20, 0, 1)
    wedge = (np.cos(th + math.pi / 4) ** 2) ** 10 * groove_zone
    rng = np.random.default_rng(7)
    rings = np.convolve(rng.standard_normal(4000), np.ones(3) / 3, mode="same")
    groove = rings[np.clip((rho * 6).astype(int), 0, 3999)] * groove_zone
    light = 0.12 * wedge + 0.02 * groove
    edge = np.clip((rho - (DISC_R - 10)) / 10, 0, 1)          # лёгкое затемнение к краю
    return light, 1 - 0.35 * edge


def save(arr, name):
    Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, name), lossless=True, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    case_src = Image.open(os.path.join(ART, "case.jpg")).convert("RGB").filter(ImageFilter.GaussianBlur(0.8))  # мутнее
    case = np.asarray(case_src).astype(np.float32)
    vinyl = np.asarray(Image.open(os.path.join(ART, "vinyl.jpg")).convert("RGB")).astype(np.float32)

    c = CANVAS / 2
    ys, xs = np.mgrid[0:CANVAS, 0:CANVAS].astype(np.float32) + 0.5
    dx = xs - c; dy = ys - c; rho = np.hypot(dx, dy)
    disc = np.clip(DISC_R - rho + 0.5, 0, 1)

    # Бокс: форма и блики с фото, цвет — красный градиент.
    cx = xs - 0.5 + DISC_C[0] - c; cy = ys - 0.5 + DISC_C[1] - c   # пиксель холста → пиксель art/case.jpg
    photo = bilinear(case, cx, cy)
    x0, y0, x1, y1, r = CASE
    qx = np.clip(cx + 0.5, x0 + r, x1 - r); qy = np.clip(cy + 0.5, y0 + r, y1 - r)
    border = np.hypot(cx + 0.5 - qx, cy + 0.5 - qy) - r            # <0 внутри бокса
    in_case = np.clip(0.5 - border / 2, 0, 1)
    depth = np.clip(-border, 0, None)                              # расстояние до края бокса
    t = np.clip(((xs / CANVAS) * 0.55 + (ys / CANVAS) * 0.45 - 0.1) / 0.85, 0, 1)
    tint = gradient(t)
    rim = np.exp(-depth / 9)                                       # рёбра: слева сверху светятся, справа снизу темнеют
    glow = np.array([255, 190, 120], np.float32); smoke = np.array([45, 6, 9], np.float32)
    rim_col = glow * (1 - t[..., None]) + smoke * t[..., None]
    body = tint * (1 - rim[..., None] * 0.7) + rim_col * rim[..., None] * 0.7
    body_a = BODY_ALPHA + (RIM_ALPHA - BODY_ALPHA) * rim
    # Блики пластика с фото (только вне диска — там на фото был другой диск).
    hl = np.clip((photo.max(axis=-1) - 25) / (255 - 25), 0, 1) ** 1.5 * 0.6 * (1 - disc)
    hl_col = np.array([255, 150, 120], np.float32)                 # блики окрашены пластиком
    # Крышка над пластинкой: тот же градиент, но почти прозрачная, и мягкий диагональный свет.
    lid_light = 0.06 * np.clip(1 - np.abs((xs - ys) / CANVAS + 0.15) * 3, 0, 1)
    a_base = body_a * (1 - disc) + LID_ALPHA * disc
    col = body * (1 - hl[..., None]) + hl_col * hl[..., None]
    col = col * (1 - lid_light[..., None] * disc[..., None]) + 255 * lid_light[..., None] * disc[..., None]
    a = in_case * np.clip(a_base + (1 - a_base) * hl + lid_light * disc, 0, 1)
    save(np.dstack([col, a * 255]), "case_front.webp")

    # Пластинка: фото, вписанное в круг диска, с маленьким отверстием.
    k = VINYL_R / DISC_R
    art = bilinear(vinyl, VINYL_C[0] + dx * k, VINYL_C[1] + dy * k)
    al = disc * np.clip(rho - HOLE_R + 0.5, 0, 1)
    save(np.dstack([art, al * 255]), "disc_art.webp")

    # Блик: белый с альфой (добавка света) поверх тени у края.
    light, shade = sheen(dx, dy, rho)
    sh_a = np.clip(light, 0, 1) * al
    dark_a = (1 - shade) * al
    sh_rgb = 255 * sh_a / np.maximum(sh_a + dark_a, 1e-4)
    save(np.dstack([sh_rgb, sh_rgb, sh_rgb, np.clip(sh_a + dark_a, 0, 1) * 255]), "disc_sheen.webp")

    case_im = Image.open(os.path.join(OUT, "case_front.webp")).convert("RGBA")
    art_im = Image.open(os.path.join(OUT, "disc_art.webp")).convert("RGBA")
    sheen_im = Image.open(os.path.join(OUT, "disc_sheen.webp")).convert("RGBA")
    layers = lambda d: Image.alpha_composite(Image.alpha_composite(d, sheen_im), case_im)
    layers(art_im).resize((360, 360), Image.LANCZOS).save(os.path.join(OUT, "widget_preview.png"), optimize=True)

    # Превью вращения на условных обоях.
    g = np.linspace(0, 1, CANVAS)[:, None, None]
    wall = Image.fromarray(((np.array([235, 200, 170]) * (1 - g) + np.array([40, 60, 110]) * g)
                            * np.ones((CANVAS, CANVAS, 3))).astype(np.uint8)).convert("RGBA")
    gif = [Image.alpha_composite(wall, layers(art_im.rotate(-15 * i, Image.BICUBIC))).convert("RGB").resize((420, 420), Image.LANCZOS)
           for i in range(24)]
    gif[0].save(os.path.join(HERE, "..", "preview.gif"), save_all=True, append_images=gif[1:], duration=80, loop=0)
    print("ok")


if __name__ == "__main__":
    main()
