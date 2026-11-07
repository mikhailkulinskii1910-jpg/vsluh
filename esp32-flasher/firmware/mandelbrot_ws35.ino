/*
  Mandelbrot Explorer 2.0 для Waveshare ESP32-Touch-LCD-3.5
  (ESP32-D0WD-V3, 3.5" ST7796 320x480 IPS, ёмкостный тач FT6336)

  Что нового по сравнению с версией для 2.4" CYD:
    • Считает на ОБОИХ ядрах ESP32: чётные строки — ядро 1, нечётные — ядро 0
    • Мультитач: тап одним пальцем — приблизить, тап двумя пальцами — отдалить
    • Ёмкостный тач не требует калибровки
    • 3 палитры, переключаются кнопкой PWR

  Управление:
    • Тап одним пальцем        — зум x2 в точку касания
    • Тап двумя пальцами       — отдалить x2
    • Кнопка «-» (слева внизу)  — отдалить
    • Кнопка «R» (справа внизу) — сброс вида
    • Кнопка BOOT (сбоку)       — вкл/выкл анимацию палитры
    • Кнопка PWR (короткое нажатие) — следующая палитра
      (долгое нажатие 6 с выключает плату — это делает контроллер питания)

  Arduino IDE:
    Плата: "ESP32 Dev Module"
    PSRAM: "Enabled" (не обязательно, но желательно)
    Библиотека: "GFX Library for Arduino" (moononournation) из Library Manager
    Остальное (тач FT6336 и расширитель TCA9554) драйвится прямо по I2C,
    дополнительные библиотеки не нужны.
*/

#include <Arduino_GFX_Library.h>
#include <Wire.h>

// ---------- Пины платы ----------
constexpr int PIN_SDA  = 21, PIN_SCL = 22;   // общая шина I2C
constexpr int PIN_BL   = 25;                 // подсветка
constexpr int PIN_BOOT = 0;                  // кнопка BOOT (активна по LOW)
constexpr int PIN_PWR  = 36;                 // кнопка PWR (активна по HIGH)

constexpr uint8_t TCA9554_ADDR = 0x20;       // расширитель: P0 = сброс LCD, P1 = сброс тача
constexpr uint8_t FT6336_ADDR  = 0x38;       // тач-контроллер

// Если тач окажется зеркальным — поменяй на true
constexpr bool TOUCH_FLIP_X = false;
constexpr bool TOUCH_FLIP_Y = false;

Arduino_DataBus* bus = new Arduino_ESP32SPI(27 /* DC */, 5 /* CS */, 18 /* SCK */, 23 /* MOSI */, 19 /* MISO */);
Arduino_GFX*     gfx = new Arduino_ST7796(bus, GFX_NOT_DEFINED /* RST через TCA9554 */, 0 /* портрет */, true /* IPS */);

// ---------- Параметры ----------
constexpr int W = 320, H = 480;
constexpr int PAL = 64;
constexpr int DOUBLE_FROM_LEVEL = 15;        // с этого зума float уже не хватает
constexpr int BTN_W = 64, BTN_H = 48, BTN_M = 12;  // экранные кнопки (с отступом от скруглённых углов)

uint8_t*  iterBuf;                           // W*H: 0 = внутри множества, 1..PAL = индекс цвета
uint16_t  palette[PAL];
uint16_t  lineBuf[W];

double   cx = -0.6, cy = 0.0;                // центр вида (ось Re идёт снизу вверх)
int      level = 0;
uint8_t  palShift = 0;
uint8_t  palScheme = 0;
bool     animate = false;
bool     needRender = true;
uint32_t lastMs = 0;

// ---------- Общие данные двух ядер ----------
TaskHandle_t       worker;
volatile uint16_t  frameId = 0;   // меняет только ядро 1
volatile uint16_t  rowFrame[H];              // номер кадра, для которого строка готова
volatile bool      abortFrame = false;
volatile bool      workerBusy = false;
double   fcx, fcy, fScale;                   // снимок параметров кадра
uint16_t fMaxIter;
bool     fDouble;

struct TouchPt { int16_t x, y; uint8_t n; };
TouchPt pending;
bool    hasPending = false;

// ---------- I2C: расширитель TCA9554 ----------
void tcaWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void resetPanelAndTouch() {
  // Регистры: 0x01 — выходы, 0x03 — направление (0 = выход)
  tcaWrite(0x01, 0xFF);
  tcaWrite(0x03, 0b11111100);     // P0 и P1 — выходы, остальное не трогаем
  tcaWrite(0x01, 0b11111100);     // сброс LCD и тача (LOW)
  delay(10);
  tcaWrite(0x01, 0xFF);           // отпускаем сброс
  delay(200);
}

// ---------- I2C: тач FT6336 ----------
uint8_t readTouch(int16_t* x, int16_t* y) {
  Wire.beginTransmission(FT6336_ADDR);
  Wire.write(0x02);               // TD_STATUS и далее координаты двух точек
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((uint8_t)FT6336_ADDR, (uint8_t)11) != 11) return 0;
  uint8_t d[11];
  for (int i = 0; i < 11; i++) d[i] = Wire.read();

  uint8_t n = d[0] & 0x0F;
  if (n == 0 || n > 2) return 0;
  for (int i = 0; i < n; i++) {
    const uint8_t* p = d + 1 + i * 6;
    int16_t tx = ((p[0] & 0x0F) << 8) | p[1];
    int16_t ty = ((p[2] & 0x0F) << 8) | p[3];
    if (TOUCH_FLIP_X) tx = W - 1 - tx;
    if (TOUCH_FLIP_Y) ty = H - 1 - ty;
    x[i] = constrain(tx, 0, W - 1);
    y[i] = constrain(ty, 0, H - 1);
  }
  return n;
}

bool pollTouch(TouchPt& t) {
  int16_t x[2], y[2];
  uint8_t n = readTouch(x, y);
  if (!n) return false;
  t = { x[0], y[0], n };
  return true;
}

// ---------- Палитры ----------
void schemeColor(uint8_t scheme, float t, uint8_t& r, uint8_t& g, uint8_t& b) {
  // t в [0,1), палитра циклическая
  float tri = t < 0.5f ? t * 2 : (1 - t) * 2;   // 0→1→0 для бесшовного цикла
  auto c = [](float v) { return (uint8_t)(255 * constrain(v, 0.0f, 1.0f)); };
  switch (scheme) {
    case 0: {  // радуга
      float a = t * 2 * PI;
      r = 128 + 127 * sinf(a);
      g = 128 + 127 * sinf(a + 2.094f);
      b = 128 + 127 * sinf(a + 4.188f);
      break;
    }
    case 1:    // огонь
      r = c(tri * 3); g = c(tri * 3 - 1); b = c(tri * 3 - 2);
      break;
    default:   // лёд
      r = c(tri * 3 - 2); g = c(tri * 3 - 1); b = c(0.25f + tri * 3);
      break;
  }
}

void buildPalette() {
  for (int i = 0; i < PAL; i++) {
    uint8_t r, g, b;
    schemeColor(palScheme, (float)i / PAL, r, g, b);
    palette[i] = gfx->color565(r, g, b);
  }
}

inline uint16_t colorOf(uint8_t v) {
  return v == 0 ? 0x0000 : palette[(v - 1 + palShift) % PAL];
}

// ---------- Математика ----------
inline double pixelScale() { return ldexp(3.4 / H, -level); }

// Две версии расчёта: float (быстро) и double (точно на глубоком зуме).
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
  /* Экран в портрете: вертикаль — ось Re (вверх), горизонталь — ось Im */    \
  void computeRow##SUFFIX(int py) {                                           \
    const T x0 = T(fcx - (py - H / 2) * fScale);                              \
    uint8_t* row = iterBuf + py * W;                                          \
    for (int px = 0; px < W; px++) {                                          \
      T y0 = T(fcy + (px - W / 2) * fScale);                                  \
      uint16_t n = mandel##SUFFIX(x0, y0, fMaxIter);                          \
      row[px] = (n >= fMaxIter) ? 0 : 1 + (n % PAL);                          \
    }                                                                         \
  }

DEFINE_MANDEL(float, F)
DEFINE_MANDEL(double, D)

void computeRowAuto(int py) {
  if (fDouble) computeRowD(py); else computeRowF(py);
}

// Ядро 0: считает нечётные строки
void workerTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    const uint16_t f = frameId;
    for (int py = 1; py < H && !abortFrame; py += 2) {
      computeRowAuto(py);
      rowFrame[py] = f;
      if ((py & 15) == 15) vTaskDelay(1);   // даём вздохнуть системным задачам ядра 0
    }
    workerBusy = false;
  }
}

void pushRow(int py) {
  const uint8_t* row = iterBuf + py * W;
  for (int px = 0; px < W; px++) lineBuf[px] = colorOf(row[px]);
  gfx->draw16bitRGBBitmap(0, py, lineBuf, W, 1);
}

// Ядро 1 (loop): чётные строки + вывод на экран. false — прервано касанием.
bool renderFrame() {
  fcx = cx; fcy = cy; fScale = pixelScale();
  fMaxIter = min(1500, 96 + level * 32);
  fDouble = level >= DOUBLE_FROM_LEVEL;

  frameId = frameId + 1;
  abortFrame = false;
  workerBusy = true;
  xTaskNotifyGive(worker);

  for (int py = 0; py < H; py += 2) {
    computeRowAuto(py);
    pushRow(py);
    while (rowFrame[py + 1] != frameId) delayMicroseconds(20);
    pushRow(py + 1);

    if ((py & 31) == 30 && pollTouch(pending)) {   // проверка тача каждые 16 пар строк
      hasPending = true;
      abortFrame = true;
      while (workerBusy) delay(1);
      return false;
    }
  }
  while (workerBusy) delay(1);
  return true;
}

// ---------- Интерфейс ----------
void drawButton(int x, const char* label) {
  int y = H - BTN_H - BTN_M;
  gfx->fillRoundRect(x, y, BTN_W, BTN_H, 10, 0x0000);
  gfx->drawRoundRect(x, y, BTN_W, BTN_H, 10, 0xFFFF);
  gfx->setTextSize(3);
  gfx->setTextColor(0xFFFF);
  gfx->setCursor(x + BTN_W / 2 - 8, y + BTN_H / 2 - 11);
  gfx->print(label);
}

void drawHud() {
  static const char* names[] = { "rainbow", "fire", "ice" };
  gfx->setTextSize(1);
  gfx->setTextColor(0xFFFF, 0x0000);
  gfx->setCursor(16, 10);
  gfx->printf(" 2^%d | %lu ms | %s | %s | 2 cores ", level, (unsigned long)lastMs,
              fDouble ? "double" : "float", names[palScheme]);
  drawButton(BTN_M, "-");
  drawButton(W - BTN_W - BTN_M, "R");
}

void redrawFromBuffer() {
  for (int py = 0; py < H; py++) pushRow(py);
  drawHud();
}

bool inButton(int x, int y, int bx) {
  return x >= bx && x < bx + BTN_W && y >= H - BTN_H - BTN_M - 8;
}

void handleGesture(int x, int y, uint8_t fingers) {
  if (fingers >= 2 || inButton(x, y, BTN_M)) {   // два пальца или «-»
    if (level > 0) level--;
  } else if (inButton(x, y, W - BTN_W - BTN_M)) { // «R»
    cx = -0.6; cy = 0.0; level = 0;
  } else if (level < 44) {                        // зум в точку
    double s = pixelScale();
    cx -= (y - H / 2) * s;
    cy += (x - W / 2) * s;
    level++;
  }
}

// Ждёт, пока все пальцы отпустят экран, и считает максимум пальцев за жест
void trackGesture(TouchPt start) {
  uint8_t maxN = start.n;
  int zeros = 0;
  int16_t x[2], y[2];
  while (zeros < 3) {
    delay(15);
    uint8_t n = readTouch(x, y);
    if (n == 0) zeros++;
    else { zeros = 0; if (n > maxN) maxN = n; }
  }
  handleGesture(start.x, start.y, maxN);
}

void splash() {
  gfx->fillScreen(0x0000);
  gfx->setTextColor(0x07FF);
  gfx->setTextSize(4);
  gfx->setCursor(88, 170);
  gfx->print("MANDEL");
  gfx->setCursor(112, 210);
  gfx->print("BROT");
  gfx->setTextSize(1);
  gfx->setTextColor(0xFFFF);
  gfx->setCursor(70, 270); gfx->print("1 finger tap  = zoom in");
  gfx->setCursor(70, 285); gfx->print("2 finger tap  = zoom out");
  gfx->setCursor(70, 300); gfx->print("BOOT = animate, PWR = palette");
  delay(2500);
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  pinMode(PIN_PWR, INPUT);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  resetPanelAndTouch();

  if (!gfx->begin()) Serial.println("gfx->begin() failed!");
  gfx->fillScreen(0x0000);
  analogWrite(PIN_BL, 230);       // яркость 0..255

  iterBuf = (uint8_t*)malloc(W * H);
  if (!iterBuf && psramFound()) iterBuf = (uint8_t*)ps_malloc(W * H);
  if (!iterBuf) {
    gfx->setCursor(10, 10);
    gfx->print("Out of memory");
    while (true) delay(1000);
  }

  buildPalette();
  xTaskCreatePinnedToCore(workerTask, "mandel", 4096, nullptr, 1, &worker, 0);
  splash();
}

void loop() {
  // BOOT — анимация палитры
  static bool lastBoot = digitalRead(PIN_BOOT);
  bool boot = digitalRead(PIN_BOOT);
  if (lastBoot == HIGH && boot == LOW) { animate = !animate; delay(30); }
  lastBoot = boot;

  // PWR — следующая палитра
  static bool lastPwr = digitalRead(PIN_PWR);
  bool pwr = digitalRead(PIN_PWR);
  if (lastPwr == LOW && pwr == HIGH) {
    palScheme = (palScheme + 1) % 3;
    buildPalette();
    redrawFromBuffer();
    delay(30);
  }
  lastPwr = pwr;

  // Тач
  if (!hasPending) hasPending = pollTouch(pending);
  if (hasPending) {
    hasPending = false;
    trackGesture(pending);
    needRender = true;
  }

  // Рендер
  if (needRender) {
    needRender = false;
    uint32_t t0 = millis();
    bool done = renderFrame();
    lastMs = millis() - t0;
    if (done) drawHud();
    return;
  }

  // Анимация: цвета «текут» без пересчёта фрактала
  if (animate) {
    palShift = (palShift + 1) % PAL;
    redrawFromBuffer();
  } else {
    delay(10);
  }
}
