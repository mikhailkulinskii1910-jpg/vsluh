"""
Готовит ресурсы и собирает APK: python3 fly/tools/build_android.py
Нужны Java 17+, Gradle и Android SDK (переменная ANDROID_HOME).
Результат: fly/dist/fly-connectome.apk
"""
import os, re, shutil, subprocess, urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
android = root / "android"
assets = android / "app/src/main/assets"
subprocess.run(["python3", str(root / "tools/build_page.py")], check=True)

if assets.exists():
    shutil.rmtree(assets)
(assets / "data").mkdir(parents=True)
(assets / "vendor").mkdir()
shutil.copy(root / "data/fly_network.json", assets / "data/fly_network.json")

# three.js вшивается в приложение, чтобы оно работало без интернета
vendor = {
    "three.min.js": "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js",
    "OrbitControls.js": "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js",
}
cache = root / "android/.vendor-cache"
cache.mkdir(exist_ok=True)
page = (root / "index.html").read_text(encoding="utf-8")
for name, url in vendor.items():
    f = cache / name
    if not f.exists():
        urllib.request.urlretrieve(url, f)
    shutil.copy(f, assets / "vendor" / name)
    page = page.replace(f'<script src="{url}"></script>', f'<script src="vendor/{name}"></script>')
assert "cdn.jsdelivr.net" not in page, "остались внешние скрипты"

html = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '</head>\n<body>\n' + page + '\n</body>\n</html>\n')
(assets / "index.html").write_text(html, encoding="utf-8")

env = dict(os.environ)
env.setdefault("ANDROID_HOME", "/home/user/android-sdk")
(android / "local.properties").write_text(f"sdk.dir={env['ANDROID_HOME']}\n")
subprocess.run(["gradle", "--no-daemon", "-q", "assembleRelease"], cwd=android, env=env, check=True)
apk = android / "app/build/outputs/apk/release/app-release.apk"
(root / "dist").mkdir(exist_ok=True)
shutil.copy(apk, root / "dist/fly-connectome.apk")
print("APK:", root / "dist/fly-connectome.apk", apk.stat().st_size // 1024, "КБ")
