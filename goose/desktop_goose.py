#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Гусь — настольный гусь для МОС (Linux) и досок МОСТЕХ.

Переработка идеи Desktop Goose (Windows) под Linux: гусь гуляет по экрану,
гогочет, оставляет грязные следы, хватает курсор, притаскивает заметки
и картинки-мемы. Всё нарисовано кодом, внешних ресурсов не нужно.

Зависимости: python3 + PyQt5 (в МОС: пакет python3-qt5 / python3-PyQt5).
Запуск:  python3 desktop_goose.py         — выпустить гуся
         python3 desktop_goose.py --quit  — прогнать гуся
"""

import argparse
import math
import os
import random
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import time
import wave

# Под Wayland окно-оверлей и перенос курсора не работают — просим XWayland.
if os.environ.get("XDG_SESSION_TYPE") == "wayland" and "QT_QPA_PLATFORM" not in os.environ:
    os.environ["QT_QPA_PLATFORM"] = "xcb"

from PyQt5.QtCore import (QElapsedTimer, QLockFile, QPoint, QPointF, QRect, QRectF,
                          QSettings, QSize, Qt, QTimer)
from PyQt5.QtGui import (QBrush, QColor, QCursor, QFont, QIcon, QImage, QPainter,
                         QPainterPath, QPen, QPixmap, QPolygonF, QRegion, QBitmap)
from PyQt5.QtWidgets import (QAction, QApplication, QLabel, QMenu, QSystemTrayIcon,
                             QVBoxLayout, QWidget, QPlainTextEdit)

APP = "desktop-goose"
VERSION = "1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
CONF_DIR = os.path.join(os.path.expanduser("~/.config"), APP)
RUN_DIR = os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir()
PID_FILE = os.path.join(RUN_DIR, APP + ".pid")

NOTES = [
    "Га-га-га!",
    "Я гусь.\nЭто мой экран.",
    "Не трогай курсор.\nОн теперь мой.",
    "Звонок — для гуся,\nа не для учителя.",
    "Домашнее задание\nсъедено гусём.",
    "Почему у вас\nна доске нет травы?",
    "ГА.",
    "Я принёс тебе заметку.\nТеперь закрой её.",
    "Мир. Труд. Гусь.",
    "Проверено гусём ✓",
    "Перемена!\n(так сказал гусь)",
    "Гусь в курсе.",
]

MEMES = [
    ("ГУСЬ ОДОБРЯЕТ", "#4caf50"),
    ("ГУСЬ НЕ ОДОБРЯЕТ", "#e53935"),
    ("МЕНЯ НЕ ОСТАНОВИТЬ", "#1e88e5"),
    ("ГА-ГА-ГА", "#fb8c00"),
    ("ОПАСНЫЙ ГУСЬ", "#8e24aa"),
]

WHITE = QColor("#fafafa")
OUTLINE = QColor("#9e9e9e")
ORANGE = QColor("#ff9800")
ORANGE_DARK = QColor("#e65100")
MUD = QColor(110, 72, 40)


# ───────────────────────────── звук ─────────────────────────────

def make_honk_wav(path):
    """Синтез «га-га»: два гнусавых слога с падающим тоном."""
    rate = 22050
    frames = bytearray()

    def syllable(dur, f0, f1):
        n = int(rate * dur)
        phase = 0.0
        for i in range(n):
            t = i / n
            f = f0 + (f1 - f0) * t + 6 * math.sin(2 * math.pi * 30 * i / rate)
            phase += 2 * math.pi * f / rate
            # пила + нечётные гармоники = «гнусавость»
            s = sum(math.sin(k * phase) / k for k in range(1, 12))
            s += 0.6 * math.sin(3 * phase) + 0.4 * math.sin(5 * phase)
            env = min(1.0, t * 25) * (1 - t) ** 0.7
            v = max(-1.0, min(1.0, s * 0.33 * env))
            frames.extend(struct.pack("<h", int(v * 26000)))

    syllable(0.17, 520, 410)
    frames.extend(b"\x00\x00" * int(rate * 0.06))
    syllable(0.21, 480, 350)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


class Sound:
    def __init__(self):
        cache = os.path.join(os.path.expanduser("~/.cache"), APP)
        os.makedirs(cache, exist_ok=True)
        self.path = os.path.join(cache, "honk-%s.wav" % VERSION)
        if not os.path.exists(self.path):
            make_honk_wav(self.path)
        self.cmd = None
        for name, args in (("paplay", []), ("pw-play", []), ("aplay", ["-q"]),
                           ("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet"])):
            exe = shutil.which(name)
            if exe:
                self.cmd = [exe] + args + [self.path]
                break
        self.last = 0.0

    def honk(self):
        if not self.cmd or time.monotonic() - self.last < 0.4:
            return
        self.last = time.monotonic()
        try:
            subprocess.Popen(self.cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self.cmd = None


# ─────────────────────── окна, которые таскает гусь ───────────────────────

class Carried(QWidget):
    """Окно без рамки, которое гусь приносит. Можно двигать мышью/пальцем и закрыть ×."""

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setAttribute(Qt.WA_DeleteOnClose)
        self._drag = None

    def paint_close(self, p):
        r = self.close_rect()
        p.setPen(QPen(QColor(0, 0, 0, 150), 2))
        m = 6
        p.drawLine(r.left() + m, r.top() + m, r.right() - m, r.bottom() - m)
        p.drawLine(r.right() - m, r.top() + m, r.left() + m, r.bottom() - m)

    def close_rect(self):
        return QRect(self.width() - 30, 2, 28, 28)

    def mousePressEvent(self, e):
        if self.close_rect().contains(e.pos()):
            self.close()
            return
        self._drag = e.globalPos() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if self._drag is not None:
            self.move(e.globalPos() - self._drag)

    def mouseReleaseEvent(self, e):
        self._drag = None


class Note(Carried):
    def __init__(self, text, s):
        super().__init__()
        self.resize(int(230 * s), int(170 * s))
        lay = QVBoxLayout(self)
        lay.setContentsMargins(int(14 * s), int(30 * s), int(14 * s), int(12 * s))
        ed = QPlainTextEdit(text)
        ed.setFrameStyle(0)
        ed.setStyleSheet("background: transparent; color: #3e2723;")
        f = QFont("Comic Sans MS, Manrope, DejaVu Sans")
        f.setPointSizeF(13 * s)
        ed.setFont(f)
        lay.addWidget(ed)

    def paintEvent(self, e):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor("#fff59d"))
        p.fillRect(QRect(0, 0, self.width(), 32), QColor("#fff176"))
        p.setPen(QColor("#795548"))
        p.drawText(QRect(10, 0, self.width(), 32), Qt.AlignVCenter, "Заметка от гуся")
        p.setPen(QPen(QColor("#fbc02d"), 1))
        p.drawRect(self.rect().adjusted(0, 0, -1, -1))
        self.paint_close(p)


def make_meme_pixmap(text, color, s):
    w, h = int(300 * s), int(260 * s)
    pm = QPixmap(w, h)
    pm.fill(QColor(color))
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    # портрет гуся крупным планом
    p.save()
    p.translate(w * 0.5, h * 0.6)
    p.rotate(-90)
    draw_goose(p, 2.4 * s, walk=0, neck=1.0, beak_open=0.6, shadow=False)
    p.restore()
    f = QFont("Impact, Unbounded, DejaVu Sans")
    f.setBold(True)
    f.setPixelSize(int(26 * s))
    p.setFont(f)
    path = QPainterPath()
    tw = p.fontMetrics().horizontalAdvance(text)
    path.addText((w - tw) / 2, h - 18 * s, f, text)
    p.setPen(QPen(Qt.black, 4 * s))
    p.drawPath(path)
    p.fillPath(path, Qt.white)
    p.end()
    return pm


class Meme(Carried):
    def __init__(self, pm):
        super().__init__()
        self.pm = pm
        self.resize(pm.size())

    def paintEvent(self, e):
        p = QPainter(self)
        p.drawPixmap(0, 0, self.pm)
        p.setPen(QPen(Qt.white, 3))
        p.drawRect(self.rect().adjusted(1, 1, -2, -2))
        self.paint_close(p)


def user_memes():
    files = []
    for d in (os.path.join(CONF_DIR, "memes"), os.path.join(HERE, "memes")):
        if os.path.isdir(d):
            for n in sorted(os.listdir(d)):
                if n.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp")):
                    files.append(os.path.join(d, n))
    return files


# ───────────────────────────── рисунок гуся ─────────────────────────────

def draw_goose(p, s, walk, neck, beak_open, shadow=True):
    """Гусь сверху, смотрит вдоль +x. walk — фаза шага, neck 0..1 — вытянутость шеи."""
    p.save()
    p.scale(s, s)
    pen = QPen(OUTLINE, 1.6)
    if shadow:
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 45))
        p.drawEllipse(QRectF(-26, -12, 50, 30))
    # лапы
    step = math.sin(walk) * 7
    p.setPen(QPen(ORANGE_DARK, 1.2))
    p.setBrush(ORANGE)
    for side, dx in ((-1, step), (1, -step)):
        foot = QPolygonF([QPointF(dx - 4, side * 8), QPointF(dx + 7, side * 13),
                          QPointF(dx + 7, side * 5)])
        p.drawPolygon(foot)
    # хвост
    p.setPen(pen)
    p.setBrush(WHITE)
    p.drawPolygon(QPolygonF([QPointF(-24, -7), QPointF(-34, 0), QPointF(-24, 7)]))
    # тело
    p.drawEllipse(QRectF(-28, -15, 46, 30))
    # крылья
    p.setPen(QPen(QColor("#cfcfcf"), 1.4))
    p.drawArc(QRectF(-22, -12, 34, 18), 200 * 16, 120 * 16)
    p.drawArc(QRectF(-22, -6, 34, 18), 40 * 16, 120 * 16)
    # шея
    nl = 10 + 12 * neck
    p.setPen(QPen(OUTLINE, 12.6, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(QPointF(8, 0), QPointF(8 + nl, 0))
    p.setPen(QPen(WHITE, 10, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(QPointF(4, 0), QPointF(8 + nl, 0))
    hx = 8 + nl + 2
    # клюв
    p.setPen(QPen(ORANGE_DARK, 1))
    p.setBrush(ORANGE)
    o = 3 * beak_open
    p.drawPolygon(QPolygonF([QPointF(hx + 4, -4), QPointF(hx + 15, -o), QPointF(hx + 4, 0)]))
    p.drawPolygon(QPolygonF([QPointF(hx + 4, 0), QPointF(hx + 15, o), QPointF(hx + 4, 4)]))
    # голова
    p.setPen(pen)
    p.setBrush(WHITE)
    p.drawEllipse(QPointF(hx, 0), 7.5, 7)
    p.setPen(Qt.NoPen)
    p.setBrush(QColor("#212121"))
    p.drawEllipse(QPointF(hx + 2, -4), 1.6, 1.6)
    p.drawEllipse(QPointF(hx + 2, 4), 1.6, 1.6)
    p.restore()


def beak_offset(s, neck):
    return (8 + 10 + 12 * neck + 2 + 14) * s


# ───────────────────────────── сам гусь ─────────────────────────────

def angle_diff(a, b):
    return (b - a + math.pi) % (2 * math.pi) - math.pi


class Goose(QWidget):
    TICK = 16

    def __init__(self, settings, sound):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
                         | Qt.X11BypassWindowManagerHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setWindowTitle("Гусь")
        self.cfg = settings
        self.sound = sound

        screens = QApplication.screens()
        geo = screens[0].virtualGeometry() if screens else QRect(0, 0, 1280, 720)
        self.setGeometry(geo)
        self.area = QRect(0, 0, geo.width(), geo.height())
        base = max(1.0, min(geo.height(), 2160) / 750)
        self.s = base * float(self.cfg.value("scale", 1.0))

        self.pos = QPointF(-60 * self.s, self.area.height() * 0.6)
        self.dir = 0.0
        self.face = 0.0
        self.walk = 0.0
        self.neck = 0.0
        self.beak = 0.0
        self.speed = 0.0
        self.target = QPointF(self.area.width() * 0.3, self.area.height() * 0.6)
        self.state = "walk"
        self.state_until = 0.0
        self.next_honk = time.monotonic() + 3
        self.honk_until = 0.0
        self.mud_until = 0.0
        self.tracks = []          # (x, y, угол, время, маска)
        self.tracks_reg = QRegion()
        self.last_track = QPointF(self.pos)
        self.track_side = 1
        self.item = None
        self.items = []           # держим ссылки, иначе PyQt удалит брошенные окна
        self.held = None
        self.paused = False
        self.memes = user_memes()

        self.clock = QElapsedTimer()
        self.clock.start()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(self.TICK)

    # ── настройки ──
    def on(self, key, default=True):
        v = self.cfg.value(key, default)
        return v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes")

    # ── решения ──
    def rand_point(self, margin=80):
        m = margin * self.s
        return QPointF(random.uniform(m, self.area.width() - m),
                       random.uniform(m, self.area.height() - m))

    def choose_task(self):
        now = time.monotonic()
        tasks = [("walk", 50), ("idle", 15)]
        if self.on("cursor"):
            tasks.append(("cursor", 12))
        if self.on("notes"):
            tasks.append(("fetch_note", 10))
        if self.on("memes"):
            tasks.append(("fetch_meme", 8))
        if self.on("mud"):
            tasks.append(("mud", 8))
        total = sum(w for _, w in tasks)
        r = random.uniform(0, total)
        for name, w in tasks:
            r -= w
            if r <= 0:
                break
        if name == "walk":
            self.state, self.target = "walk", self.rand_point()
        elif name == "idle":
            self.state, self.state_until = "idle", now + random.uniform(1, 3.5)
        elif name == "cursor":
            self.state, self.state_until = "cursor", now + 8
        elif name.startswith("fetch"):
            self.state = name
            y = random.uniform(0.2, 0.8) * self.area.height()
            x = -70 * self.s if random.random() < 0.5 else self.area.width() + 70 * self.s
            self.target = QPointF(x, y)
        elif name == "mud":
            self.mud_until = now + 15
            self.state, self.target = "walk", self.rand_point()

    def honk(self):
        self.honk_until = time.monotonic() + 0.55
        if self.on("sound"):
            self.sound.honk()

    # ── шаг симуляции ──
    def tick(self):
        dt = min(self.clock.restart() / 1000.0, 0.05)
        if self.paused:
            return
        now = time.monotonic()
        s = self.s
        walk_v, run_v = 85 * s, 270 * s
        want_speed = walk_v
        backwards = False
        goal = self.target

        if self.held is not None:
            self.pos = QPointF(QCursor.pos() - self.geometry().topLeft()) + self.held
            self.speed = 0
            self.beak = 1.0
            self.update_view()
            return

        if self.state == "idle":
            goal = None
            if now > self.state_until:
                self.choose_task()
        elif self.state == "cursor":
            goal = QPointF(QCursor.pos() - self.geometry().topLeft())
            want_speed = run_v
            if (self.beak_point() - goal).manhattanLength() < 14 * s:
                self.state = "drag_cursor"
                self.state_until = now + random.uniform(1.8, 3.2)
                self.target = self.rand_point(120)
                self.honk()
            elif now > self.state_until:
                self.choose_task()
        elif self.state == "drag_cursor":
            want_speed = walk_v * 1.4
            QCursor.setPos((self.beak_point() + QPointF(self.geometry().topLeft())).toPoint())
            if now > self.state_until or self.near(goal, 10):
                self.honk()
                self.choose_task()
        elif self.state.startswith("fetch"):
            want_speed = run_v * 0.7
            if self.near(goal, 12):
                self.spawn_item(self.state == "fetch_meme")
                self.state = "carry"
                # тащит недалеко от края, с которого пришёл
                m = 200 * s
                x = random.uniform(m, min(self.area.width() * 0.5, m + 450 * s))
                if self.pos.x() > self.area.width() / 2:
                    x = self.area.width() - x
                self.target = QPointF(x, random.uniform(m, self.area.height() - m))
        elif self.state == "carry":
            backwards = True
            want_speed = walk_v * 1.3
            if self.item is None or not self.item.isVisible():
                self.item = None
                self.choose_task()
            elif self.near(goal, 10):
                self.item = None
                self.honk()
                self.state, self.state_until = "idle", now + 1.5
        else:  # walk
            if self.near(goal, 10):
                self.state, self.state_until = "idle", now + random.uniform(0.5, 2.5)

        # движение
        if goal is not None:
            d = goal - self.pos
            want = math.atan2(d.y(), d.x())
            self.dir += angle_diff(self.dir, want) * min(1.0, dt * 7)
            self.speed += (want_speed - self.speed) * min(1.0, dt * 4)
        else:
            self.speed *= max(0.0, 1 - dt * 8)
        step = self.speed * dt
        self.pos += QPointF(math.cos(self.dir), math.sin(self.dir)) * step
        self.walk += step / (6 * s)
        face_want = self.dir + (math.pi if backwards else 0)
        self.face += angle_diff(self.face, face_want) * min(1.0, dt * 9)

        if self.item is not None and self.state == "carry":
            self.place_item()

        # шея и клюв
        neck_want = 1.0 if self.state in ("cursor", "drag_cursor") or now < self.honk_until else 0.25
        self.neck += (neck_want - self.neck) * min(1.0, dt * 8)
        beak_want = 1.0 if now < self.honk_until else 0.0
        self.beak += (beak_want - self.beak) * min(1.0, dt * 18)

        if now > self.next_honk:
            if random.random() < 0.35:
                self.honk()
            self.next_honk = now + random.uniform(3, 10)

        # следы
        if now < self.mud_until and (self.pos - self.last_track).manhattanLength() > 14 * s:
            side = self.track_side = -self.track_side
            off = QPointF(-math.sin(self.dir), math.cos(self.dir)) * (6 * s * side)
            x, y = self.pos.x() + off.x(), self.pos.y() + off.y()
            treg = self.track_region(x, y, self.dir)
            self.tracks.append((x, y, self.dir, now, treg))
            self.tracks_reg += treg
            self.last_track = QPointF(self.pos)
        if self.tracks and now - self.tracks[0][3] > 14:
            self.tracks = [t for t in self.tracks if now - t[3] <= 14][-300:]
            self.tracks_reg = QRegion()
            for t in self.tracks:
                self.tracks_reg += t[4]

        self.update_view()

    def near(self, p, r):
        return (self.pos - p).manhattanLength() < r * self.s

    def beak_point(self):
        b = beak_offset(self.s, self.neck)
        return self.pos + QPointF(math.cos(self.face), math.sin(self.face)) * b

    def spawn_item(self, meme):
        if meme:
            if self.memes and random.random() < 0.6:
                pm = QPixmap(random.choice(self.memes))
                if not pm.isNull():
                    pm = pm.scaled(int(320 * self.s), int(320 * self.s),
                                   Qt.KeepAspectRatio, Qt.SmoothTransformation)
                else:
                    pm = make_meme_pixmap(*random.choice(MEMES), self.s)
            else:
                pm = make_meme_pixmap(*random.choice(MEMES), self.s)
            self.item = Meme(pm)
        else:
            self.item = Note(random.choice(NOTES), self.s)
        it = self.item
        self.items.append(it)
        it.destroyed.connect(lambda *a: self.items.remove(it) if it in self.items else None)
        self.place_item()
        self.item.show()
        self.raise_()
        self.honk()

    def place_item(self):
        # гусь пятится и тянет окно за край, который держит клювом
        it = self.item
        b = self.beak_point()
        fx, fy = math.cos(self.face), math.sin(self.face)
        w, h = it.width(), it.height()
        reach = abs(fx) * w / 2 + abs(fy) * h / 2 - 6 * self.s
        c = b + QPointF(fx, fy) * reach
        g = self.geometry().topLeft()
        it.move(int(c.x() - w / 2 + g.x()), int(c.y() - h / 2 + g.y()))

    # ── отрисовка ──
    def update_view(self):
        self.setMask(self.shape_region())
        self.update()
        if self.item is not None:
            self.raise_()

    def goose_rect(self):
        r = 80 * self.s
        return QRectF(self.pos.x() - r, self.pos.y() - r, 2 * r, 2 * r)

    def bubble_rect(self):
        return QRectF(self.pos.x() - 30 * self.s, self.pos.y() - 70 * self.s, 80 * self.s, 30 * self.s)

    def shape_region(self):
        # маска окна: без композитора гусь всё равно не «закрасит» экран, а клики
        # мимо гуся проходят в окна под ним
        gr = self.goose_rect().toAlignedRect()
        img = QImage(gr.size(), QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.transparent)
        p = QPainter(img)
        p.translate(-gr.topLeft())
        self.paint_goose(p)
        p.end()
        reg = QRegion(QBitmap.fromImage(img.createAlphaMask()))
        reg.translate(gr.topLeft())
        reg += self.tracks_reg
        if reg.isEmpty():
            reg = QRegion(0, 0, 1, 1)
        return reg

    def paint_goose(self, p):
        p.setRenderHint(QPainter.Antialiasing)
        p.save()
        p.translate(self.pos)
        p.rotate(math.degrees(self.face))
        draw_goose(p, self.s, self.walk, self.neck, self.beak)
        p.restore()
        if time.monotonic() < self.honk_until:
            r = self.bubble_rect()
            p.setPen(QPen(QColor("#424242"), 2))
            p.setBrush(QColor(255, 255, 255, 235))
            p.drawRoundedRect(r, 10 * self.s, 10 * self.s)
            f = QFont("Unbounded, DejaVu Sans")
            f.setBold(True)
            f.setPixelSize(int(14 * self.s))
            p.setFont(f)
            p.drawText(r, Qt.AlignCenter, "ГА-ГА!")

    def paint_track(self, p, x, y, a, alpha):
        p.save()
        p.translate(x, y)
        p.rotate(math.degrees(a))
        p.scale(self.s, self.s)
        p.setPen(QPen(QColor(MUD.red(), MUD.green(), MUD.blue(), alpha), 2.2, Qt.SolidLine, Qt.RoundCap))
        for dy in (-4, 0, 4):
            p.drawLine(QPointF(-4, 0), QPointF(5, dy))
        p.restore()

    def track_region(self, x, y, a):
        # маска следа считается один раз, по пикселям (без чёрных квадратов без композитора)
        r = int(9 * self.s)
        img = QImage(2 * r, 2 * r, QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing)
        self.paint_track(p, r, r, a, 255)
        p.end()
        reg = QRegion(QBitmap.fromImage(img.createAlphaMask()))
        reg.translate(int(x) - r, int(y) - r)
        return reg

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        now = time.monotonic()
        for x, y, a, t, reg in self.tracks:
            alpha = int(200 * max(0.0, 1 - (now - t) / 14))
            self.paint_track(p, x, y, a, alpha)
        self.paint_goose(p)

    # ── мышь/касание по гусю ──
    def mousePressEvent(self, e):
        if e.button() == Qt.RightButton:
            self.menu.popup(e.globalPos())
            return
        self.held = self.pos - QPointF(e.pos())
        self.honk()
        if self.state == "drag_cursor":
            self.choose_task()

    def mouseReleaseEvent(self, e):
        if self.held is not None:
            self.held = None
            self.state, self.state_until = "idle", time.monotonic() + 1


# ───────────────────────────── меню и запуск ─────────────────────────────

def goose_pixmap(size=64):
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    k = size / 78
    p.translate(size * 0.47, size * 0.55)
    p.rotate(-35)
    draw_goose(p, k, 0, 0.5, 0.0, shadow=False)
    p.end()
    return pm


def goose_icon():
    return QIcon(goose_pixmap(64))


def build_menu(goose, settings, app):
    menu = QMenu()
    pause = QAction("Пауза", menu, checkable=True)
    pause.toggled.connect(lambda v: setattr(goose, "paused", v))
    menu.addAction(pause)
    menu.addSeparator()
    for key, title in (("sound", "Гоготать вслух"), ("cursor", "Хватать курсор"),
                       ("notes", "Приносить заметки"), ("memes", "Приносить мемы"),
                       ("mud", "Грязные лапы")):
        a = QAction(title, menu, checkable=True)
        a.setChecked(goose.on(key))
        a.toggled.connect(lambda v, k=key: settings.setValue(k, v))
        menu.addAction(a)
    menu.addSeparator()
    menu.addAction("Га!", goose.honk)
    menu.addAction("Принести заметку", lambda: start_fetch(goose, "fetch_note"))
    menu.addAction("Принести мем", lambda: start_fetch(goose, "fetch_meme"))
    menu.addAction("Убрать заметки и мемы", close_items)
    menu.addSeparator()
    menu.addAction("Прогнать гуся", app.quit)
    return menu


def start_fetch(goose, kind):
    goose.state = "walk"
    goose.choose_task()
    goose.state = kind
    x = -70 * goose.s if goose.pos.x() < goose.area.width() / 2 else goose.area.width() + 70 * goose.s
    goose.target = QPointF(x, goose.pos.y())


def close_items():
    for w in QApplication.topLevelWidgets():
        if isinstance(w, Carried):
            w.close()


def quit_running():
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        os.kill(pid, signal.SIGTERM)
        print("Гусь прогнан.")
        return 0
    except (OSError, ValueError):
        print("Гусь не найден.")
        return 1


def main():
    ap = argparse.ArgumentParser(description="Настольный гусь для МОС / Linux")
    ap.add_argument("--quit", action="store_true", help="прогнать запущенного гуся")
    ap.add_argument("--scale", type=float, help="размер гуся (1.0 — обычный)")
    ap.add_argument("--no-sound", action="store_true", help="без звука")
    ap.add_argument("--icon", metavar="PNG", help="сохранить значок гуся и выйти")
    ap.add_argument("--version", action="version", version=VERSION)
    args = ap.parse_args()
    if args.quit:
        return quit_running()
    if args.icon:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        app = QApplication(sys.argv)
        return 0 if goose_pixmap(256).save(args.icon) else 1

    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    app.setApplicationName(APP)
    app.setQuitOnLastWindowClosed(False)

    os.makedirs(CONF_DIR, exist_ok=True)
    lock = QLockFile(os.path.join(RUN_DIR, APP + ".lock"))
    if not lock.tryLock(100):
        print("Гусь уже гуляет. Прогнать: desktop-goose --quit")
        return 1
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    settings = QSettings(os.path.join(CONF_DIR, "config.ini"), QSettings.IniFormat)
    if args.scale:
        settings.setValue("scale", args.scale)
    if args.no_sound:
        settings.setValue("sound", False)

    goose = Goose(settings, Sound())
    goose.menu = build_menu(goose, settings, app)
    app.setWindowIcon(goose_icon())
    if QSystemTrayIcon.isSystemTrayAvailable():
        tray = QSystemTrayIcon(goose_icon(), app)
        tray.setToolTip("Гусь — правая кнопка по гусю или здесь")
        tray.setContextMenu(goose.menu)
        tray.show()
        goose.tray = tray
    goose.show()

    # Ctrl+C и --quit (SIGTERM) завершают аккуратно
    signal.signal(signal.SIGINT, lambda *a: app.quit())
    signal.signal(signal.SIGTERM, lambda *a: app.quit())
    alive = QTimer()
    alive.timeout.connect(lambda: None)
    alive.start(300)

    code = app.exec_()
    try:
        os.remove(PID_FILE)
    except OSError:
        pass
    return code


if __name__ == "__main__":
    sys.exit(main())
