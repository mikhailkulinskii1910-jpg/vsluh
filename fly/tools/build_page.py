"""
Собирает fly/index.html из шаблона page.template.html и модулей ядра.

Модули (genome.js, sim.js, evolution.js) остаются ES-модулями для проверки в Node.
На странице они встраиваются как обычный скрипт: строки import убираются,
слово export снимается. Так страница работает без ES-модулей, в том числе в
песочнице Artifact, а воркер эволюции создаётся из того же кода через Blob.

Запуск: python3 fly/tools/build_page.py
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parts = []
for name in ["genome.js", "sim.js", "evolution.js"]:
    lines = []
    for line in (root / name).read_text(encoding="utf-8").splitlines():
        if line.startswith("import "):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        lines.append(line)
    parts.append(f"// ---- {name} ----\n" + "\n".join(lines))
core = "\n\n".join(parts)
if "</script" in core:
    raise SystemExit("ядро содержит </script>, встроить нельзя")

template = (root / "page.template.html").read_text(encoding="utf-8")
assert template.count("/*__CORE__*/") == 1
out = template.replace("/*__CORE__*/", core)
(root / "index.html").write_text(out, encoding="utf-8")
print("wrote", root / "index.html", len(out), "bytes")
