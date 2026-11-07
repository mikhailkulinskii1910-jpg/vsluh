/*
  Mandelbrot Explorer для ESP32-2432S024R
  (2.4" ILI9341 240x320 + резистивный тач XPT2046)

  Управление:
    • Тап по экрану      — зум x2 в точку касания
    • Кнопка «-» (слева внизу)  — отдалить
    • Кнопка «R» (справа внизу) — сброс вида
    • Кнопка BOOT на плате      — вкл/выкл «психоделическую» анимацию палитры
    • Коснуться экрана во время заставки — перекалибровать тач

  RGB-светодиод: синий — идёт расчёт, зелёный — касание принято.

  Arduino IDE:
    Плата: "ESP32 Dev Module"
    Библиотека: LovyanGFX (через Library Manager, свежая версия)
*/

#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include <Preferences.h>

// ---------- Конфигурация дисплея и тача ----------
class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 _panel;
  lgfx::Bus_SPI       _bus;
  lgfx::Light_PWM     _light;
  lgfx::Touch_XPT2046 _touch;

public:
  LGFX() {
    { // Шина SPI дисплея
      auto cfg = _bus.config();
      cfg.spi_host    = SPI2_HOST;   // HSPI
      cfg.spi_mode    = 0;
      cfg.freq_write  = 40000000;
      cfg.freq_read   = 16000000;
      cfg.spi_3wire   = false;
      cfg.use_lock    = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk    = 14;
      cfg.pin_mosi    = 13;
      cfg.pin_miso    = 12;
      cfg.pin_dc      = 2;
      _bus.config(cfg);
      _panel.setBus(&_bus);
    }
    { // Панель ILI9341
      auto cfg = _panel.config();
      cfg.pin_cs          = 15;
      cfg.pin_rst         = -1;
      cfg.pin_busy        = -1;
      cfg.panel_width     = 240;
      cfg.panel_height    = 320;
      cfg.offset_x        = 0;
      cfg.offset_y        = 0;
      cfg.offset_rotation = 0;
      cfg.readable        = true;
      cfg.invert          = false;   // если цвета инвертированы — поставь true
      cfg.rgb_order       = false;   // если красный и синий перепутаны — поставь true
      cfg.dlen_16bit      = false;
      cfg.bus_shared      = true;    // тач сидит на той же шине
      _panel.config(cfg);
    }
    { // Подсветка (GPIO27 на 2.4" версии)
      auto cfg = _light.config();
      cfg.pin_bl      = 27;
      cfg.invert      = false;
      cfg.freq        = 44100;
      cfg.pwm_channel = 7;
      _light.config(cfg);
      _panel.setLight(&_light);
    }
    { // Тач XPT2046 (CS = GPIO33, общая шина с дисплеем)
      auto cfg = _touch.config();
      cfg.x_min           = 300;
      cfg.x_max           = 3900;
      cfg.y_min           = 200;
      cfg.y_max           = 3800;
      cfg.pin_int         = -1;      // опрос без прерывания
      cfg.bus_shared      = true;
      cfg.offset_rotation = 0;
      cfg.spi_host        = SPI2_HOST;
      cfg.freq            = 2500000;
      cfg.pin_sclk        = 14;
      cfg.pin_mosi        = 13;
      cfg.pin_miso        = 12;
      cfg.pin_cs          = 33;
      _touch.config(cfg);
      _panel.setTouch(&_touch);
    }
    setPanel(&_panel);
  }
};

LGFX lcd;
Preferences prefs;

// ---------- Параметры ----------
constexpr int W = 320, H = 240;
constexpr int PAL = 64;                  // размер циклической палитры
constexpr int PIN_BOOT = 0;
constexpr int LED_R = 4, LED_G = 16, LED_B = 17;  // активны по LOW
constexpr int DOUBLE_FROM_LEVEL = 15;    // с этого зума float уже не хватает

uint8_t*  iterBuf;                       // W*H: 0 = внутри множества, 1..PAL = индекс цвета
uint16_t  palette[PAL];
uint16_t  lineBuf[W];

double   cx = -0.6, cy = 0.0;            // центр вида
int      level = 0;                      // уровень зума (каждый = x2)
uint8_t  palShift = 0;
bool     animate = false;
bool     needRender = true;
uint32_t lastMs = 0;

volatile bool pendingTap = false;
int32_t  tapX = 0, tapY = 0;

// ---------- Утилиты ----------
inline double pixelScale() { return ldexp(3.2 / W, -level); }

inline uint16_t colorOf(uint8_t v) {
  return v == 0 ? 0 : palette[(v - 1 + palShift) % PAL];
}

void buildPalette() {
  for (int i = 0; i < PAL; i++) {
    float t = i * 2.0f * PI / PAL;
    uint8_t r = 128 + 127 * sinf(t);
    uint8_t g = 128 + 127 * sinf(t + 2.094f);
    uint8_t b = 128 + 127 * sinf(t + 4.188f);
    palette[i] = lcd.color565(r, g, b);
  }
}

void waitRelease() {
  int32_t a, b;
  while (lcd.getTouch(&a, &b)) delay(10);
}

// ---------- Математика ----------
// Две версии: float (быстро) и double (точно на глубоком зуме).
// Сделано макросом, а не шаблоном: генератор прототипов Arduino ломает шаблоны в .ino.
#define DEFINE_MANDEL(T, SUFFIX)                                              \
  uint16_t mandel##SUFFIX(T x0, T y0, uint16_t maxIter) {                     \
    /* Главная кардиоида и круг периода 2 — точно внутри */                   \
    T xq = x0 - T(0.25);                                                      \
    T q  = xq * xq + y0 * y0;                                                 \
    if (q * (q + xq) <= T(0.25) * y0 * y0) return maxIter;                    \
    if ((x0 + 1) * (x0 + 1) + y0 * y0 <= T(0.0625)) return maxIter;           \
    T x = 0, y = 0, x2 = 0, y2 = 0;                                           \
    uint16_t i = 0;                                                           \
    while (x2 + y2 <= T(4) && i < maxIter) {                                  \
      y = 2 * x * y + y0; x = x2 - y2 + x0; x2 = x * x; y2 = y * y; i++;      \
    }                                                                         \
    return i;                                                                 \
  }                                                                           \
  /* Рисует кадр построчно. false — прерван касанием */                       \
  bool render##SUFFIX() {                                                     \
    const double s = pixelScale();                                            \
    const uint16_t maxIter = min(1500, 96 + level * 32);                      \
    for (int py = 0; py < H; py++) {                                          \
      T y0 = T(cy + (py - H / 2) * s);                                        \
      uint8_t* row = iterBuf + py * W;                                        \
      for (int px = 0; px < W; px++) {                                        \
        T x0 = T(cx + (px - W / 2) * s);                                      \
        uint16_t n = mandel##SUFFIX(x0, y0, maxIter);                         \
        row[px] = (n >= maxIter) ? 0 : 1 + (n % PAL);                         \
        lineBuf[px] = colorOf(row[px]);                                       \
      }                                                                       \
      lcd.pushImage(0, py, W, 1, lineBuf);                                    \
      if ((py & 7) == 7) { /* проверяем тач, чтобы не ждать долгий рендер */  \
        int32_t x, y;                                                         \
        if (lcd.getTouch(&x, &y)) { tapX = x; tapY = y; pendingTap = true; return false; } \
      }                                                                       \
    }                                                                         \
    return true;                                                              \
  }

DEFINE_MANDEL(float, F)
DEFINE_MANDEL(double, D)

// ---------- Интерфейс ----------
void drawButton(int x, const char* label) {
  lcd.fillRoundRect(x, H - 36, 40, 32, 6, TFT_BLACK);
  lcd.drawRoundRect(x, H - 36, 40, 32, 6, TFT_WHITE);
  lcd.setTextSize(2);
  lcd.setTextColor(TFT_WHITE);
  lcd.setCursor(x + 14, H - 28);
  lcd.print(label);
}

void drawHud() {
  lcd.setTextSize(1);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setCursor(4, 4);
  lcd.printf(" zoom 2^%d | %lu ms | %s ", level, (unsigned long)lastMs,
             level >= DOUBLE_FROM_LEVEL ? "double" : "float");
  drawButton(4, "-");
  drawButton(W - 44, "R");
}

void redrawFromBuffer() {
  lcd.startWrite();
  for (int py = 0; py < H; py++) {
    const uint8_t* row = iterBuf + py * W;
    for (int px = 0; px < W; px++) lineBuf[px] = colorOf(row[px]);
    lcd.pushImage(0, py, W, 1, lineBuf);
  }
  lcd.endWrite();
  drawHud();
}

void handleTap(int x, int y) {
  digitalWrite(LED_G, LOW);
  if (x < 50 && y > H - 40) {                 // «-»
    if (level > 0) level--;
  } else if (x > W - 50 && y > H - 40) {      // «R»
    cx = -0.6; cy = 0.0; level = 0;
  } else if (level < 44) {                    // зум в точку
    double s = pixelScale();
    cx += (x - W / 2) * s;
    cy += (y - H / 2) * s;
    level++;
  }
  delay(40);
  digitalWrite(LED_G, HIGH);
}

// ---------- Калибровка тача (хранится в NVS) ----------
void setupTouch(bool force) {
  uint16_t cal[8];
  prefs.begin("mandel", false);
  if (!force && prefs.getBytes("cal", cal, sizeof(cal)) == sizeof(cal)) {
    lcd.setTouchCalibrate(cal);
  } else {
    lcd.fillScreen(TFT_BLACK);
    lcd.setTextSize(1);
    lcd.setTextColor(TFT_WHITE);
    lcd.setCursor(30, H / 2 - 4);
    lcd.print("Touch calibration: tap the arrow tips");
    lcd.calibrateTouch(cal, TFT_MAGENTA, TFT_BLACK, 15);
    prefs.putBytes("cal", cal, sizeof(cal));
  }
  prefs.end();
}

void splash() {
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_CYAN);
  lcd.setTextSize(3);
  lcd.setCursor(40, 70);
  lcd.print("MANDELBROT");
  lcd.setTextSize(1);
  lcd.setTextColor(TFT_WHITE);
  lcd.setCursor(70, 120);
  lcd.print("tap to zoom, BOOT = animate");
  lcd.setCursor(60, 150);
  lcd.setTextColor(TFT_YELLOW);
  lcd.print("touch now to recalibrate touch");

  bool force = false;
  uint32_t t0 = millis();
  while (millis() - t0 < 2000) {
    int32_t x, y;
    if (lcd.getTouch(&x, &y)) { force = true; waitRelease(); break; }
    delay(20);
  }
  setupTouch(force);
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  for (int p : {LED_R, LED_G, LED_B}) { pinMode(p, OUTPUT); digitalWrite(p, HIGH); }

  lcd.init();
  lcd.setRotation(1);          // альбомная ориентация 320x240
  lcd.setBrightness(200);

  iterBuf = (uint8_t*)malloc(W * H);
  if (!iterBuf) {
    lcd.print("Out of memory");
    while (true) delay(1000);
  }

  buildPalette();
  splash();
}

void loop() {
  // Кнопка BOOT — переключатель анимации палитры
  static bool lastBtn = HIGH;
  bool btn = digitalRead(PIN_BOOT);
  if (lastBtn == HIGH && btn == LOW) { animate = !animate; delay(30); }
  lastBtn = btn;

  // Тач
  int32_t x, y;
  if (!pendingTap && lcd.getTouch(&x, &y)) { tapX = x; tapY = y; pendingTap = true; }

  if (pendingTap) {
    pendingTap = false;
    handleTap(tapX, tapY);
    waitRelease();
    needRender = true;
  }

  // Рендер
  if (needRender) {
    needRender = false;
    digitalWrite(LED_B, LOW);
    uint32_t t0 = millis();
    bool done = (level >= DOUBLE_FROM_LEVEL) ? renderD() : renderF();
    lastMs = millis() - t0;
    digitalWrite(LED_B, HIGH);
    if (done) drawHud();
    return;
  }

  // Анимация палитры: цвета «текут» без пересчёта фрактала
  if (animate) {
    palShift = (palShift + 1) % PAL;
    redrawFromBuffer();
  } else {
    delay(10);
  }
}
