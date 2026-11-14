/*
 * krisa37 HID — донгл «мышь и клавиатура» для доски на ESP32-S3 SuperMini.
 *
 * В USB доски/ПК плата видна как обычные USB-клавиатура и мышь (TinyUSB, драйверы не нужны).
 * Телефон с krisa37™ (вкладка «Тачпад») подключается по Bluetooth LE и шлёт команды.
 *
 * BLE: имя «krisa37 HID», сервис 6b7e0001-…, RX (запись) 6b7e0002-…, INFO (чтение/уведомления) 6b7e0003-….
 * Пакеты RX:
 *   0x10 AUTH    [0x10, 8 байт токена]   — первый телефон привязывает донгл, чужим — отказ
 *   0x01 MOVE    [0x01, dx, dy, wheel, pan] (int8)
 *   0x02 BUTTONS [0x02, mask]            — удержание кнопок (1 L, 2 R, 4 M)
 *   0x03 CLICK   [0x03, mask, count]
 *   0x04 KEY     [0x04, mods, keycode]   — нажать и отпустить (mods: 1 Ctrl, 2 Shift, 4 Alt, 8 Win)
 *   0x05 KEYDOWN [0x05, mods, keycode]   — зажать (держится, пока не придёт KEYUP; до 6 клавиш)
 *   0x06 KEYUP   [0x06, mods, keycode]   — отпустить; [0x06] — отпустить всё (и кнопки мыши)
 *   0x07 TEXT    [0x07, UTF-8...]        — латиница по раскладке US, кириллица — клавиши ЙЦУКЕН
 *   0x08 LED     [0x08, mode, r, g, b, bright] — светодиод: 0 авто (статус), 1 цвет, 2 дыхание, 3 радуга, 4 выкл;
 *                запоминается в памяти платы. В INFO — «led=rgb».
 *   Скрипт (Ducky/макрос): 0x20 начать приём, 0x21 <байткод…> дописать, 0x22 <auto 0|1> сохранить в память,
 *                0x23 выполнить сохранённый сейчас, 0x24 стереть. Байткод: 01 len текст | 02 mods key нажать |
 *                03 lo hi пауза мс | 04 dx dy мышь | 05 mask count клик | 08 wheel колесо. В INFO — «scr=1» если сохранён.
 *                Автозапуск: при включении плата один раз проигрывает сохранённый скрипт (печатает на компьютер).
 * Зажатые модификаторы действуют и на KEY, TEXT и клики мыши (Shift+клик, Ctrl+колесо).
 * Телефон отключился — всё зажатое отпускается само.
 * Сброс привязки: удерживать BOOT 3 секунды.
 * Светодиод (RGB на GPIO48): синий мигает — ждёт телефон, зелёный — подключён, красный — чужой телефон.
 * Защита от перезагрузок по кругу: если плата 3 раза подряд упала (просадка питания, сбой), Bluetooth
 * не включается, а светодиод мигает: жёлтым — просадка питания, фиолетовым — сбой программы.
 * Сборка с -DKRISA_DIAG — диагностическая: без USB-мыши, вместо неё журнал в последовательный порт (115200).
 */
#ifndef KRISA_DIAG
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"
#endif
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_system.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include "types.h"

#define VERSION "1.5"
#define SERVICE_UUID "6b7e0001-3a1f-4c7e-9d2a-6b72697361a0"
#define RX_UUID      "6b7e0002-3a1f-4c7e-9d2a-6b72697361a0"
#define INFO_UUID    "6b7e0003-3a1f-4c7e-9d2a-6b72697361a0"
#define LED_PIN 48
#define BOOT_PIN 0

#ifndef KRISA_DIAG
USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;
#define LOG(...) Serial0.printf(__VA_ARGS__)    // журнал в UART0: на платах с разъёмом COM его видно в консоли
#else
/* Диагностика: вместо USB-клавиатуры и мыши — строки в журнал. */
#define LOG(...) do { Serial.printf(__VA_ARGS__); Serial0.printf(__VA_ARGS__); } while (0)   // и в USB, и в COM (UART0)
#define MOUSE_LEFT 1
#define MOUSE_RIGHT 2
#define MOUSE_MIDDLE 4
typedef struct { uint8_t modifiers; uint8_t reserved; uint8_t keys[6]; } KeyReport;
struct DiagKeyboard {
  void begin() {}
  void sendReport(KeyReport *r) { if (r->keys[0] || r->modifiers) LOG("key mods=%02x code=%02x\n", r->modifiers, r->keys[0]); }
} Keyboard;
struct DiagMouse {
  uint8_t b = 0;
  void begin() {}
  void move(int8_t x, int8_t y, int8_t w = 0, int8_t p = 0) { LOG("move %d %d %d %d\n", x, y, w, p); }
  void press(uint8_t m) { b |= m; LOG("press %d\n", m); }
  void release(uint8_t m) { b &= ~m; LOG("release %d\n", m); }
  bool isPressed(uint8_t m) { return b & m; }
  void click(uint8_t m) { LOG("click %d\n", m); }
} Mouse;
#endif

/* Счётчик падений подряд — переживает перезагрузку, обнуляется при отключении питания. */
RTC_NOINIT_ATTR uint32_t crashes;
RTC_NOINIT_ATTR uint32_t crashMagic;
bool safeMode = false;
bool brownout = false;
Preferences prefs;

BLECharacteristic *info;
volatile bool connected = false;
volatile bool usbReady = false;
volatile AuthState auth = AUTH_NEED;
uint8_t token[8];
bool hasToken = false;

/* Команды из BLE-потока передаём в loop() через очередь: USB трогаем только из одного места. */
QueueHandle_t queue;

/* Скрипт (Ducky/макрос) для автозапуска и выполнения по команде. */
static const size_t SCRIPT_MAX = 2048;
uint8_t scriptBuf[SCRIPT_MAX];
size_t scriptLen = 0, scriptRecv = 0;
bool scriptAuto = false;
bool scriptRan = false;
volatile bool scriptRunning = false;

uint32_t ledNow = 0xFFFFFFFF;
void led(uint8_t r, uint8_t g, uint8_t b) {
  uint32_t c = (r << 16) | (g << 8) | b;
  if (c == ledNow) return;                      // светодиод трогаем только при смене цвета
  ledNow = c;
  rgbLedWrite(LED_PIN, r, g, b);
}

/* Светодиод по выбору пользователя (0x08): режим, цвет, яркость — хранятся в NVS. */
uint8_t ledMode = 0, ledR = 0, ledG = 120, ledB = 255, ledBright = 40;
uint32_t ledSaveAt = 0;

void hsv(uint16_t h, uint8_t &r, uint8_t &g, uint8_t &b) {   // h 0..1535 — полный круг, полная насыщенность
  uint8_t x = h & 255;
  switch (h >> 8) {
    case 0: r = 255; g = x; b = 0; break;
    case 1: r = 255 - x; g = 255; b = 0; break;
    case 2: r = 0; g = 255; b = x; break;
    case 3: r = 0; g = 255 - x; b = 255; break;
    case 4: r = x; g = 0; b = 255; break;
    default: r = 255; g = 0; b = 255 - x; break;
  }
}

/* false — режим «авто»: светодиод показывает статус, как раньше. */
bool userLed(uint32_t t) {
  auto out = [](uint8_t r, uint8_t g, uint8_t b, uint16_t k) { led(r * k / 255 * ledBright / 255, g * k / 255 * ledBright / 255, b * k / 255 * ledBright / 255); };
  switch (ledMode) {
    case 1: out(ledR, ledG, ledB, 255); return true;
    case 2: { uint16_t ph = (t / 8) % 512; uint16_t k = ph < 256 ? ph : 511 - ph; out(ledR, ledG, ledB, 10 + k * 245 / 255); return true; }
    case 3: { uint8_t r, g, b; hsv((t / 6) % 1536, r, g, b); out(r, g, b, 255); return true; }
    case 4: led(0, 0, 0); return true;
  }
  return false;
}

void publishInfo() {
  if (!info) return;
  String s = String("krisa37-hid ") + VERSION + " usb=" + (usbReady ? "1" : "0") + " auth=" +
             (auth == AUTH_OK ? "ok" : auth == AUTH_DENIED ? "denied" : "need") + " led=rgb scr=" + (scriptLen > 0 ? "1" : "0");
  info->setValue(s.c_str());
  if (connected) info->notify();
}

class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override { connected = true; auth = AUTH_NEED; }
  void onDisconnect(BLEServer *s) override {
    connected = false; auth = AUTH_NEED;
    Packet rel = {1, {0x06}};                   // ничего не должно остаться зажатым
    xQueueSend(queue, &rel, 0);
    BLEDevice::startAdvertising();
  }
};

class RxCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    Packet p;
    size_t n = c->getLength();
    if (n == 0) return;
    p.len = n > sizeof(p.data) ? sizeof(p.data) : n;
    memcpy(p.data, c->getData(), p.len);
    xQueueSend(queue, &p, 0);
  }
};

/* ---------- текст: символ → клавиша ---------- */

const uint8_t SHIFT = 0x02;

// US-раскладка для печатных ASCII 0x20..0x7E
KeyStroke ascii(char ch) {
  if (ch >= 'a' && ch <= 'z') return {0, (uint8_t)(0x04 + ch - 'a')};
  if (ch >= 'A' && ch <= 'Z') return {SHIFT, (uint8_t)(0x04 + ch - 'A')};
  if (ch >= '1' && ch <= '9') return {0, (uint8_t)(0x1E + ch - '1')};
  switch (ch) {
    case '0': return {0, 0x27};
    case ' ': return {0, 0x2C};
    case '\n': return {0, 0x28};
    case '\t': return {0, 0x2B};
    case '\b': return {0, 0x2A};
    case '-': return {0, 0x2D}; case '_': return {SHIFT, 0x2D};
    case '=': return {0, 0x2E}; case '+': return {SHIFT, 0x2E};
    case '[': return {0, 0x2F}; case '{': return {SHIFT, 0x2F};
    case ']': return {0, 0x30}; case '}': return {SHIFT, 0x30};
    case '\\': return {0, 0x31}; case '|': return {SHIFT, 0x31};
    case ';': return {0, 0x33}; case ':': return {SHIFT, 0x33};
    case '\'': return {0, 0x34}; case '"': return {SHIFT, 0x34};
    case '`': return {0, 0x35}; case '~': return {SHIFT, 0x35};
    case ',': return {0, 0x36}; case '<': return {SHIFT, 0x36};
    case '.': return {0, 0x37}; case '>': return {SHIFT, 0x37};
    case '/': return {0, 0x38}; case '?': return {SHIFT, 0x38};
    case '!': return {SHIFT, 0x1E}; case '@': return {SHIFT, 0x1F};
    case '#': return {SHIFT, 0x20}; case '$': return {SHIFT, 0x21};
    case '%': return {SHIFT, 0x22}; case '^': return {SHIFT, 0x23};
    case '&': return {SHIFT, 0x24}; case '*': return {SHIFT, 0x25};
    case '(': return {SHIFT, 0x26}; case ')': return {SHIFT, 0x27};
  }
  return {0, 0};
}

// ЙЦУКЕН: строчные а…я по порядку алфавита → клавиша US, на которой эта буква в русской раскладке
const char RU_KEYS[] = "f,dult;pbqrkvyjghcnea[wxio]sm'.z";   // а б в г д е ж з и й к л м н о п р с т у ф х ц ч ш щ ъ ы ь э ю я

KeyStroke cyrillic(uint32_t cp) {
  if (cp == 0x0451) return {0, 0x35};          // ё
  if (cp == 0x0401) return {SHIFT, 0x35};      // Ё
  bool upper = cp >= 0x0410 && cp <= 0x042F;
  uint32_t lo = upper ? cp + 0x20 : cp;
  if (lo < 0x0430 || lo > 0x044F) return {0, 0};
  KeyStroke k = ascii(RU_KEYS[lo - 0x0430]);
  if (upper) k.mods |= SHIFT;
  return k;
}

/* Зажатые клавиши (KEYDOWN/KEYUP): модификаторы и до 6 клавиш держатся, пока телефон их не отпустит. */
uint8_t heldMods = 0;
uint8_t heldKeys[6] = {0};

void sendHeld(uint8_t mods = 0, uint8_t key = 0) {
  KeyReport r = {};
  r.modifiers = heldMods | mods;
  int n = 0;
  for (int i = 0; i < 6; i++) if (heldKeys[i]) r.keys[n++] = heldKeys[i];
  if (key && n < 6) r.keys[n++] = key;
  Keyboard.sendReport(&r);
}

void tap(uint8_t mods, uint8_t key) {
  sendHeld(mods, key);
  delay(8);
  sendHeld();
  delay(8);
}

void keyDown(uint8_t mods, uint8_t key) {
  heldMods |= mods;
  if (key) {
    bool have = false;
    for (int i = 0; i < 6; i++) if (heldKeys[i] == key) have = true;
    for (int i = 0; i < 6 && !have; i++) if (!heldKeys[i]) { heldKeys[i] = key; have = true; }
  }
  sendHeld();
}

void keyUp(uint8_t mods, uint8_t key) {
  heldMods &= ~mods;
  if (key) for (int i = 0; i < 6; i++) if (heldKeys[i] == key) heldKeys[i] = 0;
  sendHeld();
}

void releaseAll() {
  heldMods = 0;
  memset(heldKeys, 0, sizeof(heldKeys));
  sendHeld();
  for (uint8_t b : {MOUSE_LEFT, MOUSE_RIGHT, MOUSE_MIDDLE}) if (Mouse.isPressed(b)) Mouse.release(b);
}

/* UTF-8 может разрезаться между пакетами — держим незаконченный символ здесь. */
uint32_t pendingCp = 0;
int pendingLeft = 0;

void typeUtf8(const uint8_t *s, size_t n) {
  for (size_t i = 0; i < n; i++) {
    uint8_t b = s[i];
    if (pendingLeft > 0 && (b & 0xC0) == 0x80) {
      pendingCp = (pendingCp << 6) | (b & 0x3F);
      if (--pendingLeft > 0) continue;
    } else if (b < 0x80) {
      pendingCp = b; pendingLeft = 0;
    } else if ((b & 0xE0) == 0xC0) { pendingCp = b & 0x1F; pendingLeft = 1; continue; }
    else if ((b & 0xF0) == 0xE0) { pendingCp = b & 0x0F; pendingLeft = 2; continue; }
    else if ((b & 0xF8) == 0xF0) { pendingCp = b & 0x07; pendingLeft = 3; continue; }
    else { pendingLeft = 0; continue; }
    KeyStroke k = pendingCp < 0x80 ? ascii((char)pendingCp) : cyrillic(pendingCp);
    if (k.key) tap(k.mods, k.key);
  }
}

/* Проиграть байткод скрипта (печатает клавиши и двигает мышь на компьютере). */
void runBytecode(const uint8_t *b, size_t n) {
  scriptRunning = true;
  size_t i = 0;
  while (i < n) {
    uint8_t op = b[i++];
    if (op == 0x01) { if (i >= n) break; uint8_t len = b[i++]; if (i + len > n) len = n - i; typeUtf8(b + i, len); i += len; }
    else if (op == 0x02) { if (i + 2 > n) break; tap(b[i], b[i + 1]); i += 2; }
    else if (op == 0x03) { if (i + 2 > n) break; uint32_t ms = b[i] | (b[i + 1] << 8); i += 2; uint32_t e = millis() + ms; while (millis() < e) delay(5); }
    else if (op == 0x04) { if (i + 2 > n) break; Mouse.move((int8_t)b[i], (int8_t)b[i + 1]); i += 2; delay(6); }
    else if (op == 0x05) { if (i + 2 > n) break; for (uint8_t k = 0; k < b[i + 1] && k < 10; k++) { Mouse.click(b[i]); delay(40); } i += 2; }
    else if (op == 0x08) { if (i + 1 > n) break; Mouse.move(0, 0, (int8_t)b[i]); i += 1; delay(6); }
    else break;
  }
  scriptRunning = false;
}

void scriptSave() {
  scriptLen = scriptRecv;
  prefs.putBytes("scr", scriptBuf, scriptLen);
  prefs.putUChar("scrauto", scriptAuto ? 1 : 0);
}

/* ---------- команды ---------- */

void handle(const Packet &p) {
  uint8_t t = p.data[0];
  if (t == 0x10) {
    if (p.len < 9) return;
    if (!hasToken) {
      memcpy(token, p.data + 1, 8);
      prefs.putBytes("token", token, 8);
      hasToken = true;
    }
    auth = memcmp(token, p.data + 1, 8) == 0 ? AUTH_OK : AUTH_DENIED;
    publishInfo();
    return;
  }
  if (t == 0x06 && p.len < 3) { releaseAll(); return; }   // «отпустить всё» — безопасно всегда
  if (auth != AUTH_OK) return;                       // без привязки команды не выполняем
  switch (t) {
    case 0x01:
      if (p.len >= 5) Mouse.move((int8_t)p.data[1], (int8_t)p.data[2], (int8_t)p.data[3], (int8_t)p.data[4]);
      else if (p.len >= 3) Mouse.move((int8_t)p.data[1], (int8_t)p.data[2]);
      break;
    case 0x02: {
      uint8_t m = p.len >= 2 ? p.data[1] : 0;
      for (uint8_t b : {MOUSE_LEFT, MOUSE_RIGHT, MOUSE_MIDDLE}) {
        bool want = m & b;
        if (want && !Mouse.isPressed(b)) Mouse.press(b);
        if (!want && Mouse.isPressed(b)) Mouse.release(b);
      }
      break;
    }
    case 0x03: {
      uint8_t m = p.len >= 2 ? p.data[1] : MOUSE_LEFT;
      uint8_t n = p.len >= 3 ? p.data[2] : 1;
      for (uint8_t i = 0; i < n && i < 5; i++) { Mouse.click(m); delay(40); }
      break;
    }
    case 0x04:
      if (p.len >= 3) tap(p.data[1], p.data[2]);
      break;
    case 0x05:
      if (p.len >= 3) keyDown(p.data[1], p.data[2]);
      break;
    case 0x06:
      keyUp(p.data[1], p.data[2]);
      break;
    case 0x08:
      if (p.len >= 6) {
        ledMode = p.data[1] > 4 ? 0 : p.data[1]; ledR = p.data[2]; ledG = p.data[3]; ledB = p.data[4]; ledBright = p.data[5];
        ledSaveAt = millis() + 2000;            // в память — через 2 с после последнего изменения
      }
      break;
    case 0x07:
      typeUtf8(p.data + 1, p.len - 1);
      break;
    case 0x20: scriptRecv = 0; break;
    case 0x21: { size_t c = p.len - 1; if (scriptRecv + c <= SCRIPT_MAX) { memcpy(scriptBuf + scriptRecv, p.data + 1, c); scriptRecv += c; } break; }
    case 0x22: scriptAuto = p.len >= 2 && p.data[1]; scriptSave(); publishInfo(); break;
    case 0x23: runBytecode(scriptBuf, scriptLen); break;
    case 0x24: scriptLen = scriptRecv = 0; scriptAuto = false; prefs.remove("scr"); prefs.remove("scrauto"); publishInfo(); break;
  }
}

void setup() {
  // Первым делом — строка в UART0 (разъём COM): если плата падает дальше, будет видно, где.
  Serial0.begin(115200);
  Serial0.printf("\n[krisa37] setup %s\n", VERSION);
  esp_reset_reason_t why = esp_reset_reason();
  if (crashMagic != 0x6b726973) { crashMagic = 0x6b726973; crashes = 0; }
  bool crash = why == ESP_RST_PANIC || why == ESP_RST_INT_WDT || why == ESP_RST_TASK_WDT || why == ESP_RST_WDT || why == ESP_RST_BROWNOUT;
  crashes = crash ? crashes + 1 : 0;
  brownout = why == ESP_RST_BROWNOUT;
  safeMode = crashes >= 3;

#ifdef KRISA_DIAG
  Serial.begin(115200);
  delay(1500);
  LOG("\n\nkrisa37-hid %s DIAG, reset reason %d, crashes %u%s\n", VERSION, (int)why, crashes, safeMode ? " -> SAFE MODE" : "");
#else
  LOG("\n\nkrisa37-hid %s, reset reason %d, crashes %u%s\n", VERSION, (int)why, crashes, safeMode ? " -> SAFE MODE" : "");
#endif
  pinMode(BOOT_PIN, INPUT_PULLUP);
  led(0, 0, 40);
  prefs.begin("krisa37", false);
  hasToken = prefs.getBytes("token", token, 8) == 8;
  LOG("token %s\n", hasToken ? "saved" : "none");
  uint8_t ls[5];
  if (prefs.getBytes("led", ls, 5) == 5) { ledMode = ls[0] > 4 ? 0 : ls[0]; ledR = ls[1]; ledG = ls[2]; ledB = ls[3]; ledBright = ls[4]; }
  size_t sl = prefs.getBytesLength("scr");
  if (sl > 0 && sl <= SCRIPT_MAX) { scriptLen = prefs.getBytes("scr", scriptBuf, sl); scriptRecv = scriptLen; }
  scriptAuto = prefs.getUChar("scrauto", 0) == 1;

#ifndef KRISA_DIAG
  USB.productName("krisa37 HID");
  USB.manufacturerName("krisa37");
  Keyboard.begin();
  Mouse.begin();
  USB.begin();
#endif
  LOG("usb ok\n");

  queue = xQueueCreate(64, sizeof(Packet));
  if (safeMode) return;                         // падали подряд — без Bluetooth, только индикация

  delay(600);                                   // даём USB подняться до того, как радио возьмёт ток
  LOG("ble init\n");
  BLEDevice::init("krisa37 HID");
  BLEDevice::setPower(ESP_PWR_LVL_N0);          // поменьше мощность — поменьше ток; на 5–10 м хватает
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCb());
  BLEService *svc = server->createService(SERVICE_UUID);
  BLECharacteristic *rx = svc->createCharacteristic(RX_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCb());
  info = svc->createCharacteristic(INFO_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  info->addDescriptor(new BLE2902());
  publishInfo();
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  LOG("ble ok, advertising\n");
}

uint32_t bootDown = 0;

void loop() {
  uint32_t t = millis();
  if (safeMode) {                               // мигаем причиной: жёлтый — питание, фиолетовый — сбой
    bool on = (t / 400) % 2;
    if (brownout) led(on ? 50 : 0, on ? 35 : 0, 0); else led(on ? 40 : 0, 0, on ? 40 : 0);
    delay(20);
    return;
  }
  if (t > 10000) crashes = 0;                   // проработали 10 с — значит, не падаем

  // автозапуск: один раз через 3 с после включения печатаем сохранённый скрипт на компьютер
  if (!scriptRan && scriptAuto && scriptLen > 0 && t > 3000) { scriptRan = true; runBytecode(scriptBuf, scriptLen); }

  Packet p;
  while (xQueueReceive(queue, &p, 0) == pdTRUE) { LOG("rx %02x len %d\n", p.data[0], p.len); handle(p); }

  // доска включила/выключила USB — сообщаем телефону
#ifndef KRISA_DIAG
  bool ready = (bool)USB;
#else
  bool ready = true;
#endif
  if (ready != usbReady) { usbReady = ready; publishInfo(); }

  // удерживать BOOT 3 с — забыть привязанный телефон
  if (digitalRead(BOOT_PIN) == LOW) {
    if (!bootDown) bootDown = millis();
    else if (millis() - bootDown > 3000) {
      prefs.remove("token"); hasToken = false; auth = AUTH_NEED; publishInfo();
      for (int i = 0; i < 3; i++) { led(60, 60, 60); delay(150); led(0, 0, 0); delay(150); }
      bootDown = 0;
      while (digitalRead(BOOT_PIN) == LOW) delay(10);
    }
  } else bootDown = 0;

  if (ledSaveAt && millis() > ledSaveAt) {
    uint8_t ls[5] = {ledMode, ledR, ledG, ledB, ledBright};
    prefs.putBytes("led", ls, 5); ledSaveAt = 0;
  }

  // светодиод: свой режим — или статус («авто»)
  if (userLed(t)) {}
  else if (!connected) led(0, 0, (t / 500) % 2 ? 40 : 0);
  else if (auth == AUTH_DENIED) led(60, 0, 0);
  else led(0, 40, 0);

  delay(2);
}
