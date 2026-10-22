#!/usr/bin/env python3
"""mog — сборщик фотопрезентаций.

    python3 build.py config.json

config.json:
{
  "id": "zakharovo",              # латиница, имя папки на GitHub Pages
  "title": "Захарово",            # название вкладки
  "photos": ["1.jpg", "2.jpg"],   # слайды по порядку (пути к файлам)
  "notes": [["абзац", "абзац"], []],  # заметки докладчика на каждый слайд (можно не указывать)
  "sign": "sign.png",             # подпись автора, PNG/JPG на белом или прозрачном фоне (необязательно)
  "swap": "swap.jpg",             # фото для удалённой подмены (необязательно)
  "topic": null,                  # канал ntfy; если пусто и есть swap — создаётся и записывается в config
  "enhance": false,               # true — увеличение x2 нейросетью EDSR (≈7 мин на фото на CPU)
  "out": "out/zakharovo"          # папка результата
}

Результат в out/:
  artifact.html — для публикации через Artifact (без <html>/<head>, удалённая подмена там не работает)
  index.html    — полная страница для GitHub Pages
  pult.html     — пульт для телефона (только если задан swap)
"""
import base64, io, json, os, secrets, sys, urllib.request
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
EDSR_URL = 'https://raw.githubusercontent.com/Saafke/EDSR_Tensorflow/master/models/EDSR_x2.pb'


def trim_dark(im, thr=25):
    """Срезать чёрные полосы по краям (скриншоты, рамки)."""
    g = np.asarray(im.convert('L')).astype(float)
    h, w = g.shape
    t = 0
    while t < h // 6 and g[t].mean() < thr: t += 1
    b = h
    while b > h - h // 6 and g[b - 1].mean() < thr: b -= 1
    l = 0
    while l < w // 6 and g[:, l].mean() < thr: l += 1
    r = w
    while r > w - w // 6 and g[:, r - 1].mean() < thr: r -= 1
    m = lambda v, cond: v + 2 if cond else v
    return im.crop((m(l, l), m(t, t), r - 2 if r < w else w, b - 2 if b < h else h))


_sr = None
def upscale(im):
    global _sr
    import cv2
    if _sr is None:
        model = os.path.join(HERE, 'EDSR_x2.pb')
        if not os.path.exists(model):
            urllib.request.urlretrieve(EDSR_URL, model)
        _sr = cv2.dnn_superres.DnnSuperResImpl_create()
        _sr.readModel(model)
        _sr.setModel('edsr', 2)
    a = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
    a = cv2.fastNlMeansDenoisingColored(a, None, 3, 3, 7, 21)
    up = _sr.upsample(a)
    return Image.fromarray(cv2.cvtColor(up, cv2.COLOR_BGR2RGB)).filter(
        ImageFilter.UnsharpMask(radius=1.6, percent=60, threshold=2))


def grade(im, k=0.18, sat=1.0, con=1.02):
    """Мягкая S-кривая + чуть контраста."""
    a = np.asarray(im).astype(np.float32) / 255
    a = a + k * (a - a ** 2) * (2 * a - 1)
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(sat)).enhance(con)


def jpeg_uri(im, q=86, max_side=2400):
    if max(im.size) > max_side:
        k = max_side / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=0)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def sign_uri(path):
    """Подпись: белый фон → прозрачность, обрезка по краям, 640 px в ширину."""
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    if a[..., 3].min() == 255:
        g = a[..., :3].mean(axis=2)
        a[..., 3] = np.clip((252 - g) / 12, 0, 1) * 255
    im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    im = im.crop(im.getbbox())
    im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(), round(im.width / im.height, 3)


DOC_HEAD = '''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1210">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}[hidden]{display:none!important}</style>
'''


def main(cfg_path):
    cfg_path = os.path.abspath(cfg_path)
    base = os.path.dirname(cfg_path)
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    p = lambda f: f if os.path.isabs(f) else os.path.join(base, f)
    out = p(cfg.get('out') or ('out/' + cfg['id']))
    os.makedirs(out, exist_ok=True)

    photos = []
    for i, f in enumerate(cfg['photos']):
        im = trim_dark(Image.open(p(f)).convert('RGB'))
        if cfg.get('enhance'):
            print(f'  увеличиваю {f} …', flush=True)
            im = upscale(im)
        photos.append(jpeg_uri(grade(im)))
        print(f'фото {i + 1}: {f} {im.size}', flush=True)

    conf = {'id': cfg['id'], 'photos': photos, 'notes': cfg.get('notes') or []}
    if cfg.get('sign'):
        conf['sign'], conf['signRatio'] = sign_uri(p(cfg['sign']))
    if cfg.get('swap'):
        if not cfg.get('topic'):
            cfg['topic'] = 'mog-' + cfg['id'][:12] + '-' + secrets.token_hex(8)
            json.dump(cfg, open(cfg_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        conf['swap'] = jpeg_uri(trim_dark(Image.open(p(cfg['swap'])).convert('RGB')), q=90, max_side=1600)
        conf['topic'] = cfg['topic']

    tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
    title = cfg.get('title') or cfg['id']
    esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;')
    body = tpl.replace('{{TITLE}}', esc(title))

    art_conf = dict(conf); art_conf.pop('topic', None); art_conf.pop('swap', None)
    js = lambda c: json.dumps(c, ensure_ascii=False).replace('</', '<\\/')
    open(os.path.join(out, 'artifact.html'), 'w', encoding='utf-8').write(body.replace('{{CONFIG}}', js(art_conf)))

    page = body.replace('{{CONFIG}}', js(conf)).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
    cut = page.index('<div class="stage"')
    page = DOC_HEAD + page[:cut] + '</head>\n<body>\n' + page[cut:] + '\n</body>\n</html>\n'
    open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(page)

    if conf.get('topic'):
        pult = open(os.path.join(HERE, 'pult.html'), encoding='utf-8').read()
        pult = pult.replace('{{TOPIC}}', conf['topic']).replace('{{TITLE}}', esc(title))
        open(os.path.join(out, 'pult.html'), 'w', encoding='utf-8').write(pult)

    for f in sorted(os.listdir(out)):
        print(f'{out}/{f}  {os.path.getsize(os.path.join(out, f)) // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
