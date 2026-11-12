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
 *   0x07 TEXT    [0x07, UTF-8...]        — латиница по раскладке US, кириллица — клавиши ЙЦУКЕН
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

#define VERSION "1.1"
#define SERVICE_UUID "6b7e0001-3a1f-4c7e-9d2a-6b72697361a0"
#define RX_UUID      "6b7e0002-3a1f-4c7e-9d2a-6b72697361a0"
#define INFO_UUID    "6b7e0003-3a1f-4c7e-9d2a-6b72697361a0"
#define LED_PIN 48
#define BOOT_PIN 0

#ifndef KRISA_DIAG
USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;
#define LOG(...)
#else
/* Диагностика: вместо USB-клавиатуры и мыши — строки в журнал. */
#define LOG(...) Serial.printf(__VA_ARGS__)
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

uint32_t ledNow = 0xFFFFFFFF;
void led(uint8_t r, uint8_t g, uint8_t b) {
  uint32_t c = (r << 16) | (g << 8) | b;
  if (c == ledNow) return;                      // светодиод трогаем только при смене цвета
  ledNow = c;
  rgbLedWrite(LED_PIN, r, g, b);
}

void publishInfo() {
  if (!info) return;
  String s = String("krisa37-hid ") + VERSION + " usb=" + (usbReady ? "1" : "0") + " auth=" +
             (auth == AUTH_OK ? "ok" : auth == AUTH_DENIED ? "denied" : "need");
  info->setValue(s.c_str());
  if (connected) info->notify();
}

class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override { connected = true; auth = AUTH_NEED; }
  void onDisconnect(BLEServer *s) override {
    connected = false; auth = AUTH_NEED;
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

void tap(uint8_t mods, uint8_t key) {
  KeyReport r = {};
  r.modifiers = mods;
  r.keys[0] = key;
  Keyboard.sendReport(&r);
  delay(8);
  KeyReport up = {};
  Keyboard.sendReport(&up);
  delay(8);
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
    case 0x07:
      typeUtf8(p.data + 1, p.len - 1);
      break;
  }
}

void setup() {
  // Слабый USB-порт или длинный кабель: при включении радио напряжение проседает, и детектор
  // просадки перезагружает плату по кругу. Отключаем его — остальное плата переносит.
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
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
#endif
  pinMode(BOOT_PIN, INPUT_PULLUP);
  led(0, 0, 40);
  prefs.begin("krisa37", false);
  hasToken = prefs.getBytes("token", token, 8) == 8;
  LOG("token %s\n", hasToken ? "saved" : "none");

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

  // светодиод
  if (!connected) led(0, 0, (t / 500) % 2 ? 40 : 0);
  else if (auth == AUTH_DENIED) led(60, 0, 0);
  else led(0, 40, 0);

  delay(2);
}
