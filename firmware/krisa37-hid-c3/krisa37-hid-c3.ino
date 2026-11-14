/*
 * krisa37 HID для ESP32-C3 SuperMini — Bluetooth-клавиатура и мышь для доски.
 *
 * У ESP32-C3 нет USB-контроллера, который умеет быть клавиатурой (как у S3), поэтому здесь донгл
 * подключается к доске по Bluetooth: на доске в настройках Bluetooth сопрягается «krisa37 HID»
 * как клавиатура/мышь, а питание плата берёт от любого USB (доска, зарядка, пауэрбанк).
 * Телефон с krisa37™ подключается к той же плате по Bluetooth LE — протокол тот же, что у S3:
 * сервис 6b7e0001-…, RX 6b7e0002-…, INFO 6b7e0003-… (см. firmware/krisa37-hid).
 * В INFO «usb=1» значит «доска подключена по Bluetooth».
 * Сброс привязки телефона: удерживать BOOT 3 с. Синий светодиод (GPIO8): мигает медленно — ждёт телефон,
 * горит — телефон подключён, мигает часто — подключился чужой телефон.
 * 0x08 LED [0x08, mode, r, g, b, bright]: 0 авто, 1 горит, 2 дыхание, 3 мигает, 4 выкл — светодиод тут один (синий),
 * цвет не важен, только яркость. В INFO — «led=mono».
 */
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEHIDDevice.h>
#include <BLE2902.h>
#include <BLESecurity.h>
#include <Preferences.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "types.h"
#include "keymap.h"

#define VERSION "1.4"
#define SERVICE_UUID "6b7e0001-3a1f-4c7e-9d2a-6b72697361a0"
#define RX_UUID      "6b7e0002-3a1f-4c7e-9d2a-6b72697361a0"
#define INFO_UUID    "6b7e0003-3a1f-4c7e-9d2a-6b72697361a0"
#define LED_PIN 8        // синий, горит при LOW
#define BOOT_PIN 9

// Клавиатура (отчёт 1) и мышь с колесом и горизонтальной прокруткой (отчёт 2)
static const uint8_t REPORT_MAP[] = {
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01,
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x08, 0x81, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01,
  0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x73, 0x05, 0x07, 0x19, 0x00, 0x29, 0x73, 0x81, 0x00,
  0xC0,
  0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x85, 0x02, 0x09, 0x01, 0xA1, 0x00,
  0x05, 0x09, 0x19, 0x01, 0x29, 0x05, 0x15, 0x00, 0x25, 0x01, 0x95, 0x05, 0x75, 0x01, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x81, 0x01,
  0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03, 0x81, 0x06,
  0x05, 0x0C, 0x0A, 0x38, 0x02, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x01, 0x81, 0x06,
  0xC0, 0xC0,
  // медиа-клавиши ТВ/телефона (отчёт 3): один 16-битный Consumer usage
  0x05, 0x0C, 0x09, 0x01, 0xA1, 0x01, 0x85, 0x03,
  0x19, 0x00, 0x2A, 0xFF, 0x03, 0x15, 0x00, 0x26, 0xFF, 0x03, 0x75, 0x10, 0x95, 0x01, 0x81, 0x00,
  0xC0,
};

BLEServer *server;
BLECharacteristic *info, *kbIn, *mouseIn, *consumerIn;
Preferences prefs;
QueueHandle_t queue;

/* Скрипт (Ducky/макрос) — хранится на плате, проигрывается по команде или при включении. */
static const size_t SCRIPT_MAX = 2048;
uint8_t scriptBuf[SCRIPT_MAX];
size_t scriptLen = 0, scriptRecv = 0;
bool scriptAuto = false, scriptRan = false;
volatile int phoneConn = -1;                    // conn_id телефона, приславшего AUTH
volatile AuthState auth = AUTH_NEED;
uint8_t token[8];
bool hasToken = false;
uint8_t mouseButtons = 0;

bool boardConnected() { return server && (int)server->getConnectedCount() > (phoneConn >= 0 ? 1 : 0); }

void publishInfo() {
  if (!info) return;
  String s = String("krisa37-hid-c3 ") + VERSION + " usb=" + (boardConnected() ? "1" : "0") + " auth=" +
             (auth == AUTH_OK ? "ok" : auth == AUTH_DENIED ? "denied" : "need") + " led=mono scr=" + (scriptLen > 0 ? "1" : "0");
  info->setValue(s.c_str());
  if (phoneConn >= 0) info->notify();
}

class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer *s, esp_ble_gatts_cb_param_t *p) override {
    BLEDevice::startAdvertising();              // ещё одно подключение: доска и телефон одновременно
  }
  void onDisconnect(BLEServer *s, esp_ble_gatts_cb_param_t *p) override {
    if (p->disconnect.conn_id == phoneConn) {
      phoneConn = -1; auth = AUTH_NEED;
      Packet rel = {1, {0x06}};                 // телефон ушёл — ничего не оставляем зажатым
      xQueueSend(queue, &rel, 0);
    }
    BLEDevice::startAdvertising();
  }
};

class RxCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c, esp_ble_gatts_cb_param_t *param) override {
    Packet p;
    size_t n = c->getLength();
    if (n == 0) return;
    p.len = n > sizeof(p.data) ? sizeof(p.data) : n;
    memcpy(p.data, c->getData(), p.len);
    if (p.data[0] == 0x10) phoneConn = param->write.conn_id;
    xQueueSend(queue, &p, 0);
  }
};

/* ---------- отчёты HID ---------- */

/* Зажатые клавиши (KEYDOWN 0x05 / KEYUP 0x06): держатся, пока телефон их не отпустит. */
uint8_t heldMods = 0;
uint8_t heldKeys[6] = {0};

void keyReport(uint8_t mods, uint8_t key) {
  uint8_t r[8] = {(uint8_t)(heldMods | mods), 0, 0, 0, 0, 0, 0, 0};
  int n = 2;
  for (int i = 0; i < 6; i++) if (heldKeys[i]) r[n++] = heldKeys[i];
  if (key && n < 8) r[n++] = key;
  kbIn->setValue(r, sizeof(r)); kbIn->notify();
}

void tap(uint8_t mods, uint8_t key) { keyReport(mods, key); delay(12); keyReport(0, 0); delay(12); }

void keyDown(uint8_t mods, uint8_t key) {
  heldMods |= mods;
  if (key) {
    bool have = false;
    for (int i = 0; i < 6; i++) if (heldKeys[i] == key) have = true;
    for (int i = 0; i < 6 && !have; i++) if (!heldKeys[i]) { heldKeys[i] = key; have = true; }
  }
  keyReport(0, 0);
}

void keyUp(uint8_t mods, uint8_t key) {
  heldMods &= ~mods;
  if (key) for (int i = 0; i < 6; i++) if (heldKeys[i] == key) heldKeys[i] = 0;
  keyReport(0, 0);
}

void mouseReport(int8_t x, int8_t y, int8_t w, int8_t pan) {
  uint8_t r[5] = {mouseButtons, (uint8_t)x, (uint8_t)y, (uint8_t)w, (uint8_t)pan};
  mouseIn->setValue(r, sizeof(r)); mouseIn->notify();
}

uint32_t pendingCp = 0;
int pendingLeft = 0;

void typeUtf8(const uint8_t *s, size_t n) {
  for (size_t i = 0; i < n; i++) {
    uint8_t b = s[i];
    if (pendingLeft > 0 && (b & 0xC0) == 0x80) {
      pendingCp = (pendingCp << 6) | (b & 0x3F);
      if (--pendingLeft > 0) continue;
    } else if (b < 0x80) { pendingCp = b; pendingLeft = 0; }
    else if ((b & 0xE0) == 0xC0) { pendingCp = b & 0x1F; pendingLeft = 1; continue; }
    else if ((b & 0xF0) == 0xE0) { pendingCp = b & 0x0F; pendingLeft = 2; continue; }
    else if ((b & 0xF8) == 0xF0) { pendingCp = b & 0x07; pendingLeft = 3; continue; }
    else { pendingLeft = 0; continue; }
    KeyStroke k = pendingCp < 0x80 ? ascii((char)pendingCp) : cyrillic(pendingCp);
    if (k.key) tap(k.mods, k.key);
  }
}

uint8_t ledMode = 0, ledBright = 255;
uint32_t ledSaveAt = 0;
int ledLevel = -1;

/* Яркость 0…255 (светодиод горит при LOW, поэтому ШИМ инвертируем). */
void ledPwm(int v) { if (v == ledLevel) return; ledLevel = v; analogWrite(LED_PIN, 255 - v); }
void led(bool on) { ledPwm(on ? ledBright : 0); }

bool userLed(uint32_t t) {
  switch (ledMode) {
    case 1: ledPwm(ledBright); return true;
    case 2: { uint16_t ph = (t / 8) % 512; uint16_t k = ph < 256 ? ph : 511 - ph; ledPwm(ledBright * (10 + k * 245 / 255) / 255); return true; }
    case 3: ledPwm((t / 300) % 2 ? ledBright : 0); return true;
    case 4: ledPwm(0); return true;
  }
  return false;
}

void mclick(uint8_t mask, uint8_t cnt) {
  for (uint8_t k = 0; k < cnt && k < 10; k++) {
    uint8_t keep = mouseButtons;
    mouseButtons = keep | (mask & 7); mouseReport(0, 0, 0, 0); delay(20);
    mouseButtons = keep; mouseReport(0, 0, 0, 0); delay(40);
  }
}

void runBytecode(const uint8_t *b, size_t n) {
  size_t i = 0;
  while (i < n) {
    uint8_t op = b[i++];
    if (op == 0x01) { if (i >= n) break; uint8_t len = b[i++]; if (i + len > n) len = n - i; typeUtf8(b + i, len); i += len; }
    else if (op == 0x02) { if (i + 2 > n) break; tap(b[i], b[i + 1]); i += 2; }
    else if (op == 0x03) { if (i + 2 > n) break; uint32_t ms = b[i] | (b[i + 1] << 8); i += 2; uint32_t e = millis() + ms; while (millis() < e) delay(5); }
    else if (op == 0x04) { if (i + 2 > n) break; mouseReport((int8_t)b[i], (int8_t)b[i + 1], 0, 0); i += 2; delay(6); }
    else if (op == 0x05) { if (i + 2 > n) break; mclick(b[i], b[i + 1]); i += 2; }
    else if (op == 0x08) { if (i + 1 > n) break; mouseReport(0, 0, (int8_t)b[i], 0); i += 1; delay(6); }
    else break;
  }
}

void scriptSave() {
  scriptLen = scriptRecv;
  prefs.putBytes("scr", scriptBuf, scriptLen);
  prefs.putUChar("scrauto", scriptAuto ? 1 : 0);
}

void handle(const Packet &p) {
  uint8_t t = p.data[0];
  if (t == 0x10) {
    if (p.len < 9) return;
    if (!hasToken) { memcpy(token, p.data + 1, 8); prefs.putBytes("token", token, 8); hasToken = true; }
    auth = memcmp(token, p.data + 1, 8) == 0 ? AUTH_OK : AUTH_DENIED;
    publishInfo();
    return;
  }
  if (t == 0x06 && p.len < 3) {                 // «отпустить всё» — безопасно всегда
    heldMods = 0; memset(heldKeys, 0, sizeof(heldKeys)); keyReport(0, 0);
    if (mouseButtons) { mouseButtons = 0; mouseReport(0, 0, 0, 0); }
    return;
  }
  if (auth != AUTH_OK) return;
  switch (t) {
    case 0x01:
      if (p.len >= 5) mouseReport((int8_t)p.data[1], (int8_t)p.data[2], (int8_t)p.data[3], (int8_t)p.data[4]);
      else if (p.len >= 3) mouseReport((int8_t)p.data[1], (int8_t)p.data[2], 0, 0);
      break;
    case 0x02:
      mouseButtons = p.len >= 2 ? p.data[1] & 7 : 0;
      mouseReport(0, 0, 0, 0);
      break;
    case 0x03: {
      uint8_t m = p.len >= 2 ? p.data[1] & 7 : 1, n = p.len >= 3 ? p.data[2] : 1;
      for (uint8_t i = 0; i < n && i < 5; i++) {
        uint8_t keep = mouseButtons;
        mouseButtons = keep | m; mouseReport(0, 0, 0, 0); delay(20);
        mouseButtons = keep; mouseReport(0, 0, 0, 0); delay(40);
      }
      break;
    }
    case 0x04: if (p.len >= 3) tap(p.data[1], p.data[2]); break;
    case 0x05: if (p.len >= 3) keyDown(p.data[1], p.data[2]); break;
    case 0x06: keyUp(p.data[1], p.data[2]); break;
    case 0x07: typeUtf8(p.data + 1, p.len - 1); break;
    case 0x08:
      if (p.len >= 6) { ledMode = p.data[1] > 4 ? 0 : p.data[1]; ledBright = max<uint8_t>(p.data[5], 8); ledSaveAt = millis() + 2000; }
      break;
    case 0x09:                                   // ТВ/телефон: медиа-клавиша
      if (p.len >= 3) { uint8_t r[2] = {p.data[1], p.data[2]}; consumerIn->setValue(r, 2); consumerIn->notify(); delay(60); uint8_t z[2] = {0, 0}; consumerIn->setValue(z, 2); consumerIn->notify(); }
      break;
    case 0x20: scriptRecv = 0; break;
    case 0x21: { size_t c = p.len - 1; if (scriptRecv + c <= SCRIPT_MAX) { memcpy(scriptBuf + scriptRecv, p.data + 1, c); scriptRecv += c; } break; }
    case 0x22: scriptAuto = p.len >= 2 && p.data[1]; scriptSave(); publishInfo(); break;
    case 0x23: runBytecode(scriptBuf, scriptLen); break;
    case 0x24: scriptLen = scriptRecv = 0; scriptAuto = false; prefs.remove("scr"); prefs.remove("scrauto"); publishInfo(); break;
  }
}


void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);    // слабое питание при включении радио — не перезагружаться
  pinMode(LED_PIN, OUTPUT); led(true);
  pinMode(BOOT_PIN, INPUT_PULLUP);
  prefs.begin("krisa37", false);
  hasToken = prefs.getBytes("token", token, 8) == 8;
  uint8_t ls[2];
  if (prefs.getBytes("led", ls, 2) == 2) { ledMode = ls[0] > 4 ? 0 : ls[0]; ledBright = ls[1]; }
  size_t sl = prefs.getBytesLength("scr");
  if (sl > 0 && sl <= SCRIPT_MAX) { scriptLen = prefs.getBytes("scr", scriptBuf, sl); scriptRecv = scriptLen; }
  scriptAuto = prefs.getUChar("scrauto", 0) == 1;
  queue = xQueueCreate(64, sizeof(Packet));

  BLEDevice::init("krisa37 HID");
  BLEDevice::setPower(ESP_PWR_LVL_N0);
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCb());

  // HID для доски
  BLEHIDDevice *hid = new BLEHIDDevice(server);
  kbIn = hid->inputReport(1);
  hid->outputReport(1);                         // светодиоды Caps/Num — не используем
  mouseIn = hid->inputReport(2);
  consumerIn = hid->inputReport(3);
  hid->manufacturer()->setValue("krisa37");
  hid->pnp(0x02, 0x303A, 0x8137, 0x0100);
  hid->hidInfo(0x00, 0x01);
  hid->reportMap((uint8_t *)REPORT_MAP, sizeof(REPORT_MAP));
  hid->startServices();
  hid->setBatteryLevel(100);
  BLESecurity *sec = new BLESecurity();
  sec->setAuthenticationMode(ESP_LE_AUTH_BOND);
  sec->setCapability(ESP_IO_CAP_NONE);
  sec->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  // сервис для телефона
  BLEService *svc = server->createService(SERVICE_UUID);
  BLECharacteristic *rx = svc->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCb());
  info = svc->createCharacteristic(INFO_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  info->addDescriptor(new BLE2902());
  publishInfo();
  svc->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->setAppearance(0x03C0);                   // HID (клавиатура/мышь)
  adv->addServiceUUID(hid->hidService()->getUUID());
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

uint32_t bootDown = 0;
bool lastBoard = false;

void loop() {
  Packet p;
  while (xQueueReceive(queue, &p, 0) == pdTRUE) handle(p);

  bool b = boardConnected();
  if (b != lastBoard) { lastBoard = b; publishInfo(); }

  if (digitalRead(BOOT_PIN) == LOW) {           // BOOT 3 с — забыть телефон
    if (!bootDown) bootDown = millis();
    else if (millis() - bootDown > 3000) {
      prefs.remove("token"); hasToken = false; auth = AUTH_NEED; publishInfo();
      for (int i = 0; i < 6; i++) { led(i % 2 == 0); delay(150); }
      bootDown = 0;
      while (digitalRead(BOOT_PIN) == LOW) delay(10);
    }
  } else bootDown = 0;

  if (ledSaveAt && millis() > ledSaveAt) { uint8_t ls[2] = {ledMode, ledBright}; prefs.putBytes("led", ls, 2); ledSaveAt = 0; }
  uint32_t t = millis();
  if (!scriptRan && scriptAuto && scriptLen > 0 && t > 4000) { scriptRan = true; runBytecode(scriptBuf, scriptLen); }
  if (userLed(t)) {}
  else if (phoneConn < 0) led((t / 600) % 2);
  else if (auth == AUTH_DENIED) led((t / 120) % 2);
  else led(true);
  delay(5);
}
