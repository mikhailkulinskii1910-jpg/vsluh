// ===== Движок HTML-страниц (из прошивки «HTML Viewer») =====
// Вёрстка HTML: заголовки, абзацы, списки, таблицы, ссылки, якоря, базовый CSS,
// картинки JPEG и PNG, кодировки UTF-8 и windows-1251. JavaScript не выполняется.
// Всё лежит в пространстве имён hv, чтобы не пересекаться с остальной прошивкой.
#pragma once
#include <JPEGDEC.h>
#include <PNGdec.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <algorithm>
#ifndef HOST_SIM
#include <SD.h>
bool sdBegin();
#endif

namespace hv {
// ===================== Константы =====================
#define MK565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

#define SCREEN_W 320
#define SCREEN_H 480
#define BAR_H 44
#define VIEW_Y BAR_H
#define VIEW_H (SCREEN_H - BAR_H)
#define STRIP_H 32
#define PAGE_PAD 12
#define MAX_FILE_PSRAM (512 * 1024)
#define MAX_ITEMS 60000
#define MAX_FILE_NOPSRAM (96 * 1024)

#define C_BAR      MK565(18, 19, 24)
#define C_BAR_LINE MK565(48, 44, 62)
#define C_BAR_TEXT MK565(240, 240, 245)
#define C_BAR_ICON MK565(186, 140, 255)
#define C_BAR_DIM  MK565(110, 106, 130)

enum FontId : uint8_t { FN_BODY, FN_BOLD, FN_ITALIC, FN_BOLDIT, FN_MONO, FN_SMALL, FN_H3, FN_H2, FN_H1, FN_COUNT };
enum ItemType : uint8_t { DI_TEXT, DI_RECT, DI_IMG };
enum Align : uint8_t { AL_LEFT, AL_CENTER, AL_RIGHT };

// ===================== Типы =====================
// (все типы — до первой функции: так требует генератор прототипов Arduino)
struct Glyph { uint16_t cp; uint8_t w, h; int8_t xo, yo; uint8_t adv; uint32_t off; };
struct AAFont { uint8_t* bits; const Glyph* g; uint16_t n; int8_t asc, desc; const char* b64; uint32_t nbytes; };

struct Surface {
  uint16_t* px = nullptr;
  int w = 0, h = 0;
  int cx0 = 0, cy0 = 0, cx1 = 0, cy1 = 0;
};

// Элемент свёрстанной страницы
struct DItem {
  uint8_t type, font, flags, radius;  // flags: 1 — подчёркнуто, 2 — зачёркнуто
  uint16_t color;
  int16_t x, w, h;
  int32_t y;                          // текст: базовая линия; прямоугольник и картинка: верх
  uint32_t a;                         // текст: смещение в doc.text; картинка: номер в doc.imgs
  uint16_t len;
  int16_t link;
};

struct LinkBox { int16_t x, w, h; int32_t y; int16_t link; };
struct Anchor { std::string id; int32_t y; };

struct ImgEntry {
  std::string path;
  int16_t w, h, natW, natH;
  uint16_t* px;
  uint8_t state;          // 0 — не загружена, 1 — готова, 2 — ошибка
  uint8_t kind;           // 1 — JPEG, 2 — PNG
  uint32_t lastUse;
  uint16_t bg;
};

struct Doc {
  std::vector<DItem> items;
  std::string text;
  std::vector<LinkBox> boxes;
  std::vector<std::string> links;
  std::vector<Anchor> anchors;
  std::vector<ImgEntry> imgs;
  int32_t height = 0;
  uint16_t bg = 0xFFFF;
  std::string title;
  int refreshSec = 0;
  std::string refreshUrl;
  bool hasScript = false;
  bool truncated = false;
};

// Наследуемый стиль
struct Style {
  uint8_t bold, italic, mono, underline, strike, size;  // size: 0 мелкий, 1 обычный, 2..4 — h3..h1
  uint8_t align, pre, hidden;
  uint16_t color;
  int16_t link;
};

// Блочные свойства элемента из CSS
struct BoxProps {
  bool hasBg;
  uint16_t bg;
  int16_t pad, margin, radius, width;   // -1 — не задано; width < 0 в процентах: -100..-1
  bool widthPct;
};

struct Elem {
  char tag[12];
  Style st;
  bool block;
  BoxProps box;
  int itemStart;        // для фона блока
  int32_t startY;
  int16_t savedLeft, savedRight;
  int boxStart;         // для общей ссылки <a> вокруг блоков
  int listType;         // 1 — ul, 2 — ol
  int listCounter;
};

struct CssRule { std::string tag, cls, id; std::string decl; int spec; int order; };

struct Word {
  uint32_t a;
  uint16_t len;
  int16_t w;
  uint8_t font, flags;
  uint16_t color;
  int16_t link;
  bool space;
  int img;              // -1 — текст
  int16_t imgH;
};

struct CellBg { int itemIdx; int16_t x, w; uint16_t color; };

struct TableCtx {
  int ncols, col;
  int16_t x0, width, pad;
  int32_t rowTop, rowMax;
  int16_t savedLeft, savedRight;
  bool rowOpen, cellOpen, header;
  int cellItemStart;
  std::vector<CellBg> cellBgs;
  std::vector<int16_t> colEdges;
  bool cellHasBg;
  uint16_t cellBg;
  int16_t cellX, cellW;
};

struct DirEnt { std::string name; bool dir; uint32_t size; };

struct HistEntry { std::string url; int32_t scroll; };

struct TouchPt { int16_t x, y; };

// Состояние вёрстки
struct Layout {
  Doc* d;
  std::string baseDir;
  std::vector<Elem> stack;
  std::vector<CssRule> css;
  std::vector<TableCtx> tables;
  std::vector<Word> line;
  int16_t left, right;
  int32_t y;
  int pendingMargin;
  int lineW;
  uint8_t align;
  std::string marker;
  uint8_t markerFont;
  uint16_t markerColor;
  uint16_t textColor, linkColor;
  bool lastSpace;
  int cssOrder;
};

// ===================== Шрифты =====================
#include "hv_fonts.h"

AAFont* FONTS[FN_COUNT] = { &FN_BODY_F, &FN_BOLD_F, &FN_ITALIC_F, &FN_BOLDIT_F, &FN_MONO_F, &FN_SMALL_F, &FN_H3_F, &FN_H2_F, &FN_H1_F };

// ===================== Глобальное состояние =====================
Doc doc;
std::string curUrl;
std::vector<HistEntry> history;
int32_t scrollY = 0;
bool viewDirty = true, barDirty = true;
uint32_t refreshAt = 0, refreshStart = 0;
bool hasPsram = false;
size_t imgCacheLimit = 120 * 1024, imgCacheUsed = 0;
uint32_t useTick = 0;

Surface sStrip;
JPEGDEC* jpeg = nullptr;
PNG* png = nullptr;

// ===================== Платформа (реализация ниже: плата или симулятор) =====================
bool fsExists(const std::string& p);
bool fsIsDir(const std::string& p);
bool fsRead(const std::string& p, std::string& out, size_t maxLen, bool& truncated);
bool fsList(const std::string& p, std::vector<DirEnt>& out);
void* fsOpen(const char* name, int32_t* size);
void fsClose(void* h);
int32_t fsReadCb(void* h, uint8_t* buf, int32_t len);
bool fsSeek(void* h, int32_t pos);
uint32_t nowMs();

// ===================== Графика =====================
static inline uint16_t mix565(uint16_t a, uint16_t b, int t) {
  int ar = a >> 11, ag = (a >> 5) & 63, ab = a & 31;
  int br = b >> 11, bg = (b >> 5) & 63, bb = b & 31;
  return (uint16_t)(((ar + (br - ar) * t / 255) << 11) | ((ag + (bg - ag) * t / 255) << 5) | (ab + (bb - ab) * t / 255));
}
static inline float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

bool surfAlloc(Surface& s, int w, int h) {
  s.px = (uint16_t*)malloc((size_t)w * h * 2);
  s.w = w; s.h = h; s.cx0 = 0; s.cy0 = 0; s.cx1 = w; s.cy1 = h;
  return s.px != nullptr;
}
void surfSize(Surface& s, int w, int h) { s.w = w; s.h = h; s.cx0 = 0; s.cy0 = 0; s.cx1 = w; s.cy1 = h; }
void surfFill(Surface& s, uint16_t c) { for (int i = 0, n = s.w * s.h; i < n; i++) s.px[i] = c; }

static inline void blendPx(Surface& s, int x, int y, uint16_t c, int a) {
  if (a <= 0 || x < s.cx0 || x >= s.cx1 || y < s.cy0 || y >= s.cy1) return;
  uint16_t& p = s.px[y * s.w + x];
  p = a >= 255 ? c : mix565(p, c, a);
}

void fillRectS(Surface& s, int x, int y, int w, int h, uint16_t c) {
  int x0 = std::max(x, s.cx0), x1 = std::min(x + w, s.cx1), y0 = std::max(y, s.cy0), y1 = std::min(y + h, s.cy1);
  for (int yy = y0; yy < y1; yy++) {
    uint16_t* p = s.px + yy * s.w;
    for (int xx = x0; xx < x1; xx++) p[xx] = c;
  }
}

void roundRectS(Surface& s, float x, float y, float w, float h, float r, uint16_t fillC, uint16_t borderC, float bw) {
  float hx = w * 0.5f, hy = h * 0.5f, cx = x + hx, cy = y + hy;
  int x0 = std::max((int)floorf(x) - 1, s.cx0), x1 = std::min((int)ceilf(x + w) + 1, s.cx1);
  int y0 = std::max((int)floorf(y) - 1, s.cy0), y1 = std::min((int)ceilf(y + h) + 1, s.cy1);
  for (int py = y0; py < y1; py++)
    for (int px = x0; px < x1; px++) {
      float qx = fabsf(px + 0.5f - cx) - (hx - r), qy = fabsf(py + 0.5f - cy) - (hy - r);
      float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
      float d = sqrtf(ox * ox + oy * oy) + fminf(fmaxf(qx, qy), 0.0f) - r;
      float outer = clamp01(0.5f - d);
      if (outer <= 0) continue;
      if (bw > 0) {
        blendPx(s, px, py, borderC, (int)(outer * 255));
        float inner = clamp01(0.5f - (d + bw));
        if (inner > 0) blendPx(s, px, py, fillC, (int)(inner * 255));
      } else {
        blendPx(s, px, py, fillC, (int)(outer * 255));
      }
    }
}

void capsuleS(Surface& s, float ax, float ay, float bx, float by, float r, uint16_t c) {
  int x0 = (int)floorf(fminf(ax, bx) - r - 1), x1 = (int)ceilf(fmaxf(ax, bx) + r + 1);
  int y0 = (int)floorf(fminf(ay, by) - r - 1), y1 = (int)ceilf(fmaxf(ay, by) + r + 1);
  float bax = bx - ax, bay = by - ay, bb = bax * bax + bay * bay;
  for (int py = y0; py < y1; py++)
    for (int px = x0; px < x1; px++) {
      float pax = px + 0.5f - ax, pay = py + 0.5f - ay;
      float t = bb > 0 ? clamp01((pax * bax + pay * bay) / bb) : 0;
      float dx = pax - bax * t, dy = pay - bay * t;
      blendPx(s, px, py, c, (int)(clamp01(0.5f - (sqrtf(dx * dx + dy * dy) - r)) * 255));
    }
}

// Дуга кольца (углы в градусах, 0 — вправо, против часовой, ось y вниз)
void arcS(Surface& s, float cx, float cy, float r, float th, float a0, float a1, uint16_t c) {
  for (int py = (int)(cy - r - th); py <= (int)(cy + r + th); py++)
    for (int px = (int)(cx - r - th); px <= (int)(cx + r + th); px++) {
      float dx = px + 0.5f - cx, dy = cy - (py + 0.5f);
      float ang = atan2f(dy, dx) * 57.29578f;
      if (ang < a0 || ang > a1) continue;
      float d = fabsf(sqrtf(dx * dx + dy * dy) - r) - th * 0.5f;
      blendPx(s, px, py, c, (int)(clamp01(0.5f - d) * 255));
    }
}

// ===================== Текст =====================
static int b64v(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

bool decodeFont(AAFont& f) {
  f.bits = (uint8_t*)malloc(f.nbytes);
  if (!f.bits) return false;
  uint32_t o = 0, acc = 0;
  int bits = 0;
  for (const char* p = f.b64; *p && o < f.nbytes; p++) {
    int v = b64v(*p);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; f.bits[o++] = (acc >> bits) & 0xFF; }
  }
  return o == f.nbytes;
}

static uint32_t utf8At(const char*& s, const char* end) {
  uint8_t c = (uint8_t)*s++;
  if (c < 0x80) return c;
  if ((c & 0xE0) == 0xC0 && s < end) return ((c & 0x1F) << 6) | (*s++ & 0x3F);
  if ((c & 0xF0) == 0xE0 && s + 1 < end) {
    uint32_t r = ((c & 0x0F) << 12) | ((s[0] & 0x3F) << 6) | (s[1] & 0x3F);
    s += 2;
    return r;
  }
  if ((c & 0xF8) == 0xF0 && s + 2 < end) { s += 3; return 0xFFFD; }
  return 0xFFFD;
}

void putUtf8(std::string& out, uint32_t cp) {
  if (cp < 0x80) out += (char)cp;
  else if (cp < 0x800) { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
  else if (cp < 0x10000) { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
  else out += "?";
}

const Glyph* findGlyphIn(const AAFont& f, uint32_t cp) {
  int lo = 0, hi = f.n - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    uint16_t c = f.g[mid].cp;
    if (c == cp) return &f.g[mid];
    if (c < cp) lo = mid + 1; else hi = mid - 1;
  }
  return nullptr;
}

// Глиф с заменами: неразрывный пробел → пробел, похожие символы, иначе «□»
const Glyph* glyphFor(const AAFont& f, uint32_t cp, const AAFont** used) {
  *used = &f;
  if (cp == 0xA0 || cp == 0x2009 || cp == 0x202F || cp == 0x2002 || cp == 0x2003) cp = ' ';
  else if (cp == 0x2010 || cp == 0x2011) cp = '-';
  else if (cp == 0x2012 || cp == 0x2015) cp = 0x2013;
  else if (cp == 0x2022 || cp == 0x25CF) cp = 0x2022;
  const Glyph* g = findGlyphIn(f, cp);
  if (g) return g;
  g = findGlyphIn(*FONTS[FN_BODY], cp);
  if (g) { *used = FONTS[FN_BODY]; return g; }
  g = findGlyphIn(f, 0x25A1);
  return g ? g : findGlyphIn(f, '?');
}

int textWN(const AAFont& f, const char* s, int len) {
  const char* end = s + len;
  int w = 0;
  while (s < end) {
    const AAFont* u;
    const Glyph* g = glyphFor(f, utf8At(s, end), &u);
    if (g) w += g->adv;
  }
  return w;
}
int textW(const AAFont& f, const char* s) { return textWN(f, s, strlen(s)); }

int drawTextN(Surface& s, const AAFont& f, int x, int base, const char* str, int len, uint16_t col) {
  const char* end = str + len;
  while (str < end) {
    const AAFont* u;
    const Glyph* g = glyphFor(f, utf8At(str, end), &u);
    if (!g) continue;
    int gx = x + g->xo, gy = base + g->yo;
    if (gx + g->w > s.cx0 && gx < s.cx1 && gy + g->h > s.cy0 && gy < s.cy1) {
      for (int yy = 0; yy < g->h; yy++) {
        int py = gy + yy;
        if (py < s.cy0 || py >= s.cy1) continue;
        for (int xx = 0; xx < g->w; xx++) {
          uint32_t idx = g->off + yy * g->w + xx;
          uint8_t b = u->bits[idx >> 1];
          int a = (idx & 1) ? (b & 15) : (b >> 4);
          if (a) blendPx(s, gx + xx, py, col, a * 17);
        }
      }
    }
    x += g->adv;
  }
  return x;
}
int drawText(Surface& s, const AAFont& f, int x, int base, const char* str, uint16_t col) {
  return drawTextN(s, f, x, base, str, strlen(str), col);
}

// ===================== Строки и пути =====================
static char lowerc(char c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }

std::string lower(const std::string& s) {
  std::string r = s;
  for (auto& c : r) c = lowerc(c);
  return r;
}

std::string trim(const std::string& s) {
  size_t a = 0, b = s.size();
  while (a < b && (unsigned char)s[a] <= ' ') a++;
  while (b > a && (unsigned char)s[b - 1] <= ' ') b--;
  return s.substr(a, b - a);
}

bool endsWith(const std::string& s, const char* suf) {
  size_t n = strlen(suf);
  return s.size() >= n && lower(s.substr(s.size() - n)) == suf;
}

std::string dirOf(const std::string& path) {
  size_t p = path.rfind('/');
  return p == std::string::npos ? "/" : path.substr(0, p + 1);
}

std::string fileName(const std::string& path) {
  size_t p = path.rfind('/');
  return p == std::string::npos ? path : path.substr(p + 1);
}

// Склеивает относительный путь с папкой страницы и убирает ./ и ../
std::string resolvePath(const std::string& base, const std::string& rel) {
  std::string p = (!rel.empty() && rel[0] == '/') ? rel : base + rel;
  std::vector<std::string> parts;
  size_t i = 0;
  while (i <= p.size()) {
    size_t j = p.find('/', i);
    if (j == std::string::npos) j = p.size();
    std::string seg = p.substr(i, j - i);
    if (seg == "..") { if (!parts.empty()) parts.pop_back(); }
    else if (!seg.empty() && seg != ".") parts.push_back(seg);
    i = j + 1;
  }
  std::string r;
  for (auto& s : parts) r += "/" + s;
  if (r.empty()) r = "/";
  if (p.size() > 1 && p.back() == '/' && r != "/") r += "/";
  return r;
}

// %20 и подобное в ссылках
std::string urlDecode(const std::string& s) {
  std::string r;
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == '%' && i + 2 < s.size() && isxdigit((unsigned char)s[i + 1]) && isxdigit((unsigned char)s[i + 2])) {
      r += (char)strtol(s.substr(i + 1, 2).c_str(), nullptr, 16);
      i += 2;
    } else {
      r += s[i];
    }
  }
  return r;
}

std::string fmtSize(uint32_t b) {
  char t[32];
  if (b < 1024) snprintf(t, sizeof t, "%u Б", (unsigned)b);
  else if (b < 1024 * 1024) snprintf(t, sizeof t, "%.1f КБ", b / 1024.0);
  else snprintf(t, sizeof t, "%.1f МБ", b / 1048576.0);
  for (char* p = t; *p; p++) if (*p == '.') *p = ',';
  return t;
}

std::string htmlEscape(const std::string& s) {
  std::string r;
  for (char c : s) {
    if (c == '<') r += "&lt;";
    else if (c == '>') r += "&gt;";
    else if (c == '&') r += "&amp;";
    else if (c == '"') r += "&quot;";
    else r += c;
  }
  return r;
}

// windows-1251 → UTF-8 (старые русские страницы)
static const uint16_t CP1251_HI[64] = {
  0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021, 0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
  0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x0000, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
  0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7, 0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
  0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7, 0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457,
};

bool looksUtf8(const std::string& s) {
  size_t bad = 0, multi = 0, i = 0, n = s.size();
  while (i < n) {
    uint8_t c = s[i];
    if (c < 0x80) { i++; continue; }
    int k = (c & 0xE0) == 0xC0 ? 1 : (c & 0xF0) == 0xE0 ? 2 : (c & 0xF8) == 0xF0 ? 3 : -1;
    bool ok = k > 0 && i + k < n;
    for (int j = 1; ok && j <= k; j++) ok = ((uint8_t)s[i + j] & 0xC0) == 0x80;
    if (ok) { multi++; i += k + 1; }
    else { bad++; i++; }
  }
  return bad == 0 || multi > bad * 20;
}

// Кодировка из <meta charset="..."> или <meta http-equiv content="...; charset=...">
std::string declaredCharset(const std::string& html) {
  std::string head = lower(html.substr(0, 4096));
  size_t p = 0;
  while ((p = head.find("<meta", p)) != std::string::npos) {
    size_t e = head.find('>', p);
    if (e == std::string::npos) break;
    std::string tag = head.substr(p, e - p);
    size_t c = tag.find("charset");
    if (c != std::string::npos) {
      size_t i = c + 7;
      while (i < tag.size() && (tag[i] == ' ' || tag[i] == '=' || tag[i] == '"' || tag[i] == '\'')) i++;
      size_t j = i;
      while (j < tag.size() && (isalnum((unsigned char)tag[j]) || tag[j] == '-' || tag[j] == '_')) j++;
      return tag.substr(i, j - i);
    }
    p = e;
  }
  return "";
}

void cp1251ToUtf8(std::string& s) {
  std::string r;
  r.reserve(s.size() * 2);
  for (unsigned char c : s) {
    if (c < 0x80) r += (char)c;
    else if (c >= 0xC0) putUtf8(r, 0x0410 + (c - 0xC0));
    else { uint16_t u = CP1251_HI[c - 0x80]; putUtf8(r, u ? u : '?'); }
  }
  s.swap(r);
}

// ===================== Цвета и CSS =====================
struct NamedColor { const char* n; uint32_t rgb; };
static const NamedColor COLORS[] = {
  {"black", 0x000000}, {"white", 0xFFFFFF}, {"red", 0xFF0000}, {"green", 0x008000}, {"blue", 0x0000FF},
  {"gray", 0x808080}, {"grey", 0x808080}, {"silver", 0xC0C0C0}, {"maroon", 0x800000}, {"purple", 0x800080},
  {"fuchsia", 0xFF00FF}, {"magenta", 0xFF00FF}, {"lime", 0x00FF00}, {"olive", 0x808000}, {"navy", 0x000080},
  {"teal", 0x008080}, {"aqua", 0x00FFFF}, {"cyan", 0x00FFFF}, {"yellow", 0xFFFF00}, {"orange", 0xFFA500},
  {"pink", 0xFFC0CB}, {"brown", 0xA52A2A}, {"gold", 0xFFD700}, {"darkgray", 0xA9A9A9}, {"darkgrey", 0xA9A9A9},
  {"lightgray", 0xD3D3D3}, {"lightgrey", 0xD3D3D3}, {"darkblue", 0x00008B}, {"darkred", 0x8B0000},
  {"darkgreen", 0x006400}, {"crimson", 0xDC143C}, {"coral", 0xFF7F50}, {"indigo", 0x4B0082}, {"violet", 0xEE82EE},
  {"tomato", 0xFF6347}, {"skyblue", 0x87CEEB}, {"steelblue", 0x4682B4}, {"beige", 0xF5F5DC}, {"ivory", 0xFFFFF0},
  {"lavender", 0xE6E6FA}, {"salmon", 0xFA8072}, {"khaki", 0xF0E68C}, {"orangered", 0xFF4500}, {"royalblue", 0x4169E1},
  {"dodgerblue", 0x1E90FF}, {"slategray", 0x708090}, {"whitesmoke", 0xF5F5F5}, {"gainsboro", 0xDCDCDC},
  {"lightblue", 0xADD8E6}, {"lightgreen", 0x90EE90}, {"lightyellow", 0xFFFFE0}, {"darkorange", 0xFF8C00},
  {"chocolate", 0xD2691E}, {"tan", 0xD2B48C}, {"turquoise", 0x40E0D0}, {"seagreen", 0x2E8B57}, {"firebrick", 0xB22222},
};

bool parseColor(const std::string& v0, uint16_t& out) {
  std::string v = lower(trim(v0));
  uint32_t rgb;
  if (v.empty() || v == "transparent" || v == "inherit" || v == "none") return false;
  if (v[0] == '#') {
    std::string h = v.substr(1);
    for (char c : h) if (!isxdigit((unsigned char)c)) return false;
    if (h.size() == 3 || h.size() == 4) {
      unsigned r = strtoul(h.substr(0, 1).c_str(), nullptr, 16), g = strtoul(h.substr(1, 1).c_str(), nullptr, 16), b = strtoul(h.substr(2, 1).c_str(), nullptr, 16);
      rgb = (r * 17 << 16) | (g * 17 << 8) | (b * 17);
    } else if (h.size() == 6 || h.size() == 8) {
      rgb = strtoul(h.substr(0, 6).c_str(), nullptr, 16);
    } else return false;
  } else if (v.compare(0, 3, "rgb") == 0) {
    size_t a = v.find('(');
    if (a == std::string::npos) return false;
    int c[3] = { 0, 0, 0 };
    const char* p = v.c_str() + a + 1;
    for (int i = 0; i < 3; i++) {
      while (*p == ' ' || *p == ',') p++;
      char* e;
      double x = strtod(p, &e);
      if (e == p) return false;
      if (*e == '%') { x = x * 2.55; e++; }
      c[i] = (int)std::max(0.0, std::min(255.0, x));
      p = e;
    }
    rgb = (c[0] << 16) | (c[1] << 8) | c[2];
  } else {
    bool found = false;
    for (auto& nc : COLORS) if (v == nc.n) { rgb = nc.rgb; found = true; break; }
    if (!found) return false;
  }
  out = MK565((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  return true;
}

int parsePx(const std::string& v0, int base, bool* pct) {
  std::string v = lower(trim(v0));
  if (pct) *pct = false;
  if (v.empty()) return -1;
  char* e;
  double x = strtod(v.c_str(), &e);
  if (e == v.c_str()) return -1;
  std::string unit = trim(e);
  if (unit == "%") { if (pct) *pct = true; return (int)x; }
  if (unit == "em" || unit == "rem") return (int)(x * base);
  if (unit == "pt") return (int)(x * 4 / 3);
  return (int)x;
}

uint8_t sizeLevelFromPx(int px) {
  if (px <= 13) return 0;
  if (px <= 17) return 1;
  if (px <= 21) return 2;
  if (px <= 25) return 3;
  return 4;
}

// Применяет объявления CSS «a: b; c: d» к стилю и блочным свойствам
void applyDecl(const std::string& decl, Style& st, BoxProps& bx) {
  size_t i = 0;
  while (i < decl.size()) {
    size_t semi = decl.find(';', i);
    if (semi == std::string::npos) semi = decl.size();
    std::string d = decl.substr(i, semi - i);
    i = semi + 1;
    size_t colon = d.find(':');
    if (colon == std::string::npos) continue;
    std::string k = lower(trim(d.substr(0, colon))), v = trim(d.substr(colon + 1));
    size_t imp = lower(v).find("!important");
    if (imp != std::string::npos) v = trim(v.substr(0, imp));
    std::string lv = lower(v);
    uint16_t c;
    if (k == "color") { if (parseColor(v, c)) st.color = c; }
    else if (k == "background-color" || k == "background") {
      std::string first = v;
      if (k == "background") {  // первый токен, похожий на цвет
        size_t sp = 0;
        std::string tok;
        bool ok = false;
        while (sp <= v.size()) {
          size_t e = v.find(' ', sp);
          if (e == std::string::npos) e = v.size();
          tok = v.substr(sp, e - sp);
          if (parseColor(tok, c)) { ok = true; break; }
          sp = e + 1;
        }
        if (ok) { bx.hasBg = true; bx.bg = c; }
      } else if (parseColor(first, c)) { bx.hasBg = true; bx.bg = c; }
    }
    else if (k == "text-align") st.align = lv == "center" ? AL_CENTER : lv == "right" ? AL_RIGHT : AL_LEFT;
    else if (k == "font-weight") st.bold = (lv == "bold" || lv == "bolder" || atoi(lv.c_str()) >= 600) ? 1 : 0;
    else if (k == "font-style") st.italic = (lv == "italic" || lv == "oblique") ? 1 : 0;
    else if (k == "text-decoration" || k == "text-decoration-line") {
      st.underline = lv.find("underline") != std::string::npos;
      st.strike = lv.find("line-through") != std::string::npos;
    }
    else if (k == "font-size") {
      if (lv == "small" || lv == "x-small" || lv == "xx-small" || lv == "smaller") st.size = 0;
      else if (lv == "medium") st.size = 1;
      else if (lv == "large" || lv == "larger") st.size = 2;
      else if (lv == "x-large") st.size = 3;
      else if (lv == "xx-large" || lv == "xxx-large") st.size = 4;
      else {
        bool pct;
        int px = parsePx(v, 16, &pct);
        if (pct) px = 16 * px / 100;
        if (px > 0) st.size = sizeLevelFromPx(px);
      }
    }
    else if (k == "font-family") { if (lv.find("mono") != std::string::npos || lv.find("courier") != std::string::npos || lv.find("consol") != std::string::npos) st.mono = 1; }
    else if (k == "display") { if (lv == "none") st.hidden = 1; }
    else if (k == "visibility") { if (lv == "hidden") st.hidden = 1; }
    else if (k == "white-space") st.pre = (lv.compare(0, 3, "pre") == 0) ? 1 : 0;
    else if (k == "padding") bx.pad = parsePx(v, 16, nullptr);
    else if (k == "margin") { int m = parsePx(v, 16, nullptr); if (m >= 0) bx.margin = m; }
    else if (k == "border-radius") bx.radius = parsePx(v, 16, nullptr);
    else if (k == "width") { bool pct; int w = parsePx(v, 16, &pct); if (w > 0) { bx.width = w; bx.widthPct = pct; } }
  }
}

void parseCss(Layout& L, const std::string& css) {
  size_t i = 0;
  while (i < css.size()) {
    size_t ob = css.find('{', i);
    if (ob == std::string::npos) break;
    size_t cb = css.find('}', ob);
    if (cb == std::string::npos) break;
    std::string sels = css.substr(i, ob - i), decl = css.substr(ob + 1, cb - ob - 1);
    i = cb + 1;
    // комментарии и @media пропускаем целиком
    size_t cm;
    while ((cm = sels.find("/*")) != std::string::npos) {
      size_t ce = sels.find("*/", cm);
      sels.erase(cm, ce == std::string::npos ? std::string::npos : ce + 2 - cm);
    }
    if (trim(sels).compare(0, 1, "@") == 0) {
      if (sels.find("@media") != std::string::npos) {  // пропускаем вложенный блок
        int depth = 1;
        size_t j = ob + 1;
        while (j < css.size() && depth) { if (css[j] == '{') depth++; else if (css[j] == '}') depth--; j++; }
        i = j;
      }
      continue;
    }
    size_t s = 0;
    while (s <= sels.size()) {
      size_t e = sels.find(',', s);
      if (e == std::string::npos) e = sels.size();
      std::string sel = trim(sels.substr(s, e - s));
      s = e + 1;
      if (sel.empty() || sel.find(':') != std::string::npos || sel.find('[') != std::string::npos) continue;
      size_t sp = sel.find_last_of(" >+~");  // для «div p» берём последний простой селектор
      if (sp != std::string::npos) sel = sel.substr(sp + 1);
      CssRule r;
      r.spec = 0;
      size_t k = 0;
      std::string cur;
      char mode = 't';
      auto flush = [&]() {
        if (cur.empty()) return;
        if (mode == 't') { r.tag = lower(cur); r.spec += 1; }
        else if (mode == '.') { r.cls = cur; r.spec += 10; }
        else { r.id = cur; r.spec += 100; }
        cur.clear();
      };
      for (; k < sel.size(); k++) {
        char c = sel[k];
        if (c == '.' || c == '#') { flush(); mode = c; }
        else cur += c;
      }
      flush();
      if (r.tag == "*") r.tag.clear();
      r.decl = decl;
      r.order = L.cssOrder++;
      L.css.push_back(r);
    }
  }
}

// ===================== Разбор тегов =====================
struct Attr { std::string k, v; };

// Разбирает «<tag a="b" c=d e>» начиная с p (после '<'). Возвращает позицию после '>'
size_t parseTag(const std::string& h, size_t p, std::string& name, bool& closing, bool& selfClose, std::vector<Attr>& attrs) {
  size_t n = h.size();
  closing = false; selfClose = false; name.clear(); attrs.clear();
  if (p < n && h[p] == '/') { closing = true; p++; }
  while (p < n && (isalnum((unsigned char)h[p]) || h[p] == '-' || h[p] == ':' || h[p] == '!')) name += lowerc(h[p++]);
  while (p < n && h[p] != '>') {
    while (p < n && isspace((unsigned char)h[p])) p++;
    if (p < n && h[p] == '/') { selfClose = true; p++; continue; }
    if (p >= n || h[p] == '>') break;
    std::string k, v;
    while (p < n && !isspace((unsigned char)h[p]) && h[p] != '=' && h[p] != '>' && h[p] != '/') k += lowerc(h[p++]);
    while (p < n && isspace((unsigned char)h[p])) p++;
    if (p < n && h[p] == '=') {
      p++;
      while (p < n && isspace((unsigned char)h[p])) p++;
      if (p < n && (h[p] == '"' || h[p] == '\'')) {
        char q = h[p++];
        size_t e = h.find(q, p);
        if (e == std::string::npos) e = n;
        v = h.substr(p, e - p);
        p = e + 1;
      } else {
        while (p < n && !isspace((unsigned char)h[p]) && h[p] != '>') v += h[p++];
      }
    }
    if (!k.empty()) attrs.push_back({ k, v });
    else if (p < n && h[p] != '>') p++;
  }
  return p < n ? p + 1 : n;
}

const std::string* getAttr(const std::vector<Attr>& a, const char* k) {
  for (auto& x : a) if (x.k == k) return &x.v;
  return nullptr;
}

static const char* const VOID_TAGS[] = { "br", "hr", "img", "meta", "link", "input", "area", "base", "col", "embed", "source", "wbr", "param", "track", nullptr };
static const char* const BLOCK_TAGS[] = { "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "tr", "td", "th",
  "center", "section", "article", "header", "footer", "nav", "main", "aside", "figure", "figcaption", "dl", "dt", "dd", "form", "address", "body", "html",
  "details", "summary", "fieldset", "legend", "hgroup", "caption", "tbody", "thead", "tfoot", nullptr };

bool inList(const char* const* list, const std::string& s) {
  for (int i = 0; list[i]; i++) if (s == list[i]) return true;
  return false;
}

// Сущности: &amp; &nbsp; &#1234; &#x41; и самые частые именованные
struct Ent { const char* n; uint16_t cp; };
static const Ent ENTS[] = {
  {"amp", '&'}, {"lt", '<'}, {"gt", '>'}, {"quot", '"'}, {"apos", '\''}, {"nbsp", 0xA0}, {"copy", 0xA9}, {"reg", 0xAE},
  {"trade", 0x2122}, {"mdash", 0x2014}, {"ndash", 0x2013}, {"hellip", 0x2026}, {"laquo", 0xAB}, {"raquo", 0xBB},
  {"bull", 0x2022}, {"middot", 0xB7}, {"deg", 0xB0}, {"plusmn", 0xB1}, {"times", 0xD7}, {"divide", 0xF7},
  {"euro", 0x20AC}, {"rarr", 0x2192}, {"larr", 0x2190}, {"uarr", 0x2191}, {"darr", 0x2193}, {"ldquo", 0x201C},
  {"rdquo", 0x201D}, {"bdquo", 0x201E}, {"lsquo", 0x2018}, {"rsquo", 0x2019}, {"minus", 0x2212}, {"sect", 0xA7},
  {"para", 0xB6}, {"frac12", 0xBD}, {"frac14", 0xBC}, {"frac34", 0xBE}, {"sup2", 0xB2}, {"sup3", 0xB3},
  {"thinsp", 0x2009}, {"ensp", 0x2002}, {"emsp", 0x2003}, {"shy", 0xAD}, {"numero", 0x2116},
};

void decodeText(const std::string& h, size_t a, size_t b, std::string& out) {
  for (size_t i = a; i < b; i++) {
    char c = h[i];
    if (c != '&') { out += c; continue; }
    size_t semi = h.find(';', i);
    if (semi == std::string::npos || semi > b || semi - i > 10) { out += c; continue; }
    std::string name = h.substr(i + 1, semi - i - 1);
    uint32_t cp = 0;
    if (!name.empty() && name[0] == '#') {
      cp = (name.size() > 1 && (name[1] == 'x' || name[1] == 'X')) ? strtoul(name.c_str() + 2, nullptr, 16) : strtoul(name.c_str() + 1, nullptr, 10);
    } else {
      for (auto& e : ENTS) if (name == e.n) { cp = e.cp; break; }
    }
    if (!cp) { out += c; continue; }
    if (cp != 0xAD) putUtf8(out, cp);  // мягкий перенос не показываем
    i = semi;
  }
}

// ===================== Вёрстка =====================
uint8_t fontOf(const Style& s) {
  if (s.mono) return FN_MONO;
  if (s.size == 0) return FN_SMALL;
  if (s.size == 2) return FN_H3;
  if (s.size == 3) return FN_H2;
  if (s.size == 4) return FN_H1;
  if (s.bold && s.italic) return FN_BOLDIT;
  if (s.bold) return FN_BOLD;
  if (s.italic) return FN_ITALIC;
  return FN_BODY;
}

Style& curStyle(Layout& L) { return L.stack.back().st; }

void applyPendingMargin(Layout& L) {
  if (L.pendingMargin > 0 && L.y > PAGE_PAD) L.y += L.pendingMargin;
  L.pendingMargin = 0;
}

void addItem(Layout& L, const DItem& it) {
  if (L.d->items.size() >= MAX_ITEMS) { L.d->truncated = true; return; }  // защита памяти на огромных страницах
  L.d->items.push_back(it);
}

void addRect(Layout& L, int x, int32_t y, int w, int h, uint16_t c, int radius) {
  DItem it;
  memset(&it, 0, sizeof it);
  it.type = DI_RECT; it.x = x; it.y = y; it.w = w; it.h = h; it.color = c; it.radius = radius; it.link = -1;
  addItem(L, it);
}

void insertRect(Layout& L, int idx, int x, int32_t y, int w, int h, uint16_t c, int radius) {
  DItem it;
  memset(&it, 0, sizeof it);
  it.type = DI_RECT; it.x = x; it.y = y; it.w = w; it.h = h; it.color = c; it.radius = radius; it.link = -1;
  if (idx > (int)L.d->items.size()) idx = L.d->items.size();
  L.d->items.insert(L.d->items.begin() + idx, it);
}

int lineHeightOf(uint8_t f) { return FONTS[f]->asc + FONTS[f]->desc; }

// Выводит накопленную строку с выравниванием
void flushLine(Layout& L, bool forceEmpty) {
  if (L.line.empty()) {
    if (forceEmpty) {
      applyPendingMargin(L);
      L.y += lineHeightOf(fontOf(curStyle(L))) + 2;
    }
    return;
  }
  applyPendingMargin(L);
  int asc = 0, desc = 0;
  for (auto& w : L.line) {
    if (w.img >= 0) { asc = std::max<int>(asc, w.imgH); }
    else { asc = std::max<int>(asc, FONTS[w.font]->asc); desc = std::max<int>(desc, FONTS[w.font]->desc); }
  }
  int avail = L.right - L.left;
  int x = L.left;
  if (L.align == AL_CENTER) x += (avail - L.lineW) / 2;
  else if (L.align == AL_RIGHT) x += avail - L.lineW;
  if (x < L.left) x = L.left;
  int32_t base = L.y + asc;
  if (!L.marker.empty()) {
    const AAFont& mf = *FONTS[L.markerFont];
    int mw = textW(mf, L.marker.c_str());
    DItem it;
    memset(&it, 0, sizeof it);
    it.type = DI_TEXT; it.font = L.markerFont; it.color = L.markerColor;
    it.x = L.left - mw - 6; it.y = base; it.w = mw; it.a = L.d->text.size(); it.len = L.marker.size(); it.link = -1;
    L.d->text += L.marker;
    addItem(L, it);
    L.marker.clear();
  }
  bool first = true;
  int prevLink = -1;
  for (auto& w : L.line) {
    int sp = (w.space && !first) ? FONTS[w.font]->asc / 4 + 1 : 0;
    if (w.space && !first) {
      const AAFont* u;
      const Glyph* g = glyphFor(*FONTS[w.font], ' ', &u);
      sp = g ? g->adv : 4;
    }
    if (sp && (w.flags & 1) && prevLink >= 0 && prevLink == w.link) {  // подчёркивание ссылки не рвётся на пробелах
      DItem u;
      memset(&u, 0, sizeof u);
      u.type = DI_RECT; u.x = x; u.y = base + 2; u.w = sp; u.h = 1; u.color = w.color; u.link = -1;
      addItem(L, u);
    }
    prevLink = (w.img < 0 && (w.flags & 1)) ? w.link : -1;
    x += sp;
    DItem it;
    memset(&it, 0, sizeof it);
    it.link = w.link;
    if (w.img >= 0) {
      it.type = DI_IMG; it.x = x; it.y = base - w.imgH; it.w = w.w; it.h = w.imgH; it.a = w.img;
    } else {
      it.type = DI_TEXT; it.font = w.font; it.color = w.color; it.flags = w.flags;
      it.x = x; it.y = base; it.w = w.w; it.a = w.a; it.len = w.len;
    }
    addItem(L, it);
    if (w.link >= 0) {  // область ссылки, включая пробел перед словом
      int32_t top = it.type == DI_IMG ? it.y : base - FONTS[w.font]->asc;
      int h = it.type == DI_IMG ? it.h : FONTS[w.font]->asc + FONTS[w.font]->desc;
      L.d->boxes.push_back({ (int16_t)(x - sp), (int16_t)(w.w + sp), (int16_t)h, top, w.link });
    }
    x += w.w;
    first = false;
  }
  L.y = base + desc + 3;
  L.line.clear();
  L.lineW = 0;
}

void addWord(Layout& L, Word w) {
  int avail = L.right - L.left;
  int sp = 0;
  if (w.space && !L.line.empty()) {
    const AAFont* u;
    const Glyph* g = glyphFor(*FONTS[w.font], ' ', &u);
    sp = g ? g->adv : 4;
  }
  if (!L.line.empty() && L.lineW + sp + w.w > avail) {
    flushLine(L, false);
    sp = 0;
  }
  if (L.line.empty()) w.space = false;
  L.line.push_back(w);
  L.lineW += sp + w.w;
}

// Слово длиннее строки режем по символам
void addTextWord(Layout& L, const char* s, int len, bool space) {
  const Style& st = curStyle(L);
  uint8_t f = fontOf(st);
  const AAFont& font = *FONTS[f];
  int avail = L.right - L.left;
  while (len > 0) {
    int w = textWN(font, s, len), take = len;
    if (w > avail) {  // сколько символов влезет
      const char* p = s;
      const char* end = s + len;
      int acc = 0;
      while (p < end) {
        const char* q = p;
        uint32_t cp = utf8At(q, end);
        const AAFont* u;
        const Glyph* g = glyphFor(font, cp, &u);
        int adv = g ? g->adv : 0;
        if (acc + adv > avail && p > s) break;
        acc += adv;
        p = q;
      }
      take = p - s;
      w = acc;
    }
    Word wd;
    wd.a = L.d->text.size();
    wd.len = take;
    wd.w = w;
    wd.font = f;
    wd.flags = (st.underline ? 1 : 0) | (st.strike ? 2 : 0);
    wd.color = st.color;
    wd.link = st.link;
    wd.space = space;
    wd.img = -1;
    wd.imgH = 0;
    L.d->text.append(s, take);
    addWord(L, wd);
    s += take;
    len -= take;
    space = false;
  }
}

void addText(Layout& L, const std::string& t) {
  const Style& st = curStyle(L);
  if (st.hidden) return;
  if (st.pre) {  // сохраняем пробелы и переводы строк, длинные строки переносим
    size_t i = 0;
    while (i <= t.size()) {
      size_t nl = t.find('\n', i);
      if (nl == std::string::npos) nl = t.size();
      std::string seg = t.substr(i, nl - i);
      std::string out;
      for (char c : seg) { if (c == '\t') out += "    "; else if (c != '\r') out += c; }
      size_t k = 0;
      while (k < out.size()) {  // режем по пробелам, сами пробелы оставляем в словах
        size_t e = out.find(' ', k);
        if (e == std::string::npos) e = out.size(); else e++;
        addTextWord(L, out.c_str() + k, e - k, false);
        k = e;
      }
      if (nl < t.size()) flushLine(L, true);
      i = nl + 1;
    }
    return;
  }
  size_t i = 0, n = t.size();
  while (i < n) {
    bool space = false;
    while (i < n && (t[i] == ' ' || t[i] == '\n' || t[i] == '\t' || t[i] == '\r')) { space = true; i++; }
    if (i >= n) { if (space) L.lastSpace = true; break; }
    size_t j = i;
    while (j < n && t[j] != ' ' && t[j] != '\n' && t[j] != '\t' && t[j] != '\r') j++;
    addTextWord(L, t.c_str() + i, j - i, space || L.lastSpace);
    L.lastSpace = false;
    i = j;
  }
}

// ---------- Картинки ----------
int imgKind(const std::string& path) {
  if (endsWith(path, ".jpg") || endsWith(path, ".jpeg")) return 1;
  if (endsWith(path, ".png")) return 2;
  return 0;
}

// Размер картинки по заголовку файла (быстро, без декодирования)
bool probeImage(const std::string& path, int kind, int& w, int& h) {
  int32_t size;
  void* f = fsOpen(path.c_str(), &size);
  if (!f) return false;
  uint8_t b[64];
  bool ok = false;
  if (kind == 2) {
    if (fsReadCb(f, b, 24) == 24 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
      w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
      h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
      ok = true;
    }
  } else if (kind == 1) {
    int32_t pos = 2;
    if (fsReadCb(f, b, 2) == 2 && b[0] == 0xFF && b[1] == 0xD8) {
      while (pos < size) {
        if (fsReadCb(f, b, 4) != 4 || b[0] != 0xFF) break;
        int marker = b[1], len = (b[2] << 8) | b[3];
        if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
          if (fsReadCb(f, b, 5) == 5) { h = (b[1] << 8) | b[2]; w = (b[3] << 8) | b[4]; ok = true; }
          break;
        }
        pos += 2 + len;
        fsSeek(f, pos);
      }
    }
  }
  fsClose(f);
  return ok && w > 0 && h > 0;
}

void addImage(Layout& L, const std::vector<Attr>& attrs) {
  const std::string* src = getAttr(attrs, "src");
  const std::string* alt = getAttr(attrs, "alt");
  std::string path = src ? resolvePath(L.baseDir, urlDecode(*src)) : "";
  int kind = imgKind(path), nw = 0, nh = 0;
  bool ok = src && kind && fsExists(path) && probeImage(path, kind, nw, nh);
  if (!ok) {  // вместо картинки — её описание
    std::string t = "[" + (alt && !alt->empty() ? *alt : std::string("картинка")) + "]";
    Style saved = curStyle(L);
    curStyle(L).italic = 1;
    curStyle(L).color = MK565(140, 140, 150);
    addText(L, " " + t + " ");
    curStyle(L) = saved;
    return;
  }
  int w = nw, h = nh;
  BoxProps bx = { false, 0, -1, -1, -1, -1, false };
  Style tmp = curStyle(L);
  const std::string* style = getAttr(attrs, "style");
  if (style) applyDecl(*style, tmp, bx);
  int avail = L.right - L.left;
  const std::string* aw = getAttr(attrs, "width");
  const std::string* ah = getAttr(attrs, "height");
  bool pct = false;
  int ww = bx.width > 0 ? bx.width : (aw ? parsePx(*aw, 16, &pct) : -1);
  if (bx.width > 0) pct = bx.widthPct;
  int hh = ah ? parsePx(*ah, 16, nullptr) : -1;
  if (ww > 0 && pct) ww = avail * ww / 100;
  if (ww > 0 && hh > 0) { w = ww; h = hh; }
  else if (ww > 0) { h = nh * ww / nw; w = ww; }
  else if (hh > 0) { w = nw * hh / nh; h = hh; }
  if (w > avail) { h = h * avail / w; w = avail; }
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  if (h > 2000) { w = w * 2000 / h; h = 2000; }
  ImgEntry e;
  e.path = path; e.w = w; e.h = h; e.natW = nw; e.natH = nh; e.px = nullptr; e.state = 0; e.kind = kind; e.lastUse = 0; e.bg = L.d->bg;
  L.d->imgs.push_back(e);
  Word wd;
  memset(&wd, 0, sizeof wd);
  wd.img = L.d->imgs.size() - 1;
  wd.w = w;
  wd.imgH = h;
  wd.link = curStyle(L).link;
  wd.space = L.lastSpace;
  wd.font = FN_BODY;
  L.lastSpace = false;
  addWord(L, wd);
}

// ---------- Таблицы ----------
// Сколько колонок в таблице: наибольшее число ячеек в строке (с учётом colspan)
int countColumns(const std::string& h, size_t from) {
  int depth = 0, cols = 0, maxCols = 1;
  size_t p = from;
  while (p < h.size()) {
    size_t lt = h.find('<', p);
    if (lt == std::string::npos) break;
    std::string name;
    bool closing, sc;
    std::vector<Attr> attrs;
    p = parseTag(h, lt + 1, name, closing, sc, attrs);
    if (name == "table") {
      if (closing) { if (depth == 0) break; depth--; }
      else depth++;
    } else if (depth == 0) {
      if (name == "tr" && !closing) cols = 0;
      else if ((name == "td" || name == "th") && !closing) {
        const std::string* cs = getAttr(attrs, "colspan");
        cols += cs ? std::max(1, atoi(cs->c_str())) : 1;
        maxCols = std::max(maxCols, cols);
      }
    }
  }
  return std::min(maxCols, 8);
}

const uint16_t TABLE_LINE = MK565(208, 208, 216);

void closeCell(Layout& L) {
  TableCtx& T = L.tables.back();
  if (!T.cellOpen) return;
  flushLine(L, false);
  T.rowMax = std::max(T.rowMax, L.y + T.pad);
  if (T.cellHasBg) T.cellBgs.push_back({ T.cellItemStart, T.cellX, T.cellW, T.cellBg });
  T.cellOpen = false;
  // стиль ячейки (th) снимаем
  while (!L.stack.empty() && strcmp(L.stack.back().tag, "td") != 0 && strcmp(L.stack.back().tag, "th") != 0 && strcmp(L.stack.back().tag, "tr") != 0 && strcmp(L.stack.back().tag, "table") != 0) L.stack.pop_back();
  if (!L.stack.empty() && (strcmp(L.stack.back().tag, "td") == 0 || strcmp(L.stack.back().tag, "th") == 0)) L.stack.pop_back();
}

void closeRow(Layout& L) {
  TableCtx& T = L.tables.back();
  if (!T.rowOpen) return;
  closeCell(L);
  int32_t h = T.rowMax - T.rowTop;
  for (int i = (int)T.cellBgs.size() - 1; i >= 0; i--) {  // фоны ячеек — под текст
    CellBg& c = T.cellBgs[i];
    insertRect(L, c.itemIdx, c.x, T.rowTop, c.w, h, c.color, 0);
  }
  T.cellBgs.clear();
  addRect(L, T.x0, T.rowTop, T.width, 1, TABLE_LINE, 0);
  for (size_t i = 0; i < T.colEdges.size(); i++) addRect(L, T.colEdges[i], T.rowTop, 1, h, TABLE_LINE, 0);
  addRect(L, T.x0 + T.width - 1, T.rowTop, 1, h, TABLE_LINE, 0);
  T.colEdges.clear();
  L.y = T.rowMax;
  T.rowOpen = false;
  while (!L.stack.empty() && strcmp(L.stack.back().tag, "tr") != 0 && strcmp(L.stack.back().tag, "table") != 0) L.stack.pop_back();
  if (!L.stack.empty() && strcmp(L.stack.back().tag, "tr") == 0) L.stack.pop_back();
}

// ---------- Открытие и закрытие элементов ----------
int defaultMargin(const std::string& t) {
  if (t == "p" || t == "blockquote" || t == "pre" || t == "table" || t == "ul" || t == "ol" || t == "dl" || t == "figure" || t == "details") return 10;
  if (t == "h1") return 16;
  if (t == "h2") return 14;
  if (t == "h3") return 12;
  if (t == "h4" || t == "h5" || t == "h6") return 10;
  if (t == "hr") return 8;
  if (t == "li" || t == "dd" || t == "dt") return 3;
  return 0;
}

void computeStyle(Layout& L, const std::string& tag, const std::vector<Attr>& attrs, Style& st, BoxProps& bx) {
  // значения по умолчанию для тега
  if (tag == "b" || tag == "strong" || tag == "th" || tag == "dt" || tag == "summary" || tag == "legend") st.bold = 1;
  else if (tag == "i" || tag == "em" || tag == "cite" || tag == "var" || tag == "dfn" || tag == "address") st.italic = 1;
  else if (tag == "u" || tag == "ins") st.underline = 1;
  else if (tag == "s" || tag == "strike" || tag == "del") st.strike = 1;
  else if (tag == "code" || tag == "tt" || tag == "kbd" || tag == "samp") st.mono = 1;
  else if (tag == "pre") { st.mono = 1; st.pre = 1; bx.hasBg = true; bx.bg = MK565(243, 243, 247); bx.pad = 8; bx.radius = 6; }
  else if (tag == "small" || tag == "sub" || tag == "sup" || tag == "figcaption") st.size = 0;
  else if (tag == "big") st.size = 2;
  else if (tag == "h1") { st.size = 4; st.bold = 1; }
  else if (tag == "h2") { st.size = 3; st.bold = 1; }
  else if (tag == "h3") { st.size = 2; st.bold = 1; }
  else if (tag == "h4" || tag == "h5" || tag == "h6") { st.size = 1; st.bold = 1; }
  else if (tag == "center") st.align = AL_CENTER;
  else if (tag == "mark") { bx.hasBg = false; st.color = MK565(120, 80, 0); }
  else if (tag == "a" && getAttr(attrs, "href")) { st.color = L.linkColor; st.underline = 1; }
  else if (tag == "blockquote") st.color = MK565(90, 90, 100);
  else if (tag == "script" || tag == "style" || tag == "head" || tag == "title" || tag == "noscript" || tag == "template" ||
           tag == "svg" || tag == "iframe" || tag == "object" || tag == "select" || tag == "canvas" || tag == "video" || tag == "audio") st.hidden = 1;
  // устаревшие атрибуты
  const std::string* v;
  if ((v = getAttr(attrs, "align"))) { std::string a = lower(*v); st.align = a == "center" ? AL_CENTER : a == "right" ? AL_RIGHT : st.align; }
  uint16_t c;
  if ((v = getAttr(attrs, "bgcolor")) && parseColor(*v, c)) { bx.hasBg = true; bx.bg = c; }
  if (tag == "font") {
    if ((v = getAttr(attrs, "color")) && parseColor(*v, c)) st.color = c;
    if ((v = getAttr(attrs, "size"))) {
      int s = atoi(v->c_str());
      if ((*v)[0] == '+') s = 3 + s; else if ((*v)[0] == '-') s = 3 + s;
      st.size = s <= 2 ? 0 : s == 3 ? 1 : s == 4 ? 2 : s == 5 ? 3 : 4;
    }
    if ((v = getAttr(attrs, "face"))) { std::string f = lower(*v); if (f.find("mono") != std::string::npos || f.find("courier") != std::string::npos) st.mono = 1; }
  }
  // правила из <style> по возрастанию специфичности
  const std::string* idv = getAttr(attrs, "id");
  const std::string* clv = getAttr(attrs, "class");
  std::vector<const CssRule*> match;
  for (auto& r : L.css) {
    if (!r.tag.empty() && r.tag != tag) continue;
    if (!r.id.empty() && (!idv || *idv != r.id)) continue;
    if (!r.cls.empty()) {
      if (!clv) continue;
      bool found = false;
      size_t s = 0;
      while (s <= clv->size()) {
        size_t e = clv->find(' ', s);
        if (e == std::string::npos) e = clv->size();
        if (clv->substr(s, e - s) == r.cls) { found = true; break; }
        s = e + 1;
      }
      if (!found) continue;
    }
    match.push_back(&r);
  }
  std::stable_sort(match.begin(), match.end(), [](const CssRule* a, const CssRule* b) { return a->spec < b->spec || (a->spec == b->spec && a->order < b->order); });
  for (auto* r : match) applyDecl(r->decl, st, bx);
  if ((v = getAttr(attrs, "style"))) applyDecl(*v, st, bx);
}

void openBlockBox(Layout& L, Elem& e, const std::string& tag) {
  int m = e.box.margin >= 0 ? e.box.margin : defaultMargin(tag);
  flushLine(L, false);
  L.pendingMargin = std::max(L.pendingMargin, m);
  e.savedLeft = L.left;
  e.savedRight = L.right;
  if (e.box.hasBg || e.box.pad > 0 || tag == "blockquote") {
    applyPendingMargin(L);
    e.itemStart = L.d->items.size();
    e.startY = L.y;
    int pad = e.box.pad > 0 ? e.box.pad : (e.box.hasBg ? 6 : 0);
    if (e.box.width > 0) {
      int avail = L.right - L.left;
      int w = e.box.widthPct ? avail * e.box.width / 100 : e.box.width;
      if (w < avail) {
        if (e.st.align == AL_CENTER) { L.left += (avail - w) / 2; L.right = L.left + w; }
        else L.right = L.left + w;
        e.savedLeft = L.left; e.savedRight = L.right;  // ширина сохраняется для фона
      }
    }
    L.y += pad;
    L.left += pad;
    L.right -= pad;
    if (tag == "blockquote") L.left += 12;
  }
  if (tag == "ul" || tag == "ol" || tag == "dd") L.left += 22;
}

void closeBlockBox(Layout& L, Elem& e, const std::string& tag) {
  flushLine(L, false);
  int m = e.box.margin >= 0 ? e.box.margin : defaultMargin(tag);
  if (e.box.hasBg || e.box.pad > 0 || tag == "blockquote") {
    int pad = e.box.pad > 0 ? e.box.pad : (e.box.hasBg ? 6 : 0);
    L.pendingMargin = 0;
    L.y += pad;
    int x = e.savedLeft, w = e.savedRight - e.savedLeft;
    if (e.box.hasBg) insertRect(L, e.itemStart, x, e.startY, w, L.y - e.startY, e.box.bg, e.box.radius > 0 ? std::min<int>(e.box.radius, 40) : 0);
    if (tag == "blockquote") insertRect(L, e.itemStart, x + pad, e.startY + pad, 3, std::max<int>(1, L.y - e.startY - 2 * pad), MK565(200, 200, 212), 1);
  }
  L.left = e.savedLeft;
  L.right = e.savedRight;
  L.pendingMargin = std::max(L.pendingMargin, m);
}

void popElem(Layout& L) {
  Elem e = L.stack.back();
  L.stack.pop_back();
  std::string tag = e.tag;
  if (e.block) closeBlockBox(L, e, tag);
  if (tag == "a" && e.boxStart >= 0 && e.st.link >= 0) {  // ссылка вокруг блоков: общая область
    flushLine(L, false);
    int32_t top = INT32_MAX, bot = INT32_MIN;
    int x0 = 32767, x1 = -32768;
    for (size_t i = e.itemStart; i < L.d->items.size(); i++) {
      DItem& it = L.d->items[i];
      int32_t t = it.type == DI_TEXT ? it.y - FONTS[it.font]->asc : it.y;
      int32_t b = it.type == DI_TEXT ? it.y + FONTS[it.font]->desc : it.y + it.h;
      top = std::min(top, t); bot = std::max(bot, b);
      x0 = std::min<int>(x0, it.x); x1 = std::max<int>(x1, it.x + it.w);
    }
    if (top < bot) L.d->boxes.push_back({ (int16_t)x0, (int16_t)(x1 - x0), (int16_t)(bot - top), top, e.st.link });
  }
  if (!L.stack.empty()) L.align = L.stack.back().st.align;
}

void closeTag(Layout& L, const std::string& tag) {
  if (tag == "td" || tag == "th") { if (!L.tables.empty()) closeCell(L); return; }
  if (tag == "tr") { if (!L.tables.empty()) closeRow(L); return; }
  if (tag == "table") {
    if (L.tables.empty()) return;
    closeRow(L);
    TableCtx& T = L.tables.back();
    addRect(L, T.x0, L.y, T.width, 1, TABLE_LINE, 0);
    L.y += 1;
    L.left = T.savedLeft;
    L.right = T.savedRight;
    L.tables.pop_back();
    while (!L.stack.empty() && strcmp(L.stack.back().tag, "table") != 0) L.stack.pop_back();
    if (!L.stack.empty()) popElem(L);
    return;
  }
  for (int i = (int)L.stack.size() - 1; i > 0; i--) {
    if (tag == L.stack[i].tag) {
      while ((int)L.stack.size() > i) popElem(L);
      return;
    }
    if (strcmp(L.stack[i].tag, "table") == 0 || strcmp(L.stack[i].tag, "td") == 0 || strcmp(L.stack[i].tag, "th") == 0) return;  // не выходим за ячейку
  }
}

void openTag(Layout& L, const std::string& h, size_t afterTag, const std::string& tag, const std::vector<Attr>& attrs, bool selfClose) {
  Style& parent = curStyle(L);
  if (parent.hidden && tag != "title" && tag != "style" && tag != "meta") {
    if (!inList(VOID_TAGS, tag) && !selfClose) {  // внутри скрытого — только следим за вложенностью
      Elem e = L.stack.back();
      strncpy(e.tag, tag.c_str(), sizeof e.tag - 1);
      e.tag[sizeof e.tag - 1] = 0;
      e.block = false;
      e.boxStart = -1;
      L.stack.push_back(e);
    }
    return;
  }
  // неявные закрытия
  if (tag == "p" || tag == "li" || tag == "dt" || tag == "dd" || tag == "h1" || tag == "h2" || tag == "h3" || tag == "div" || tag == "ul" || tag == "ol" || tag == "table" || tag == "pre" || tag == "blockquote") {
    for (int i = (int)L.stack.size() - 1; i > 0; i--) {
      std::string t = L.stack[i].tag;
      if (t == "p") { while ((int)L.stack.size() > i) popElem(L); break; }
      if (t != "a" && t != "b" && t != "i" && t != "span" && t != "strong" && t != "em" && t != "font" && t != "u") break;
    }
  }
  if (tag == "li") {
    for (int i = (int)L.stack.size() - 1; i > 0; i--) {
      std::string t = L.stack[i].tag;
      if (t == "li") { while ((int)L.stack.size() > i) popElem(L); break; }
      if (t == "ul" || t == "ol" || t == "td" || t == "th") break;
    }
  }

  if (tag == "br") { if (L.line.empty()) flushLine(L, true); else flushLine(L, false); return; }
  if (tag == "img") { addImage(L, attrs); return; }
  if (tag == "hr") {
    flushLine(L, false);
    L.pendingMargin = std::max(L.pendingMargin, 8);
    applyPendingMargin(L);
    addRect(L, L.left, L.y, L.right - L.left, 1, MK565(200, 200, 208), 0);
    L.y += 1;
    L.pendingMargin = 8;
    return;
  }
  if (tag == "meta") {
    const std::string* he = getAttr(attrs, "http-equiv");
    const std::string* ct = getAttr(attrs, "content");
    if (he && ct && lower(*he) == "refresh") {
      L.d->refreshSec = atoi(ct->c_str());
      size_t u = lower(*ct).find("url=");
      if (u != std::string::npos) {
        std::string url = trim(ct->substr(u + 4));
        if (!url.empty() && (url[0] == '\'' || url[0] == '"')) url = url.substr(1, url.size() - 2);
        L.d->refreshUrl = url;
      }
    }
    return;
  }
  if (inList(VOID_TAGS, tag)) return;
  if (tag == "input" || tag == "textarea" || tag == "button") {}

  Elem e;
  memset(&e, 0, sizeof e);
  strncpy(e.tag, tag.c_str(), sizeof e.tag - 1);
  e.st = parent;
  e.st.link = parent.link;
  e.box = { false, 0, -1, -1, -1, -1, false };
  e.boxStart = -1;
  e.itemStart = L.d->items.size();
  if (tag == "a") {
    const std::string* href = getAttr(attrs, "href");
    if (href) {
      L.d->links.push_back(*href);
      e.st.link = L.d->links.size() - 1;
      e.boxStart = L.d->boxes.size();
    }
    const std::string* nm = getAttr(attrs, "name");
    if (nm) L.d->anchors.push_back({ *nm, L.y });
  }
  computeStyle(L, tag, attrs, e.st, e.box);
  if (tag == "body") {  // фон и цвета страницы
    const std::string* v;
    uint16_t c;
    if (e.box.hasBg) { L.d->bg = e.box.bg; e.box.hasBg = false; }
    if ((v = getAttr(attrs, "text")) && parseColor(*v, c)) e.st.color = c;
    if ((v = getAttr(attrs, "link")) && parseColor(*v, c)) L.linkColor = c;
  }
  const std::string* idv = getAttr(attrs, "id");
  if (idv && !L.line.empty() && inList(BLOCK_TAGS, tag) && L.tables.empty()) flushLine(L, false);  // якорь — после строки над блоком
  if (idv) L.d->anchors.push_back({ *idv, L.y + (inList(BLOCK_TAGS, tag) ? L.pendingMargin : 0) });

  e.block = inList(BLOCK_TAGS, tag) && tag != "td" && tag != "th" && tag != "tr" && tag != "table" && tag != "tbody" && tag != "thead" && tag != "tfoot";
  if (tag == "ul" || tag == "ol") {
    e.listType = tag == "ul" ? 1 : 2;
    const std::string* start = getAttr(attrs, "start");
    e.listCounter = start ? atoi(start->c_str()) - 1 : 0;
  }

  if (tag == "table") {
    flushLine(L, false);
    L.pendingMargin = std::max(L.pendingMargin, 10);
    applyPendingMargin(L);
    TableCtx T;
    T.ncols = countColumns(h, afterTag);
    T.col = 0;
    T.x0 = L.left;
    T.width = L.right - L.left;
    T.pad = 5;
    T.rowTop = T.rowMax = L.y;
    T.savedLeft = L.left;
    T.savedRight = L.right;
    T.rowOpen = T.cellOpen = T.header = false;
    T.cellItemStart = 0;
    T.cellHasBg = false;
    T.cellBg = 0;
    T.cellX = T.cellW = 0;
    L.tables.push_back(T);
    e.block = false;
    L.stack.push_back(e);
    return;
  }
  if (!L.tables.empty() && (tag == "tr" || tag == "td" || tag == "th")) {
    TableCtx& T = L.tables.back();
    if (tag == "tr") {
      closeRow(L);
      flushLine(L, false);
      T.rowOpen = true;
      T.col = 0;
      T.rowTop = T.rowMax = L.y;
      if (e.box.hasBg) { insertRect(L, L.d->items.size(), T.x0, L.y, T.width, 0, e.box.bg, 0); }
      L.stack.push_back(e);
      return;
    }
    if (!T.rowOpen) {
      T.rowOpen = true;
      T.col = 0;
      T.rowTop = T.rowMax = L.y;
    }
    closeCell(L);
    const std::string* cs = getAttr(attrs, "colspan");
    int span = cs ? std::max(1, atoi(cs->c_str())) : 1;
    if (T.col + span > T.ncols) span = std::max(1, T.ncols - T.col);
    int colW = T.width / T.ncols;
    int x = T.x0 + T.col * colW;
    int w = (T.col + span >= T.ncols) ? T.x0 + T.width - x : colW * span;
    if (T.col > 0) T.colEdges.push_back(x);
    T.col += span;
    T.cellOpen = true;
    T.cellItemStart = L.d->items.size();
    T.cellHasBg = e.box.hasBg || tag == "th";
    T.cellBg = e.box.hasBg ? e.box.bg : MK565(240, 240, 246);
    T.cellX = x;
    T.cellW = w;
    L.left = x + T.pad;
    L.right = x + w - T.pad;
    L.y = T.rowTop + T.pad;
    L.pendingMargin = 0;
    e.block = false;
    L.stack.push_back(e);
    L.align = e.st.align;
    return;
  }

  L.stack.push_back(e);
  Elem& me = L.stack.back();
  if (me.block) openBlockBox(L, me, tag);
  L.align = me.st.align;
  if (tag == "li") {
    Elem* list = nullptr;
    for (int i = (int)L.stack.size() - 2; i >= 0; i--) if (L.stack[i].listType) { list = &L.stack[i]; break; }
    if (list && list->listType == 2) {
      list->listCounter++;
      L.marker = std::to_string(list->listCounter) + ".";
    } else {
      L.marker = "•";
    }
    L.markerFont = fontOf(me.st) == FN_MONO ? FN_BODY : fontOf(me.st);
    L.markerColor = me.st.color;
  }
}

// Главная функция: HTML → свёрстанная страница
void layoutHtml(const std::string& h, const std::string& baseDir, Doc& d) {
  Layout L;
  L.d = &d;
  L.baseDir = baseDir;
  L.left = PAGE_PAD;
  L.right = SCREEN_W - PAGE_PAD;
  L.y = PAGE_PAD;
  L.pendingMargin = 0;
  L.lineW = 0;
  L.align = AL_LEFT;
  L.markerFont = FN_BODY;
  L.markerColor = 0;
  L.textColor = MK565(26, 26, 30);
  L.linkColor = MK565(26, 86, 219);
  L.lastSpace = false;
  L.cssOrder = 0;
  d.bg = 0xFFFF;
  d.items.reserve(h.size() / 12 + 64);
  d.text.reserve(h.size());

  // CSS собираем заранее из всех <style>
  {
    std::string lh = lower(h);
    size_t p = 0;
    while ((p = lh.find("<style", p)) != std::string::npos) {
      size_t gt = lh.find('>', p);
      size_t end = lh.find("</style", gt);
      if (gt == std::string::npos || end == std::string::npos) break;
      parseCss(L, h.substr(gt + 1, end - gt - 1));
      p = end;
    }
    d.hasScript = lh.find("<script") != std::string::npos;
  }

  Elem root;
  memset(&root, 0, sizeof root);
  strcpy(root.tag, "#root");
  root.st.color = L.textColor;
  root.st.size = 1;
  root.st.link = -1;
  root.box = { false, 0, -1, -1, -1, -1, false };
  root.boxStart = -1;
  L.stack.push_back(root);

  size_t p = 0, n = h.size();
  std::string text;
  while (p < n) {
    size_t lt = h.find('<', p);
    if (lt == std::string::npos) lt = n;
    if (lt > p) {
      text.clear();
      decodeText(h, p, lt, text);
      addText(L, text);
    }
    if (lt >= n) break;
    if (h.compare(lt, 4, "<!--") == 0) {
      size_t e = h.find("-->", lt + 4);
      p = e == std::string::npos ? n : e + 3;
      continue;
    }
    if (lt + 1 < n && (h[lt + 1] == '!' || h[lt + 1] == '?')) {
      size_t e = h.find('>', lt);
      p = e == std::string::npos ? n : e + 1;
      continue;
    }
    if (lt + 1 >= n || !(isalpha((unsigned char)h[lt + 1]) || h[lt + 1] == '/')) {  // одиночный «<» — это текст
      addText(L, "<");
      p = lt + 1;
      continue;
    }
    std::string name;
    bool closing, selfClose;
    std::vector<Attr> attrs;
    p = parseTag(h, lt + 1, name, closing, selfClose, attrs);
    if (name.empty()) continue;
    if (!closing && (name == "script" || name == "style" || name == "textarea" || name == "title")) {
      std::string endTag = "</" + name;
      std::string lh = lower(h.substr(p, std::min<size_t>(n - p, 400000)));
      size_t e = lh.find(endTag);
      size_t contentEnd = e == std::string::npos ? n : p + e;
      if (name == "title") {
        std::string t;
        decodeText(h, p, contentEnd, t);
        d.title = trim(t);
      } else if (name == "textarea") {
        Elem tmp = L.stack.back();
        L.stack.push_back(tmp);
        L.stack.back().st.pre = 1;
        L.stack.back().st.mono = 1;
        std::string t;
        decodeText(h, p, contentEnd, t);
        flushLine(L, false);
        addText(L, t);
        flushLine(L, false);
        L.stack.pop_back();
      }
      size_t gt = h.find('>', contentEnd);
      p = gt == std::string::npos ? n : gt + 1;
      continue;
    }
    if (closing) closeTag(L, name);
    else openTag(L, h, p, name, attrs, selfClose);
  }
  while (!L.tables.empty()) closeTag(L, "table");
  while (L.stack.size() > 1) popElem(L);
  flushLine(L, false);
  d.height = L.y + PAGE_PAD + 8;
}

// ===================== Картинки: декодирование с масштабом =====================
struct DecodeTarget { ImgEntry* e; int srcW, srcH; };
DecodeTarget gDec;

void* jOpen(const char* name, int32_t* size) { return fsOpen(name, size); }
void jClose(void* h) { fsClose(h); }
int32_t jRead(JPEGFILE* f, uint8_t* buf, int32_t len) { int32_t n = fsReadCb(f->fHandle, buf, len); f->iPos += n > 0 ? n : 0; return n; }
int32_t jSeek(JPEGFILE* f, int32_t pos) { f->iPos = pos; return fsSeek(f->fHandle, pos) ? pos : -1; }
int32_t pRead(PNGFILE* f, uint8_t* buf, int32_t len) { int32_t n = fsReadCb(f->fHandle, buf, len); f->iPos += n > 0 ? n : 0; return n; }
int32_t pSeek(PNGFILE* f, int32_t pos) { f->iPos = pos; return fsSeek(f->fHandle, pos) ? pos : -1; }

// Блок пикселей исходника → ближайшие пиксели картинки нужного размера
void blitScaled(int bx, int by, int bw, int bh, const uint16_t* src, int srcStride) {
  ImgEntry* e = gDec.e;
  int W = e->w, H = e->h, SW = gDec.srcW, SH = gDec.srcH;
  int tx0 = (int)(((int64_t)bx * W + SW - 1) / SW), tx1 = (int)(((int64_t)(bx + bw) * W + SW - 1) / SW);
  int ty0 = (int)(((int64_t)by * H + SH - 1) / SH), ty1 = (int)(((int64_t)(by + bh) * H + SH - 1) / SH);
  if (tx1 > W) tx1 = W;
  if (ty1 > H) ty1 = H;
  for (int ty = ty0; ty < ty1; ty++) {
    int sy = (int)((int64_t)ty * SH / H) - by;
    if (sy < 0 || sy >= bh) continue;
    for (int tx = tx0; tx < tx1; tx++) {
      int sx = (int)((int64_t)tx * SW / W) - bx;
      if (sx < 0 || sx >= bw) continue;
      e->px[ty * W + tx] = src[sy * srcStride + sx];
    }
  }
}

int jDraw(JPEGDRAW* d) {
  blitScaled(d->x, d->y, d->iWidthUsed > 0 ? d->iWidthUsed : d->iWidth, d->iHeight, d->pPixels, d->iWidth);
  return 1;
}

static uint16_t pngLine[2048];
int pDraw(PNGDRAW* d) {
  int w = std::min(d->iWidth, 2048);
  uint16_t bg = gDec.e->bg;
  uint32_t bg888 = (((bg >> 11) & 31) << 19) | (((bg >> 5) & 63) << 10) | ((bg & 31) << 3);
  png->getLineAsRGB565(d, pngLine, PNG_RGB565_LITTLE_ENDIAN, bg888);
  blitScaled(0, d->y, w, 1, pngLine, w);
  return 1;
}

void evictImages(size_t need) {
  while (imgCacheUsed + need > imgCacheLimit) {
    ImgEntry* old = nullptr;
    for (auto& e : doc.imgs) if (e.state == 1 && e.px && (!old || e.lastUse < old->lastUse)) old = &e;
    if (!old) break;
    free(old->px);
    old->px = nullptr;
    old->state = 0;
    imgCacheUsed -= (size_t)old->w * old->h * 2;
  }
}

bool ensureImage(ImgEntry& e) {
  e.lastUse = ++useTick;
  if (e.state == 1) return true;
  if (e.state == 2) return false;
  size_t bytes = (size_t)e.w * e.h * 2;
  evictImages(bytes);
  e.px = (uint16_t*)malloc(bytes);
  if (!e.px) { e.state = 2; return false; }
  for (size_t i = 0; i < (size_t)e.w * e.h; i++) e.px[i] = e.bg;
  bool ok = false;
  gDec.e = &e;
  if (e.kind == 1 && jpeg) {
    if (jpeg->open(e.path.c_str(), jOpen, jClose, jRead, jSeek, jDraw)) {
      int scale = 0, s = 1;
      while (s < 8 && e.natW / (s * 2) >= e.w && e.natH / (s * 2) >= e.h) s *= 2;
      if (s == 2) scale = JPEG_SCALE_HALF; else if (s == 4) scale = JPEG_SCALE_QUARTER; else if (s == 8) scale = JPEG_SCALE_EIGHTH;
      gDec.srcW = jpeg->getWidth() / s;
      gDec.srcH = jpeg->getHeight() / s;
      jpeg->setPixelType(RGB565_LITTLE_ENDIAN);
      ok = jpeg->decode(0, 0, scale) != 0;
      jpeg->close();
    }
  } else if (e.kind == 2 && png) {
    if (png->open(e.path.c_str(), jOpen, jClose, pRead, pSeek, pDraw) == PNG_SUCCESS) {
      gDec.srcW = png->getWidth();
      gDec.srcH = png->getHeight();
      ok = gDec.srcW <= 2048 && png->decode(nullptr, 0) == PNG_SUCCESS;
      png->close();
    }
  }
  if (!ok) { free(e.px); e.px = nullptr; e.state = 2; return false; }
  e.state = 1;
  imgCacheUsed += bytes;
  return true;
}

void freeDoc() {
  for (auto& e : doc.imgs) if (e.px) free(e.px);
  imgCacheUsed = 0;
  doc = Doc();
}

// ===================== Отрисовка страницы =====================
void drawItem(Surface& s, const DItem& it, int32_t top) {
  int y = (int)(it.y - top);
  if (it.type == DI_TEXT) {
    const AAFont& f = *FONTS[it.font];
    drawTextN(s, f, it.x, y, doc.text.c_str() + it.a, it.len, it.color);
    if (it.flags & 1) fillRectS(s, it.x, y + 2, it.w, 1, it.color);
    if (it.flags & 2) fillRectS(s, it.x, y - f.asc / 3, it.w, 1, it.color);
  } else if (it.type == DI_RECT) {
    if (it.radius > 0) roundRectS(s, it.x, y, it.w, it.h, it.radius, it.color, 0, 0);
    else fillRectS(s, it.x, y, it.w, it.h, it.color);
  } else if (it.type == DI_IMG) {
    ImgEntry& e = doc.imgs[it.a];
    if (ensureImage(e)) {
      int y0 = std::max(y, s.cy0), y1 = std::min(y + (int)it.h, s.cy1);
      int x0 = std::max<int>(it.x, s.cx0), x1 = std::min<int>(it.x + it.w, s.cx1);
      for (int yy = y0; yy < y1; yy++) {
        const uint16_t* src = e.px + (yy - y) * e.w + (x0 - it.x);
        uint16_t* dst = s.px + yy * s.w + x0;
        for (int xx = x0; xx < x1; xx++) *dst++ = *src++;
      }
    } else {
      roundRectS(s, it.x + 0.5f, y + 0.5f, it.w - 1, it.h - 1, 6, mix565(doc.bg, 0x8410, 40), mix565(doc.bg, 0x8410, 110), 1.2f);
    }
  }
}

// Полоса страницы для чужой поверхности: top — координата страницы, попадающая в строку 0
void drawStrip(Surface& s, int32_t top) {
  fillRectS(s, 0, s.cy0, s.w, s.cy1 - s.cy0, doc.bg);
  int32_t t0 = top + s.cy0, t1 = top + s.cy1;
  for (const DItem& it : doc.items) {
    int32_t t, b;
    if (it.type == DI_TEXT) { t = it.y - FONTS[it.font]->asc - 2; b = it.y + FONTS[it.font]->desc + 3; }
    else { t = it.y; b = it.y + it.h; }
    if (b <= t0 || t >= t1) continue;
    drawItem(s, it, top);
  }
}

// ===================== Встроенные страницы =====================
const char* DARK_CSS =
  "body{background:#0e0f13;color:#ececf1}"
  ".row{background:#1a1b22;padding:12px;border-radius:12px;margin:5px}"
  ".sub{color:#8e8aa6;font-size:13px}"
  ".dir{color:#c4a3ff}"
  "a{color:#ececf1;text-decoration:none}"
  ".note{color:#8e8aa6;font-size:13px}"
  "h2{color:#ffffff}";

std::string kindLabel(const std::string& name) {
  if (endsWith(name, ".html") || endsWith(name, ".htm")) return "страница";
  if (endsWith(name, ".txt")) return "текст";
  if (imgKind(name)) return "картинка";
  return "";
}

std::string dirPage(const std::string& path) {
  std::vector<DirEnt> ents;
  std::string h = "<html><head><title>" + htmlEscape(path == "/" ? std::string("SD-карта") : path) + "</title><style>" + DARK_CSS + "</style></head><body>";
  if (!fsList(path, ents)) {
    return h + "<h2>SD-карта не найдена</h2><p class='note'>Вставьте microSD с файлами .html и нажмите кнопку ниже.</p><a href='retry:'><div class='row'><b class='dir'>Проверить ещё раз</b></div></a></body></html>";
  }
  std::sort(ents.begin(), ents.end(), [](const DirEnt& a, const DirEnt& b) {
    if (a.dir != b.dir) return a.dir;
    return lower(a.name) < lower(b.name);
  });
  if (path != "/") {
    std::string up = resolvePath(path, "..");
    h += "<a href='dir:" + htmlEscape(up) + "'><div class='row'><span class='dir'>‹ Наверх</span></div></a>";
  }
  int shown = 0;
  for (auto& e : ents) {
    if (e.name.empty() || e.name[0] == '.' || e.name == "System Volume Information") continue;
    std::string full = (path == "/" ? "/" : path + "/") + e.name;
    if (e.dir) {
      h += "<a href='dir:" + htmlEscape(full) + "'><div class='row'><b class='dir'>▸ " + htmlEscape(e.name) + "</b><br><span class='sub'>папка</span></div></a>";
      shown++;
    } else {
      std::string k = kindLabel(e.name);
      if (k.empty()) continue;
      h += "<a href='" + htmlEscape(full) + "'><div class='row'><b>" + htmlEscape(e.name) + "</b><br><span class='sub'>" + k + " · " + fmtSize(e.size) + "</span></div></a>";
      shown++;
    }
  }
  if (!shown) h += "<p class='note'>Здесь нет страниц .html, текстов или картинок.</p>";
  h += "</body></html>";
  return h;
}

std::string messagePage(const std::string& title, const std::string& text) {
  return "<html><head><title>" + htmlEscape(title) + "</title><style>" + std::string(DARK_CSS) + "</style></head><body><h2>" + htmlEscape(title) + "</h2><p>" + text + "</p></body></html>";
}

// ===================== Навигация =====================
const char* SCRIPT_NOTE =
  "<div style='background:#fff4d6;color:#6b4e00;padding:8px;border-radius:8px;font-size:13px;margin:0'>"
  "На странице есть JavaScript — на плате он не выполняется, поэтому кнопки и игры здесь не работают. "
  "Полностью страница работает в браузере телефона; через приложение ESP32 Flasher → «Экран на плату» её можно показать здесь.</div>";

const char* PROGRAM_NOTE =
  "<p>В файле почти нет текста: это игра или приложение на JavaScript (например, «Своя игра»). "
  "Плата показывает текст, таблицы и картинки, а программы на ней не запускаются.</p>"
  "<div class='row'>Откройте файл в браузере телефона или компьютера.</div>"
  "<div class='row'>Чтобы видеть страницу и на плате, откройте её в приложении ESP32 Flasher → «Плата по Wi-Fi» → «Экран на плату»: "
  "там нажатия на экране платы тоже работают.</div>";

bool ready = false;
bool init() {
  if (ready) return true;
  for (int i = 0; i < FN_COUNT; i++) if (!FONTS[i]->bits && !decodeFont(*FONTS[i])) return false;
  if (!jpeg) jpeg = new JPEGDEC();
  if (!png) png = new PNG();
  ready = true;
  return true;
}

void showHtml(const std::string& html, const std::string& baseDir, const std::string& url) {
  freeDoc();
  layoutHtml(html, baseDir, doc);
  if (doc.hasScript) {
    std::string title = doc.title;
    size_t chars = doc.text.size();
    freeDoc();
    bool program = chars < 200 && html.size() > 4000;  // почти весь файл — скрипт: игра или приложение
    if (program) layoutHtml("<html><head><title>Страница-программа</title><style>" + std::string(DARK_CSS) + "</style></head><body><h2>Это страница-программа</h2>" + PROGRAM_NOTE + "</body></html>", "/", doc);
    else layoutHtml(std::string(SCRIPT_NOTE) + html, baseDir, doc);
    doc.hasScript = true;
    if (doc.title.empty() || program) doc.title = title;
  }
  if (doc.truncated && doc.items.size() >= MAX_ITEMS) doc.title = "(начало) " + doc.title;
  curUrl = url;
  scrollY = 0;
  refreshAt = 0;
  if (doc.refreshSec > 0 && !doc.refreshUrl.empty()) {
    refreshStart = nowMs();
    refreshAt = refreshStart + (uint32_t)doc.refreshSec * 1000;
  }
}

void openUrl(const std::string& url, bool pushHistory) {
  init();
  if (pushHistory && !curUrl.empty()) history.push_back({ curUrl, scrollY });
  if (history.size() > 30) history.erase(history.begin());
  std::string anchor;
  std::string u = url;
  size_t hash = u.find('#');
  if (hash != std::string::npos && u.compare(0, 4, "dir:") != 0) { anchor = u.substr(hash + 1); u = u.substr(0, hash); }
  if (u.compare(0, 4, "dir:") == 0) { showHtml(dirPage(u.substr(4)), "/", u); return; }
  std::string path = u;
  if (fsIsDir(path)) { showHtml(dirPage(path), "/", "dir:" + path); return; }
  std::string base = dirOf(path);
  if (imgKind(path)) {
    showHtml("<html><head><title>" + htmlEscape(fileName(path)) + "</title></head><body style='background:#000;text-align:center'><img src='" +
             htmlEscape(fileName(path)) + "' width='100%'></body></html>", base, u);
    return;
  }
  std::string data;
  bool truncated = false;
  if (!fsRead(path, data, hasPsram ? MAX_FILE_PSRAM : MAX_FILE_NOPSRAM, truncated)) {
    showHtml(messagePage("Не открывается", "Файл <b>" + htmlEscape(path) + "</b> не найден на карте."), "/", u);
    return;
  }
  bool isHtml = endsWith(lower(path), ".html") || endsWith(lower(path), ".htm");
  std::string cs = isHtml ? declaredCharset(data) : "";
  bool is1251 = cs == "windows-1251" || cs == "cp1251" || cs == "x-cp1251";
  if (is1251 || (cs.empty() && !looksUtf8(data))) cp1251ToUtf8(data);
  if (!isHtml) data = "<html><head><title>" + htmlEscape(fileName(path)) + "</title></head><body><pre style='background:#fff;padding:0'>" + htmlEscape(data) + "</pre></body></html>";
  if (truncated) data += "<hr><p style='color:#b00'><b>Файл слишком большой — показано начало.</b></p>";
  showHtml(data, base, u);
  if (!anchor.empty()) {
    for (auto& a : doc.anchors) if (a.id == anchor) { scrollY = std::max<int32_t>(0, a.y - 6); break; }
  }
}

// Открыть файл с чистой историей (из списка «Мои файлы»)
void openFile(const std::string& path) { history.clear(); curUrl.clear(); openUrl(path, false); }

// Назад по ссылкам; false — история кончилась, пора к списку файлов
bool goBack() {
  if (history.empty()) return false;
  HistEntry h = history.back();
  history.pop_back();
  openUrl(h.url, false);
  scrollY = h.scroll;
  return true;
}

void followLink(const std::string& href0) {
  std::string href = trim(href0);
  if (href.empty()) return;
  if (href[0] == '#') {
    for (auto& a : doc.anchors) if (a.id == href.substr(1)) { scrollY = std::max<int32_t>(0, a.y - 6); return; }
    return;
  }
  if (href.compare(0, 4, "dir:") == 0) { openUrl(href, true); return; }
  std::string lh = lower(href);
  if (lh.compare(0, 7, "http://") == 0 || lh.compare(0, 8, "https://") == 0 || lh.compare(0, 7, "mailto:") == 0 || lh.compare(0, 4, "tel:") == 0 || lh.compare(0, 11, "javascript:") == 0) {
    if (!curUrl.empty()) history.push_back({ curUrl, scrollY });
    showHtml(messagePage("Ссылка в интернет", "Плата не выходит в интернет. Адрес ссылки:<br><b>" + htmlEscape(href) +
             "</b><br><br>Откройте его на телефоне: в приложении ESP32 Flasher → «Экран на плату» страницу можно показать и здесь."), "/", "msg:");
    return;
  }
  std::string base = curUrl.compare(0, 4, "dir:") == 0 ? std::string("/") : dirOf(curUrl);
  openUrl(resolvePath(base, urlDecode(href)), true);
}

// Касание по странице (y — координата страницы). true — сработала ссылка
bool tapAt(int x, int32_t y) {
  for (auto& b : doc.boxes) {
    if (x >= b.x - 4 && x < b.x + b.w + 4 && y >= b.y - 4 && y < b.y + b.h + 4) {
      if (b.link >= 0 && b.link < (int)doc.links.size()) { followLink(doc.links[b.link]); return true; }
      return false;
    }
  }
  return false;
}

// Автопереход <meta http-equiv="refresh">: true — открыта следующая страница
bool tick() {
  if (!refreshAt || (int32_t)(nowMs() - refreshAt) < 0) return false;
  openUrl(resolvePath(dirOf(curUrl), urlDecode(doc.refreshUrl)), false);
  return true;
}

void close() { freeDoc(); history.clear(); curUrl.clear(); refreshAt = 0; }

// ===================== Файлы на SD-карте (на плате) =====================
#ifndef HOST_SIM
uint32_t nowMs() { return millis(); }
bool fsExists(const std::string& p) { return sdBegin() && SD.exists(p.c_str()); }
bool fsIsDir(const std::string& p) {
  if (!sdBegin()) return false;
  File f = SD.open(p.c_str());
  bool d = f && f.isDirectory();
  if (f) f.close();
  return d;
}
bool fsRead(const std::string& p, std::string& out, size_t maxLen, bool& truncated) {
  if (!sdBegin()) return false;
  File f = SD.open(p.c_str());
  if (!f || f.isDirectory()) return false;
  size_t size = f.size();
  truncated = size > maxLen;
  size_t n = std::min(size, maxLen);
  out.resize(n);
  size_t got = n ? f.read((uint8_t*)&out[0], n) : 0;
  out.resize(got);
  f.close();
  return true;
}
bool fsList(const std::string& p, std::vector<DirEnt>& out) {
  if (!sdBegin()) return false;
  File d = SD.open(p.c_str());
  if (!d || !d.isDirectory()) return false;
  File f;
  while ((f = d.openNextFile())) {
    std::string name = f.name();
    size_t sl = name.rfind('/');
    if (sl != std::string::npos) name = name.substr(sl + 1);
    out.push_back({ name, f.isDirectory(), (uint32_t)f.size() });
    f.close();
    if (out.size() > 300) break;
  }
  d.close();
  return true;
}
void* fsOpen(const char* name, int32_t* size) {
  if (!sdBegin()) return nullptr;
  File* f = new File(SD.open(name));
  if (!*f) { delete f; return nullptr; }
  *size = f->size();
  return f;
}
void fsClose(void* h) { if (h) { File* f = (File*)h; f->close(); delete f; } }
int32_t fsReadCb(void* h, uint8_t* buf, int32_t len) { return h ? ((File*)h)->read(buf, len) : 0; }
bool fsSeek(void* h, int32_t pos) { return h && ((File*)h)->seek(pos); }
#endif
}  // namespace hv

#undef MK565
#undef SCREEN_W
#undef SCREEN_H
#undef BAR_H
#undef VIEW_Y
#undef VIEW_H
#undef STRIP_H
#undef PAGE_PAD
#undef MAX_FILE_PSRAM
#undef MAX_ITEMS
#undef MAX_FILE_NOPSRAM
#undef C_BAR
#undef C_BAR_LINE
#undef C_BAR_TEXT
#undef C_BAR_ICON
#undef C_BAR_DIM
