#!/usr/bin/env python3
# Собирает компактную библиотеку ИК-пультов из Flipper-IRDB в irbis/lib/.
# Формат на устройстве разворачивается в тайминги (см. app encoder). Храним компактно.
# Выход: irbis/lib/index.json {cats:{Категория:[бренды]}}, irbis/lib/<Cat>/<Brand>.json
import os, json, re, sys, glob

SRC = sys.argv[1] if len(sys.argv) > 1 else "Flipper-IRDB"
OUT = sys.argv[2] if len(sys.argv) > 2 else "irbis/lib"
KEEP = {"NEC", "NECext", "NEC42", "NEC42ext", "Samsung32", "SIRC", "SIRC15", "SIRC20", "Kaseikyo", "RC5", "RC6", "RCA", "Pioneer"}
# что умеет развернуть приложение (остальные parsed пропускаем):
ENC = {"NEC", "NECext", "Samsung32", "SIRC", "SIRC15", "SIRC20"}

def hx(s):  # "07 00 00 00" -> "0700" (значимые младшие байты, без хвостовых нулей)
    b = [p for p in s.split() if re.fullmatch(r"[0-9A-Fa-f]{2}", p)]
    while len(b) > 1 and b[-1] == "00":
        b.pop()
    return "".join(b).upper()

def parse_ir(path):
    sigs = []
    cur = {}
    raw = None
    for line in open(path, encoding="utf-8", errors="ignore"):
        line = line.strip()
        if line.startswith("#"):
            if cur.get("name"):
                sigs.append(cur);
            cur = {}; raw = None; continue
        if ":" not in line: continue
        k, _, v = line.partition(":"); k = k.strip(); v = v.strip()
        if k == "name": cur = {"name": v}
        elif k == "type": cur["type"] = v
        elif k == "protocol": cur["protocol"] = v
        elif k == "address": cur["a"] = hx(v)
        elif k == "command": cur["c"] = hx(v)
        elif k == "frequency": cur["f"] = int(v) if v.isdigit() else 38000
        elif k == "data": cur["raw"] = [int(x) for x in v.split() if x.lstrip("-").isdigit()]
    if cur.get("name"): sigs.append(cur)
    out = []
    for s in sigs:
        nm = s.get("name", "")[:24]
        if not nm: continue
        if s.get("type") == "raw" and s.get("raw"):
            out.append({"n": nm, "r": s["raw"], "f": s.get("f", 38000)})
        elif s.get("type") == "parsed":
            p = s.get("protocol", "")
            if p in ENC and "a" in s and "c" in s:
                out.append({"n": nm, "p": p, "a": s["a"], "c": s["c"]})
    return out

def main():
    cats = {}
    for cat in sorted(os.listdir(SRC)):
        cdir = os.path.join(SRC, cat)
        if not os.path.isdir(cdir) or cat.startswith("."): continue
        brands = {}
        for ir in glob.glob(os.path.join(cdir, "**", "*.ir"), recursive=True):
            rel = os.path.relpath(ir, cdir)
            brand = rel.split(os.sep)[0]
            model = os.path.splitext(os.path.basename(ir))[0]
            btns = parse_ir(ir)
            if not btns: continue
            brands.setdefault(brand, []).append({"m": model, "b": btns})
        if not brands: continue
        cats[cat] = sorted(brands)
        for brand, remotes in brands.items():
            d = os.path.join(OUT, cat); os.makedirs(d, exist_ok=True)
            safe = re.sub(r"[^\w.-]", "_", brand)
            json.dump(remotes, open(os.path.join(d, safe + ".json"), "w", encoding="utf-8"),
                      ensure_ascii=False, separators=(",", ":"))
    os.makedirs(OUT, exist_ok=True)
    json.dump({"cats": cats}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    n = sum(len(v) for v in cats.values())
    print("categories", len(cats), "brands", n)

main()
