/*
  Медиаплеер для Waveshare ESP32-Touch-LCD-3.5
  (ESP32-D0WD-V3, 3.5" ST7796 320x480, тач FT6336, аудиокодек ES8311 + динамик, microSD)

  Играет с SD-карты:
    • MP3 — с названием, исполнителем и обложкой из тегов ID3, перемоткой и громкостью
    • WAV (PCM 8/16 бит)
    • AVI с видео MJPEG и звуком PCM или MP3 — на весь экран, со звуком
  MP4 (видео H.264) плата не декодирует: на это у ESP32 не хватает мощности.
  Такие ролики переводит в AVI приложение ESP32 Flasher (вкладка «Конвертер»)
  или ffmpeg:
    ffmpeg -i video.mp4 -vf "scale=320:-2,fps=15" -c:v mjpeg -q:v 6 -c:a pcm_s16le -ar 22050 -ac 1 video.avi

  Управление:
    список — тап по файлу; «‹» — в папку выше; плашка внизу — текущий трек
    плеер — ⏮ ⏯ ⏭, тап по полосе — перемотка, «−» и «+» — громкость
    видео — тап: пауза, удержание 1 с или кнопка BOOT: выход
    кнопка BOOT в списке и плеере — пауза и продолжение

  Arduino IDE: плата "ESP32 Dev Module", PSRAM "Enabled",
  Partition Scheme "Huge APP (3MB No OTA/1MB SPIFFS)".
  Библиотеки: "GFX Library for Arduino", "JPEGDEC".
  В папке скетча должны лежать fonts.h и minimp3.h (декодер MP3, CC0).
  Настройка ES8311 по драйверу Espressif (Apache-2.0).
*/

#ifndef HOST_SIM
#include <Arduino_GFX_Library.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <ESP_I2S.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#endif
#include <JPEGDEC.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <algorithm>
#define MINIMP3_IMPLEMENTATION
#define MINIMP3_ONLY_MP3
#include "minimp3.h"

// ===================== Константы =====================
#define MK565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

#define SCREEN_W 320
#define SCREEN_H 480
#define BAR_H 44
#define ROW_H 56
#define MINI_H 60
#define STRIP_H 32
#define OUT_RATE 44100
#define RING_SAMPLES 32768

#define C_BG       MK565(14, 15, 19)
#define C_BAR      MK565(18, 19, 24)
#define C_LINE     MK565(40, 38, 52)
#define C_TEXT     MK565(236, 236, 241)
#define C_DIM      MK565(142, 138, 166)
#define C_ACCENT   MK565(186, 140, 255)
#define C_ACCENT2  MK565(123, 31, 162)
#define C_CARD     MK565(26, 27, 34)
#define C_AUDIO    MK565(123, 31, 162)
#define C_VIDEO    MK565(196, 84, 40)
#define C_DIR      MK565(56, 120, 110)
#define C_OFF      MK565(70, 68, 84)
#define C_ERR      MK565(255, 110, 126)

enum FontId : uint8_t { FN_BODY, FN_BOLD, FN_SMALL, FN_TITLE, FN_COUNT };
enum MediaKind : uint8_t { MK_NONE, MK_DIR, MK_MP3, MK_WAV, MK_AVI, MK_MP4, MK_OTHER };
enum Screen : uint8_t { SC_LIST, SC_PLAYER, SC_MSG };
enum TrackType : uint8_t { TT_NONE, TT_MP3, TT_WAV };

// ===================== Типы =====================
struct Glyph { uint16_t cp; uint8_t w, h; int8_t xo, yo; uint8_t adv; uint32_t off; };
struct AAFont { uint8_t* bits; const Glyph* g; uint16_t n; int8_t asc, desc; const char* b64; uint32_t nbytes; };

struct Surface {
  uint16_t* px = nullptr;
  int w = 0, h = 0;
  int cx0 = 0, cy0 = 0, cx1 = 0, cy1 = 0;
};

struct DirEnt { std::string name; bool dir; uint32_t size; };
struct Entry { std::string name; MediaKind kind; uint32_t size; };
struct TouchPt { int16_t x, y; };

struct TrackInfo {
  std::string title, artist, album;
  uint32_t audioStart, audioEnd;     // байты звука в файле (без тегов)
  uint32_t coverOff, coverLen;       // обложка JPEG внутри файла
  uint32_t xingFrames;               // число кадров из заголовка Xing/Info (VBR)
};

struct WavInfo { uint32_t rate; uint16_t ch, bits; uint32_t dataOff, dataLen; };

struct AviInfo {
  uint32_t usPerFrame, totalFrames;
  uint16_t w, h;
  bool mjpeg;
  char vcodec[5];
  uint16_t aFormat, aCh, aBits;
  uint32_t aRate;
  int vStream, aStream;
  uint32_t moviStart, moviEnd;
};

struct Track {                      // текущий звук
  TrackType type;
  std::string path, name;
  TrackInfo info;
  WavInfo wav;
  void* f;
  int32_t fileSize;
  uint32_t pos, end;                // позиция чтения и конец звуковых данных
  uint8_t* in;
  int inLen, inPos;
  bool eof, started, paused, finished;
  uint32_t rate, ch, bitrate;
  float duration;                   // секунды (оценка)
};

struct DecodeTarget { uint16_t* px; int w, h, srcW, srcH; };

// ===================== Шрифты =====================
#include "fonts.h"
AAFont* FONTS[FN_COUNT] = { &FN_BODY_F, &FN_BOLD_F, &FN_SMALL_F, &FN_TITLE_F };

// ===================== Глобальное состояние =====================
Surface sStrip;
JPEGDEC* jpeg = nullptr;
mp3dec_t mp3d;
int16_t pcmBuf[MINIMP3_MAX_SAMPLES_PER_FRAME];

Screen screen = SC_LIST;
std::string curDir = "/";
std::vector<Entry> entries;
int32_t listScroll = 0;
bool sdReady = false;
Track trk;
int trackIndex = -1;                // индекс текущего трека в entries (если в этой папке)
std::string trackDir;
std::vector<Entry> trackDirEntries;
uint16_t* coverPx = nullptr;        // обложка 200×200
int volume = 70;
std::string msgTitle, msgText;
bool listDirty = true, playerDirty = true, miniDirty = true, progDirty = true;
bool wifiOn = false;                // Wi-Fi и веб-сервер для приложения ESP32 Flasher
volatile bool filesChanged = false; // приложение изменило файлы на карте
std::string wifiText;               // как подключиться (для экрана сообщения)

// Звуковое кольцо: продюсер — основной цикл, потребитель — задача вывода
int16_t* ring = nullptr;
volatile uint32_t ringW = 0, ringR = 0;
volatile uint32_t srcRate = OUT_RATE;
volatile uint8_t srcCh = 2;
volatile bool aRun = false, aPause = false, aResetPhase = false;
volatile uint32_t aConsumed = 0;    // проиграно кадров источника
volatile uint32_t aBase = 0;        // смещение часов после перемотки (кадры источника)
volatile uint16_t aLevel = 0;       // уровень громкости сигнала для индикатора

// ===================== Платформа =====================
void pushPixels(int x, int y, int w, int h, const uint16_t* px);
bool fsList(const std::string& p, std::vector<DirEnt>& out);
void* fsOpen(const char* name, int32_t* size);
void fsClose(void* h);
int32_t fsReadCb(void* h, uint8_t* buf, int32_t len);
bool fsSeek(void* h, int32_t pos);
uint32_t nowMs();
void sleepMs(uint32_t ms);
void audioHwWrite(const int32_t* stereo, int frames);
void audioHwVolume(int v);
void saveVolume();

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



// ===================== Звук: кольцо и пересчёт частоты =====================
static inline uint32_t ringUsed() { return ringW - ringR; }
static inline uint32_t ringFree() { return RING_SAMPLES - ringUsed(); }

// Кладёт сэмплы в кольцо; если места нет — ждёт (это и задаёт темп для видео)
bool ringPush(const int16_t* s, uint32_t n) {
  while (n) {
    uint32_t fr = ringFree();
    if (!fr) {
      if (!aRun || aPause) return false;
      sleepMs(1);
      continue;
    }
    uint32_t k = n < fr ? n : fr;
    uint32_t w = ringW;
    for (uint32_t i = 0; i < k; i++) ring[(w + i) & (RING_SAMPLES - 1)] = s[i];
    __sync_synchronize();
    ringW = w + k;
    s += k;
    n -= k;
  }
  return true;
}

// Готовит frames кадров 44,1 кГц стерео из кольца (линейная интерполяция)
void audioRender(int32_t* out, int frames) {
  static uint32_t phase = 0;
  if (aResetPhase) { phase = 0; aResetPhase = false; }
  if (!aRun || aPause || !ring) {
    memset(out, 0, frames * 8);
    return;
  }
  uint32_t ch = srcCh, rate = srcRate;
  uint32_t step = (uint32_t)(((uint64_t)rate << 16) / OUT_RATE);
  uint32_t peak = 0;
  for (int i = 0; i < frames; i++) {
    uint32_t avail = (ringW - ringR) / ch;
    if (avail < 3) {  // данных нет — тишина, часы стоят
      for (; i < frames; i++) out[2 * i] = out[2 * i + 1] = 0;
      break;
    }
    uint32_t r = ringR, M = RING_SAMPLES - 1;
    int32_t l0 = ring[r & M], r0 = ch == 2 ? ring[(r + 1) & M] : l0;
    int32_t l1 = ring[(r + ch) & M], r1 = ch == 2 ? ring[(r + ch + 1) & M] : l1;
    int32_t f = (phase & 0xFFFF) >> 1;
    int32_t L = l0 + (((l1 - l0) * f) >> 15), R = r0 + (((r1 - r0) * f) >> 15);
    out[2 * i] = (int32_t)((uint32_t)L << 16);
    out[2 * i + 1] = (int32_t)((uint32_t)R << 16);
    uint32_t a = (uint32_t)(L < 0 ? -L : L);
    if (a > peak) peak = a;
    phase += step;
    uint32_t adv = phase >> 16;
    phase &= 0xFFFF;
    if (adv) {
      __sync_synchronize();
      ringR = r + adv * ch;
      aConsumed = aConsumed + adv;
    }
  }
  aLevel = (uint16_t)std::min<uint32_t>(32767, peak);
}

// Начать звук с новыми параметрами (очищает кольцо). base — с какого кадра идут часы
void audioStart(uint32_t rate, uint8_t ch, uint32_t base) {
  aRun = false;
  sleepMs(25);              // задача вывода доигрывает текущий блок тишиной
  ringW = 0;
  ringR = 0;
  srcRate = rate ? rate : OUT_RATE;
  srcCh = (ch == 1) ? 1 : 2;
  aConsumed = 0;
  aBase = base;
  aResetPhase = true;
  aPause = false;
  aRun = true;
}

void audioStop() {
  aRun = false;
  sleepMs(25);
  ringW = 0;
  ringR = 0;
}

float audioClock() { return srcRate ? (float)(aBase + aConsumed) / srcRate : 0; }

// ===================== Разбор файлов =====================
static uint32_t rd32le(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t rd16le(const uint8_t* p) { return p[0] | (p[1] << 8); }
static uint32_t rd32be(const uint8_t* p) { return ((uint32_t)p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]; }
static uint32_t syncsafe(const uint8_t* p) { return ((p[0] & 0x7F) << 21) | ((p[1] & 0x7F) << 14) | ((p[2] & 0x7F) << 7) | (p[3] & 0x7F); }

MediaKind kindOf(const std::string& name, bool dir) {
  if (dir) return MK_DIR;
  if (endsWith(name, ".mp3")) return MK_MP3;
  if (endsWith(name, ".wav")) return MK_WAV;
  if (endsWith(name, ".avi")) return MK_AVI;
  if (endsWith(name, ".mp4") || endsWith(name, ".mov") || endsWith(name, ".mkv") || endsWith(name, ".m4v") || endsWith(name, ".webm")) return MK_MP4;
  return MK_OTHER;
}

// Текст тега ID3 → UTF-8 (кодировки 0 — Latin-1/часто cp1251, 1/2 — UTF-16, 3 — UTF-8)
std::string id3Text(const uint8_t* d, uint32_t n) {
  if (!n) return "";
  uint8_t enc = d[0];
  d++; n--;
  std::string r;
  if (enc == 1 || enc == 2) {
    bool be = enc == 2;
    if (n >= 2 && d[0] == 0xFF && d[1] == 0xFE) { be = false; d += 2; n -= 2; }
    else if (n >= 2 && d[0] == 0xFE && d[1] == 0xFF) { be = true; d += 2; n -= 2; }
    for (uint32_t i = 0; i + 1 < n; i += 2) {
      uint32_t cp = be ? (d[i] << 8) | d[i + 1] : d[i] | (d[i + 1] << 8);
      if (!cp) break;
      putUtf8(r, cp);
    }
  } else {
    for (uint32_t i = 0; i < n && d[i]; i++) r += (char)d[i];
    if (enc == 0) {
      bool hi = false;
      for (unsigned char c : r) if (c >= 0x80) hi = true;
      if (hi) cp1251ToUtf8(r);  // русские теги обычно в cp1251
    }
  }
  return trim(r);
}

// Теги ID3v2 (начало файла) и ID3v1 (конец), заголовок Xing первого кадра
void parseMp3Info(void* f, int32_t size, TrackInfo& t) {
  t.audioStart = 0;
  t.audioEnd = size;
  t.coverOff = t.coverLen = 0;
  t.xingFrames = 0;
  uint8_t h[10];
  fsSeek(f, 0);
  if (fsReadCb(f, h, 10) == 10 && h[0] == 'I' && h[1] == 'D' && h[2] == '3') {
    uint8_t ver = h[3];
    uint32_t tagSize = syncsafe(h + 6);
    t.audioStart = 10 + tagSize + ((h[5] & 0x10) ? 10 : 0);
    uint32_t p = 10;
    if (h[5] & 0x40) {  // расширенный заголовок
      uint8_t e[4];
      fsReadCb(f, e, 4);
      p += ver >= 4 ? syncsafe(e) : rd32be(e) + 4;
      fsSeek(f, p);
    }
    while (p + 10 <= 10 + tagSize) {
      uint8_t fh[10];
      if (fsReadCb(f, fh, 10) != 10 || !fh[0]) break;
      uint32_t fs = ver >= 4 ? syncsafe(fh + 4) : rd32be(fh + 4);
      if (fs == 0 || p + 10 + fs > 10 + tagSize) break;
      char id[5] = { (char)fh[0], (char)fh[1], (char)fh[2], (char)fh[3], 0 };
      if (!strcmp(id, "TIT2") || !strcmp(id, "TPE1") || !strcmp(id, "TALB")) {
        uint32_t n = std::min<uint32_t>(fs, 512);
        std::vector<uint8_t> b(n);
        fsReadCb(f, b.data(), n);
        std::string s = id3Text(b.data(), n);
        if (id[1] == 'I') t.title = s; else if (id[1] == 'P') t.artist = s; else t.album = s;
      } else if (!strcmp(id, "APIC") && !t.coverLen) {
        uint8_t b[256];
        uint32_t n = std::min<uint32_t>(fs, sizeof b);
        fsReadCb(f, b, n);
        uint8_t enc = b[0];
        uint32_t i = 1;
        while (i < n && b[i]) i++;          // MIME
        i += 2;                              // ноль и тип картинки
        if (enc == 1 || enc == 2) { while (i + 1 < n && (b[i] || b[i + 1])) i += 2; i += 2; }
        else { while (i < n && b[i]) i++; i++; }
        if (i + 2 < n && b[i] == 0xFF && b[i + 1] == 0xD8) { t.coverOff = p + 10 + i; t.coverLen = fs - i; }
      }
      p += 10 + fs;
      fsSeek(f, p);
    }
  }
  if (size > 128) {  // ID3v1
    uint8_t v1[128];
    fsSeek(f, size - 128);
    if (fsReadCb(f, v1, 128) == 128 && v1[0] == 'T' && v1[1] == 'A' && v1[2] == 'G') {
      t.audioEnd = size - 128;
      auto field = [&](int off, int len) { std::string s((const char*)v1 + off, len); size_t z = s.find('\0'); if (z != std::string::npos) s.resize(z); if (!looksUtf8(s)) cp1251ToUtf8(s); return trim(s); };
      if (t.title.empty()) t.title = field(3, 30);
      if (t.artist.empty()) t.artist = field(33, 30);
      if (t.album.empty()) t.album = field(63, 30);
    }
  }
  // Xing/Info в первом кадре — число кадров для точной длительности VBR
  uint8_t b[512];
  fsSeek(f, t.audioStart);
  int n = fsReadCb(f, b, sizeof b);
  for (int i = 0; i + 12 < n; i++) {
    if ((b[i] == 'X' && b[i + 1] == 'i' && b[i + 2] == 'n' && b[i + 3] == 'g') || (b[i] == 'I' && b[i + 1] == 'n' && b[i + 2] == 'f' && b[i + 3] == 'o')) {
      if (rd32be(b + i + 4) & 1) t.xingFrames = rd32be(b + i + 8);
      break;
    }
  }
}

bool parseWav(void* f, int32_t size, WavInfo& w) {
  uint8_t h[12];
  fsSeek(f, 0);
  if (fsReadCb(f, h, 12) != 12 || memcmp(h, "RIFF", 4) || memcmp(h + 8, "WAVE", 4)) return false;
  uint32_t p = 12;
  bool fmt = false;
  while (p + 8 <= (uint32_t)size) {
    uint8_t c[8];
    fsSeek(f, p);
    if (fsReadCb(f, c, 8) != 8) break;
    uint32_t len = rd32le(c + 4);
    if (!memcmp(c, "fmt ", 4)) {
      uint8_t b[16];
      fsReadCb(f, b, 16);
      if (rd16le(b) != 1) return false;  // только PCM
      w.ch = rd16le(b + 2);
      w.rate = rd32le(b + 4);
      w.bits = rd16le(b + 14);
      fmt = true;
    } else if (!memcmp(c, "data", 4)) {
      w.dataOff = p + 8;
      w.dataLen = std::min<uint32_t>(len, size - w.dataOff);
      return fmt && (w.bits == 8 || w.bits == 16) && (w.ch == 1 || w.ch == 2);
    }
    p += 8 + len + (len & 1);
  }
  return false;
}

static bool fourcc(const uint8_t* p, const char* s) { return !memcmp(p, s, 4); }

bool parseAvi(void* f, int32_t size, AviInfo& a, std::string& err) {
  memset(&a, 0, sizeof a);
  a.vStream = a.aStream = -1;
  uint8_t h[12];
  fsSeek(f, 0);
  if (fsReadCb(f, h, 12) != 12 || !fourcc(h, "RIFF") || !fourcc(h + 8, "AVI ")) { err = "Это не файл AVI."; return false; }
  uint32_t p = 12;
  int stream = -1;
  char curType[5] = "";
  while (p + 8 <= (uint32_t)size) {
    uint8_t c[12];
    fsSeek(f, p);
    if (fsReadCb(f, c, 12) < 8) break;
    uint32_t len = rd32le(c + 4);
    if (fourcc(c, "LIST")) {
      if (fourcc(c + 8, "hdrl") || fourcc(c + 8, "strl")) { p += 12; continue; }
      if (fourcc(c + 8, "movi")) { a.moviStart = p + 12; a.moviEnd = std::min<uint32_t>(p + 8 + len, size); break; }
    } else if (fourcc(c, "avih")) {
      uint8_t b[40];
      fsSeek(f, p + 8);
      fsReadCb(f, b, 40);
      a.usPerFrame = rd32le(b);
      a.totalFrames = rd32le(b + 16);
      a.w = rd32le(b + 32);
      a.h = rd32le(b + 36);
    } else if (fourcc(c, "strh")) {
      uint8_t b[36];
      fsSeek(f, p + 8);
      fsReadCb(f, b, 36);
      stream++;
      memcpy(curType, b, 4);
      if (fourcc(b, "vids")) {
        a.vStream = stream;
        memcpy(a.vcodec, b + 4, 4);
        uint32_t scale = rd32le(b + 20), rate = rd32le(b + 24), length = rd32le(b + 32);
        if (scale && rate) a.usPerFrame = (uint32_t)((uint64_t)scale * 1000000ULL / rate);
        if (length) a.totalFrames = length;
      } else if (fourcc(b, "auds") && a.aStream < 0) {
        a.aStream = stream;
      }
    } else if (fourcc(c, "strf")) {
      uint8_t b[20];
      fsSeek(f, p + 8);
      fsReadCb(f, b, 20);
      if (fourcc((const uint8_t*)curType, "vids")) {
        a.w = rd32le(b + 4);
        int32_t hh = (int32_t)rd32le(b + 8);
        a.h = hh < 0 ? -hh : hh;
        const uint8_t* cc = b + 16;
        a.mjpeg = fourcc(cc, "MJPG") || fourcc(cc, "mjpg") || fourcc(cc, "JPEG") || fourcc(cc, "jpeg") || fourcc(cc, "AVRn") || fourcc(cc, "dmb1");
        if (!a.mjpeg) memcpy(a.vcodec, cc, 4);
      } else if (fourcc((const uint8_t*)curType, "auds") && stream == a.aStream) {
        a.aFormat = rd16le(b);
        a.aCh = rd16le(b + 2);
        a.aRate = rd32le(b + 4);
        a.aBits = rd16le(b + 14);
      }
    }
    p += 8 + len + (len & 1);
  }
  if (!a.moviStart || a.vStream < 0) { err = "В файле не найдено видео."; return false; }
  if (!a.mjpeg) {
    char cc[5];
    memcpy(cc, a.vcodec, 4);
    cc[4] = 0;
    err = std::string("Видео сжато кодеком ") + cc + ", а плата понимает только MJPEG. Переведите файл в приложении ESP32 Flasher → «Конвертер».";
    return false;
  }
  if (!a.usPerFrame) a.usPerFrame = 66666;
  return true;
}

// ===================== Графика интерфейса =====================
void polyS(Surface& s, const float* xs, const float* ys, int n, uint16_t c) {
  float minx = xs[0], maxx = xs[0], miny = ys[0], maxy = ys[0];
  for (int i = 1; i < n; i++) { minx = fminf(minx, xs[i]); maxx = fmaxf(maxx, xs[i]); miny = fminf(miny, ys[i]); maxy = fmaxf(maxy, ys[i]); }
  for (int py = (int)floorf(miny); py <= (int)ceilf(maxy); py++)
    for (int px = (int)floorf(minx); px <= (int)ceilf(maxx); px++) {
      if (px < s.cx0 || px >= s.cx1 || py < s.cy0 || py >= s.cy1) continue;
      int hits = 0;
      for (int sy = 0; sy < 4; sy++)
        for (int sx = 0; sx < 4; sx++) {
          float X = px + (sx + 0.5f) / 4, Y = py + (sy + 0.5f) / 4;
          bool in = false;
          for (int i = 0, j = n - 1; i < n; j = i++)
            if (((ys[i] > Y) != (ys[j] > Y)) && (X < (xs[j] - xs[i]) * (Y - ys[i]) / (ys[j] - ys[i]) + xs[i])) in = !in;
          hits += in;
        }
      blendPx(s, px, py, c, hits * 255 / 16);
    }
}

void discS(Surface& s, float cx, float cy, float r, uint16_t c) { roundRectS(s, cx - r, cy - r, 2 * r, 2 * r, r, c, 0, 0); }

void iconPlay(Surface& s, float cx, float cy, float r, uint16_t c) {
  float xs[] = { cx - r * 0.45f, cx + r * 0.65f, cx - r * 0.45f }, ys[] = { cy - r * 0.62f, cy, cy + r * 0.62f };
  polyS(s, xs, ys, 3, c);
}
void iconPause(Surface& s, float cx, float cy, float r, uint16_t c) {
  roundRectS(s, cx - r * 0.45f, cy - r * 0.55f, r * 0.32f, r * 1.1f, 1.5f, c, 0, 0);
  roundRectS(s, cx + r * 0.13f, cy - r * 0.55f, r * 0.32f, r * 1.1f, 1.5f, c, 0, 0);
}
void iconSkip(Surface& s, float cx, float cy, float r, bool fwd, uint16_t c) {
  float d = fwd ? 1 : -1;
  float xs[] = { cx - d * r * 0.55f, cx + d * r * 0.35f, cx - d * r * 0.55f }, ys[] = { cy - r * 0.5f, cy, cy + r * 0.5f };
  polyS(s, xs, ys, 3, c);
  float bx = fwd ? cx + r * 0.35f : cx - r * 0.35f - r * 0.18f;
  roundRectS(s, bx, cy - r * 0.5f, r * 0.18f, r, 1, c, 0, 0);
}
void iconFolder(Surface& s, float cx, float cy, uint16_t c) {
  roundRectS(s, cx - 9, cy - 6, 8, 4, 1.5f, c, 0, 0);
  roundRectS(s, cx - 9, cy - 4, 18, 12, 2, c, 0, 0);
}
void iconBack(Surface& s, float x, float y, uint16_t c) {
  capsuleS(s, x + 8, y - 8, x, y, 2, c);
  capsuleS(s, x, y, x + 8, y + 8, 2, c);
}

// Строка с многоточием по ширине
std::string ellipsize(const AAFont& f, const std::string& s0, int maxW) {
  std::string t = s0;
  if (textW(f, t.c_str()) <= maxW) return t;
  while (!t.empty() && textW(f, (t + "…").c_str()) > maxW) {
    size_t k = t.size() - 1;
    while (k > 0 && ((uint8_t)t[k] & 0xC0) == 0x80) k--;
    t.erase(k);
  }
  return t + "…";
}

void drawCentered(Surface& s, const AAFont& f, int cx, int base, const std::string& t, uint16_t c) {
  drawText(s, f, cx - textW(f, t.c_str()) / 2, base, t.c_str(), c);
}

// Перенос текста по словам
std::vector<std::string> wrapText(const AAFont& f, const std::string& text, int maxW) {
  std::vector<std::string> lines;
  std::string cur;
  size_t i = 0;
  while (i <= text.size()) {
    size_t j = text.find(' ', i);
    if (j == std::string::npos) j = text.size();
    std::string w = text.substr(i, j - i);
    std::string cand = cur.empty() ? w : cur + " " + w;
    if (!cur.empty() && textW(f, cand.c_str()) > maxW) { lines.push_back(cur); cur = w; }
    else cur = cand;
    i = j + 1;
  }
  if (!cur.empty()) lines.push_back(cur);
  return lines;
}

std::string fmtTime(float sec) {
  if (sec < 0) sec = 0;
  int s = (int)sec;
  char b[16];
  if (s >= 3600) snprintf(b, sizeof b, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60);
  else snprintf(b, sizeof b, "%d:%02d", s / 60, s % 60);
  return b;
}

// Рисует область экрана [y0, y1) полосами через функцию отрисовки
void renderRegion(int y0, int y1, void (*draw)(Surface&, int)) {
  for (int y = y0; y < y1; y += STRIP_H) {
    int h = std::min(STRIP_H, y1 - y);
    surfSize(sStrip, SCREEN_W, h);
    surfFill(sStrip, C_BG);
    draw(sStrip, y);
    pushPixels(0, y, SCREEN_W, h, sStrip.px);
  }
}

// ===================== Обложка =====================
DecodeTarget gDec;
void blitScaled(int bx, int by, int bw, int bh, const uint16_t* src, int stride) {
  int W = gDec.w, H = gDec.h, SW = gDec.srcW, SH = gDec.srcH;
  int tx0 = (int)(((int64_t)bx * W + SW - 1) / SW), tx1 = std::min(W, (int)(((int64_t)(bx + bw) * W + SW - 1) / SW));
  int ty0 = (int)(((int64_t)by * H + SH - 1) / SH), ty1 = std::min(H, (int)(((int64_t)(by + bh) * H + SH - 1) / SH));
  for (int ty = ty0; ty < ty1; ty++) {
    int sy = (int)((int64_t)ty * SH / H) - by;
    if (sy < 0 || sy >= bh) continue;
    for (int tx = tx0; tx < tx1; tx++) {
      int sx = (int)((int64_t)tx * SW / W) - bx;
      if (sx >= 0 && sx < bw) gDec.px[ty * W + tx] = src[sy * stride + sx];
    }
  }
}
int coverDraw(JPEGDRAW* d) {
  blitScaled(d->x, d->y, d->iWidthUsed > 0 ? d->iWidthUsed : d->iWidth, d->iHeight, d->pPixels, d->iWidth);
  return 1;
}

void loadCover() {
  if (coverPx) { free(coverPx); coverPx = nullptr; }
  if (!trk.f || !trk.info.coverLen || trk.info.coverLen > 1500000) return;
  uint8_t* buf = (uint8_t*)malloc(trk.info.coverLen);
  if (!buf) return;
  fsSeek(trk.f, trk.info.coverOff);
  int32_t got = fsReadCb(trk.f, buf, trk.info.coverLen);
  if (got == (int32_t)trk.info.coverLen && jpeg->openRAM(buf, got, coverDraw)) {
    coverPx = (uint16_t*)malloc(200 * 200 * 2);
    if (coverPx) {
      for (int i = 0; i < 200 * 200; i++) coverPx[i] = C_CARD;
      int s = 1;
      while (s < 8 && jpeg->getWidth() / (s * 2) >= 200 && jpeg->getHeight() / (s * 2) >= 200) s *= 2;
      gDec.px = coverPx; gDec.w = 200; gDec.h = 200;
      gDec.srcW = jpeg->getWidth() / s; gDec.srcH = jpeg->getHeight() / s;
      jpeg->setPixelType(RGB565_LITTLE_ENDIAN);
      if (!jpeg->decode(0, 0, s == 2 ? JPEG_SCALE_HALF : s == 4 ? JPEG_SCALE_QUARTER : s == 8 ? JPEG_SCALE_EIGHTH : 0)) { free(coverPx); coverPx = nullptr; }
    }
    jpeg->close();
  }
  free(buf);
  fsSeek(trk.f, trk.pos);
}

// ===================== Треки =====================
void closeTrack() {
  audioStop();
  if (trk.f) fsClose(trk.f);
  if (trk.in) free(trk.in);
  trk = Track();
  if (coverPx) { free(coverPx); coverPx = nullptr; }
  trackIndex = -1;
}

bool openTrack(const std::string& dir, const std::vector<Entry>& list, int idx) {
  closeTrack();
  const Entry& e = list[idx];
  std::string path = (dir == "/" ? "/" : dir + "/") + e.name;
  int32_t size;
  void* f = fsOpen(path.c_str(), &size);
  if (!f) return false;
  trk.f = f;
  trk.fileSize = size;
  trk.path = path;
  trk.name = e.name;
  trk.in = (uint8_t*)malloc(16384);
  trk.inLen = trk.inPos = 0;
  trk.eof = trk.started = trk.paused = trk.finished = false;
  if (e.kind == MK_MP3) {
    trk.type = TT_MP3;
    parseMp3Info(f, size, trk.info);
    trk.pos = trk.info.audioStart;
    trk.end = trk.info.audioEnd;
    mp3dec_init(&mp3d);
  } else if (e.kind == MK_WAV) {
    if (!parseWav(f, size, trk.wav)) { fsClose(f); trk = Track(); return false; }
    trk.type = TT_WAV;
    trk.pos = trk.wav.dataOff;
    trk.end = trk.wav.dataOff + trk.wav.dataLen;
    trk.rate = trk.wav.rate;
    trk.ch = trk.wav.ch;
    trk.duration = (float)trk.wav.dataLen / (trk.wav.rate * trk.wav.ch * (trk.wav.bits / 8));
    audioStart(trk.rate, trk.ch, 0);
    trk.started = true;
  }
  if (trk.info.title.empty()) {
    trk.info.title = e.name;
    size_t dot = trk.info.title.rfind('.');
    if (dot != std::string::npos && dot > 0) trk.info.title.resize(dot);
  }
  fsSeek(f, trk.pos);
  trackDir = dir;
  trackDirEntries = list;
  trackIndex = idx;
  loadCover();
  playerDirty = miniDirty = progDirty = listDirty = true;
  return true;
}

// Следующий или предыдущий звуковой файл в той же папке
bool stepTrack(int dir) {
  if (trackIndex < 0) return false;
  int n = trackDirEntries.size();
  for (int k = 1; k <= n; k++) {
    int i = trackIndex + dir * k;
    if (i < 0 || i >= n) return false;
    MediaKind m = trackDirEntries[i].kind;
    if (m == MK_MP3 || m == MK_WAV) {
      std::string d = trackDir;
      std::vector<Entry> l = trackDirEntries;
      return openTrack(d, l, i);
    }
  }
  return false;
}

void seekTrack(float frac) {
  if (!trk.f || trk.type == TT_NONE) return;
  frac = std::max(0.0f, std::min(0.999f, frac));
  if (trk.type == TT_MP3) {
    trk.pos = trk.info.audioStart + (uint32_t)((trk.info.audioEnd - trk.info.audioStart) * frac);
    mp3dec_init(&mp3d);
    trk.inLen = trk.inPos = 0;
    trk.eof = false;
    if (trk.started) audioStart(trk.rate, trk.ch, (uint32_t)(frac * trk.duration * trk.rate));
  } else {
    uint32_t bpf = trk.wav.ch * (trk.wav.bits / 8);
    uint32_t off = ((uint32_t)(trk.wav.dataLen * frac) / bpf) * bpf;
    trk.pos = trk.wav.dataOff + off;
    trk.eof = false;
    audioStart(trk.rate, trk.ch, off / bpf);
  }
  fsSeek(trk.f, trk.pos);
  if (trk.paused) aPause = true;
  progDirty = true;
}

void togglePause() {
  if (trk.type == TT_NONE) return;
  trk.paused = !trk.paused;
  aPause = trk.paused;
  playerDirty = miniDirty = true;
}

// Декодирует немного звука, если в кольце есть место (вызывается в каждом цикле)
void trackTick() {
  if (trk.type == TT_NONE || trk.paused || trk.finished) return;
  bool needMore = false;
  for (int iter = 0; iter < 4; iter++) {
    if (trk.type == TT_MP3) {
      if (trk.started && ringFree() < MINIMP3_MAX_SAMPLES_PER_FRAME + 64) return;
      if ((trk.inLen - trk.inPos < 4096 || needMore) && !trk.eof) {  // подчитываем файл
        needMore = false;
        memmove(trk.in, trk.in + trk.inPos, trk.inLen - trk.inPos);
        trk.inLen -= trk.inPos;
        trk.inPos = 0;
        int want = std::min<int>(16384 - trk.inLen, (int)(trk.end - trk.pos));
        int got = want > 0 ? fsReadCb(trk.f, trk.in + trk.inLen, want) : 0;
        if (got <= 0) trk.eof = true;
        else { trk.inLen += got; trk.pos += got; }
      }
      mp3dec_frame_info_t fi;
      int samples = mp3dec_decode_frame(&mp3d, trk.in + trk.inPos, trk.inLen - trk.inPos, pcmBuf, &fi);
      if (!fi.frame_bytes) {
        if (trk.eof) { trk.finished = true; return; }
        if (trk.inPos == 0 && trk.inLen >= 16384) trk.inPos = trk.inLen;  // целый буфер без кадров — мусор
        else needMore = true;                                              // кадр не дочитан — дочитываем
        continue;
      }
      trk.inPos += fi.frame_bytes;
      if (samples > 0) {
        if (!trk.started) {
          trk.rate = fi.hz;
          trk.ch = fi.channels;
          trk.bitrate = fi.bitrate_kbps;
          if (trk.info.xingFrames) trk.duration = (float)trk.info.xingFrames * samples / fi.hz;
          else if (fi.bitrate_kbps) trk.duration = (float)(trk.info.audioEnd - trk.info.audioStart) * 8 / (fi.bitrate_kbps * 1000.0f);
          audioStart(trk.rate, trk.ch, 0);
          trk.started = true;
          progDirty = true;
        }
        ringPush(pcmBuf, samples * fi.channels);
      }
    } else if (trk.type == TT_WAV) {
      uint32_t bps = trk.wav.bits / 8;
      uint32_t freeFrames = ringFree() / trk.ch;
      if (freeFrames < 512) return;
      uint32_t frames = std::min<uint32_t>(std::min<uint32_t>(freeFrames, 2048), (trk.end - trk.pos) / (bps * trk.ch));
      if (!frames) { trk.finished = true; return; }
      uint32_t bytes = frames * bps * trk.ch;
      int got = fsReadCb(trk.f, trk.in, std::min<uint32_t>(bytes, bps == 1 ? 4096 : 16384));
      if (got <= 0) { trk.finished = true; return; }
      trk.pos += got;
      int n = got / bps;
      if (bps == 1) {
        static int16_t tmp[4096];
        for (int i = 0; i < n; i++) tmp[i] = ((int)trk.in[i] - 128) * 256;
        ringPush(tmp, n);
      } else {
        ringPush((const int16_t*)trk.in, n);
      }
    }
  }
}

// ===================== Экран: список файлов =====================
int listViewH() { return SCREEN_H - BAR_H - (trk.type != TT_NONE ? MINI_H : 0); }

void loadDir(const std::string& dir) {
  std::vector<DirEnt> ents;
  entries.clear();
  sdReady = fsList(dir, ents);
  curDir = dir;
  listScroll = 0;
  for (auto& d : ents) {
    if (d.name.empty() || d.name[0] == '.' || d.name == "System Volume Information") continue;
    MediaKind k = kindOf(d.name, d.dir);
    if (k == MK_OTHER) continue;
    entries.push_back({ d.name, k, d.size });
  }
  std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
    if ((a.kind == MK_DIR) != (b.kind == MK_DIR)) return a.kind == MK_DIR;
    return lower(a.name) < lower(b.name);
  });
  listDirty = true;
}

void drawBar(Surface& s, int top, const std::string& title, bool back) {
  if (top >= BAR_H) return;
  fillRectS(s, 0, -top, SCREEN_W, BAR_H, C_BAR);
  fillRectS(s, 0, BAR_H - 1 - top, SCREEN_W, 1, C_LINE);
  if (back) iconBack(s, 16, 22 - top, C_ACCENT);
  const AAFont& f = *FONTS[FN_BOLD];
  drawText(s, f, back ? 44 : 16, 28 - top, ellipsize(f, title, SCREEN_W - 70).c_str(), C_TEXT);
}

const char* kindLabel(MediaKind k) {
  switch (k) {
    case MK_MP3: return "MP3";
    case MK_WAV: return "WAV";
    case MK_AVI: return "видео AVI";
    case MK_MP4: return "MP4 — сначала переведите в AVI";
    case MK_DIR: return "папка";
    default: return "";
  }
}

void drawEntryIcon(Surface& s, MediaKind k, float cx, float cy) {
  uint16_t c = k == MK_DIR ? C_DIR : k == MK_AVI ? C_VIDEO : k == MK_MP4 ? C_OFF : C_AUDIO;
  discS(s, cx, cy, 17, c);
  if (k == MK_DIR) iconFolder(s, cx, cy, C_TEXT);
  else if (k == MK_AVI || k == MK_MP4) iconPlay(s, cx + 1, cy, 12, C_TEXT);
  else drawCentered(s, *FONTS[FN_BOLD], (int)cx, (int)cy + 6, "♪", C_TEXT);
}

void drawMini(Surface& s, int top) {
  int y0 = SCREEN_H - MINI_H - top;
  fillRectS(s, 0, y0, SCREEN_W, MINI_H, C_CARD);
  fillRectS(s, 0, y0, SCREEN_W, 1, C_LINE);
  float k = trk.duration > 0 ? std::min(1.0f, audioClock() / trk.duration) : 0;
  fillRectS(s, 0, y0, (int)(SCREEN_W * k), 2, C_ACCENT);
  drawText(s, *FONTS[FN_BOLD], 16, y0 + 26, ellipsize(*FONTS[FN_BOLD], trk.info.title, 230).c_str(), C_TEXT);
  std::string sub = trk.info.artist.empty() ? fmtTime(audioClock()) + (trk.duration > 0 ? " / " + fmtTime(trk.duration) : std::string()) : trk.info.artist;
  drawText(s, *FONTS[FN_SMALL], 16, y0 + 46, ellipsize(*FONTS[FN_SMALL], sub, 230).c_str(), C_DIM);
  discS(s, 288, y0 + 30, 19, C_ACCENT2);
  if (trk.paused) iconPlay(s, 289, y0 + 30, 15, C_TEXT); else iconPause(s, 288, y0 + 30, 15, C_TEXT);
}

void drawWifiIcon(Surface& s, float cx, float cy, uint16_t c) {
  capsuleS(s, cx, cy, cx, cy, 1.8f, c);
  arcS(s, cx, cy + 1, 6, 2, 45, 135, c);
  arcS(s, cx, cy + 1, 11, 2, 45, 135, c);
}

void drawListStrip(Surface& s, int top) {
  std::string title = curDir == "/" ? "Медиаплеер" : fileName(curDir);
  drawBar(s, top, title, curDir != "/");
  if (top < BAR_H) drawWifiIcon(s, 296, 27 - top, wifiOn ? MK565(110, 230, 160) : C_DIM);
  int viewH = listViewH();
  if (top + s.h > BAR_H && top < BAR_H + viewH) {
    s.cy0 = std::max(0, BAR_H - top);
    s.cy1 = std::min(s.h, BAR_H + viewH - top);
    if (!sdReady || entries.empty()) {
      const char* t = !sdReady ? "SD-карта не найдена" : "Здесь нет MP3, WAV и AVI";
      const char* t2 = !sdReady ? "Вставьте microSD и нажмите сюда" : "Загрузите файлы через приложение ESP32 Flasher";
      drawCentered(s, *FONTS[FN_BOLD], SCREEN_W / 2, BAR_H + 80 - top, t, C_TEXT);
      drawCentered(s, *FONTS[FN_SMALL], SCREEN_W / 2, BAR_H + 104 - top, t2, C_DIM);
    }
    int first = std::max(0, (int)((top - BAR_H + listScroll) / ROW_H));
    for (int i = first; i < (int)entries.size(); i++) {
      int y = BAR_H + i * ROW_H - listScroll - top;
      if (y >= s.h) break;
      const Entry& e = entries[i];
      bool playing = trk.type != TT_NONE && trackDir == curDir && trackIndex == i;
      drawEntryIcon(s, e.kind, 34, y + ROW_H / 2);
      uint16_t nameC = e.kind == MK_MP4 ? C_DIM : playing ? C_ACCENT : C_TEXT;
      drawText(s, *FONTS[FN_BODY], 62, y + 25, ellipsize(*FONTS[FN_BODY], e.name, 240).c_str(), nameC);
      std::string sub = kindLabel(e.kind);
      if (e.kind != MK_DIR && e.kind != MK_MP4) sub += " · " + fmtSize(e.size);
      drawText(s, *FONTS[FN_SMALL], 62, y + 44, ellipsize(*FONTS[FN_SMALL], sub, 240).c_str(), C_DIM);
      fillRectS(s, 62, y + ROW_H - 1, SCREEN_W - 62, 1, C_LINE);
    }
    int total = entries.size() * ROW_H;
    if (total > viewH) {  // полоса прокрутки
      int bh = std::max(24, viewH * viewH / total);
      int by = BAR_H + (viewH - bh) * listScroll / (total - viewH) - top;
      roundRectS(s, SCREEN_W - 5, by, 3, bh, 1.5f, C_OFF, 0, 0);
    }
    s.cy0 = 0;
    s.cy1 = s.h;
  }
  if (trk.type != TT_NONE) drawMini(s, top);
}

void renderList() { renderRegion(0, SCREEN_H, drawListStrip); listDirty = miniDirty = false; }
void renderMini() { if (trk.type != TT_NONE) renderRegion(SCREEN_H - MINI_H, SCREEN_H, drawListStrip); miniDirty = false; }

// ===================== Экран: плеер =====================
#define COVER_X 60
#define COVER_Y 60
#define PROG_Y 352
#define CTRL_Y 418
#define VOL_Y 464

void drawPlayerStrip(Surface& s, int top) {
  drawBar(s, top, "Сейчас играет", true);
  // обложка
  int cy = COVER_Y - top;
  if (cy < s.h && cy + 200 > 0) {
    if (coverPx) {
      for (int yy = std::max(0, -cy); yy < 200 && cy + yy < s.h; yy++)
        memcpy(s.px + (cy + yy) * s.w + COVER_X, coverPx + yy * 200, 400);
    } else {
      roundRectS(s, COVER_X, cy, 200, 200, 18, C_CARD, C_LINE, 1);
      // «пластинка» вместо обложки
      discS(s, COVER_X + 100, cy + 100, 70, MK565(32, 30, 42));
      for (int r = 60; r > 30; r -= 9) {
        roundRectS(s, COVER_X + 100 - r, cy + 100 - r, 2 * r, 2 * r, r, MK565(32, 30, 42), MK565(48, 44, 62), 1);
      }
      discS(s, COVER_X + 100, cy + 100, 22, C_ACCENT2);
      discS(s, COVER_X + 100, cy + 100, 4, C_BG);
    }
  }
  drawCentered(s, *FONTS[FN_TITLE], SCREEN_W / 2, 296 - top, ellipsize(*FONTS[FN_TITLE], trk.info.title, 290), C_TEXT);
  std::string sub = trk.info.artist;
  if (!trk.info.album.empty()) sub += (sub.empty() ? "" : " — ") + trk.info.album;
  if (sub.empty()) sub = trk.type == TT_WAV ? "WAV" : (trk.bitrate ? "MP3 · " + std::to_string(trk.bitrate) + " кбит/с" : "MP3");
  drawCentered(s, *FONTS[FN_BODY], SCREEN_W / 2, 322 - top, ellipsize(*FONTS[FN_BODY], sub, 290), C_DIM);
  // полоса прогресса
  float t = audioClock(), k = trk.duration > 0 ? std::min(1.0f, t / trk.duration) : 0;
  roundRectS(s, 24, PROG_Y - top, 272, 4, 2, C_OFF, 0, 0);
  roundRectS(s, 24, PROG_Y - top, 272 * k, 4, 2, C_ACCENT, 0, 0);
  discS(s, 24 + 272 * k, PROG_Y + 2 - top, 7, C_TEXT);
  drawText(s, *FONTS[FN_SMALL], 24, PROG_Y + 24 - top, fmtTime(t).c_str(), C_DIM);
  std::string tot = trk.duration > 0 ? fmtTime(trk.duration) : "—";
  drawText(s, *FONTS[FN_SMALL], 296 - textW(*FONTS[FN_SMALL], tot.c_str()), PROG_Y + 24 - top, tot.c_str(), C_DIM);
  // кнопки
  iconSkip(s, 84, CTRL_Y - top, 20, false, C_TEXT);
  discS(s, 160, CTRL_Y - top, 32, C_ACCENT2);
  if (trk.paused) iconPlay(s, 162, CTRL_Y - top, 24, C_TEXT); else iconPause(s, 160, CTRL_Y - top, 24, C_TEXT);
  iconSkip(s, 236, CTRL_Y - top, 20, true, C_TEXT);
  // громкость
  roundRectS(s, 70, VOL_Y - 2 - top, 180, 4, 2, C_OFF, 0, 0);
  roundRectS(s, 70, VOL_Y - 2 - top, 180 * volume / 100, 4, 2, C_DIM, 0, 0);
  capsuleS(s, 30, VOL_Y - top, 42, VOL_Y - top, 1.6f, C_TEXT);
  capsuleS(s, 278, VOL_Y - top, 290, VOL_Y - top, 1.6f, C_TEXT);
  capsuleS(s, 284, VOL_Y - 6 - top, 284, VOL_Y + 6 - top, 1.6f, C_TEXT);
}

void renderPlayer() { renderRegion(0, SCREEN_H, drawPlayerStrip); playerDirty = progDirty = false; }
void renderProgress() { renderRegion(PROG_Y - 12, PROG_Y + 32, drawPlayerStrip); progDirty = false; }

// ===================== Экран: сообщение =====================
void drawMsgStrip(Surface& s, int top) {
  drawBar(s, top, msgTitle, true);
  int y = BAR_H + 40;
  size_t i = 0;
  while (i <= msgText.size()) {  // абзацы через \n
    size_t j = msgText.find('\n', i);
    if (j == std::string::npos) j = msgText.size();
    for (auto& l : wrapText(*FONTS[FN_BODY], msgText.substr(i, j - i), SCREEN_W - 40)) { drawText(s, *FONTS[FN_BODY], 20, y - top, l.c_str(), C_TEXT); y += 24; }
    y += 10;
    i = j + 1;
  }
}

void showMessage(const std::string& title, const std::string& text) {
  msgTitle = title;
  msgText = text;
  screen = SC_MSG;
  renderRegion(0, SCREEN_H, drawMsgStrip);
}

bool uiInit() {
  for (int i = 0; i < FN_COUNT; i++) if (!decodeFont(*FONTS[i])) return false;
  if (!surfAlloc(sStrip, SCREEN_W, STRIP_H)) return false;
  ring = (int16_t*)malloc(RING_SAMPLES * 2);
  jpeg = new JPEGDEC();
  return ring && jpeg;
}

// ===================== Железо =====================
#ifndef HOST_SIM
#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_BL 25
#define PIN_BOOT 0
#define PIN_SD_CS 15
#define PIN_I2S_BCLK 2
#define PIN_I2S_LRCK 4
#define PIN_I2S_DOUT 12
#define TCA9554_ADDR 0x20
#define FT6336_ADDR 0x38
#define ES8311_ADDR 0x18

Arduino_DataBus* bus = new Arduino_HWSPI(27 /* DC */, 5 /* CS */, 18 /* SCK */, 23 /* MOSI */, 19 /* MISO */, &SPI, true);
Arduino_GFX* gfx = new Arduino_ST7796(bus, GFX_NOT_DEFINED, 0, true);
I2SClass i2s;
Preferences prefs;

uint32_t nowMs() { return millis(); }
void sleepMs(uint32_t ms) { delay(ms); }
void pushPixels(int x, int y, int w, int h, const uint16_t* px) { gfx->draw16bitRGBBitmap(x, y, (uint16_t*)px, w, h); }

bool sdBegin() {
  static bool ok = false;
  if (!ok) ok = SD.begin(PIN_SD_CS, SPI, 20000000);
  return ok;
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
    if (out.size() > 500) break;
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

void tcaWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void initExpander() {
  tcaWrite(0x01, 0xFF);
  tcaWrite(0x03, 0b11111000);   // P0 — сброс LCD, P1 — сброс тача, P2 — усилитель динамика
  tcaWrite(0x01, 0b11111000);
  delay(10);
  tcaWrite(0x01, 0xFF);         // отпускаем сброс и включаем усилитель
  delay(200);
}

bool readTouch(TouchPt& t) {
  Wire.beginTransmission(FT6336_ADDR);
  Wire.write(0x02);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)FT6336_ADDR, (uint8_t)5) != 5) return false;
  uint8_t d[5];
  for (int i = 0; i < 5; i++) d[i] = Wire.read();
  uint8_t n = d[0] & 0x0F;
  if (n == 0 || n > 2) return false;
  t.x = std::min(((d[1] & 0x0F) << 8) | d[2], SCREEN_W - 1);
  t.y = std::min(((d[3] & 0x0F) << 8) | d[4], SCREEN_H - 1);
  return true;
}

// ---------- Кодек ES8311: ведомый I2S, 32 бита, MCLK от BCLK (64·fs), 44,1 кГц ----------
void esW(uint8_t reg, uint8_t v) {
  Wire.beginTransmission(ES8311_ADDR);
  Wire.write(reg);
  Wire.write(v);
  Wire.endTransmission();
}
uint8_t esR(uint8_t reg) {
  Wire.beginTransmission(ES8311_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)ES8311_ADDR, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0;
}

void es8311Init() {
  esW(0x00, 0x1F);
  delay(20);
  esW(0x00, 0x00);
  esW(0x00, 0x80);                        // включение
  esW(0x01, 0x3F | 0x80);                 // все такты, MCLK от вывода BCLK
  esW(0x06, esR(0x06) & ~(1 << 5));
  // коэффициенты для MCLK 2 822 400 Гц и 44 100 Гц (таблица драйвера Espressif)
  esW(0x02, (esR(0x02) & 0x07) | (0 << 5) | (2 << 3));
  esW(0x03, (0 << 6) | 0x10);
  esW(0x04, 0x10);
  esW(0x05, 0x00);
  esW(0x06, (esR(0x06) & 0xE0) | (4 - 1));
  esW(0x07, esR(0x07) & 0xC0);
  esW(0x08, 0xFF);
  esW(0x00, esR(0x00) & 0xBF);            // ведомый режим
  esW(0x09, 4 << 2);                       // 32 бита
  esW(0x0A, 4 << 2);
  esW(0x0D, 0x01);
  esW(0x0E, 0x02);
  esW(0x12, 0x00);                         // ЦАП включён
  esW(0x13, 0x10);                         // выход на усилитель
  esW(0x1C, 0x6A);
  esW(0x37, 0x08);
}

void audioHwVolume(int v) { esW(0x32, v <= 0 ? 0 : v * 256 / 100 - 1); }
void audioHwWrite(const int32_t* stereo, int frames) { i2s.write((uint8_t*)stereo, frames * 8); }
void saveVolume() { prefs.begin("media", false); prefs.putInt("vol", volume); prefs.end(); }

void audioTask(void*) {
  static int32_t out[256 * 2];
  for (;;) {
    audioRender(out, 256);
    audioHwWrite(out, 256);
  }
}

// ---------- Видео AVI ----------
int videoDraw(JPEGDRAW* d) {
  gfx->draw16bitBeRGBBitmap(d->x, d->y, d->pPixels, d->iWidth, d->iHeight);
  return 1;
}

bool feedAviMp3(const uint8_t* data, int n, std::vector<uint8_t>& acc, mp3dec_t& dec, uint32_t& rate, uint8_t& ch, bool& started) {
  acc.insert(acc.end(), data, data + n);
  size_t pos = 0;
  while (acc.size() - pos > 0) {
    mp3dec_frame_info_t fi;
    int samples = mp3dec_decode_frame(&dec, acc.data() + pos, acc.size() - pos, pcmBuf, &fi);
    if (!fi.frame_bytes) break;
    if (samples == 0 && acc.size() - pos < 2048) break;  // кадр целиком ещё не пришёл
    pos += fi.frame_bytes;
    if (samples > 0) {
      if (!started) { rate = fi.hz; ch = fi.channels; audioStart(rate, ch, 0); started = true; }
      ringPush(pcmBuf, samples * fi.channels);
    }
  }
  acc.erase(acc.begin(), acc.begin() + pos);
  return true;
}

void drawVideoOverlay(bool paused, const std::string& name) {
  Surface o;
  if (!surfAlloc(o, 300, 80)) return;
  surfFill(o, 0);
  if (paused) {
    roundRectS(o, 0, 0, 300, 80, 16, MK565(20, 20, 26), C_LINE, 1);
    iconPause(o, 40, 40, 20, C_TEXT);
    drawText(o, *FONTS[FN_BOLD], 72, 34, "Пауза", C_TEXT);
    drawText(o, *FONTS[FN_SMALL], 72, 56, "Тап — дальше, удержание — выход", C_DIM);
    pushPixels(90, 120, 300, 80, o.px);
  }
  free(o.px);
}

void playAvi(const std::string& path) {
  int32_t size;
  void* f = fsOpen(path.c_str(), &size);
  if (!f) { showMessage("Видео", "Не удалось открыть файл."); return; }
  AviInfo a;
  std::string err;
  if (!parseAvi(f, size, a, err)) { fsClose(f); showMessage("Видео", err); return; }
  bool wasPlaying = trk.type != TT_NONE && !trk.paused;
  float resumeAt = trk.type != TT_NONE ? audioClock() : 0;  // видео забирает звук — потом вернёмся на это место
  if (trk.type != TT_NONE) { trk.paused = true; aPause = true; }
  bool pcm = a.aStream >= 0 && a.aFormat == 1 && (a.aBits == 8 || a.aBits == 16) && a.aCh >= 1 && a.aCh <= 2;
  bool mp3 = a.aStream >= 0 && a.aFormat == 0x55;
  bool hasAudio = pcm || mp3;
  gfx->setRotation(1);
  gfx->fillScreen(0x0000);
  int s = 1;
  while (s < 8 && (a.w / s > 480 || a.h / s > 320)) s *= 2;
  int vw = a.w / s, vh = a.h / s, ox = (480 - vw) / 2, oy = (320 - vh) / 2;
  int scaleFlag = s == 2 ? JPEG_SCALE_HALF : s == 4 ? JPEG_SCALE_QUARTER : s == 8 ? JPEG_SCALE_EIGHTH : 0;
  char vid[3] = { (char)('0' + a.vStream / 10), (char)('0' + a.vStream % 10), 0 };
  char aud[3] = { (char)('0' + (a.aStream >= 0 ? a.aStream : 0) / 10), (char)('0' + (a.aStream >= 0 ? a.aStream : 0) % 10), 0 };
  std::vector<uint8_t> frame, mp3acc;
  static int16_t abuf[4096];
  mp3dec_t dec;
  mp3dec_init(&dec);
  uint32_t aRate = a.aRate;
  uint8_t aCh = a.aCh;
  bool aStarted = false;
  if (pcm) { audioStart(a.aRate, a.aCh, 0); aStarted = true; }
  uint32_t frameIdx = 0, t0 = millis(), pausedMs = 0;
  bool paused = false, exitReq = false;
  bool touchDown = false;
  uint32_t touchT = 0;
  int relCount = 0;
  uint32_t p = a.moviStart;
  uint32_t lastBar = 0;
  while (p + 8 <= a.moviEnd && !exitReq) {
    // касания и кнопка BOOT
    TouchPt tp;
    bool down = readTouch(tp);
    if (down) {
      relCount = 0;
      if (!touchDown) { touchDown = true; touchT = millis(); }
      else if (millis() - touchT > 900) exitReq = true;
    } else if (touchDown && ++relCount >= 2) {
      touchDown = false;
      paused = !paused;
      aPause = paused;
      static uint32_t pauseStart = 0;
      if (paused) { pauseStart = millis(); drawVideoOverlay(true, path); }
      else { pausedMs += millis() - pauseStart; gfx->fillRect(90, 120, 300, 80, 0x0000); }
    }
    if (!digitalRead(PIN_BOOT)) exitReq = true;
    if (paused) { delay(20); continue; }

    uint8_t c[12];
    fsSeek(f, p);
    if (fsReadCb(f, c, 12) < 8) break;
    uint32_t len = rd32le(c + 4);
    if (fourcc(c, "LIST")) { p += 12; continue; }      // «rec » и подобные — заходим внутрь
    uint32_t next = p + 8 + len + (len & 1);
    if (c[0] == vid[0] && c[1] == vid[1] && (c[2] == 'd') && (c[3] == 'c' || c[3] == 'b')) {
      float ft = frameIdx * (a.usPerFrame / 1e6f);
      float clock = (hasAudio && aStarted) ? audioClock() : (millis() - t0 - pausedMs) / 1000.0f;
      frameIdx++;
      if (len > 0 && ft >= clock - a.usPerFrame / 1e6f * 1.5f) {  // успеваем — показываем, иначе пропускаем кадр
        while (true) {
          float cl = (hasAudio && aStarted) ? audioClock() : (millis() - t0 - pausedMs) / 1000.0f;
          if (cl >= ft - 0.004f || (hasAudio && ringUsed() == 0)) break;
          delay(1);
        }
        if (frame.size() < len) frame.resize(len);
        fsSeek(f, p + 8);
        if (fsReadCb(f, frame.data(), len) == (int32_t)len && jpeg->openRAM(frame.data(), len, videoDraw)) {
          jpeg->setPixelType(RGB565_BIG_ENDIAN);
          jpeg->decode(ox, oy, scaleFlag);
          jpeg->close();
        }
      }
      if (a.totalFrames && millis() - lastBar > 500) {  // полоска прогресса внизу
        lastBar = millis();
        int w = 480 * frameIdx / a.totalFrames;
        gfx->fillRect(0, 317, w, 3, C_ACCENT);
      }
    } else if (hasAudio && c[0] == aud[0] && c[1] == aud[1] && c[2] == 'w' && c[3] == 'b' && len > 0) {
      std::vector<uint8_t> chunk(len);
      fsSeek(f, p + 8);
      int32_t got = fsReadCb(f, chunk.data(), len);
      if (got > 0) {
        if (pcm && a.aBits == 16) ringPush((const int16_t*)chunk.data(), got / 2);
        else if (pcm) {
          for (int32_t i = 0; i < got;) {
            int k = std::min<int32_t>(4096, got - i);
            for (int j = 0; j < k; j++) abuf[j] = ((int)chunk[i + j] - 128) * 256;
            ringPush(abuf, k);
            i += k;
          }
        } else feedAviMp3(chunk.data(), got, mp3acc, dec, aRate, aCh, aStarted);
      }
    }
    p = next;
  }
  // доигрываем хвост звука
  uint32_t tw = millis();
  while (hasAudio && ringUsed() > 0 && millis() - tw < 3000 && !exitReq) delay(10);
  audioStop();
  fsClose(f);
  gfx->setRotation(0);
  if (trk.type != TT_NONE) {  // возвращаем прерванный трек
    trk.paused = false;
    seekTrack(trk.duration > 0 ? resumeAt / trk.duration : 0);
    trk.paused = !wasPlaying;
    aPause = trk.paused;
  }
  screen = SC_LIST;
  listDirty = true;
  TouchPt tp2;
  while (readTouch(tp2)) delay(10);
}

// ---------- Wi-Fi: тот же API, что у прошивки «HTML с SD-карты» ----------
WebServer server(80);
File uploadFile;

String jsonEsc(const String& s) {
  String r;
  for (unsigned i = 0; i < s.length(); i++) {
    unsigned char c = s[i];
    if (c == '"' || c == '\\') { r += '\\'; r += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); r += b; }
    else r += (char)c;
  }
  return r;
}

void sendJson(int code, const String& body) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json; charset=utf-8", body);
}

bool badPath(const String& p) { return p.length() < 2 || p[0] != '/' || p.indexOf("..") >= 0; }

// Файл, который сейчас играет, нельзя трогать: сначала останавливаем звук
void releaseIfPlaying(const String& path) {
  if (trk.type == TT_NONE) return;
  String cur = trk.path.c_str();
  if (cur == path || cur.startsWith(path + "/")) { closeTrack(); trackIndex = -1; screen = SC_LIST; }
}

void apiInfo() {
  char b[160];
  bool ok = sdBegin();
  snprintf(b, sizeof b, "{\"ok\":true,\"total\":%llu,\"used\":%llu,\"card\":%s,\"app\":\"mediaplayer\"}",
           ok ? (unsigned long long)SD.totalBytes() : 0ULL, ok ? (unsigned long long)SD.usedBytes() : 0ULL, ok ? "true" : "false");
  sendJson(200, b);
}

void apiList() {
  String dir = server.hasArg("dir") ? server.arg("dir") : "/";
  std::vector<DirEnt> ents;
  if (!fsList(dir.c_str(), ents)) { sendJson(404, "{\"ok\":false,\"error\":\"Папка не найдена\"}"); return; }
  std::sort(ents.begin(), ents.end(), [](const DirEnt& a, const DirEnt& b) { if (a.dir != b.dir) return a.dir; return lower(a.name) < lower(b.name); });
  String body = "{\"ok\":true,\"dir\":\"" + jsonEsc(dir) + "\",\"items\":[";
  bool first = true;
  for (auto& e : ents) {
    if (e.name.empty() || e.name == "System Volume Information") continue;
    if (!first) body += ",";
    first = false;
    body += "{\"n\":\"" + jsonEsc(e.name.c_str()) + "\",\"d\":" + String(e.dir ? 1 : 0) + ",\"s\":" + String(e.size) + "}";
  }
  body += "]}";
  sendJson(200, body);
}

bool removeTree(const String& path) {
  File f = SD.open(path.c_str());
  if (!f) return false;
  if (!f.isDirectory()) { f.close(); return SD.remove(path.c_str()); }
  std::vector<String> kids;
  File c;
  while ((c = f.openNextFile())) {
    String n = c.name();
    int sl = n.lastIndexOf('/');
    if (sl >= 0) n = n.substring(sl + 1);
    kids.push_back((path.endsWith("/") ? path : path + "/") + n);
    c.close();
  }
  f.close();
  for (auto& k : kids) if (!removeTree(k)) return false;
  return SD.rmdir(path.c_str());
}

void apiDelete() {
  String path = server.arg("path");
  if (badPath(path)) { sendJson(400, "{\"ok\":false,\"error\":\"Неверный путь\"}"); return; }
  releaseIfPlaying(path);
  bool ok = removeTree(path);
  filesChanged = true;
  sendJson(ok ? 200 : 500, ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Не удалось удалить\"}");
}

void apiMkdir() {
  String path = server.arg("path");
  if (badPath(path)) { sendJson(400, "{\"ok\":false,\"error\":\"Неверное имя\"}"); return; }
  bool ok = SD.exists(path.c_str()) || SD.mkdir(path.c_str());
  filesChanged = true;
  sendJson(ok ? 200 : 500, ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Не удалось создать папку\"}");
}

void handleUpload() {
  HTTPUpload& up = server.upload();
  if (up.status == UPLOAD_FILE_START) {
    String dir = server.arg("dir");
    if (dir.indexOf("..") >= 0 || !dir.startsWith("/")) dir = "/";
    if (!dir.endsWith("/")) dir += "/";
    String name = up.filename;
    name.replace("/", "_");
    name.replace("\\", "_");
    String full = dir + name;
    if (trk.type != TT_NONE && !trk.paused) togglePause();  // пока идёт приём, звук прерывался бы
    releaseIfPlaying(full);
    sdBegin();
    uploadFile = SD.open(full.c_str(), FILE_WRITE);
    filesChanged = true;
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (uploadFile) uploadFile.write(up.buf, up.currentSize);
  } else if (up.status == UPLOAD_FILE_END || up.status == UPLOAD_FILE_ABORTED) {
    if (uploadFile) uploadFile.close();
  }
}

String mimeOf(const String& p) {
  String l = p;
  l.toLowerCase();
  if (l.endsWith(".html") || l.endsWith(".htm")) return "text/html; charset=utf-8";
  if (l.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (l.endsWith(".css")) return "text/css";
  if (l.endsWith(".js")) return "application/javascript";
  if (l.endsWith(".json")) return "application/json";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".gif")) return "image/gif";
  if (l.endsWith(".svg")) return "image/svg+xml";
  if (l.endsWith(".mp3")) return "audio/mpeg";
  if (l.endsWith(".wav")) return "audio/wav";
  if (l.endsWith(".avi")) return "video/x-msvideo";
  return "application/octet-stream";
}

String htmlEsc(const String& s) {
  String r;
  for (unsigned i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '<') r += "&lt;"; else if (c == '>') r += "&gt;"; else if (c == '&') r += "&amp;"; else if (c == '"') r += "&quot;"; else r += c;
  }
  return r;
}

String urlEnc(const String& s) {
  String r;
  const char* hex = "0123456789ABCDEF";
  for (unsigned i = 0; i < s.length(); i++) {
    unsigned char c = s[i];
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') r += (char)c;
    else { r += '%'; r += hex[c >> 4]; r += hex[c & 15]; }
  }
  return r;
}

// Простая страница с файлами — для браузера без приложения
void sendDirPage(const String& dir) {
  std::vector<DirEnt> ents;
  fsList(dir.c_str(), ents);
  std::sort(ents.begin(), ents.end(), [](const DirEnt& a, const DirEnt& b) { if (a.dir != b.dir) return a.dir; return lower(a.name) < lower(b.name); });
  String base = dir.endsWith("/") ? dir : dir + "/";
  String h = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Медиаплеер</title>"
             "<style>body{font:16px system-ui;margin:16px;background:#0e0f13;color:#ececf1}a{color:#ba8cff}li{margin:6px 0}small{color:#8e8aa6}</style>"
             "<h2>Медиаплеер · SD:" + htmlEsc(dir) + "</h2><ul>";
  if (dir != "/") h += "<li><a href='../'>‹ Наверх</a>";
  for (auto& e : ents) {
    if (e.name.empty() || e.name == "System Volume Information") continue;
    String n = e.name.c_str();
    h += "<li><a href='" + urlEnc(n) + (e.dir ? "/" : "") + "'>" + htmlEsc(n) + (e.dir ? "/" : "") + "</a>";
    if (!e.dir) h += " <small>" + String(fmtSize(e.size).c_str()) + "</small>";
  }
  h += "</ul><form method=post enctype=multipart/form-data action='/__upload?dir=" + urlEnc(base) + "'><b>Загрузить файлы сюда</b><br><br>"
       "<input type=file name=f multiple> <button>Отправить</button></form>";
  server.send(200, "text/html; charset=utf-8", h);
}

void handleAny() {
  String path = server.urlDecode(server.uri());
  if (path.indexOf("..") >= 0) { server.send(400, "text/plain", "bad path"); return; }
  if (!sdBegin()) { server.send(503, "text/plain; charset=utf-8", "Нет SD-карты"); return; }
  String clean = path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
  File f = SD.open(clean.c_str());
  if (!f) { server.send(404, "text/plain; charset=utf-8", "Нет такого файла: " + path); return; }
  if (f.isDirectory()) { f.close(); sendDirPage(clean); return; }
  server.streamFile(f, mimeOf(clean));
  f.close();
}

void wifiStart() {
  showMessage("Wi-Fi", "Включаю Wi-Fi…");
  String ssid, pass;
  sdBegin();
  File cfg = SD.open("/wifi.txt");  // своя сеть: первая строка — имя, вторая — пароль
  if (cfg) {
    ssid = cfg.readStringUntil('\n'); ssid.trim();
    pass = cfg.readStringUntil('\n'); pass.trim();
    cfg.close();
  }
  bool sta = false;
  if (ssid.length()) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) delay(200);
    sta = WiFi.status() == WL_CONNECTED;
  }
  if (sta) {
    wifiText = std::string("Плата в сети ") + ssid.c_str() + ".\nВ приложении ESP32 Flasher на вкладке «Файлы на карте» впишите адрес " + WiFi.localIP().toString().c_str() + " и нажмите «Проверить».";
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("ESP32-HTML", "12345678");
    wifiText = std::string(ssid.length() ? "Сеть из wifi.txt не ответила — включена своя точка доступа.\n" : "") +
               "Сеть ESP32-HTML, пароль 12345678.\nВ приложении ESP32 Flasher откройте «Файлы на карте» и нажмите «Подключиться к плате». Адрес в браузере: http://" + WiFi.softAPIP().toString().c_str();
  }
  server.on("/__upload", HTTP_POST, []() {
    if (server.hasArg("json")) sendJson(200, "{\"ok\":true}");
    else { server.sendHeader("Location", server.arg("dir")); server.send(303); }
  }, handleUpload);
  server.on("/__api/info", HTTP_GET, apiInfo);
  server.on("/__api/list", HTTP_GET, apiList);
  server.on("/__api/delete", HTTP_POST, apiDelete);
  server.on("/__api/mkdir", HTTP_POST, apiMkdir);
  server.onNotFound(handleAny);
  server.begin();
  wifiOn = true;
  showMessage("Wi-Fi включён", wifiText + "\nЧтобы выключить, нажмите значок Wi-Fi ещё раз.");
}

void wifiStop() {
  server.stop();
  WiFi.softAPdisconnect(true);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiOn = false;
  listDirty = true;
}

// ---------- Касания ----------
bool touching = false, moved = false;
int16_t downX, downY, lastY;
int32_t downScroll;
uint32_t downT, lastMoveT;
float vel = 0;
int releaseCount = 0;
int lastBoot = 1;

void openEntry(int i) {
  const Entry& e = entries[i];
  std::string full = (curDir == "/" ? "/" : curDir + "/") + e.name;
  if (e.kind == MK_DIR) { loadDir(full); return; }
  if (e.kind == MK_MP4) {
    showMessage("MP4 не поддерживается", "В файлах MP4 видео сжато кодеком H.264 — у ESP32 не хватает мощности, чтобы его показывать. Переведите ролик в AVI: приложение ESP32 Flasher → вкладка «Конвертер». Готовый файл можно сразу отправить на эту карту по Wi-Fi (значок справа вверху).");
    return;
  }
  if (e.kind == MK_AVI) { playAvi(full); return; }
  if (openTrack(curDir, entries, i)) { screen = SC_PLAYER; playerDirty = true; }
  else showMessage("Не воспроизводится", "Файл «" + e.name + "» повреждён или в неподдерживаемом формате. WAV должен быть PCM 8 или 16 бит.");
}

void onTap(int x, int y) {
  if (screen == SC_MSG) { screen = SC_LIST; listDirty = true; return; }
  if (screen == SC_PLAYER) {
    if (y < BAR_H && x < 80) { screen = SC_LIST; listDirty = true; return; }
    if (y > PROG_Y - 20 && y < PROG_Y + 20 && trk.duration > 0) { seekTrack((x - 24) / 272.0f); return; }
    if (y > CTRL_Y - 34 && y < CTRL_Y + 34) {
      if (x < 120) { if (audioClock() > 3) seekTrack(0); else stepTrack(-1); }
      else if (x < 200) togglePause();
      else stepTrack(1);
      playerDirty = true;
      return;
    }
    if (y > VOL_Y - 22) {
      if (x < 60) volume = std::max(0, volume - 5);
      else if (x > 260) volume = std::min(100, volume + 5);
      else volume = std::max(0, std::min(100, (x - 70) * 100 / 180));
      audioHwVolume(volume);
      saveVolume();
      playerDirty = true;
    }
    return;
  }
  // список
  if (y < BAR_H) {
    if (x > SCREEN_W - 60) { if (wifiOn) wifiStop(); else wifiStart(); return; }
    if (x < 80 && curDir != "/") { std::string up = dirOf(curDir); if (up.size() > 1) up.pop_back(); loadDir(up.empty() ? "/" : up); }
    return;
  }
  if (trk.type != TT_NONE && y >= SCREEN_H - MINI_H) {
    if (x > 250) togglePause();
    else { screen = SC_PLAYER; playerDirty = true; }
    return;
  }
  if (!sdReady) { loadDir(curDir); return; }
  int i = (y - BAR_H + listScroll) / ROW_H;
  if (i >= 0 && i < (int)entries.size()) openEntry(i);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  initExpander();
  SPI.begin(18, 19, 23);
  if (!gfx->begin(40000000)) Serial.println("gfx->begin() failed!");
  gfx->fillScreen(C_BG);
  analogWrite(PIN_BL, 230);
  if (!uiInit()) { Serial.println("Out of memory"); while (true) delay(1000); }
  prefs.begin("media", true);
  volume = prefs.getInt("vol", 70);
  prefs.end();
  es8311Init();
  audioHwVolume(volume);
  i2s.setPins(PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DOUT, -1, -1);
  if (!i2s.begin(I2S_MODE_STD, OUT_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) Serial.println("I2S failed");
  xTaskCreatePinnedToCore(audioTask, "audio", 4096, nullptr, 5, nullptr, 0);
  loadDir("/");
  renderList();
}

void loop() {
  uint32_t now = millis();
  trackTick();
  if (trk.type != TT_NONE && trk.finished && ringUsed() < 3u * srcCh) {  // трек закончился — следующий
    if (!stepTrack(1)) {  // это был последний: встаём в начало на паузе
      trk.finished = false;
      trk.paused = false;
      seekTrack(0);
      trk.paused = true;
      aPause = true;
      playerDirty = miniDirty = true;
    }
  }

  int boot = digitalRead(PIN_BOOT);
  if (lastBoot && !boot) togglePause();
  lastBoot = boot;

  TouchPt t;
  bool down = readTouch(t);
  if (down) {
    releaseCount = 0;
    if (!touching) {
      touching = true; moved = false; vel = 0;
      downX = t.x; downY = lastY = t.y; downScroll = listScroll; downT = lastMoveT = now;
    } else if (screen == SC_LIST && downY >= BAR_H) {
      if (abs(t.y - downY) > 8) moved = true;
      if (moved) {
        int maxScroll = std::max(0, (int)entries.size() * ROW_H - listViewH());
        int32_t ns = std::max(0, std::min(maxScroll, (int)(downScroll - (t.y - downY))));
        float dt = std::max<uint32_t>(1, now - lastMoveT);
        vel = 0.6f * vel + 0.4f * (-(t.y - lastY) / dt);
        lastY = t.y;
        lastMoveT = now;
        if (ns != listScroll) { listScroll = ns; listDirty = true; }
      }
    }
  } else if (touching && ++releaseCount >= 2) {
    touching = false;
    if (!moved) onTap(downX, downY);
    else if (now - lastMoveT > 80) vel = 0;
  }
  if (!touching && screen == SC_LIST && fabsf(vel) > 0.05f) {  // инерция
    int maxScroll = std::max(0, (int)entries.size() * ROW_H - listViewH());
    listScroll = std::max(0, std::min(maxScroll, (int)(listScroll + vel * 16)));
    vel *= 0.92f;
    if (listScroll == 0 || listScroll == maxScroll) vel = 0;
    listDirty = true;
  }

  if (wifiOn) server.handleClient();
  if (filesChanged && !touching && screen == SC_LIST) {  // приложение что-то загрузило или удалило
    filesChanged = false;
    int32_t keep = listScroll;
    loadDir(curDir);
    int maxScroll = std::max(0, (int)entries.size() * ROW_H - listViewH());
    listScroll = std::min((int)keep, maxScroll);
    if (trk.type != TT_NONE && trackDir == curDir)
      for (int i = 0; i < (int)entries.size(); i++) if (entries[i].name == trk.name) trackIndex = i;
  }

  static uint32_t lastUi = 0;
  bool tickUi = now - lastUi > 300;
  if (tickUi) lastUi = now;
  if (screen == SC_LIST) {
    if (listDirty) renderList();
    else if (trk.type != TT_NONE && (miniDirty || (tickUi && !trk.paused))) renderMini();
  } else if (screen == SC_PLAYER) {
    if (trk.type == TT_NONE) { screen = SC_LIST; listDirty = true; }
    else if (playerDirty) renderPlayer();
    else if (progDirty || (tickUi && !trk.paused)) renderProgress();
  }
  delay(2);
}
#endif
