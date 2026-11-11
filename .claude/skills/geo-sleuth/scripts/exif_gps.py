#!/usr/bin/env python3
"""Печатает GPS, дату и камеру из EXIF фотографии. Нужен Pillow (pip install pillow)."""
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Нет Pillow: pip install pillow (или используйте exiftool)")

GPS_IFD = 0x8825
EXIF_IFD = 0x8769


def to_deg(dms, ref):
    d, m, s = (float(x) for x in dms)
    v = d + m / 60 + s / 3600
    return -v if ref in ("S", "W") else v


def main(path):
    exif = Image.open(path).getexif()
    if not exif:
        print("EXIF нет (вероятно, вырезан мессенджером или соцсетью)")
        return
    sub = exif.get_ifd(EXIF_IFD)
    date = sub.get(0x9003) or exif.get(0x0132)
    camera = " ".join(str(x) for x in (exif.get(0x010F), exif.get(0x0110)) if x)
    if date:
        print("Дата:", date)
    if camera:
        print("Камера:", camera)
    gps = exif.get_ifd(GPS_IFD)
    if 2 not in gps or 4 not in gps:
        print("GPS нет")
        return
    lat = to_deg(gps[2], gps.get(1, "N"))
    lon = to_deg(gps[4], gps.get(3, "E"))
    print(f"GPS: {lat:.6f}, {lon:.6f}")
    if 6 in gps:
        print(f"Высота: {float(gps[6]):.0f} м")
    print(f"https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=17/{lat:.6f}/{lon:.6f}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Использование: exif_gps.py <файл>")
    main(sys.argv[1])
