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
#include <BluetoothA2DPSource.h>  // библиотека ESP32-A2DP (Phil Schatzmann)
#include <esp_gap_bt_api.h>
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
#define HDR_H 96                    // шапка медиатеки
#define CARD_W 144
#define CARD_H 176
#define CARD_GAP 10
#define HERO_W 296
#define HERO_H 176
#define MINI_Y 408                  // мини-плеер
#define THUMB_MAX 12
#define PROG_X 66                   // плеер
#define PROG_W 188
#define PROG_Y 186
#define TR_Y 204
#define DPAD_X 98
#define DPAD_Y 376
#define DPAD_R 78
#define KEY_X 190
#define KEY_Y 298
#define VOL_X 262
#define VOL_Y 298
#define VOL_TOP 334
#define VOL_BOT 424
#define BT_DELAY 0.22f              // задержка звука в Bluetooth-наушниках, с
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
#define C_WHITE    MK565(255, 255, 255)
#define C_BLACK    0x0000
#define C_INK      MK565(20, 20, 24)
#define C_BLUE     MK565(47, 140, 255)
#define C_GREEN    MK565(60, 215, 125)
#define C_TXT2     MK565(178, 180, 190)
#define C_TXT3     MK565(124, 126, 136)
#define C_PANEL0   MK565(46, 47, 53)
#define C_PANEL1   MK565(26, 27, 31)
#define C_INSET    MK565(15, 16, 19)
#define C_KEY0     MK565(72, 73, 80)
#define C_KEY1     MK565(44, 45, 51)

enum FontId : uint8_t { FN_BODY, FN_BOLD, FN_SMALL, FN_TITLE, FN_TINY, FN_SEMI, FN_COUNT };
enum MediaKind : uint8_t { MK_NONE, MK_DIR, MK_MP3, MK_WAV, MK_AVI, MK_MP4, MK_OTHER };
enum Screen : uint8_t { SC_LIST, SC_PLAYER, SC_MSG, SC_COVER, SC_BT };
enum BtState : uint8_t { BT_OFF, BT_SCAN, BT_LINK, BT_ON };
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
struct JDec { uint16_t* px; int w, h; };
struct BtDev { char name[33]; int8_t rssi; };
struct Thumb { std::string key; uint16_t* px; uint32_t used; };
struct HitRect { int x, y, w, h; };
struct LibLayout { bool hero; int heroY, secY, gridY, rows, total; };
struct HeroInfo { bool now; int idx; MediaKind kind; std::string title, sub, badge, tag1, tag2, key, path; };

// ===================== Шрифты =====================
#include "fonts.h"
AAFont* FONTS[FN_COUNT] = { &FN_BODY_F, &FN_BOLD_F, &FN_SMALL_F, &FN_TITLE_F, &FN_TINY_F, &FN_SEMI_F };

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
int tab = 0;                        // 0 — всё, 1 — музыка, 2 — видео
std::vector<int> view;              // карточки (индексы entries)
std::vector<int> heroList;          // что можно показать в большой карточке
int heroPos = 0;                    // -1 — то, что играет
bool shuffleOn = false;
int repeatMode = 0;                 // 0 — нет, 1 — все, 2 — один
Screen msgBack = SC_LIST;
uint16_t* bgPx = nullptr;           // размытый фон 320×480
uint16_t* heroPx = nullptr;
std::string heroKey;
bool heroOk = false;
uint16_t* cover80 = nullptr;
uint16_t* cover42 = nullptr;
uint16_t* coverBig = nullptr;
std::vector<Thumb> thumbs;
uint32_t thumbClock = 0;
bool thumbPending = false;
LibLayout lay;
void (*renderIdle)() = nullptr;     // звук не должен заикаться во время долгой отрисовки
volatile uint8_t btState = BT_OFF;  // Bluetooth-наушники
volatile bool btOut = false;        // звук идёт в наушники, а не в динамик
BtDev btDevs[8];
volatile int btDevCount = 0;
volatile uint32_t btDevsVer = 0;
char btTarget[33] = "";             // к кому подключаться
char btName[33] = "";               // кто подключён
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
void prepareTrackArt();
void btEnable();
void btDisable();
void btConnect(const char* name);
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
    if (bgPx) memcpy(sStrip.px, bgPx + y * SCREEN_W, (size_t)SCREEN_W * h * 2);
    else surfFill(sStrip, C_BG);
    draw(sStrip, y);
    pushPixels(0, y, SCREEN_W, h, sStrip.px);
    if (renderIdle) renderIdle();
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
  heroKey.clear();
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
  prepareTrackArt();
  playerDirty = miniDirty = progDirty = listDirty = true;
  return true;
}

// Следующий или предыдущий звуковой файл в той же папке
// (с учётом перемешивания и повтора всей папки)
bool stepTrack(int dir) {
  if (trackIndex < 0) return false;
  std::vector<int> audio;
  int cur = -1;
  for (int i = 0; i < (int)trackDirEntries.size(); i++) {
    MediaKind m = trackDirEntries[i].kind;
    if (m != MK_MP3 && m != MK_WAV) continue;
    if (i == trackIndex) cur = audio.size();
    audio.push_back(i);
  }
  if (audio.empty()) return false;
  int next;
  if (shuffleOn && audio.size() > 1) {
    do next = audio[rand() % audio.size()]; while (next == trackIndex);
  } else {
    int p = cur + dir, n = audio.size();
    if (p < 0 || p >= n) {
      if (repeatMode != 1) return false;
      p = (p + n) % n;
    }
    next = audio[p];
  }
  std::string d = trackDir;
  std::vector<Entry> l = trackDirEntries;
  return openTrack(d, l, next);
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

// ===================== Стиль интерфейса =====================
// Медиатека — «стекло» поверх размытой обложки, плеер — тёмная панель-пульт.
static inline uint16_t blendA(uint16_t bg, uint16_t fg, int a) {  // a: 0…255
  uint32_t rb = bg & 0xF81F;
  rb += (((fg & 0xF81F) - rb) * (uint32_t)(a >> 2)) >> 6;
  uint32_t g = bg & 0x07E0;
  g += (((fg & 0x07E0) - g) * (uint32_t)a) >> 8;
  return (uint16_t)((rb & 0xF81F) | (g & 0x07E0));
}

// Скруглённый прямоугольник: заливка с градиентом цвета и прозрачности, рамка 1 px
void rrectX(Surface& s, float x, float y, float w, float h, float r, uint16_t c0, uint16_t c1, int a0, int a1, bool horiz, uint16_t bc, int ba) {
  if (w <= 0 || h <= 0) return;
  float hx = w * 0.5f, hy = h * 0.5f, cx = x + hx, cy = y + hy;
  if (r > hx) r = hx;
  if (r > hy) r = hy;
  int X0 = std::max((int)floorf(x), s.cx0), X1 = std::min((int)ceilf(x + w), s.cx1);
  int Y0 = std::max((int)floorf(y), s.cy0), Y1 = std::min((int)ceilf(y + h), s.cy1);
  bool grad = c0 != c1 || a0 != a1;
  uint16_t c = c0;
  int a = a0;
  for (int py = Y0; py < Y1; py++) {
    float qy = fabsf(py + 0.5f - cy) - (hy - r);
    if (grad && !horiz) {
      int t = (int)(clamp01((py + 0.5f - y) / h) * 255);
      c = mix565(c0, c1, t);
      a = a0 + (a1 - a0) * t / 255;
    }
    uint16_t* row = s.px + py * s.w;
    for (int px = X0; px < X1; px++) {
      float qx = fabsf(px + 0.5f - cx) - (hx - r);
      float d = (qx > 0 && qy > 0) ? sqrtf(qx * qx + qy * qy) - r : fmaxf(qx, qy) - r;
      float cov = clamp01(0.5f - d);
      if (cov <= 0) continue;
      if (grad && horiz) {
        int t = (int)(clamp01((px + 0.5f - x) / w) * 255);
        c = mix565(c0, c1, t);
        a = a0 + (a1 - a0) * t / 255;
      }
      if (ba > 0) {
        float in = clamp01(0.5f - (d + 1.0f));
        int fa = (int)(in * a);
        if (fa > 0) row[px] = fa >= 255 ? c : blendA(row[px], c, fa);
        int ea = (int)((cov - in) * ba);
        if (ea > 0) row[px] = blendA(row[px], bc, ea);
      } else {
        int fa = (int)(cov * a);
        if (fa > 0) row[px] = fa >= 255 ? c : blendA(row[px], c, fa);
      }
    }
  }
}
void rr(Surface& s, float x, float y, float w, float h, float r, uint16_t c, int a) { rrectX(s, x, y, w, h, r, c, c, a, a, false, 0, 0); }
void glass(Surface& s, float x, float y, float w, float h, float r, int a) { rrectX(s, x, y, w, h, r, C_WHITE, C_WHITE, a, a, false, C_WHITE, std::min(255, a + 34)); }
void outline(Surface& s, float x, float y, float w, float h, float r, uint16_t c, int a) { rrectX(s, x, y, w, h, r, c, c, 0, 0, false, c, a); }

// Картинка w×h со скруглёнными углами
void imageRound(Surface& s, int x, int y, int w, int h, float r, const uint16_t* img) {
  float hx = w * 0.5f, hy = h * 0.5f, cx = x + hx, cy = y + hy;
  int X0 = std::max(x, s.cx0), X1 = std::min(x + w, s.cx1), Y0 = std::max(y, s.cy0), Y1 = std::min(y + h, s.cy1);
  for (int py = Y0; py < Y1; py++) {
    float qy = fabsf(py + 0.5f - cy) - (hy - r);
    const uint16_t* src = img + (py - y) * w - x;
    uint16_t* row = s.px + py * s.w;
    for (int px = X0; px < X1; px++) {
      float qx = fabsf(px + 0.5f - cx) - (hx - r);
      if (qx <= -1 && qy <= -1) { row[px] = src[px]; continue; }
      float d = (qx > 0 && qy > 0) ? sqrtf(qx * qx + qy * qy) - r : fmaxf(qx, qy) - r;
      int a = (int)(clamp01(0.5f - d) * 255);
      if (a >= 255) row[px] = src[px];
      else if (a > 0) row[px] = blendA(row[px], src[px], a);
    }
  }
}

int capBase(const AAFont& f, float y, float h) { return (int)(y + (h + f.asc * 0.74f) * 0.5f + 0.5f); }

// Заглавные буквы (латиница и кириллица в UTF-8)
std::string upperRu(const std::string& s) {
  std::string r;
  r.reserve(s.size());
  for (size_t i = 0; i < s.size(); i++) {
    unsigned char c = s[i];
    if (c >= 'a' && c <= 'z') r += (char)(c - 32);
    else if (c == 0xD0 && i + 1 < s.size()) {
      unsigned char d = s[++i];
      r += (char)0xD0;
      r += (char)(d >= 0xB0 && d <= 0xBF ? d - 0x20 : d);
    } else if (c == 0xD1 && i + 1 < s.size()) {
      unsigned char d = s[++i];
      if (d >= 0x80 && d <= 0x8F) { r += (char)0xD0; r += (char)(d + 0x20); }
      else if (d == 0x91) { r += (char)0xD0; r += (char)0x81; }
      else { r += (char)c; r += (char)d; }
    } else r += (char)c;
  }
  return r;
}
static int utf8Len(unsigned char c) { return c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1; }
// Текст с разрядкой (для подписей капсом, как на пульте)
int trackedW(const AAFont& f, const std::string& t, int sp) {
  int w = 0;
  for (size_t i = 0; i < t.size(); i += utf8Len(t[i])) w += textWN(f, t.c_str() + i, utf8Len(t[i])) + sp;
  return t.empty() ? 0 : w - sp;
}
int drawTracked(Surface& s, const AAFont& f, int x, int base, const std::string& t, int sp, uint16_t col) {
  for (size_t i = 0; i < t.size(); i += utf8Len(t[i])) x = drawTextN(s, f, x, base, t.c_str() + i, utf8Len(t[i]), col) + sp;
  return x - sp;
}

std::string stemOf(const std::string& name) {
  size_t dot = name.rfind('.');
  return dot != std::string::npos && dot > 0 ? name.substr(0, dot) : name;
}
std::string joinDir(const std::string& dir, const std::string& name) { return (dir == "/" ? "/" : dir + "/") + name; }
uint32_t hashStr(const std::string& s) {
  uint32_t h = 2166136261u;
  for (unsigned char c : s) { h ^= c; h *= 16777619u; }
  return h;
}

// ---------- Значки ----------
void iconChevron(Surface& s, float cx, float cy, float sz, int dir, uint16_t c) {
  float d = dir * sz * 0.5f;
  capsuleS(s, cx - d, cy - sz, cx + d, cy, 1.6f, c);
  capsuleS(s, cx + d, cy, cx - d, cy + sz, 1.6f, c);
}
void iconNote(Surface& s, float cx, float cy, float sz, uint16_t c) {
  float hr = sz * 0.17f;
  discS(s, cx - sz * 0.12f, cy + sz * 0.3f, hr, c);
  capsuleS(s, cx + sz * 0.03f, cy + sz * 0.3f, cx + sz * 0.03f, cy - sz * 0.42f, sz * 0.05f, c);
  capsuleS(s, cx + sz * 0.03f, cy - sz * 0.42f, cx + sz * 0.3f, cy - sz * 0.22f, sz * 0.055f, c);
  capsuleS(s, cx + sz * 0.3f, cy - sz * 0.22f, cx + sz * 0.3f, cy - sz * 0.08f, sz * 0.05f, c);
}
void iconFolderBig(Surface& s, float cx, float cy, float sz, uint16_t c) {
  roundRectS(s, cx - sz * 0.5f, cy - sz * 0.4f, sz * 0.42f, sz * 0.22f, sz * 0.07f, c, 0, 0);
  roundRectS(s, cx - sz * 0.5f, cy - sz * 0.28f, sz, sz * 0.66f, sz * 0.09f, c, 0, 0);
}
void iconRewind(Surface& s, float cx, float cy, float r, bool fwd, uint16_t c) {
  float d = fwd ? 1 : -1;
  for (int k = 0; k < 2; k++) {
    float ox = cx + d * (k ? r * 0.38f : -r * 0.38f);
    float xs[] = { ox - d * r * 0.42f, ox + d * r * 0.42f, ox - d * r * 0.42f }, ys[] = { cy - r * 0.48f, cy, cy + r * 0.48f };
    polyS(s, xs, ys, 3, c);
  }
}
void iconStop(Surface& s, float cx, float cy, float r, uint16_t c) { roundRectS(s, cx - r * 0.45f, cy - r * 0.45f, r * 0.9f, r * 0.9f, 1.5f, c, 0, 0); }
void iconShuffle(Surface& s, float cx, float cy, uint16_t c) {
  capsuleS(s, cx - 7, cy - 4, cx + 6, cy + 4, 1.3f, c);
  capsuleS(s, cx - 7, cy + 4, cx + 6, cy - 4, 1.3f, c);
  float xa[] = { cx + 4, cx + 9, cx + 4 }, ya[] = { cy - 7, cy - 4, cy - 1 };
  polyS(s, xa, ya, 3, c);
  float xb[] = { cx + 4, cx + 9, cx + 4 }, yb[] = { cy + 1, cy + 4, cy + 7 };
  polyS(s, xb, yb, 3, c);
}
void iconSpeaker(Surface& s, float cx, float cy, uint16_t c) {
  roundRectS(s, cx - 8, cy - 3, 4, 6, 1, c, 0, 0);
  float xs[] = { cx - 5, cx + 1, cx + 1, cx - 5 }, ys[] = { cy - 3, cy - 7, cy + 7, cy + 3 };
  polyS(s, xs, ys, 4, c);
  arcS(s, cx + 1, cy, 4.5f, 1.4f, -50, 50, c);
  arcS(s, cx + 1, cy, 8, 1.4f, -50, 50, c);
}
void iconExpand(Surface& s, float cx, float cy, uint16_t c) {
  capsuleS(s, cx - 4, cy + 4, cx + 4, cy - 4, 1.2f, c);
  capsuleS(s, cx + 1, cy - 5, cx + 5, cy - 5, 1.2f, c);
  capsuleS(s, cx + 5, cy - 5, cx + 5, cy - 1, 1.2f, c);
  capsuleS(s, cx - 5, cy + 1, cx - 5, cy + 5, 1.2f, c);
  capsuleS(s, cx - 5, cy + 5, cx - 1, cy + 5, 1.2f, c);
}
void drawWifiIcon(Surface& s, float cx, float cy, uint16_t c) {
  capsuleS(s, cx, cy, cx, cy, 1.8f, c);
  arcS(s, cx, cy + 1, 6, 2, 45, 135, c);
  arcS(s, cx, cy + 1, 11, 2, 45, 135, c);
}
void iconBt(Surface& s, float cx, float cy, uint16_t c) {
  capsuleS(s, cx, cy - 9, cx, cy + 9, 1.3f, c);
  capsuleS(s, cx, cy - 9, cx + 5, cy - 4.5f, 1.3f, c);
  capsuleS(s, cx + 5, cy - 4.5f, cx - 5, cy + 4.5f, 1.3f, c);
  capsuleS(s, cx, cy + 9, cx + 5, cy + 4.5f, 1.3f, c);
  capsuleS(s, cx + 5, cy + 4.5f, cx - 5, cy - 4.5f, 1.3f, c);
}
void iconHeadphones(Surface& s, float cx, float cy, uint16_t c) {
  arcS(s, cx, cy + 1, 7, 1.8f, 0, 180, c);
  roundRectS(s, cx - 9, cy + 1, 4, 7, 1.5f, c, 0, 0);
  roundRectS(s, cx + 5, cy + 1, 4, 7, 1.5f, c, 0, 0);
}
// Кольцо прогресса: от «12 часов» по часовой стрелке
void arcProgress(Surface& s, float cx, float cy, float r, float th, float k, uint16_t c) {
  if (k <= 0) return;
  if (k > 1) k = 1;
  float a0 = 90 - 360 * k;
  if (a0 >= -180) arcS(s, cx, cy, r, th, a0, 90, c);
  else { arcS(s, cx, cy, r, th, -180, 90, c); arcS(s, cx, cy, r, th, a0 + 360, 180, c); }
}

// Обложка-заглушка: градиент по имени файла и крупный значок
static const uint16_t ART_PAL[6][2] = {
  { MK565(124, 58, 237), MK565(190, 24, 93) }, { MK565(14, 116, 144), MK565(30, 41, 99) },
  { MK565(234, 88, 12), MK565(159, 18, 57) },  { MK565(37, 99, 235), MK565(55, 48, 163) },
  { MK565(5, 150, 105), MK565(17, 94, 89) },   { MK565(219, 39, 119), MK565(88, 28, 135) },
};
void drawArt(Surface& s, float x, float y, float w, float h, float r, const std::string& name, MediaKind k) {
  const uint16_t* p = ART_PAL[hashStr(name) % 6];
  rrectX(s, x, y, w, h, r, p[0], p[1], 255, 255, false, 0, 0);
  float m = std::min(w, h);
  rr(s, x + w * 0.62f - m * 0.3f, y + h * 0.34f - m * 0.3f, m * 0.6f, m * 0.6f, m * 0.3f, C_WHITE, 24);
  uint16_t ic = mix565(p[0], C_WHITE, 225);
  if (k == MK_DIR) iconFolderBig(s, x + w * 0.5f, y + h * 0.4f, m * 0.36f, ic);
  else if (k == MK_AVI || k == MK_MP4) iconPlay(s, x + w * 0.52f, y + h * 0.4f, m * 0.22f, ic);
  else iconNote(s, x + w * 0.5f, y + h * 0.4f, m * 0.38f, ic);
}

// Капсула с текстом, возвращает ширину
int pill(Surface& s, int x, int y, int h, const std::string& t, const AAFont& f, uint16_t fill, int fa, uint16_t txt, int padX) {
  int w = textW(f, t.c_str()) + padX * 2;
  rrectX(s, x, y, w, h, h * 0.5f, fill, fill, fa, fa, false, C_WHITE, fill == C_WHITE || fa < 140 ? std::min(255, fa + 34) : 0);
  drawText(s, f, x + padX, capBase(f, y, h), t.c_str(), txt);
  return w;
}

// ---------- Картинки: масштаб, фон, JPEG ----------
// Вписывает изображение с обрезкой краёв (как object-fit: cover)
void scaleFill(const uint16_t* src, int sw, int sh, uint16_t* dst, int dw, int dh) {
  float k = std::max((float)dw / sw, (float)dh / sh);
  float step = 1.0f / k, ox = (sw - dw * step) * 0.5f, oy = (sh - dh * step) * 0.5f;
  for (int y = 0; y < dh; y++)
    for (int x = 0; x < dw; x++) {
      uint32_t R = 0, G = 0, B = 0, n = 0;
      if (step > 1.5f) {  // уменьшение: среднее по области
        int x0 = (int)(ox + x * step), x1 = std::max(x0 + 1, (int)(ox + (x + 1) * step));
        int y0 = (int)(oy + y * step), y1 = std::max(y0 + 1, (int)(oy + (y + 1) * step));
        int st = std::max(1, (x1 - x0) / 3);
        for (int yy = y0; yy < y1 && yy < sh; yy += st)
          for (int xx = x0; xx < x1 && xx < sw; xx += st) {
            uint16_t c = src[yy * sw + xx];
            R += c >> 11; G += (c >> 5) & 63; B += c & 31; n++;
          }
        dst[y * dw + x] = n ? (uint16_t)(((R / n) << 11) | ((G / n) << 5) | (B / n)) : 0;
      } else {  // увеличение: билинейно
        float sx = ox + (x + 0.5f) * step - 0.5f, sy = oy + (y + 0.5f) * step - 0.5f;
        int ix = std::max(0, std::min(sw - 2, (int)floorf(sx))), iy = std::max(0, std::min(sh - 2, (int)floorf(sy)));
        float fx = clamp01(sx - ix), fy = clamp01(sy - iy);
        uint16_t c00 = src[iy * sw + ix], c10 = src[iy * sw + ix + 1], c01 = src[(iy + 1) * sw + ix], c11 = src[(iy + 1) * sw + ix + 1];
        float w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        float r = (c00 >> 11) * w00 + (c10 >> 11) * w10 + (c01 >> 11) * w01 + (c11 >> 11) * w11;
        float g = ((c00 >> 5) & 63) * w00 + ((c10 >> 5) & 63) * w10 + ((c01 >> 5) & 63) * w01 + ((c11 >> 5) & 63) * w11;
        float b = (c00 & 31) * w00 + (c10 & 31) * w10 + (c01 & 31) * w01 + (c11 & 31) * w11;
        dst[y * dw + x] = (uint16_t)(((int)(r + 0.5f) << 11) | ((int)(g + 0.5f) << 5) | (int)(b + 0.5f));
      }
    }
}

static const uint8_t BAYER4[16] = { 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };
static inline uint16_t rgbDither(float r, float g, float b, int x, int y) {
  float d = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5f) / 16.0f;
  int R = (int)(r * (31.0f / 255) + d), G = (int)(g * (63.0f / 255) + d), B = (int)(b * (31.0f / 255) + d);
  R = R < 0 ? 0 : R > 31 ? 31 : R;
  G = G < 0 ? 0 : G > 63 ? 63 : G;
  B = B < 0 ? 0 : B > 31 ? 31 : B;
  return (uint16_t)((R << 11) | (G << 5) | B);
}

// Размытый фон экрана: из обложки (сетка средних цветов, плавно растянутая) или по умолчанию
void makeBackdrop(const uint16_t* src, int sw, int sh) {
  if (!bgPx) bgPx = (uint16_t*)malloc(SCREEN_W * SCREEN_H * 2);
  if (!bgPx) return;
  const int GX = 4, GY = 6;
  static const uint8_t DEF[GY][GX][3] = {
    { { 42, 48, 72 }, { 74, 62, 92 }, { 62, 54, 84 }, { 30, 36, 60 } },
    { { 96, 74, 62 }, { 150, 116, 84 }, { 104, 84, 96 }, { 52, 52, 84 } },
    { { 60, 92, 112 }, { 124, 102, 124 }, { 160, 96, 72 }, { 72, 62, 104 } },
    { { 40, 72, 94 }, { 92, 62, 116 }, { 136, 82, 62 }, { 60, 72, 104 } },
    { { 30, 40, 62 }, { 72, 60, 92 }, { 84, 62, 72 }, { 40, 50, 82 } },
    { { 20, 24, 38 }, { 36, 34, 54 }, { 44, 40, 54 }, { 24, 28, 46 } },
  };
  float G[GY][GX][3];
  for (int gy = 0; gy < GY; gy++)
    for (int gx = 0; gx < GX; gx++) {
      float r = DEF[gy][gx][0], g = DEF[gy][gx][1], b = DEF[gy][gx][2];
      if (src) {
        float cw = sw, ch = sh;
        if (cw / ch > 2.0f / 3) cw = ch * 2 / 3; else ch = cw * 3 / 2;
        float ox = (sw - cw) / 2, oy = (sh - ch) / 2;
        int x0 = (int)(ox + cw * gx / GX), x1 = (int)(ox + cw * (gx + 1) / GX), y0 = (int)(oy + ch * gy / GY), y1 = (int)(oy + ch * (gy + 1) / GY);
        float R = 0, Gg = 0, B = 0;
        int n = 0;
        for (int y = y0; y < y1; y += 2)
          for (int x = x0; x < x1; x += 2) {
            uint16_t c = src[y * sw + x];
            R += (c >> 11) * 8.2258f; Gg += ((c >> 5) & 63) * 4.0476f; B += (c & 31) * 8.2258f; n++;
          }
        if (n) { r = R / n; g = Gg / n; b = B / n; }
        float l = 0.3f * r + 0.59f * g + 0.11f * b;  // чуть сочнее и темнее
        r = (l + (r - l) * 1.3f) * 0.6f; g = (l + (g - l) * 1.3f) * 0.6f; b = (l + (b - l) * 1.3f) * 0.6f;
      } else { r *= 0.7f; g *= 0.7f; b *= 0.7f; }
      G[gy][gx][0] = r; G[gy][gx][1] = g; G[gy][gx][2] = b;
    }
  for (int y = 0; y < SCREEN_H; y++) {
    float gyf = (y + 0.5f) * GY / SCREEN_H - 0.5f;
    int iy = std::max(0, std::min(GY - 2, (int)floorf(gyf)));
    float ty = clamp01(gyf - iy);
    ty = ty * ty * (3 - 2 * ty);
    float dy = (y - SCREEN_H * 0.45f) / (SCREEN_H * 0.6f);
    for (int x = 0; x < SCREEN_W; x++) {
      float gxf = (x + 0.5f) * GX / SCREEN_W - 0.5f;
      int ix = std::max(0, std::min(GX - 2, (int)floorf(gxf)));
      float tx = clamp01(gxf - ix);
      tx = tx * tx * (3 - 2 * tx);
      float dx = (x - SCREEN_W * 0.5f) / (SCREEN_W * 0.6f), v = 1 - 0.32f * (dx * dx + dy * dy);
      float c[3];
      for (int k = 0; k < 3; k++) {
        float top = G[iy][ix][k] + (G[iy][ix + 1][k] - G[iy][ix][k]) * tx;
        float bot = G[iy + 1][ix][k] + (G[iy + 1][ix + 1][k] - G[iy + 1][ix][k]) * tx;
        c[k] = (top + (bot - top) * ty) * v;
      }
      bgPx[y * SCREEN_W + x] = rgbDither(c[0], c[1], c[2], x, y);
    }
  }
}

JDec gJ;
int jpegToBuf(JPEGDRAW* d) {
  int bw = d->iWidthUsed > 0 ? d->iWidthUsed : d->iWidth;
  for (int yy = 0; yy < d->iHeight; yy++) {
    int Y = d->y + yy;
    if (Y >= gJ.h) break;
    for (int xx = 0; xx < bw; xx++) {
      int X = d->x + xx;
      if (X < gJ.w) gJ.px[Y * gJ.w + X] = d->pPixels[yy * d->iWidth + xx];
    }
  }
  return 1;
}
// JPEG в буфер с масштабом 1/2/4/8 так, чтобы было не меньше minW×minH
uint16_t* decodeJpeg(uint8_t* data, int len, int minW, int minH, int* outW, int* outH) {
  if (!jpeg->openRAM(data, len, jpegToBuf)) return nullptr;
  int W = jpeg->getWidth(), H = jpeg->getHeight(), s = 1;
  while (s < 8 && W / (s * 2) >= minW && H / (s * 2) >= minH) s *= 2;
  int w = W / s, h = H / s;
  uint16_t* px = w > 0 && h > 0 ? (uint16_t*)calloc((size_t)w * h, 2) : nullptr;
  if (!px) { jpeg->close(); return nullptr; }
  gJ.px = px; gJ.w = w; gJ.h = h;
  jpeg->setPixelType(RGB565_LITTLE_ENDIAN);
  int ok = jpeg->decode(0, 0, s == 2 ? JPEG_SCALE_HALF : s == 4 ? JPEG_SCALE_QUARTER : s == 8 ? JPEG_SCALE_EIGHTH : 0);
  jpeg->close();
  if (!ok) { free(px); return nullptr; }
  *outW = w;
  *outH = h;
  return px;
}
bool loadJpegFill(void* f, uint32_t off, uint32_t len, uint16_t* dst, int dw, int dh) {
  if (!len || len > 1500000) return false;
  uint8_t* buf = (uint8_t*)malloc(len);
  if (!buf) return false;
  fsSeek(f, off);
  bool ok = fsReadCb(f, buf, len) == (int32_t)len;
  int w = 0, h = 0;
  uint16_t* img = ok ? decodeJpeg(buf, len, dw, dh, &w, &h) : nullptr;
  free(buf);
  if (!img) return false;
  scaleFill(img, w, h, dst, dw, dh);
  free(img);
  return true;
}
// Картинка для файла: обложка из тегов MP3 или первый кадр AVI
bool loadArt(const std::string& path, MediaKind k, uint16_t* dst, int dw, int dh) {
  int32_t size;
  void* f = fsOpen(path.c_str(), &size);
  if (!f) return false;
  bool ok = false;
  if (k == MK_MP3) {
    TrackInfo ti = TrackInfo();
    parseMp3Info(f, size, ti);
    ok = loadJpegFill(f, ti.coverOff, ti.coverLen, dst, dw, dh);
  } else if (k == MK_AVI) {
    AviInfo a;
    std::string err;
    if (parseAvi(f, size, a, err)) {
      uint32_t p = a.moviStart;
      for (int n = 0; n < 300 && p + 8 <= a.moviEnd; n++) {
        uint8_t c[12];
        fsSeek(f, p);
        if (fsReadCb(f, c, 12) < 8) break;
        uint32_t len = rd32le(c + 4);
        if (fourcc(c, "LIST")) { p += 12; continue; }
        if (c[2] == 'd' && (c[3] == 'c' || c[3] == 'b') && len > 0) { ok = loadJpegFill(f, p + 8, len, dst, dw, dh); break; }
        p += 8 + len + (len & 1);
      }
    }
  }
  fsClose(f);
  return ok;
}

// ---------- Кэш миниатюр карточек ----------
Thumb* thumbFind(const std::string& key) {
  for (auto& t : thumbs)
    if (t.key == key) { t.used = ++thumbClock; return &t; }
  return nullptr;
}
void thumbPut(const std::string& key, uint16_t* px) {
  int withPx = 0;
  for (auto& t : thumbs) withPx += t.px != nullptr;
  if (px && withPx >= THUMB_MAX) {
    size_t old = SIZE_MAX;
    for (size_t i = 0; i < thumbs.size(); i++)
      if (thumbs[i].px && (old == SIZE_MAX || thumbs[i].used < thumbs[old].used)) old = i;
    if (old != SIZE_MAX) { free(thumbs[old].px); thumbs.erase(thumbs.begin() + old); }
  }
  if (thumbs.size() > 64) {  // старые неудачи
    for (size_t i = 0; i < thumbs.size(); i++)
      if (!thumbs[i].px) { thumbs.erase(thumbs.begin() + i); break; }
  }
  Thumb t;
  t.key = key;
  t.px = px;
  t.used = ++thumbClock;
  thumbs.push_back(t);
}
void thumbForget(const std::string& key) {
  for (size_t i = 0; i < thumbs.size(); i++)
    if (thumbs[i].key == key) { free(thumbs[i].px); thumbs.erase(thumbs.begin() + i); return; }
}

// Обложка трека: фон, маленькие копии для плеера и мини-плеера
void prepareTrackArt() {
  if (coverPx) {
    if (!cover80) cover80 = (uint16_t*)malloc(80 * 80 * 2);
    if (!cover42) cover42 = (uint16_t*)malloc(42 * 42 * 2);
    if (cover80) scaleFill(coverPx, 200, 200, cover80, 80, 80);
    if (cover42) scaleFill(coverPx, 200, 200, cover42, 42, 42);
  } else {
    free(cover80); cover80 = nullptr;
    free(cover42); cover42 = nullptr;
  }
  makeBackdrop(coverPx, 200, 200);
  heroKey.clear();
}

// ===================== Медиатека =====================
bool trackOn() { return trk.type != TT_NONE; }

void rebuildView() {
  view.clear();
  heroList.clear();
  for (int i = 0; i < (int)entries.size(); i++) {
    MediaKind k = entries[i].kind;
    bool show = tab == 0 || (tab == 1 && (k == MK_MP3 || k == MK_WAV)) || (tab == 2 && (k == MK_AVI || k == MK_MP4));
    if (!show) continue;
    view.push_back(i);
    if (k == MK_MP3 || k == MK_WAV || k == MK_AVI) heroList.push_back(i);
  }
  int lo = trackOn() ? -1 : 0;
  if (heroPos < lo || heroPos >= (int)heroList.size()) heroPos = lo;
  listDirty = true;
}

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
  heroPos = trackOn() ? -1 : 0;
  rebuildView();
}

bool heroAvail() { return (heroPos == -1 && trackOn()) || (heroPos >= 0 && heroPos < (int)heroList.size()); }
int heroCount() { return (int)heroList.size() + (trackOn() ? 1 : 0); }

HeroInfo heroInfo() {
  HeroInfo h;
  h.now = heroPos == -1 && trackOn();
  h.idx = -1;
  if (h.now) {
    h.kind = trk.type == TT_MP3 ? MK_MP3 : MK_WAV;
    h.title = trk.info.title;
    h.sub = trk.info.artist;
    if (!trk.info.album.empty()) h.sub += (h.sub.empty() ? "" : " — ") + trk.info.album;
    if (h.sub.empty()) h.sub = fileName(trackDir == "/" ? std::string("SD-карта") : trackDir);
    h.badge = trk.paused ? "На паузе" : "Сейчас играет";
    h.tag1 = trk.type == TT_MP3 ? "MP3" : "WAV";
    h.tag2 = trk.duration > 0 ? fmtTime(trk.duration) : "";
    h.key = "#now:" + trk.path;
    h.path = trk.path;
  } else if (heroPos >= 0 && heroPos < (int)heroList.size()) {
    h.idx = heroList[heroPos];
    const Entry& e = entries[h.idx];
    h.kind = e.kind;
    h.title = stemOf(e.name);
    h.path = joinDir(curDir, e.name);
    h.key = h.path;
    h.badge = e.kind == MK_AVI ? "Видео" : "Музыка";
    h.tag1 = e.kind == MK_AVI ? "AVI" : e.kind == MK_MP3 ? "MP3" : "WAV";
    h.tag2 = fmtSize(e.size);
    h.sub = curDir == "/" ? "SD-карта" : "Папка «" + fileName(curDir) + "»";
  } else h.kind = MK_NONE;
  return h;
}

// Картинка большой карточки (загружается до отрисовки)
void ensureHeroImage() {
  if (!heroAvail()) return;
  HeroInfo h = heroInfo();
  if (h.key == heroKey) return;
  heroKey = h.key;
  heroOk = false;
  if (!heroPx) heroPx = (uint16_t*)malloc(HERO_W * HERO_H * 2);
  if (!heroPx) return;
  if (h.now) {
    if (coverPx) { scaleFill(coverPx, 200, 200, heroPx, HERO_W, HERO_H); heroOk = true; }
  } else if (h.kind == MK_MP3 || h.kind == MK_AVI) heroOk = loadArt(h.path, h.kind, heroPx, HERO_W, HERO_H);
}

void computeLayout() {
  lay.hero = heroAvail();
  int y = 8;
  lay.heroY = y;
  if (lay.hero) y += HERO_H + 16;
  lay.secY = y;
  y += 36;
  lay.gridY = y;
  lay.rows = ((int)view.size() + 1) / 2;
  y += lay.rows * (CARD_H + CARD_GAP);
  if (view.empty()) y += 110;
  y += trackOn() ? (SCREEN_H - MINI_Y) + 6 : 10;
  lay.total = y;
}
int libMaxScroll() { computeLayout(); return std::max(0, lay.total - (SCREEN_H - HDR_H)); }

void cardPos(int vi, int& x, int& y) {  // y — экранная
  x = 12 + (vi % 2) * (CARD_W + 8);
  y = HDR_H + lay.gridY + (vi / 2) * (CARD_H + CARD_GAP) - listScroll;
}

// Кнопки большой карточки (координаты экрана при прокрутке scroll)
void heroGeom(const HeroInfo& h, HitRect& prim, HitRect& sec, HitRect& prv, HitRect& nxt, bool& hasSec, bool& arrows) {
  int x = 12, y = HDR_H + lay.heroY - listScroll;
  int by = y + HERO_H - 48;
  const char* lbl = h.now ? (trk.paused ? "Слушать" : "Пауза") : h.kind == MK_AVI ? "Смотреть" : "Слушать";
  prim.x = x + 12; prim.y = by; prim.w = textW(*FONTS[FN_SEMI], lbl) + 52; prim.h = 34;
  hasSec = h.now;
  sec.x = prim.x + prim.w + 8; sec.y = by; sec.w = textW(*FONTS[FN_SEMI], "Плеер") + 32; sec.h = 34;
  arrows = heroCount() > 1;
  prv.x = x + HERO_W - 74; prv.y = by + 1; prv.w = 32; prv.h = 32;
  nxt.x = x + HERO_W - 38; nxt.y = by + 1; nxt.w = 32; nxt.h = 32;
}
bool hit(const HitRect& r, int x, int y, int pad) { return x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad; }

void drawHero(Surface& s, int top) {
  int x = 12, y = HDR_H + lay.heroY - listScroll - top;
  if (y + HERO_H <= 0 || y >= s.h) return;
  HeroInfo h = heroInfo();
  if (heroOk) imageRound(s, x, y, HERO_W, HERO_H, 20, heroPx);
  else drawArt(s, x, y, HERO_W, HERO_H, 20, h.title, h.kind);
  rrectX(s, x, y, HERO_W, HERO_H, 20, C_BLACK, C_BLACK, 200, 20, true, 0, 0);
  rrectX(s, x, y, HERO_W, HERO_H, 20, C_BLACK, C_BLACK, 0, 150, false, C_WHITE, 52);
  // значок «сейчас играет»
  const AAFont& tiny = *FONTS[FN_TINY];
  int bw = textW(tiny, h.badge.c_str()) + 34;
  rrectX(s, x + 12, y + 12, bw, 24, 12, C_BLACK, C_BLACK, 110, 110, false, C_WHITE, 46);
  if (h.now) discS(s, x + 25, y + 24, 4, trk.paused ? C_TXT2 : C_GREEN);
  else if (h.kind == MK_AVI) iconPlay(s, x + 25, y + 24, 6, C_WHITE);
  else iconNote(s, x + 25, y + 24, 12, C_WHITE);
  drawText(s, tiny, x + 34, capBase(tiny, y + 12, 24), h.badge.c_str(), C_WHITE);
  // заголовок и подпись
  const AAFont& tf = *FONTS[FN_TITLE];
  std::vector<std::string> lines = wrapText(tf, h.title, HERO_W - 40);
  if (lines.empty()) lines.push_back("");
  if (lines.size() > 2) { lines[1] = ellipsize(tf, lines[1] + " " + lines[2], HERO_W - 40); lines.resize(2); }
  for (auto& l : lines) l = ellipsize(tf, l, HERO_W - 40);
  int by = y + HERO_H - 48;
  int subBase = by - 12, titleBase = subBase - 21, firstBase = titleBase - 25 * ((int)lines.size() - 1);
  for (size_t i = 0; i < lines.size(); i++) drawText(s, tf, x + 14, firstBase + 25 * (int)i, lines[i].c_str(), C_WHITE);
  drawText(s, *FONTS[FN_SMALL], x + 14, subBase, ellipsize(*FONTS[FN_SMALL], h.sub, HERO_W - 30).c_str(), C_TXT2);
  int tagY = firstBase - 22 - 22;
  if (tagY >= y + 44) {
    int tx = x + 14;
    tx += pill(s, tx, tagY, 22, h.tag1, tiny, C_WHITE, 40, C_WHITE, 10) + 6;
    if (!h.tag2.empty()) pill(s, tx, tagY, 22, h.tag2, tiny, C_WHITE, 40, C_WHITE, 10);
  }
  // кнопки
  HitRect pr, sc, pv, nx;
  bool hasSec, arrows;
  heroGeom(h, pr, sc, pv, nx, hasSec, arrows);
  int d = -top;
  rr(s, pr.x, pr.y + d, pr.w, pr.h, 17, C_WHITE, 255);
  bool pauseIcon = h.now && !trk.paused;
  if (pauseIcon) iconPause(s, pr.x + 20, pr.y + d + 17, 9, C_INK); else iconPlay(s, pr.x + 20, pr.y + d + 17, 9, C_INK);
  const char* lbl = h.now ? (trk.paused ? "Слушать" : "Пауза") : h.kind == MK_AVI ? "Смотреть" : "Слушать";
  drawText(s, *FONTS[FN_SEMI], pr.x + 34, capBase(*FONTS[FN_SEMI], pr.y + d, pr.h), lbl, C_INK);
  if (hasSec) {
    glass(s, sc.x, sc.y + d, sc.w, sc.h, 17, 30);
    drawText(s, *FONTS[FN_SEMI], sc.x + 16, capBase(*FONTS[FN_SEMI], sc.y + d, sc.h), "Плеер", C_WHITE);
  }
  if (arrows) {
    glass(s, pv.x, pv.y + d, 32, 32, 16, 34);
    iconChevron(s, pv.x + 15, pv.y + d + 16, 5, -1, C_WHITE);
    glass(s, nx.x, nx.y + d, 32, 32, 16, 34);
    iconChevron(s, nx.x + 17, nx.y + d + 16, 5, 1, C_WHITE);
  }
}

void drawCard(Surface& s, int top, int vi) {
  int x, y;
  cardPos(vi, x, y);
  y -= top;
  if (y + CARD_H <= 0 || y >= s.h) return;
  const Entry& e = entries[view[vi]];
  std::string full = joinDir(curDir, e.name);
  bool hasArt = e.kind == MK_MP3 || e.kind == MK_AVI;
  Thumb* t = hasArt ? thumbFind(full) : nullptr;
  bool playing = trackOn() && trk.path == full;
  if (t && t->px) imageRound(s, x, y, CARD_W, CARD_H, 16, t->px);
  else {
    if (hasArt && !t) thumbPending = true;
    drawArt(s, x, y, CARD_W, CARD_H, 16, e.name, e.kind);
  }
  rrectX(s, x, y, CARD_W, CARD_H, 16, C_BLACK, C_BLACK, 0, 215, false, 0, 0);
  if (e.kind == MK_MP4) rr(s, x, y, CARD_W, CARD_H, 16, C_BLACK, 120);
  if (playing) { outline(s, x, y, CARD_W, CARD_H, 16, C_BLUE, 255); outline(s, x + 1, y + 1, CARD_W - 2, CARD_H - 2, 15, C_BLUE, 255); }
  else outline(s, x, y, CARD_W, CARD_H, 16, C_WHITE, 46);
  const AAFont& tiny = *FONTS[FN_TINY];
  std::string tag = playing ? (trk.paused ? "На паузе" : "Играет") : e.kind == MK_DIR ? "Папка" : e.kind == MK_MP3 ? "MP3" : e.kind == MK_WAV ? "WAV" : e.kind == MK_AVI ? "Видео" : "MP4";
  if (playing) pill(s, x + 10, y + CARD_H - 82, 20, tag, tiny, C_BLUE, 235, C_WHITE, 9);
  else pill(s, x + 10, y + CARD_H - 82, 20, tag, tiny, C_WHITE, 46, C_WHITE, 9);
  const AAFont& sf = *FONTS[FN_SEMI];
  drawText(s, sf, x + 10, y + CARD_H - 46, ellipsize(sf, stemOf(e.name), CARD_W - 20).c_str(), C_WHITE);
  std::string sub = e.kind == MK_DIR ? "Открыть папку" : e.kind == MK_MP4 ? "Переведите в AVI" : fmtSize(e.size);
  drawText(s, tiny, x + 10, y + CARD_H - 27, ellipsize(tiny, sub, CARD_W - 58).c_str(), C_TXT2);
  if (e.kind != MK_MP4) {
    float bx = x + CARD_W - 26, by = y + CARD_H - 26;
    discS(s, bx, by, 15, C_WHITE);
    if (e.kind == MK_DIR) iconChevron(s, bx + 1.5f, by, 4.5f, 1, C_INK);
    else if (playing && !trk.paused) iconPause(s, bx, by, 8, C_INK);
    else iconPlay(s, bx + 1, by, 8, C_INK);
  }
}

void tabGeom(int* xs, int* ws) {
  static const char* T[3] = { "Всё", "Музыка", "Видео" };
  int x = 12;
  for (int k = 0; k < 3; k++) { ws[k] = textW(*FONTS[FN_SEMI], T[k]) + 28; xs[k] = x; x += ws[k] + 4; }
}

void drawHeader(Surface& s, int top) {
  int o = -top;
  rr(s, 0, o, SCREEN_W, HDR_H, 0, C_BLACK, 70);
  if (listScroll > 0) rr(s, 0, o + HDR_H - 1, SCREEN_W, 1, 0, C_WHITE, 26);
  // строка с названием папки
  glass(s, 12, o + 10, 210, 36, 18, 34);
  if (curDir != "/") iconChevron(s, 29, o + 28, 6, -1, C_WHITE);
  else iconNote(s, 30, o + 28, 18, C_WHITE);
  const AAFont& sf = *FONTS[FN_SEMI];
  const AAFont& tiny = *FONTS[FN_TINY];
  char cnt[32];
  snprintf(cnt, sizeof cnt, "%d", (int)entries.size());
  std::string cs = sdReady ? std::string(cnt) + " шт." : "нет карты";
  int cw = textW(tiny, cs.c_str());
  drawText(s, tiny, 210 - cw, capBase(tiny, o + 10, 36), cs.c_str(), C_TXT2);
  std::string title = curDir == "/" ? "Медиатека" : fileName(curDir);
  drawText(s, sf, 46, capBase(sf, o + 10, 36), ellipsize(sf, title, 210 - 46 - cw - 10).c_str(), C_WHITE);
  // Bluetooth
  glass(s, 228, o + 10, 36, 36, 18, btState != BT_OFF ? 60 : 34);
  iconBt(s, 246, o + 28, btState != BT_OFF ? C_WHITE : C_TXT2);
  if (btState == BT_ON) { discS(s, 260, o + 13, 6, MK565(20, 22, 26)); discS(s, 260, o + 13, 4, C_GREEN); }
  else if (btState != BT_OFF) { discS(s, 260, o + 13, 6, MK565(20, 22, 26)); discS(s, 260, o + 13, 4, C_BLUE); }
  // Wi-Fi
  glass(s, 270, o + 10, 36, 36, 18, wifiOn ? 60 : 34);
  drawWifiIcon(s, 288, o + 33, wifiOn ? C_WHITE : C_TXT2);
  if (wifiOn) { discS(s, 302, o + 13, 6, MK565(20, 22, 26)); discS(s, 302, o + 13, 4, C_GREEN); }
  // вкладки
  static const char* T[3] = { "Всё", "Музыка", "Видео" };
  int xs[3], ws[3];
  tabGeom(xs, ws);
  for (int k = 0; k < 3; k++) {
    if (k == tab) glass(s, xs[k], o + 56, ws[k], 30, 15, 64);
    drawText(s, sf, xs[k] + 14, capBase(sf, o + 56, 30), T[k], k == tab ? C_WHITE : C_TXT2);
  }
  // перемешивание
  if (shuffleOn) rrectX(s, 274, o + 55, 32, 32, 16, C_BLUE, C_BLUE, 240, 240, false, C_WHITE, 60);
  else glass(s, 274, o + 55, 32, 32, 16, 30);
  iconShuffle(s, 290, o + 71, shuffleOn ? C_WHITE : C_TXT2);
}

void drawMiniBar(Surface& s, int top) {
  int x = 10, y = MINI_Y - top, w = 300, h = 60;
  if (y + h <= 0 || y >= s.h) return;
  rrectX(s, x, y, w, h, 30, MK565(34, 35, 41), MK565(20, 21, 25), 238, 238, false, C_WHITE, 48);
  if (cover42) imageRound(s, x + 9, y + 9, 42, 42, 21, cover42);
  else drawArt(s, x + 9, y + 9, 42, 42, 21, trk.info.title, MK_MP3);
  const AAFont& sf = *FONTS[FN_SEMI];
  const AAFont& tiny = *FONTS[FN_TINY];
  drawText(s, sf, x + 62, y + 27, ellipsize(sf, trk.info.title, 148).c_str(), C_WHITE);
  std::string sub = fmtTime(audioClock()) + (trk.duration > 0 ? " / " + fmtTime(trk.duration) : std::string());
  if (!trk.info.artist.empty()) sub = trk.info.artist + " · " + sub;
  drawText(s, tiny, x + 62, y + 45, ellipsize(tiny, sub, 148).c_str(), C_TXT2);
  iconSkip(s, x + w - 78, y + 30, 11, true, C_WHITE);
  float pcx = x + w - 32, pcy = y + 30;
  arcS(s, pcx, pcy, 22, 2.4f, -180, 180, MK565(70, 72, 80));
  arcProgress(s, pcx, pcy, 22, 2.4f, trk.duration > 0 ? audioClock() / trk.duration : 0, C_WHITE);
  discS(s, pcx, pcy, 17, C_WHITE);
  if (trk.paused) iconPlay(s, pcx + 1, pcy, 9, C_INK); else iconPause(s, pcx, pcy, 9, C_INK);
}

void drawLibStrip(Surface& s, int top) {
  if (top + s.h > HDR_H) {
    s.cy0 = std::max(0, HDR_H - top);
    if (lay.hero) drawHero(s, top);
    int sy = HDR_H + lay.secY - listScroll - top;
    if (sy + 34 > 0 && sy < s.h) {
      const char* sec = !sdReady ? "SD-карта" : tab == 1 ? "Музыка" : tab == 2 ? "Видео" : curDir == "/" ? "На карте" : "В этой папке";
      drawText(s, *FONTS[FN_BOLD], 14, sy + 22, sec, C_WHITE);
      if (!view.empty()) {
        char b[24];
        snprintf(b, sizeof b, "%d", (int)view.size());
        const AAFont& tiny = *FONTS[FN_TINY];
        int w = textW(tiny, b) + 22;
        pill(s, 308 - w, sy + 6, 22, b, tiny, C_WHITE, 40, C_WHITE, 11);
      }
    }
    for (int vi = 0; vi < (int)view.size(); vi++) drawCard(s, top, vi);
    if (view.empty()) {
      int ey = HDR_H + lay.gridY + 6 - listScroll - top;
      const char* t1 = !sdReady ? "SD-карта не найдена" : tab == 1 ? "Здесь нет музыки" : tab == 2 ? "Здесь нет видео" : "Здесь нет MP3, WAV и AVI";
      const char* t2 = !sdReady ? "Вставьте microSD и нажмите сюда" : "Загрузите файлы по Wi-Fi через ESP32 Flasher";
      glass(s, 12, ey, 296, 92, 18, 30);
      drawCentered(s, *FONTS[FN_BOLD], SCREEN_W / 2, ey + 40, t1, C_WHITE);
      drawCentered(s, *FONTS[FN_TINY], SCREEN_W / 2, ey + 64, t2, C_TXT2);
    }
    s.cy0 = 0;
  }
  if (top < HDR_H) drawHeader(s, top);
  if (trackOn() && top + s.h > MINI_Y) drawMiniBar(s, top);
}

void renderList() {
  rebuildView();
  computeLayout();
  listScroll = std::max(0, std::min((int)listScroll, libMaxScroll()));
  ensureHeroImage();
  renderRegion(0, SCREEN_H, drawLibStrip);
  listDirty = miniDirty = false;
}
void renderMini() { if (trackOn()) { computeLayout(); renderRegion(MINI_Y, MINI_Y + 60, drawLibStrip); } miniDirty = false; }

// Догружает одну миниатюру видимой карточки и перерисовывает её
bool loadPendingThumb() {
  computeLayout();
  for (int vi = 0; vi < (int)view.size(); vi++) {
    const Entry& e = entries[view[vi]];
    if (e.kind != MK_MP3 && e.kind != MK_AVI) continue;
    int x, y;
    cardPos(vi, x, y);
    if (y + CARD_H <= HDR_H || y >= SCREEN_H) continue;
    std::string full = joinDir(curDir, e.name);
    if (thumbFind(full)) continue;
    uint16_t* px = (uint16_t*)malloc(CARD_W * CARD_H * 2);
    bool ok = px && loadArt(full, e.kind, px, CARD_W, CARD_H);
    if (!ok && px) { free(px); px = nullptr; }
    thumbPut(full, px);
    if (ok && screen == SC_LIST) renderRegion(std::max(HDR_H, y), std::min(SCREEN_H, y + CARD_H), drawLibStrip);
    return true;
  }
  thumbPending = false;
  return false;
}

// ===================== Плеер =====================
std::string fmtFormat() {
  std::string f = trk.type == TT_MP3 ? "MP3" : "WAV";
  if (trk.rate) {
    char b[24];
    if (trk.rate % 1000) snprintf(b, sizeof b, "%u,%u кГц", (unsigned)(trk.rate / 1000), (unsigned)(trk.rate % 1000 / 100));
    else snprintf(b, sizeof b, "%u кГц", (unsigned)(trk.rate / 1000));
    f += std::string(" · ") + b;
  }
  if (trk.type == TT_MP3 && trk.bitrate) f += " · " + std::to_string(trk.bitrate) + " кбит/с";
  if (trk.type == TT_WAV) f += " · " + std::to_string(trk.wav.bits) + " бит";
  if (trk.ch) f += trk.ch == 1 ? " · моно" : " · стерео";
  return f;
}

void drawKey(Surface& s, int x, int y, int w, int h, const char* label) {
  rrectX(s, x, y, w, h, 9, C_KEY0, C_KEY1, 255, 255, false, C_BLACK, 150);
  rr(s, x + 7, y + 1, w - 14, 1, 0, C_WHITE, 34);
  drawCentered(s, *FONTS[FN_SEMI], x + w / 2, capBase(*FONTS[FN_SEMI], y, h), label, C_WHITE);
}

void drawProgress(Surface& s, int o) {
  const AAFont& tiny = *FONTS[FN_TINY];
  float k = trk.duration > 0 ? clamp01(audioClock() / trk.duration) : 0;
  drawText(s, tiny, 22, o + PROG_Y + 4, fmtTime(audioClock()).c_str(), C_WHITE);
  std::string tot = trk.duration > 0 ? fmtTime(trk.duration) : "--:--";
  drawText(s, tiny, 298 - textW(tiny, tot.c_str()), o + PROG_Y + 4, tot.c_str(), C_TXT2);
  rr(s, PROG_X, o + PROG_Y - 2, PROG_W, 4, 2, C_WHITE, 46);
  rr(s, PROG_X, o + PROG_Y - 2, PROG_W * k, 4, 2, C_WHITE, 255);
  rr(s, PROG_X + PROG_W * k - 2, o + PROG_Y - 7, 4, 14, 2, C_WHITE, 255);
}

void drawDpad(Surface& s, float cx, float cy) {
  const float R = DPAD_R;
  rrectX(s, cx - R, cy - R, 2 * R, 2 * R, R, C_KEY0, C_KEY1, 255, 255, false, C_BLACK, 160);
  for (int q = 0; q < 4; q++) {
    float a = (45 + 90 * q) * 0.0174533f, ca = cosf(a), sa = sinf(a);
    capsuleS(s, cx + ca * 34, cy + sa * 34, cx + ca * (R - 3), cy + sa * (R - 3), 0.8f, MK565(30, 31, 35));
  }
  float d = 56;
  float ux[] = { cx - 7, cx + 7, cx }, uy[] = { cy - d + 4, cy - d + 4, cy - d - 5 };
  polyS(s, ux, uy, 3, C_WHITE);
  float dx[] = { cx - 7, cx + 7, cx }, dy[] = { cy + d - 4, cy + d - 4, cy + d + 5 };
  polyS(s, dx, dy, 3, C_WHITE);
  float lx[] = { cx - d + 4, cx - d + 4, cx - d - 5 }, ly[] = { cy - 7, cy + 7, cy };
  polyS(s, lx, ly, 3, C_WHITE);
  float rx[] = { cx + d - 4, cx + d - 4, cx + d + 5 }, ry[] = { cy - 7, cy + 7, cy };
  polyS(s, rx, ry, 3, C_WHITE);
  const AAFont& tiny = *FONTS[FN_TINY];
  drawCentered(s, tiny, (int)(cx - d), (int)cy + 22, "−10 с", C_TXT3);
  drawCentered(s, tiny, (int)(cx + d), (int)cy + 22, "+10 с", C_TXT3);
  drawCentered(s, tiny, (int)cx + 22, (int)(cy - d) + 4, "+", C_TXT3);
  drawCentered(s, tiny, (int)cx + 22, (int)(cy + d) + 4, "−", C_TXT3);
  rrectX(s, cx - 31, cy - 31, 62, 62, 31, MK565(86, 87, 95), C_KEY1, 255, 255, false, C_BLACK, 170);
  drawCentered(s, *FONTS[FN_SEMI], (int)cx, capBase(*FONTS[FN_SEMI], cy - 31, 62), trk.paused ? "Пуск" : "Пауза", C_WHITE);
  // кнопка «обложка во весь экран»
  rrectX(s, cx + 53, cy + 53, 26, 26, 13, C_KEY0, C_KEY1, 255, 255, false, C_BLACK, 160);
  iconExpand(s, cx + 66, cy + 66, C_TXT2);
}

void drawVolume(Surface& s, int o) {
  rrectX(s, VOL_X, o + VOL_Y, 36, 156, 10, C_INSET, C_INSET, 255, 255, false, C_WHITE, 16);
  if (btOut) iconHeadphones(s, VOL_X + 18, o + VOL_Y + 17, C_BLUE);
  else iconSpeaker(s, VOL_X + 17, o + VOL_Y + 18, C_WHITE);
  int tx = VOL_X + 16, t0 = o + VOL_TOP, t1 = o + VOL_BOT;
  rr(s, tx, t0, 4, t1 - t0, 2, C_WHITE, 40);
  float ky = t1 - (t1 - t0) * volume / 100.0f;
  rr(s, tx, ky, 4, t1 - ky, 2, C_BLUE, 255);
  for (int i = 0; i <= 4; i++) rr(s, tx - 6, t0 + (t1 - t0) * i / 4.0f, 3, 1, 0, C_WHITE, 50);
  discS(s, tx + 2, ky, 7, C_WHITE);
  char b[8];
  snprintf(b, sizeof b, "%d%%", volume);
  drawCentered(s, *FONTS[FN_TINY], VOL_X + 18, o + VOL_Y + 146, b, C_WHITE);
}

int audioPosInDir(int* total) {
  int n = 0, pos = 0;
  for (int i = 0; i < (int)trackDirEntries.size(); i++) {
    MediaKind k = trackDirEntries[i].kind;
    if (k != MK_MP3 && k != MK_WAV) continue;
    n++;
    if (i == trackIndex) pos = n;
  }
  *total = n;
  return pos;
}

void drawPlayerStrip(Surface& s, int top) {
  int o = -top;
  const AAFont& sf = *FONTS[FN_SEMI];
  const AAFont& tiny = *FONTS[FN_TINY];
  if (top < 52) {
    glass(s, 10, o + 8, 36, 36, 18, 34);
    iconChevron(s, 27, o + 26, 6, -1, C_WHITE);
    drawCentered(s, sf, SCREEN_W / 2, capBase(sf, o + 8, 36), "Сейчас играет", C_WHITE);
    int n = 0, p = audioPosInDir(&n);
    int rx = 306;
    if (n > 0) {
      std::string t = std::to_string(p) + " / " + std::to_string(n);
      rx -= textW(tiny, t.c_str());
      drawText(s, tiny, rx, capBase(tiny, o + 8, 36), t.c_str(), C_TXT2);
      rx -= 10;
    }
    if (btOut) iconHeadphones(s, rx - 9, o + 24, C_BLUE);
  }
  // корпус-пульт
  rrectX(s, 10, o + 54, 300, 418, 28, C_PANEL0, C_PANEL1, 250, 250, false, C_WHITE, 36);
  // экранчик с обложкой
  rrectX(s, 22, o + 66, 276, 100, 14, C_INSET, C_INSET, 255, 255, false, C_WHITE, 16);
  if (cover80) imageRound(s, 32, o + 76, 80, 80, 10, cover80);
  else drawArt(s, 32, o + 76, 80, 80, 10, trk.info.title, MK_MP3);
  drawText(s, *FONTS[FN_BOLD], 124, o + 98, ellipsize(*FONTS[FN_BOLD], trk.info.title, 166).c_str(), C_WHITE);
  std::string artist = trk.info.artist.empty() ? std::string("Неизвестный исполнитель") : trk.info.artist;
  drawTracked(s, tiny, 124, o + 118, upperRu(ellipsize(tiny, artist, 140)), 1, C_TXT2);
  if (!trk.info.album.empty()) drawText(s, *FONTS[FN_SMALL], 124, o + 137, ellipsize(*FONTS[FN_SMALL], trk.info.album, 166).c_str(), C_TXT3);
  drawText(s, tiny, 124, o + 156, ellipsize(tiny, fmtFormat(), 166).c_str(), C_TXT3);
  drawProgress(s, o);
  // транспорт
  rrectX(s, 22, o + TR_Y, 276, 72, 14, C_INSET, C_INSET, 255, 255, false, C_WHITE, 16);
  float iy = o + TR_Y + 26;
  for (int i = 0; i < 6; i++) {
    float cx = 22 + 276 * (i + 0.5f) / 6;
    switch (i) {
      case 0: iconSkip(s, cx, iy, 11, false, C_WHITE); break;
      case 1: iconRewind(s, cx, iy, 12, false, C_WHITE); break;
      case 2: if (trk.paused) iconPlay(s, cx + 1, iy, 15, C_WHITE); else iconPause(s, cx, iy, 15, C_WHITE); break;
      case 3: iconStop(s, cx, iy, 13, C_WHITE); break;
      case 4: iconRewind(s, cx, iy, 12, true, C_WHITE); break;
      case 5: iconSkip(s, cx, iy, 11, true, C_WHITE); break;
    }
  }
  rr(s, 34, o + TR_Y + 46, 252, 1, 0, C_WHITE, 14);
  static const char* REP[3] = { "Повтор: нет", "Повтор: все", "Повтор: один" };
  int bx = drawText(s, tiny, 34, o + TR_Y + 62, REP[repeatMode], repeatMode ? C_WHITE : C_TXT2);
  float xs[] = { (float)bx + 5, (float)bx + 10, (float)bx + 5 }, ys[] = { (float)o + TR_Y + 54, (float)o + TR_Y + 58, (float)o + TR_Y + 62 };
  polyS(s, xs, ys, 3, C_TXT3);
  int cbx = 270, cby = o + TR_Y + 51;
  std::string sh = "ПЕРЕМЕШАТЬ";
  drawTracked(s, tiny, cbx - 8 - trackedW(tiny, sh, 1), o + TR_Y + 62, sh, 1, shuffleOn ? C_WHITE : C_TXT2);
  if (shuffleOn) {
    rr(s, cbx, cby, 15, 15, 3, C_BLUE, 255);
    capsuleS(s, cbx + 3.5f, cby + 7.5f, cbx + 6.5f, cby + 10.5f, 1.2f, C_WHITE);
    capsuleS(s, cbx + 6.5f, cby + 10.5f, cbx + 11.5f, cby + 4.5f, 1.2f, C_WHITE);
  } else outline(s, cbx, cby, 15, 15, 3, C_TXT3, 255);
  // нижняя часть: крестовина, клавиши, громкость
  drawDpad(s, DPAD_X, o + DPAD_Y);
  drawKey(s, KEY_X, o + KEY_Y, 64, 42, "Меню");
  drawKey(s, KEY_X, o + KEY_Y + 50, 64, 42, "Инфо");
  drawKey(s, KEY_X, o + KEY_Y + 100, 64, 42, "Извлечь");
  drawVolume(s, o);
}

void renderPlayer() { renderRegion(0, SCREEN_H, drawPlayerStrip); playerDirty = progDirty = false; }
void renderProgress() { renderRegion(PROG_Y - 14, PROG_Y + 12, drawPlayerStrip); progDirty = false; }
void renderVolume() { renderRegion(VOL_Y, VOL_Y + 156, drawPlayerStrip); }

// ===================== Обложка во весь экран =====================
void drawCoverStrip(Surface& s, int top) {
  int o = -top;
  if (coverBig) imageRound(s, 16, o + 56, 288, 288, 22, coverBig);
  else drawArt(s, 16, o + 56, 288, 288, 22, trk.info.title, MK_MP3);
  outline(s, 16, o + 56, 288, 288, 22, C_WHITE, 50);
  const AAFont& tf = *FONTS[FN_TITLE];
  drawCentered(s, tf, SCREEN_W / 2, o + 384, ellipsize(tf, trk.info.title, 290), C_WHITE);
  drawCentered(s, *FONTS[FN_SMALL], SCREEN_W / 2, o + 408, ellipsize(*FONTS[FN_SMALL], trk.info.artist, 290), C_TXT2);
  float k = trk.duration > 0 ? clamp01(audioClock() / trk.duration) : 0;
  rr(s, 40, o + 428, 240, 3, 1.5f, C_WHITE, 46);
  rr(s, 40, o + 428, 240 * k, 3, 1.5f, C_WHITE, 255);
  drawCentered(s, *FONTS[FN_TINY], SCREEN_W / 2, o + 458, "Нажмите, чтобы вернуться", C_TXT3);
}
void showCover() {
  if (coverPx && !coverBig) {
    coverBig = (uint16_t*)malloc(288 * 288 * 2);
    if (coverBig) scaleFill(coverPx, 200, 200, coverBig, 288, 288);
  }
  screen = SC_COVER;
  renderRegion(0, SCREEN_H, drawCoverStrip);
}
void hideCover() {
  free(coverBig);
  coverBig = nullptr;
  screen = SC_PLAYER;
  playerDirty = true;
}

// ===================== Bluetooth =====================
void drawBtStrip(Surface& s, int top) {
  int o = -top;
  const AAFont& sf = *FONTS[FN_SEMI];
  const AAFont& tiny = *FONTS[FN_TINY];
  const AAFont& bf = *FONTS[FN_BOLD];
  bool on = btState != BT_OFF;
  glass(s, 10, o + 8, 36, 36, 18, 34);
  iconChevron(s, 27, o + 26, 6, -1, C_WHITE);
  drawCentered(s, sf, SCREEN_W / 2, capBase(sf, o + 8, 36), "Bluetooth", C_WHITE);
  rrectX(s, 258, o + 13, 48, 26, 13, on ? C_BLUE : C_WHITE, on ? C_BLUE : C_WHITE, on ? 255 : 40, on ? 255 : 40, false, C_WHITE, 60);
  discS(s, on ? 293 : 271, o + 26, 10, C_WHITE);
  // состояние
  glass(s, 12, o + 58, 296, 96, 20, 34);
  discS(s, 48, o + 106, 24, on ? C_BLUE : MK565(70, 72, 80));
  iconBt(s, 48, o + 106, C_WHITE);
  std::string t1, t2;
  switch (btState) {
    case BT_OFF: t1 = "Bluetooth выключен"; t2 = "Для наушников и колонок"; break;
    case BT_SCAN: t1 = "Поиск устройств…"; t2 = btTarget[0] ? std::string("Жду «") + btTarget + "»" : "Включите на наушниках сопряжение"; break;
    case BT_LINK: t1 = "Подключение…"; t2 = btTarget; break;
    default: t1 = btName; t2 = "Звук идёт в наушники"; break;
  }
  bool onBtn = btState == BT_ON;
  int ty = onBtn ? o + 92 : o + 102;
  drawText(s, bf, 84, ty, ellipsize(bf, t1, 210).c_str(), C_WHITE);
  drawText(s, tiny, 84, ty + 18, ellipsize(tiny, t2, 210).c_str(), C_TXT2);
  if (onBtn) pill(s, 84, o + 118, 26, "Отключить", sf, C_WHITE, 255, C_INK, 14);
  // устройства
  if (!on) {
    glass(s, 12, o + 172, 296, 112, 20, 26);
    const AAFont& sm = *FONTS[FN_SMALL];
    std::vector<std::string> l = wrapText(sm, "Включите Bluetooth переключателем справа вверху и переведите наушники в режим сопряжения. Пока работает Bluetooth, Wi-Fi выключен.", 260);
    for (size_t i = 0; i < l.size() && i < 4; i++) drawText(s, sm, 30, o + 202 + 20 * (int)i, l[i].c_str(), C_WHITE);
    return;
  }
  drawText(s, bf, 14, o + 190, "Устройства рядом", C_WHITE);
  if (btState == BT_SCAN) drawText(s, tiny, 306 - textW(tiny, "идёт поиск"), o + 189, "идёт поиск", C_TXT2);
  int n = std::min((int)btDevCount, 5);
  if (!n) {
    glass(s, 12, o + 204, 296, 92, 18, 26);
    drawCentered(s, sf, SCREEN_W / 2, o + 238, "Пока никого не видно", C_WHITE);
    drawCentered(s, tiny, SCREEN_W / 2, o + 260, "Обычно сопряжение — долгое нажатие", C_TXT2);
    drawCentered(s, tiny, SCREEN_W / 2, o + 276, "кнопки питания на наушниках", C_TXT2);
  }
  for (int i = 0; i < n; i++) {
    int y = o + 204 + i * 54;
    BtDev d = btDevs[i];
    d.name[32] = 0;
    bool cur = btState == BT_ON && !strcmp(d.name, btName);
    bool tgt = !cur && btTarget[0] && !strcmp(d.name, btTarget);
    if (cur) rrectX(s, 12, y, 296, 48, 16, C_BLUE, C_BLUE, 200, 200, false, C_WHITE, 60);
    else glass(s, 12, y, 296, 48, 16, tgt ? 50 : 28);
    drawText(s, sf, 26, y + 21, ellipsize(sf, d.name, 220).c_str(), C_WHITE);
    const char* st = cur ? "Подключено" : tgt ? (btState == BT_LINK ? "Подключение…" : "Жду, когда появится") : "Нажмите, чтобы подключить";
    drawText(s, tiny, 26, y + 37, st, cur ? C_WHITE : C_TXT2);
    int bars = d.rssi > -60 ? 4 : d.rssi > -70 ? 3 : d.rssi > -80 ? 2 : 1;
    for (int b = 0; b < 4; b++) rr(s, 272 + b * 6, y + 32 - (4 + b * 4), 4, 4 + b * 4, 1, C_WHITE, b < bars ? 230 : 60);
  }
}
void renderBt() { renderRegion(0, SCREEN_H, drawBtStrip); }

// ===================== Сообщение =====================
void drawMsgStrip(Surface& s, int top) {
  const AAFont& bf = *FONTS[FN_SMALL];
  std::vector<std::string> lines;
  std::vector<int> gaps;
  size_t i = 0;
  while (i <= msgText.size()) {
    size_t j = msgText.find('\n', i);
    if (j == std::string::npos) j = msgText.size();
    std::vector<std::string> w = wrapText(bf, msgText.substr(i, j - i), 248);
    for (size_t k = 0; k < w.size(); k++) { lines.push_back(w[k]); gaps.push_back(k == 0 && !lines.empty() && lines.size() > 1 ? 8 : 0); }
    i = j + 1;
  }
  int h = 96;
  for (size_t k = 0; k < lines.size(); k++) h += 20 + gaps[k];
  int y0 = std::max(24, (SCREEN_H - h) / 2) - top;
  rrectX(s, 16, y0, 288, h, 24, C_BLACK, C_BLACK, 120, 120, false, C_WHITE, 0);
  glass(s, 16, y0, 288, h, 24, 30);
  drawText(s, *FONTS[FN_BOLD], 36, y0 + 40, ellipsize(*FONTS[FN_BOLD], msgTitle, 248).c_str(), C_WHITE);
  int y = y0 + 68;
  for (size_t k = 0; k < lines.size(); k++) { y += gaps[k]; drawText(s, bf, 36, y, lines[k].c_str(), C_WHITE); y += 20; }
  drawText(s, *FONTS[FN_TINY], 36, y0 + h - 18, "Нажмите, чтобы вернуться", C_TXT3);
}

void showMessage(const std::string& title, const std::string& text) {
  if (screen != SC_MSG) msgBack = screen == SC_COVER ? SC_PLAYER : screen;
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
  makeBackdrop(nullptr, 0, 0);
  return ring && jpeg && bgPx;
}

// ===================== Нажатия =====================
void playAvi(const std::string& path);
void wifiStart();
void wifiStop();

void openEntry(int i, bool toPlayer) {
  const Entry& e = entries[i];
  std::string full = joinDir(curDir, e.name);
  if (e.kind == MK_DIR) { loadDir(full); return; }
  if (e.kind == MK_MP4) {
    showMessage("MP4 не поддерживается", "В файлах MP4 видео сжато кодеком H.264 — у ESP32 не хватает мощности, чтобы его показывать.\nПереведите ролик в AVI: приложение ESP32 Flasher → вкладка «Конвертер видео». Готовый файл можно сразу отправить на эту карту по Wi-Fi (значок справа вверху).");
    return;
  }
  if (e.kind == MK_AVI) { playAvi(full); return; }
  if (trackOn() && trk.path == full) { if (toPlayer) { screen = SC_PLAYER; playerDirty = true; } else togglePause(); listDirty = true; return; }
  if (openTrack(curDir, entries, i)) {
    heroPos = -1;
    listDirty = true;
    if (toPlayer) { screen = SC_PLAYER; playerDirty = true; }
  } else showMessage("Не воспроизводится", "Файл «" + e.name + "» повреждён или в неподдерживаемом формате. WAV должен быть PCM 8 или 16 бит.");
}

void ejectTrack() {
  closeTrack();
  prepareTrackArt();
  screen = SC_LIST;
  rebuildView();
}

void seekBy(float sec) {
  if (!trackOn() || trk.duration <= 0) return;
  seekTrack((audioClock() + sec) / trk.duration);
  progDirty = miniDirty = true;
}

void setVolume(int v) {
  v = std::max(0, std::min(100, v));
  if (v == volume) return;
  volume = v;
  audioHwVolume(volume);
}

void showTrackInfo() {
  std::string t = "Файл: " + trk.name + "\nПапка: " + (trackDir.empty() ? std::string("/") : trackDir) + "\nФормат: " + fmtFormat() +
                  "\nДлительность: " + (trk.duration > 0 ? fmtTime(trk.duration) : std::string("неизвестно")) + "\nРазмер: " + fmtSize(trk.fileSize);
  if (!trk.info.artist.empty()) t += "\nИсполнитель: " + trk.info.artist;
  if (!trk.info.album.empty()) t += "\nАльбом: " + trk.info.album;
  showMessage("О треке", t);
}

void tapPlayer(int x, int y) {
  if (y < 50) { if (x < 70) { screen = SC_LIST; listDirty = true; } return; }
  if (y >= PROG_Y - 16 && y < PROG_Y + 14 && x >= PROG_X - 10 && x < PROG_X + PROG_W + 10) {
    if (trk.duration > 0) { seekTrack((float)(x - PROG_X) / PROG_W); progDirty = miniDirty = true; }
    return;
  }
  if (y >= TR_Y && y < TR_Y + 46) {  // транспорт
    int i = std::max(0, std::min(5, (x - 22) * 6 / 276));
    switch (i) {
      case 0: if (audioClock() > 3) seekTrack(0); else if (!stepTrack(-1)) seekTrack(0); break;
      case 1: seekBy(-10); break;
      case 2: togglePause(); break;
      case 3: if (!trk.paused) togglePause(); seekTrack(0); break;
      case 4: seekBy(10); break;
      case 5: stepTrack(1); break;
    }
    playerDirty = true;
    return;
  }
  if (y >= TR_Y + 46 && y < TR_Y + 74) {
    if (x < 160) repeatMode = (repeatMode + 1) % 3; else shuffleOn = !shuffleOn;
    playerDirty = true;
    return;
  }
  float ex = x - (DPAD_X + 66), ey = y - (DPAD_Y + 66);
  if (ex * ex + ey * ey < 17 * 17) { showCover(); return; }
  float dx = x - DPAD_X, dy = y - DPAD_Y, d2 = dx * dx + dy * dy;
  if (d2 <= 32 * 32) { togglePause(); playerDirty = true; return; }
  if (d2 <= (DPAD_R + 4) * (DPAD_R + 4)) {
    if (fabsf(dx) > fabsf(dy)) seekBy(dx < 0 ? -10 : 10);
    else { setVolume(volume + (dy < 0 ? 5 : -5)); saveVolume(); }
    playerDirty = true;
    return;
  }
  if (x >= KEY_X - 4 && x < KEY_X + 68 && y >= KEY_Y - 4) {
    int k = (y - KEY_Y + 4) / 50;
    if (k == 0) { screen = SC_LIST; listDirty = true; }
    else if (k == 1) showTrackInfo();
    else if (k == 2) ejectTrack();
    return;
  }
  if (x >= VOL_X - 6 && y >= VOL_Y && y < VOL_Y + 160) {
    setVolume((VOL_BOT - y) * 100 / (VOL_BOT - VOL_TOP));
    saveVolume();
    renderVolume();
  }
}

void tapLibrary(int x, int y) {
  if (y < 50) {
    if (x >= 266) {
      if (wifiOn) wifiStop();
      else if (btState != BT_OFF) showMessage("Wi-Fi", "Пока работает Bluetooth, Wi-Fi не включить: плате не хватит памяти на оба сразу.\nВыключите Bluetooth (значок рядом) и нажмите Wi-Fi ещё раз.");
      else wifiStart();
      return;
    }
    if (x >= 224) { screen = SC_BT; renderBt(); return; }
    if (curDir != "/") { std::string up = dirOf(curDir); if (up.size() > 1) up.pop_back(); loadDir(up.empty() ? "/" : up); }
    return;
  }
  if (y < HDR_H) {
    if (x >= 270) { shuffleOn = !shuffleOn; listDirty = true; return; }
    int xs[3], ws[3];
    tabGeom(xs, ws);
    for (int k = 0; k < 3; k++)
      if (x >= xs[k] - 2 && x < xs[k] + ws[k] + 2) { if (tab != k) { tab = k; listScroll = 0; heroPos = trackOn() ? -1 : 0; rebuildView(); } return; }
    return;
  }
  if (trackOn() && y >= MINI_Y && y < MINI_Y + 60) {
    if (x >= 250) togglePause();
    else if (x >= 212) stepTrack(1);
    else { screen = SC_PLAYER; playerDirty = true; }
    listDirty = true;
    return;
  }
  if (!sdReady) { loadDir(curDir); return; }
  computeLayout();
  if (lay.hero) {
    int hy = HDR_H + lay.heroY - listScroll;
    if (y >= hy && y < hy + HERO_H && x >= 12 && x < 12 + HERO_W) {
      HeroInfo h = heroInfo();
      HitRect pr, sc, pv, nx;
      bool hasSec, arrows;
      heroGeom(h, pr, sc, pv, nx, hasSec, arrows);
      int lo = trackOn() ? -1 : 0, hi = (int)heroList.size() - 1;
      if (arrows && hit(pv, x, y, 4)) { heroPos = heroPos <= lo ? hi : heroPos - 1; listDirty = true; return; }
      if (arrows && hit(nx, x, y, 4)) { heroPos = heroPos >= hi ? lo : heroPos + 1; listDirty = true; return; }
      if (hasSec && hit(sc, x, y, 4)) { screen = SC_PLAYER; playerDirty = true; return; }
      bool prim = hit(pr, x, y, 4);
      if (h.now) { if (prim) { togglePause(); listDirty = true; } else { screen = SC_PLAYER; playerDirty = true; } }
      else if (h.idx >= 0) openEntry(h.idx, false);
      return;
    }
  }
  for (int vi = 0; vi < (int)view.size(); vi++) {
    int cx, cy;
    cardPos(vi, cx, cy);
    if (x >= cx && x < cx + CARD_W && y >= cy && y < cy + CARD_H) {
      bool onButton = (x - (cx + CARD_W - 26)) * (x - (cx + CARD_W - 26)) + (y - (cy + CARD_H - 26)) * (y - (cy + CARD_H - 26)) < 22 * 22;
      openEntry(view[vi], !onButton);  // кнопка ▶ — играть здесь, карточка — открыть плеер
      return;
    }
  }
}

void tapBt(int x, int y) {
  if (y < 50) {
    if (x < 70) { screen = SC_LIST; listDirty = true; return; }
    if (x >= 250) { if (btState == BT_OFF) btEnable(); else btDisable(); renderBt(); }
    return;
  }
  if (btState == BT_ON && y >= 114 && y < 148 && x >= 80 && x < 200) { btDisable(); renderBt(); return; }
  if (btState != BT_OFF && y >= 204) {
    int i = (y - 204) / 54;
    if (i < std::min((int)btDevCount, 5) && (y - 204) % 54 < 48) {
      char name[33];
      memcpy(name, btDevs[i].name, 33);
      name[32] = 0;
      if (!(btState == BT_ON && !strcmp(name, btName))) btConnect(name);
      renderBt();
    }
  }
}

void onTap(int x, int y) {
  if (screen == SC_MSG) { if (msgBack == SC_BT) { screen = SC_BT; renderBt(); return; } screen = msgBack; listDirty = playerDirty = true; return; }
  if (screen == SC_BT) { tapBt(x, y); return; }
  if (screen == SC_COVER) { hideCover(); return; }
  if (screen == SC_PLAYER) { tapPlayer(x, y); return; }
  tapLibrary(x, y);
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

volatile int btGain = 256;  // громкость для наушников: 0…256
void audioHwVolume(int v) {
  esW(0x32, v <= 0 ? 0 : v * 256 / 100 - 1);
  btGain = v <= 0 ? 0 : (int)(256 * powf(10.0f, (v - 100) * 0.02f));  // 40 дБ на всю шкалу
}
void audioHwWrite(const int32_t* stereo, int frames) { i2s.write((uint8_t*)stereo, frames * 8); }
void saveVolume() { prefs.begin("media", false); prefs.putInt("vol", volume); prefs.end(); }

void audioTask(void*) {
  static int32_t out[256 * 2];
  for (;;) {
    if (btOut) memset(out, 0, sizeof out);  // звук забирают наушники, динамик молчит
    else audioRender(out, 256);
    audioHwWrite(out, 256);
  }
}

// ---------- Bluetooth-наушники (A2DP) ----------
BluetoothA2DPSource a2dp;
portMUX_TYPE btMux = portMUX_INITIALIZER_UNLOCKED;
bool btRunning = false;
char btSaved[33] = "";  // последние наушники — подключаемся к ним сами

// Каждое найденное устройство: запоминаем для списка, «да» — только выбранному
bool btFound(const char* ssid, esp_bd_addr_t addr, int rssi) {
  if (!ssid || !*ssid) return false;
  portENTER_CRITICAL(&btMux);
  int i = 0;
  while (i < btDevCount && strncmp(btDevs[i].name, ssid, 32)) i++;
  if (i == btDevCount && i < 8) {
    strncpy(btDevs[i].name, ssid, 32);
    btDevs[i].name[32] = 0;
    btDevCount = i + 1;
  }
  if (i < 8) btDevs[i].rssi = (int8_t)std::max(-127, std::min(0, rssi));
  btDevsVer = btDevsVer + 1;
  portEXIT_CRITICAL(&btMux);
  bool want = btTarget[0] && !strncmp(ssid, btTarget, 32);
  if (want) { strncpy(btName, ssid, 32); btName[32] = 0; btState = BT_LINK; }
  return want;
}

// Наушникам нужен звук: 44,1 кГц, стерео, 16 бит — тот же поток, что шёл бы в динамик
int32_t btFrames(Frame* fr, int32_t n) {
  static int32_t tmp[256 * 2];
  int32_t done = 0;
  while (done < n) {
    int k = std::min<int32_t>(256, n - done);
    if (btOut) audioRender(tmp, k);
    else memset(tmp, 0, k * 8);
    int g = btGain;
    for (int i = 0; i < k; i++) {
      fr[done + i].channel1 = (int16_t)(((tmp[2 * i] >> 16) * g) >> 8);
      fr[done + i].channel2 = (int16_t)(((tmp[2 * i + 1] >> 16) * g) >> 8);
    }
    done += k;
  }
  return n;
}

void btEnable() {
  if (btRunning) return;
  if (wifiOn) wifiStop();
  portENTER_CRITICAL(&btMux);
  btDevCount = 0;
  btDevsVer = btDevsVer + 1;
  portEXIT_CRITICAL(&btMux);
  if (!btTarget[0]) strcpy(btTarget, btSaved);
  a2dp.set_local_name("ESP32 Media");
  a2dp.set_ssid_callback(btFound);
  a2dp.set_data_callback_in_frames(btFrames);
  a2dp.set_auto_reconnect(false);
  a2dp.set_pin_code("0000", ESP_BT_PIN_TYPE_VARIABLE);  // для старых наушников без Secure Simple Pairing
  btState = BT_SCAN;
  a2dp.start();
  btRunning = true;
}

void btDisable() {
  btOut = false;
  if (btRunning) {
    esp_bt_gap_cancel_discovery();
    a2dp.end();
    btRunning = false;
  }
  btState = BT_OFF;
  btName[0] = 0;
  listDirty = playerDirty = true;
}

void btConnect(const char* name) {
  bool restart = btRunning && (btState == BT_ON || btState == BT_LINK);
  if (restart) btDisable();
  strncpy(btTarget, name, 32);
  btTarget[32] = 0;
  if (!btRunning) btEnable();
  else btState = BT_SCAN;
}

// Следим за подключением (вызывается в каждом цикле)
void btPoll() {
  if (!btRunning) return;
  bool c = a2dp.is_connected();
  static uint32_t linkSince = 0;
  if (btState == BT_LINK && !c) {  // наушники не ответили — снова ищем
    if (!linkSince) linkSince = millis();
    else if (millis() - linkSince > 20000) { linkSince = 0; btState = BT_SCAN; }
  } else linkSince = 0;
  if (c && btState != BT_ON) {
    btState = BT_ON;
    if (!btName[0]) strncpy(btName, btTarget, 32);
    btOut = true;
    if (strcmp(btSaved, btName)) {
      strncpy(btSaved, btName, 32);
      prefs.begin("media", false); prefs.putString("btdev", btSaved); prefs.end();
    }
    listDirty = playerDirty = true;
  } else if (!c && btState == BT_ON) {  // наушники выключили или унесли
    btDisable();
    if (screen != SC_BT) showMessage("Bluetooth", std::string("Наушники «") + btSaved + "» отключились. Звук снова идёт в динамик.");
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
  int shownOk = 0, shownBad = 0;
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
      float clock = (hasAudio && aStarted) ? audioClock() - (btOut ? BT_DELAY : 0) : (millis() - t0 - pausedMs) / 1000.0f;
      frameIdx++;
      if (len > 0 && ft >= clock - a.usPerFrame / 1e6f * 1.5f) {  // успеваем — показываем, иначе пропускаем кадр
        while (true) {
          float cl = (hasAudio && aStarted) ? audioClock() - (btOut ? BT_DELAY : 0) : (millis() - t0 - pausedMs) / 1000.0f;
          if (cl >= ft - 0.004f || (hasAudio && ringUsed() == 0)) break;
          delay(1);
        }
        if (frame.size() < len) frame.resize(len);
        fsSeek(f, p + 8);
        if (fsReadCb(f, frame.data(), len) == (int32_t)len && jpeg->openRAM(frame.data(), len, videoDraw)) {
          jpeg->setPixelType(RGB565_BIG_ENDIAN);
          if (jpeg->decode(ox, oy, scaleFlag)) shownOk++; else shownBad++;
          jpeg->close();
        } else shownBad++;
        if (shownBad >= 8 && !shownOk) exitReq = true;  // кадры не читаются — дальше смысла нет
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
  if (shownBad && !shownOk)
    showMessage("Кадры не читаются", "Видео в этом файле сжато в JPEG, который плата не умеет разбирать (например, 4:4:4 или прогрессивный).\nПереведите ролик заново в приложении ESP32 Flasher → «Конвертер видео» или командой ffmpeg с параметром -pix_fmt yuvj420p.");
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
  if (cur == path || cur.startsWith(path + "/")) { closeTrack(); prepareTrackArt(); screen = SC_LIST; listDirty = true; }
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
bool touching = false, moved = false, dragVol = false;
int16_t downX, downY, lastY;
int32_t downScroll;
uint32_t downT, lastMoveT;
float vel = 0;
int releaseCount = 0;
int lastBoot = 1;

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
  srand(esp_random());
  prefs.begin("media", true);
  volume = prefs.getInt("vol", 70);
  shuffleOn = prefs.getBool("shuf", false);
  repeatMode = prefs.getInt("rep", 0) % 3;
  String bt = prefs.getString("btdev", "");
  strncpy(btSaved, bt.c_str(), 32);
  prefs.end();
  es8311Init();
  audioHwVolume(volume);
  i2s.setPins(PIN_I2S_BCLK, PIN_I2S_LRCK, PIN_I2S_DOUT, -1, -1);
  if (!i2s.begin(I2S_MODE_STD, OUT_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) Serial.println("I2S failed");
  xTaskCreatePinnedToCore(audioTask, "audio", 4096, nullptr, 5, nullptr, 0);
  renderIdle = trackTick;
  loadDir("/");
  renderList();
}

void loop() {
  uint32_t now = millis();
  trackTick();
  if (trackOn() && trk.finished && ringUsed() < 3u * srcCh) {  // трек закончился
    if (repeatMode == 2) { trk.finished = false; seekTrack(0); }
    else if (!stepTrack(1)) {  // это был последний: встаём в начало на паузе
      trk.finished = false;
      trk.paused = false;
      seekTrack(0);
      trk.paused = true;
      aPause = true;
    }
    playerDirty = miniDirty = listDirty = true;
  }

  int boot = digitalRead(PIN_BOOT);
  if (lastBoot && !boot) { togglePause(); listDirty = true; }
  lastBoot = boot;

  TouchPt t;
  bool down = readTouch(t);
  if (down) {
    releaseCount = 0;
    if (!touching) {
      touching = true; moved = false; vel = 0;
      downX = t.x; downY = t.y; lastY = t.y; downScroll = listScroll; downT = lastMoveT = now;
      dragVol = screen == SC_PLAYER && t.x >= VOL_X - 6 && t.y >= VOL_Y && t.y < VOL_Y + 160;
    } else if (dragVol) {
      if (abs(t.y - downY) > 4) moved = true;
      if (moved) {
        int old = volume;
        setVolume((VOL_BOT - t.y) * 100 / (VOL_BOT - VOL_TOP));
        if (volume != old) renderVolume();
      }
    } else if (screen == SC_LIST && downY >= HDR_H && !(trackOn() && downY >= MINI_Y)) {
      if (abs(t.y - downY) > 8) moved = true;
      if (moved) {
        int32_t ns = std::max(0, std::min(libMaxScroll(), (int)(downScroll - (t.y - downY))));
        float dt = std::max<uint32_t>(1, now - lastMoveT);
        vel = 0.6f * vel + 0.4f * (-(t.y - lastY) / dt);
        lastY = t.y;
        lastMoveT = now;
        if (ns != listScroll) { listScroll = ns; listDirty = true; }
      }
    }
  } else if (touching && ++releaseCount >= 2) {
    touching = false;
    if (dragVol && moved) saveVolume();
    else if (!moved) onTap(downX, downY);
    else if (now - lastMoveT > 80) vel = 0;
    dragVol = false;
    static bool lastShuf = false;
    static int lastRep = 0;
    if (lastShuf != shuffleOn || lastRep != repeatMode) {  // запоминаем режимы
      lastShuf = shuffleOn; lastRep = repeatMode;
      prefs.begin("media", false); prefs.putBool("shuf", shuffleOn); prefs.putInt("rep", repeatMode); prefs.end();
    }
  }
  if (!touching && screen == SC_LIST && fabsf(vel) > 0.05f) {  // инерция
    int maxScroll = libMaxScroll();
    listScroll = std::max(0, std::min(maxScroll, (int)(listScroll + vel * 16)));
    vel *= 0.92f;
    if (listScroll == 0 || listScroll == maxScroll) vel = 0;
    listDirty = true;
  }

  if (wifiOn) server.handleClient();
  btPoll();
  static uint32_t seenBtVer = 0;
  static uint8_t seenBtState = BT_OFF;
  if (btState != seenBtState || (screen == SC_BT && btDevsVer != seenBtVer)) {
    seenBtState = btState;
    seenBtVer = btDevsVer;
    if (screen == SC_BT) renderBt();
    else if (screen == SC_LIST) listDirty = true;
  }
  if (filesChanged && !touching && screen == SC_LIST) {  // приложение что-то загрузило или удалило
    filesChanged = false;
    int32_t keep = listScroll;
    std::string d = curDir;
    for (auto& e : entries) thumbForget(joinDir(curDir, e.name));
    loadDir(d);
    listScroll = keep;
    if (trackOn() && trackDir == curDir) {
      trackDirEntries = entries;
      for (int i = 0; i < (int)entries.size(); i++) if (entries[i].name == trk.name) trackIndex = i;
    }
  }

  static uint32_t lastUi = 0;
  bool tickUi = now - lastUi > 500;
  if (tickUi) lastUi = now;
  if (screen == SC_LIST) {
    if (listDirty) renderList();
    else if (trackOn() && (miniDirty || (tickUi && !trk.paused))) renderMini();
    else if (thumbPending && !touching && fabsf(vel) <= 0.05f) loadPendingThumb();
  } else if (screen == SC_PLAYER) {
    if (!trackOn()) { screen = SC_LIST; listDirty = true; }
    else if (playerDirty) renderPlayer();
    else if (progDirty || (tickUi && !trk.paused)) renderProgress();
  } else if (screen == SC_COVER) {
    if (!trackOn()) hideCover();
  }
  delay(2);
}
#endif
