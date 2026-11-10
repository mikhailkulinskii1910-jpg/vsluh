#!/usr/bin/env python3
"""Собирает «файл для компьютера»: встраивает шрифты (Prata, Cormorant Garamond, Montserrat)
в HTML игры, чтобы она открывалась двойным щелчком без интернета.

  python3 mkoffline.py game.html Игра_для_компьютера.html [папка_со_шрифтами]

Шрифты берутся из npm-пакетов @fontsource/* (скачиваются сами, если папки нет).
"""
import base64, os, re, subprocess, sys, tarfile, glob

src, dst = sys.argv[1], sys.argv[2]
fdir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '.fonts')
SPEC = [("prata", "Prata", [(400, "normal")]),
        ("cormorant-garamond", "Cormorant Garamond", [(400, "normal"), (500, "normal"), (600, "normal"), (700, "normal"), (400, "italic"), (500, "italic")]),
        ("montserrat", "Montserrat", [(400, "normal"), (500, "normal"), (600, "normal"), (700, "normal")])]
CYR = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"
LAT = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

def pkg_dir(slug):
    hits = glob.glob(os.path.join(fdir, f"fontsource-{slug}-*", "package", "files"))
    if hits: return hits[0]
    os.makedirs(fdir, exist_ok=True)
    subprocess.run(["npm", "pack", f"@fontsource/{slug}", "--silent"], cwd=fdir, check=True, stdout=subprocess.DEVNULL)
    tgz = sorted(glob.glob(os.path.join(fdir, f"fontsource-{slug}-*.tgz")))[-1]
    out = tgz[:-4]; os.makedirs(out, exist_ok=True)
    with tarfile.open(tgz) as t: t.extractall(out)
    return os.path.join(out, "package", "files")

css = []
for slug, fam, ws in SPEC:
    d = pkg_dir(slug)
    for w, st in ws:
        for sub, rng in (("cyrillic", CYR), ("latin", LAT)):
            b = base64.b64encode(open(os.path.join(d, f"{slug}-{sub}-{w}-{st}.woff2"), "rb").read()).decode()
            css.append(f"@font-face{{font-family:'{fam}';font-style:{st};font-weight:{w};font-display:swap;src:url(data:font/woff2;base64,{b}) format('woff2');unicode-range:{rng}}}")

s = open(src, encoding="utf-8").read()
s = re.sub(r'<link rel="(preconnect|stylesheet)"[^>]*>\n', '', s)
title = re.search(r'<title>.*?</title>\n', s).group(0); s = s.replace(title, '', 1)
head = ('<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'{title}<style>{chr(10).join(css)}\n[hidden]{{display:none!important}}\n</style>\n')
s = head + s
i = s.index('<svg width="0"')
s = s[:i] + '</head>\n<body>\n' + s[i:] + '\n</body>\n</html>\n'
open(dst, 'w', encoding='utf-8').write(s)
print(dst, os.path.getsize(dst) // 1024, 'KB')
