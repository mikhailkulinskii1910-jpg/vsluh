"""Картинки для виджета-плеера «Пластинка».

Из art/case.jpg (прозрачный бокс) и art/disc.jpg (блюдо с рыбами — это пластинка) делает (res/drawable-nodpi).
Все слои — квадрат CANVAS×CANVAS, центр диска ровно в центре: виджет крутит пластинку вокруг центра картинки.
  case_front.webp     — бокс поверх пластинки: чёрный фон снят (остаётся только пластик), место диска вырезано,
                        шпиндель в центре остаётся, в его середине — сквозное отверстие;
  disc_art.webp       — пластинка (с отверстием в центре); её вращает drawable/disc_spin.xml;
  disc_sheen.webp     — неподвижный блик винила и бороздки поверх вращающейся пластинки;
  widget_preview.png  — превью в списке виджетов.
Ещё пишет preview.gif — как крутится пластинка (для README).

Запуск: python3 tools/make_disc.py (из папки glassblock).
"""
import math
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "..", "art")
OUT = os.path.join(HERE, "..", "app", "src", "main", "res", "drawable-nodpi")

CANVAS = 740                          # размер слоёв; центр диска — CANVAS/2
CASE = (3, 10, 730, 726, 24)          # контур бокса на art/case.jpg, радиус угла
DISC_C = (373.0, 362.0)               # центр диска (и шпинделя) на art/case.jpg
DISC_R = 312.0
HUB_R = 93.0                          # шпиндель бокса — остаётся поверх пластинки
HOLE_R = 45.0                         # сквозное отверстие в центре (и в пластинке)
PLATE_C = (368.0, 381.0)              # блюдо на art/disc.jpg
PLATE_R = 314.0


def bilinear(img, sx, sy):
    h, w = img.shape[:2]
    inside = (sx >= 0) & (sy >= 0) & (sx <= w - 1.001) & (sy <= h - 1.001)
    sx = np.clip(sx, 0, w - 1.001); sy = np.clip(sy, 0, h - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * inside[..., None]


def sheen(dx, dy, rho):
    """Неподвижный свет на виниле: два встречных клина блика + тонкие бороздки. Возвращает (добавка яркости, тень)."""
    th = np.arctan2(dy, dx)
    wedge = (np.cos(th + math.pi / 4) ** 2) ** 10 * np.clip((rho - HUB_R) / 60, 0, 1)
    rng = np.random.default_rng(7)
    rings = np.convolve(rng.standard_normal(4000), np.ones(3) / 3, mode="same")
    groove = rings[np.clip((rho * 6).astype(int), 0, 3999)]
    light = 0.16 * wedge + 0.025 * groove
    edge = np.clip((rho - (DISC_R - 10)) / 10, 0, 1)          # лёгкое затемнение к краю
    return light, 1 - 0.35 * edge


def save(arr, name):
    Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, name), lossless=True, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    case = np.asarray(Image.open(os.path.join(ART, "case.jpg")).convert("RGB")).astype(np.float32)
    plate = np.asarray(Image.open(os.path.join(ART, "disc.jpg")).convert("RGB")).astype(np.float32)

    c = CANVAS / 2
    ys, xs = np.mgrid[0:CANVAS, 0:CANVAS].astype(np.float32) + 0.5
    dx = xs - c; dy = ys - c; rho = np.hypot(dx, dy)
    inner = np.clip(rho - HOLE_R + 0.5, 0, 1)                 # 0 в центральном отверстии
    disc = np.clip(DISC_R - rho + 0.5, 0, 1)

    # Бокс: пластик снят с чёрного фона («обратное» наложение: на чёрном даёт ровно исходник),
    # шпиндель непрозрачный, место диска и центральное отверстие вырезаны.
    cx = xs - 0.5 + DISC_C[0] - c; cy = ys - 0.5 + DISC_C[1] - c   # пиксель холста → пиксель art/case.jpg
    rgb = bilinear(case, cx, cy)
    x0, y0, x1, y1, r = CASE
    qx = np.clip(cx + 0.5, x0 + r, x1 - r); qy = np.clip(cy + 0.5, y0 + r, y1 - r)
    in_case = np.clip(0.5 - (np.hypot(cx + 0.5 - qx, cy + 0.5 - qy) - r) / 2, 0, 1)
    plastic = np.clip((rgb.max(axis=-1) - 8) / (255 - 8), 0, 1)
    hub = np.clip(HUB_R - rho + 0.5, 0, 1) * inner
    disc_hole = disc * np.clip(rho - HUB_R + 0.5, 0, 1)
    a = in_case * np.maximum(plastic * (1 - disc_hole) * inner, hub)
    rgb = np.where(hub[..., None] > 0, rgb, rgb / np.maximum(plastic, 1e-3)[..., None] * (plastic > 0)[..., None])
    save(np.dstack([rgb, a * 255]), "case_front.webp")

    # Пластинка: блюдо, вписанное в круг диска, с отверстием.
    k = PLATE_R / DISC_R
    art = bilinear(plate, PLATE_C[0] + dx * k, PLATE_C[1] + dy * k)
    al = disc * inner
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
