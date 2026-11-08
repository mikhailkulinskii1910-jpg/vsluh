/*
  Счётчик нажатий для Waveshare ESP32-Touch-LCD-3.5
  (ESP32-D0WD-V3, 3.5" ST7796 320x480, тач FT6336)

  На экране большая кнопка и число нажатий.
    • нажатие на кнопку или кнопку BOOT на плате — +1
    • число сохраняется в памяти платы и не пропадает после выключения
    • внизу — скорость (нажатий в секунду) и рекорд скорости
    • каждые 100 нажатий — салют
    • «Сбросить» — удерживать 2 секунды

  Arduino IDE: плата "ESP32 Dev Module", PSRAM "Enabled".
  Библиотека: "GFX Library for Arduino".
*/

#ifndef HOST_SIM
#include <Arduino_GFX_Library.h>
#include <Wire.h>
#include <SPI.h>
#include <Preferences.h>
#endif
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <algorithm>

// ===================== Константы =====================
#define MK565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

#define SCREEN_W 320
#define SCREEN_H 480
#define STRIP_H 32

#define CARD_Y 92                   // карточка с числом
#define CARD_H 140
#define BTN_X 160                   // кнопка
#define BTN_Y 338
#define BTN_R 80
#define ROW_Y 440                   // скорость и сброс
#define ROW_H 32
#define RESET_X 212
#define RESET_W 92
#define HOLD_MS 2000

#define C_BG     MK565(14, 15, 19)
#define C_WHITE  MK565(255, 255, 255)
#define C_BLACK  0x0000
#define C_TXT2   MK565(186, 188, 200)
#define C_TXT3   MK565(130, 132, 146)
#define C_BTN0   MK565(96, 150, 255)
#define C_BTN1   MK565(124, 72, 238)
#define C_GLOW   MK565(110, 120, 255)
#define C_GOLD   MK565(255, 200, 80)
#define C_RED    MK565(255, 110, 120)

enum FontId : uint8_t { FN_HUGE, FN_BIG, FN_MID, FN_TITLE, FN_SEMI, FN_SMALL, FN_TINY, FN_COUNT, FN_BODY = FN_SMALL };  // FN_BODY — запасной шрифт для редких знаков

// ===================== Типы =====================
struct Glyph { uint16_t cp; uint8_t w, h; int8_t xo, yo; uint8_t adv; uint32_t off; };
struct AAFont { uint8_t* bits; const Glyph* g; uint16_t n; int8_t asc, desc; const char* b64; uint32_t nbytes; };
struct Surface {
  uint16_t* px = nullptr;
  int w = 0, h = 0;
  int cx0 = 0, cy0 = 0, cx1 = 0, cy1 = 0;
};
struct TouchPt { int16_t x, y; };
struct Particle { float x, y, vx, vy; uint16_t c; };

// ===================== Шрифты =====================
// ---- Сгенерировано genfonts.py: шрифт Inter (SIL OFL 1.1), запасной DejaVu Sans ----
// FN_HUGE_F: 112px, 11 глифов, 24745 байт
static const char FN_HUGE_F_B64[] PROGMEM =
  "AAAAAAAAAAAAAAAAFHnN7//+24YgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKM///////////+pQAAAAAAAAAAAAAAAAAAAAAAAAAA"
  "Bs////////////////kgAAAAAAAAAAAAAAAAAAAAAAAG7//////////////////6IAAAAAAAAAAAAAAAAAAAAAPf////////////"
  "////////+AAAAAAAAAAAAAAAAAAAAH///////////////////////9IAAAAAAAAAAAAAAAAAHP////////////////////////9Q"
  "AAAAAAAAAAAAAAAB3//////////////////////////2AAAAAAAAAAAAAAAu////////////////////////////gAAAAAAAAAAA"
  "AAHf////////////////////////////9gAAAAAAAAAAAAz//////////////////////////////0AAAAAAAAAAAJ//////////"
  "//////////////////////IAAAAAAAAABP////////////////////////////////wAAAAAAAAAHv///////////////97/////"
  "//////////9wAAAAAAAAn/////////////+UEAACbf/////////////xAAAAAAAC/////////////4EAAAAAAEz////////////5"
  "AAAAAAAK////////////8wAAAAAAAACv////////////IAAAAAAv///////////9IAAAAAAAAAAH////////////oAAAAACf////"
  "///////yAAAAAAAAAAAAn///////////8QAAAAH///////////9gAAAAAAAAAAAADf//////////+AAAAAb///////////oAAAAA"
  "AAAAAAAAA////////////gAAAAz///////////EAAAAAAAAAAAAAAI///////////0AAAB///////////6AAAAAAAAAAAAAAAC//"
  "/////////5AAAG///////////zAAAAAAAAAAAAAAAAv//////////+AAAL///////////AAAAAAAAAAAAAAAAAT///////////MA"
  "AP//////////9gAAAAAAAAAAAAAAAADv//////////cAA///////////8gAAAAAAAAAAAAAAAACf//////////sAB///////////"
  "0AAAAAAAAAAAAAAAAABf//////////8ACv//////////kAAAAAAAAAAAAAAAAAAf//////////8gDf//////////UAAAAAAAAAAA"
  "AAAAAAAN//////////9QD///////////IAAAAAAAAAAAAAAAAAAK//////////9wL///////////AAAAAAAAAAAAAAAAAAAH////"
  "//////+gT//////////9AAAAAAAAAAAAAAAAAAAF///////////Qb//////////7AAAAAAAAAAAAAAAAAAAD///////////gj///"
  "///////5AAAAAAAAAAAAAAAAAAAB///////////wn//////////3AAAAAAAAAAAAAAAAAAAA///////////xv//////////2AAAA"
  "AAAAAAAAAAAAAAAA7//////////zz//////////1AAAAAAAAAAAAAAAAAAAA3//////////0z//////////1AAAAAAAAAAAAAAAA"
  "AAAAz//////////03//////////0AAAAAAAAAAAAAAAAAAAAz//////////13//////////zAAAAAAAAAAAAAAAAAAAAv///////"
  "///17//////////zAAAAAAAAAAAAAAAAAAAAr//////////27//////////zAAAAAAAAAAAAAAAAAAAAr//////////23///////"
  "///zAAAAAAAAAAAAAAAAAAAAv//////////13//////////0AAAAAAAAAAAAAAAAAAAAz//////////1z//////////0AAAAAAAA"
  "AAAAAAAAAAAAz//////////0z//////////1AAAAAAAAAAAAAAAAAAAA3//////////0v//////////2AAAAAAAAAAAAAAAAAAAA"
  "7//////////zn//////////3AAAAAAAAAAAAAAAAAAAA7//////////xj//////////5AAAAAAAAAAAAAAAAAAAB///////////w"
  "b//////////7AAAAAAAAAAAAAAAAAAAD///////////gX//////////9AAAAAAAAAAAAAAAAAAAF///////////QL///////////"
  "AAAAAAAAAAAAAAAAAAAH//////////+gD///////////EAAAAAAAAAAAAAAAAAAJ//////////+ADf//////////QAAAAAAAAAAA"
  "AAAAAAAM//////////9QC///////////kAAAAAAAAAAAAAAAAAAf//////////8wB///////////0AAAAAAAAAAAAAAAAABf////"
  "//////8AA///////////8QAAAAAAAAAAAAAAAACf//////////wAAP//////////9QAAAAAAAAAAAAAAAADf//////////gAAM//"
  "////////+wAAAAAAAAAAAAAAAAP///////////QAAH///////////yAAAAAAAAAAAAAAAAr///////////AAAC///////////5AA"
  "AAAAAAAAAAAAAC///////////6AAAA3///////////EAAAAAAAAAAAAAAI///////////1AAAAf///////////oAAAAAAAAAAAAA"
  "A////////////xAAAAH///////////9QAAAAAAAAAAAADf//////////+QAAAACv///////////xAAAAAAAAAAAAj///////////"
  "8gAAAAA////////////9IAAAAAAAAAAH////////////sAAAAAAL////////////4wAAAAAAAACv////////////QAAAAAAD////"
  "/////////4EAAAAAAEz////////////7AAAAAAAAr/////////////+UIAATbf/////////////yAAAAAAAAH///////////////"
  "/+////////////////+AAAAAAAAABf////////////////////////////////0AAAAAAAAAAK//////////////////////////"
  "//////MAAAAAAAAAAB3//////////////////////////////2AAAAAAAAAAAAHv////////////////////////////+AAAAAAA"
  "AAAAAAAu////////////////////////////kAAAAAAAAAAAAAAC7//////////////////////////4AAAAAAAAAAAAAAAAHf//"
  "//////////////////////9wAAAAAAAAAAAAAAAAAI///////////////////////+MAAAAAAAAAAAAAAAAAAATv////////////"
  "////////+RAAAAAAAAAAAAAAAAAAAAAG7//////////////////7MAAAAAAAAAAAAAAAAAAAAAAAFt////////////////owAAAA"
  "AAAAAAAAAAAAAAAAAAAAAAON////////////phAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFXrO7//+24YwAAAAAAAAAAAAAAAAAAAA"
  "AAAAAAAZ////////////AAAAAAAAAAPv////////////AAAAAAAAAI//////////////AAAAAAAALP//////////////AAAAAAAG"
  "////////////////AAAAAAG/////////////////AAAAAE7/////////////////AAAAGf//////////////////AAAD3///////"
  "////////////AAB/////////////////////ACz/////////////////////Bv//////////////////////r///////////////"
  "////////////////////////////////////////////7//////////////////////5G/////////////////////5QC///////"
  "/////////////7EAC///////////////////9gAAC//////////////////8IAAAC/////////////////+AAAAAC///////////"
  "/////+MAAAAAC///////////////+hAAAAAAC///////////////UAAAAAAAC/////////////+xAAAAAAAAC/////////////YA"
  "AAAAAAAAC////////////SAAAAAAAAAAC///////////cAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAA"
  "AAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAA"
  "C///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///"
  "////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////"
  "////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////"
  "AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAA"
  "AAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAA"
  "AAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAA"
  "C///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///"
  "////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////"
  "////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////"
  "AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAA"
  "AAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAA"
  "AAAAC///////////AAAAAAAAAAAAC///////////AAAAAAAAAAAAABSKvN//7bqWIAAAAAAAAAAAAAAAAAAAAAAAAABIz///////"
  "////63IAAAAAAAAAAAAAAAAAAAAAF+////////////////xQAAAAAAAAAAAAAAAAAAKf///////////////////nEAAAAAAAAAAA"
  "AAAAB//////////////////////+QAAAAAAAAAAAAAAc////////////////////////kQAAAAAAAAAAAE//////////////////"
  "////////4wAAAAAAAAAAb///////////////////////////8wAAAAAAAABP////////////////////////////8wAAAAAAAD//"
  "////////////////////////////4gAAAAAAL///////////////////////////////4QAAAAAM////////////////////////"
  "////////gAAAAAX/////////////////////////////////IAAAAN//////////////qHZ4rv/////////////8AAAAf///////"
  "/////6MAAAAAA6/////////////0AAAO///////////9MAAAAAAAACz///////////+gAAT///////////sQAAAAAAAAAAj/////"
  "//////8AAJ///////////QAAAAAAAAAAAAn///////////UADv//////////IAAAAAAAAAAAAA3//////////6AC//////////+A"
  "AAAAAAAAAAAAAE///////////gB///////////EAAAAAAAAAAAAAAM//////////8Qr/////////+wAAAAAAAAAAAAAAB///////"
  "////MM//////////cAAAAAAAAAAAAAAAL//////////0Dv/////////zAAAAAAAAAAAAAAAA//////////9Q//////////8gAAAA"
  "AAAAAAAAAAAP//////////UP//////////EAAAAAAAAAAAAAAADv/////////0AzMzMzMzMzMwAAAAAAAAAAAAAAAA//////////"
  "8wAAAAAAAAAAAAAAAAAAAAAAAAAAAf//////////EAAAAAAAAAAAAAAAAAAAAAAAAAAAT//////////gAAAAAAAAAAAAAAAAAAAA"
  "AAAAAAAI//////////sAAAAAAAAAAAAAAAAAAAAAAAAAAADv/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAF//////////8gAA"
  "AAAAAAAAAAAAAAAAAAAAAAAADf/////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAH//////////9gAAAAAAAAAAAAAAAAAAAAAAAA"
  "AAL///////////EAAAAAAAAAAAAAAAAAAAAAAAAAAM//////////9wAAAAAAAAAAAAAAAAAAAAAAAAAAn//////////9AAAAAAAA"
  "AAAAAAAAAAAAAAAAAAB///////////9QAAAAAAAAAAAAAAAAAAAAAAAAAF///////////6AAAAAAAAAAAAAAAAAAAAAAAAAAT///"
  "////////4QAAAAAAAAAAAAAAAAAAAAAAAAA////////////0AAAAAAAAAAAAAAAAAAAAAAAAAD////////////gAAAAAAAAAAAAA"
  "AAAAAAAAAAAAP///////////+wAAAAAAAAAAAAAAAAAAAAAAAAA////////////9EAAAAAAAAAAAAAAAAAAAAAAAAE//////////"
  "//4gAAAAAAAAAAAAAAAAAAAAAAAAT////////////zAAAAAAAAAAAAAAAAAAAAAAAABf////////////UAAAAAAAAAAAAAAAAAAA"
  "AAAAAG////////////9gAAAAAAAAAAAAAAAAAAAAAAAAf////////////2AAAAAAAAAAAAAAAAAAAAAAAACP////////////cAAA"
  "AAAAAAAAAAAAAAAAAAAAAI////////////9wAAAAAAAAAAAAAAAAAAAAAAAAn////////////3AAAAAAAAAAAAAAAAAAAAAAAACv"
  "////////////cAAAAAAAAAAAAAAAAAAAAAAAAL////////////9gAAAAAAAAAAAAAAAAAAAAAAABz////////////2AAAAAAAAAA"
  "AAAAAAAAAAAAAAHP////////////UAAAAAAAAAAAAAAAAAAAAAAAAd////////////9AAAAAAAAAAAAAAAAAAAAAAAAC3///////"
  "/////0AAAAAAAAAAAAAAAAAAAAAAAALv////////////QAAAAAAAAAAAAAAAAAAAAAAAA+////////////9AAAAAAAAAAAAAAAAA"
  "AAAAAAAD/////////////0AAAAAAAAAAAAAAAAAAAAAAAAT/////////////QAAAAAAAAAAAAAAAAAAAAAAABf////////////9A"
  "AAAAAAAAAAAAAAAAAAAAAAAF/////////////0AAAAAAAAAAAAAAAAAAAAAAAAb/////////////QAAAAAAAAAAAAAAAAAAAAAAA"
  "B/////////////8wAAAAAAAAAAAAAAAAAAAAAAAI/////////////zAAAAAAAAAAAAAAAAAAAAAAAAn/////////////MAAAAAAA"
  "AAAAAAAAAAAAAAAACv////////////8wAAAAAAAAAAAAAAAAAAAAAAAK//////////////u7u7u7u7u7u7u7u7u7u7u7tQv/////"
  "////////////////////////////////c//////////////////////////////////////3P///////////////////////////"
  "//////////9z//////////////////////////////////////c//////////////////////////////////////3P/////////"
  "////////////////////////////9z//////////////////////////////////////c///////////////////////////////"
  "///////3P/////////////////////////////////////9z//////////////////////////////////////c/////////////"
  "/////////////////////////3P/////////////////////////////////////9z//////////////////////////////////"
  "////cAAAAAAAAAAAAAAAJpq97/7cuoQQAAAAAAAAAAAAAAAAAAAAAAAAAAACe+///////////8hAAAAAAAAAAAAAAAAAAAAAAAAA"
  "XP///////////////+cQAAAAAAAAAAAAAAAAAAAAF+///////////////////5IAAAAAAAAAAAAAAAAAAF7/////////////////"
  "////9wAAAAAAAAAAAAAAAAG////////////////////////8IAAAAAAAAAAAAAAF//////////////////////////9QAAAAAAAA"
  "AAAABv///////////////////////////2AAAAAAAAAAAAb/////////////////////////////UAAAAAAAAAAH////////////"
  "//////////////////9QAAAAAAAABf///////////////////////////////yAAAAAAAAHv////////////////////////////"
  "///7AAAAAAAAn/////////////////////////////////UAAAAAAE///////////////Jdmec//////////////4QAAAAAN////"
  "/////////GAAAAAABd////////////9gAAAABP///////////+QAAAAAAAAAb////////////AAAAAC///////////+gAAAAAAAA"
  "AAA////////////xAAAAH///////////oAAAAAAAAAAAAD///////////3AAAAX//////////9AAAAAAAAAAAAAAj//////////7"
  "AAAAj//////////zAAAAAAAAAAAAAAHv/////////+AAAAv//////////AAAAAAAAAAAAAAACf//////////EAAA3/////////9w"
  "AAAAAAAAAAAAAABf//////////IAAA//////////9AAAAAAAAAAAAAAAAv//////////MAAAzMzMzMzMzMwgAAAAAAAAAAAAAAAf"
  "//////////IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf//////////EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv//////////AAAAAA"
  "AAAAAAAAAAAAAAAAAAAAAAAABf/////////9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAACv/////////5AAAAAAAAAAAAAAAAAAAAAA"
  "AAAAAAAAH//////////1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAr//////////xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF////////"
  "//+AAAAAAAAAAAAAAAAAAAAAAAAAAAAABf//////////8QAAAAAAAAAAAAAAAAAAAAAAAAAAABn///////////YAAAAAAAAAAAAA"
  "AAAAAAAAAAAAAAF+///////////7AAAAAAAAAAAAAAAAAAAAAAAAASR7/////////////RAAAAAAAAAAAAAAAAAAAP//////////"
  "//////////wQAAAAAAAAAAAAAAAAAAAP///////////////////6EAAAAAAAAAAAAAAAAAAAAP//////////////////5QAAAAAA"
  "AAAAAAAAAAAAAAAP/////////////////oEAAAAAAAAAAAAAAAAAAAAAAP///////////////7YAAAAAAAAAAAAAAAAAAAAAAAAP"
  "//////////////MAAAAAAAAAAAAAAAAAAAAAAAAAAP//////////////+4UQAAAAAAAAAAAAAAAAAAAAAAAP////////////////"
  "/7UAAAAAAAAAAAAAAAAAAAAAAP///////////////////mAAAAAAAAAAAAAAAAAAAAAP////////////////////1AAAAAAAAAAA"
  "AAAAAAAAAP/////////////////////4AAAAAAAAAAAAAAAAAAAP//////////////////////oAAAAAAAAAAAAAAAAAAHd3d3eJ"
  "rP//////////////+gAAAAAAAAAAAAAAAAAAAAAAAAAAOO/////////////3AAAAAAAAAAAAAAAAAAAAAAAAAAAAXv//////////"
  "//MAAAAAAAAAAAAAAAAAAAAAAAAAAAAY////////////0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAf///////////9AAAAAAAAAAAAA"
  "AAAAAAAAAAAAAAAAB////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM///////////yAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  "AD///////////2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7//////////6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAj//////////+AA"
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAb///////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAX///////////EAAAAAAAAAAAAAAAAA"
  "AAAAAAAAAAAAX///////////Kf//////////UAAAAAAAAAAAAAAAAAb///////////KP//////////cAAAAAAAAAAAAAAAAAn///"
  "////////F///////////sAAAAAAAAAAAAAAAAA7///////////BP//////////8gAAAAAAAAAAAAAAAE///////////9Af//////"
  "////+gAAAAAAAAAAAAAAAN///////////7AN///////////2AAAAAAAAAAAAAACf///////////3AI////////////YAAAAAAAAA"
  "AAAAj////////////yAD////////////+RAAAAAAAAAAAb/////////////QAAz////////////+YQAAAAAAABf/////////////"
  "9gAAX//////////////6YwAAACav//////////////4AAAC//////////////////u//////////////////YAAAAv//////////"
  "/////////////////////////8AAAAAG///////////////////////////////////yAAAAAAv/////////////////////////"
  "////////9QAAAAAAHP////////////////////////////////UAAAAAAAAc///////////////////////////////1AAAAAAAA"
  "AAv/////////////////////////////9AAAAAAAAAAACf///////////////////////////9MAAAAAAAAAAAAD3///////////"
  "//////////////9wAAAAAAAAAAAAAAB////////////////////////7IAAAAAAAAAAAAAAAACjv////////////////////pAAA"
  "AAAAAAAAAAAAAAAAAFz/////////////////1xAAAAAAAAAAAAAAAAAAAAAAAnrv///////////+tzAAAAAAAAAAAAAAAAAAAAAA"
  "AAAAABWKvN7/7cupYgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM/////////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAABv"
  "/////////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAH//////////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAr/////////////"
  "/4AAAAAAAAAAAAAAAAAAAAAAAAAAAF///////////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAe///////////////4AAAAAAAAAA"
  "AAAAAAAAAAAAAAAACf///////////////4AAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////4AAAAAAAAAAAAAAAAAAAAAA"
  "AAAA3////////////////4AAAAAAAAAAAAAAAAAAAAAAAAAI/////////////////4AAAAAAAAAAAAAAAAAAAAAAAAAv////////"
  "/////////4AAAAAAAAAAAAAAAAAAAAAAAADP/////////////////4AAAAAAAAAAAAAAAAAAAAAAAAb//////////////////4AA"
  "AAAAAAAAAAAAAAAAAAAAAC///////////////////4AAAAAAAAAAAAAAAAAAAAAAAL///////////////////4AAAAAAAAAAAAAA"
  "AAAAAAAABf///////////////////4AAAAAAAAAAAAAAAAAAAAAAHv///////////////////4AAAAAAAAAAAAAAAAAAAAAAr///"
  "/////////////////4AAAAAAAAAAAAAAAAAAAAAE//////////+P/////////4AAAAAAAAAAAAAAAAAAAAAO//////////cv////"
  "/////4AAAAAAAAAAAAAAAAAAAACP/////////9Av/////////4AAAAAAAAAAAAAAAAAAAAP//////////zAv/////////4AAAAAA"
  "AAAAAAAAAAAAAA3/////////+QAv/////////4AAAAAAAAAAAAAAAAAAAH//////////4QAv/////////4AAAAAAAAAAAAAAAAAA"
  "Av//////////QAAv/////////4AAAAAAAAAAAAAAAAAAC//////////6AAAv/////////4AAAAAAAAAAAAAAAAAAb//////////h"
  "AAAv/////////4AAAAAAAAAAAAAAAAAB//////////9QAAAv/////////4AAAAAAAAAAAAAAAAAK//////////sAAAAv////////"
  "/4AAAAAAAAAAAAAAAABP//////////IAAAAv/////////4AAAAAAAAAAAAAAAAHv/////////2AAAAAv/////////4AAAAAAAAAA"
  "AAAAAAn//////////AAAAAAv/////////4AAAAAAAAAAAAAAAD//////////8gAAAAAv/////////4AAAAAAAAAAAAAAAN//////"
  "////gAAAAAAv/////////4AAAAAAAAAAAAAACP/////////9AAAAAAAv/////////4AAAAAAAAAAAAAAL//////////zAAAAAAAv"
  "/////////4AAAAAAAAAAAAAAz/////////+QAAAAAAAv/////////4AAAAAAAAAAAAAG//////////4QAAAAAAAv/////////4AA"
  "AAAAAAAAAAAv//////////QAAAAAAAAv/////////4AAAAAAAAAAAAC//////////6AAAAAAAAAv/////////4AAAAAAAAAAAAX/"
  "/////////xAAAAAAAAAv/////////4AAAAAAAAAAAB7/////////9QAAAAAAAAAv/////////4AAAAAAAAAAAJ//////////sAAA"
  "AAAAAAAv/////////4AAAAAAAAAABP//////////IAAAAAAAAAAv/////////4AAAAAAAAAADf/////////2AAAAAAAAAAAv////"
  "/////4AAAAAAAAAAj//////////AAAAAAAAAAAAv/////////4AAAAAAAAAD//////////8gAAAAAAAAAAAv/////////4AAAAAA"
  "AAAM//////////gAAAAAAAAAAAAv/////////4AAAAAAAAB//////////9AAAAAAAAAAAAAv/////////4AAAAAAAAL/////////"
  "/zAAAAAAAAAAAAAv/////////4AAAAAAAAv/////////+QAAAAAAAAAAAAAv/////////4AAAAAAAG//////////4QAAAAAAAAAA"
  "AAAv/////////4AAAAAAAf//////////YAAAAAAAAAAAAAAv/////////4AAAAAAB///////////////////////////////////"
  "////////uP//////////////////////////////////////////uP//////////////////////////////////////////uP//"
  "////////////////////////////////////////uP//////////////////////////////////////////uP//////////////"
  "////////////////////////////uP//////////////////////////////////////////uP//////////////////////////"
  "////////////////uP//////////////////////////////////////////uP//////////////////////////////////////"
  "////uP//////////////////////////////////////////uP//////////////////////////////////////////uP//////"
  "////////////////////////////////////tHd3d3d3d3d3d3d3d3d3d3d3d3e//////////8d3d3d3UAAAAAAAAAAAAAAAAAAA"
  "AAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP////"
  "/////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAA"
  "AAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAA"
  "AAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  "AACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP////////"
  "/4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACP/////////4AAAAAAAAAA"
  "b////////////////////////////////wAAAAAAf////////////////////////////////wAAAAAAn///////////////////"
  "/////////////wAAAAAAr////////////////////////////////wAAAAAAz////////////////////////////////wAAAAAA"
  "3////////////////////////////////wAAAAAA/////////////////////////////////wAAAAAA////////////////////"
  "/////////////wAAAAAC/////////////////////////////////wAAAAAD/////////////////////////////////wAAAAAF"
  "/////////////////////////////////wAAAAAG/////////////////////////////////wAAAAAH////////////////////"
  "/////////////wAAAAAJ/////////+zMzMzMzMzMzMzMzMzMzMzMzAAAAAAK/////////3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAM"
  "/////////1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAN/////////0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/////////yAAAAAAAAAA"
  "AAAAAAAAAAAAAAAAAAAP/////////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv/////////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/"
  "/////////QAAAAAAAAAAAAAAAAAAAAAAAAAAAABf////////+wAAAAAAAAAAAAAAAAAAAAAAAAAAAABv////////+gAAAAAAAAAA"
  "AAAAAAAAAAAAAAAAAACP////////+AAAAAAAAAAAAAAAAAAAAAAAAAAAAACf////////9wAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/"
  "////////9QAAAAAAAAAAAAAAAAAAAAAAAAAAAADP////////8wAAAAAAAAAAAAAAAAAAAAAAAAAAAADv////////8gAAAAAAAkVm"
  "VCAAAAAAAAAAAAAAAAD/////////8AAAAAON///////YMAAAAAAAAAAAAAH/////////4AAAGe///////////qMAAAAAAAAAAAL/"
  "////////0AAH//////////////+yAAAAAAAAAAT/////////sATv////////////////kQAAAAAAAAX/////////kH//////////"
  "/////////jAAAAAAAAb/////////h/////////////////////UAAAAAAAj/////////3/////////////////////+AAAAAAAn/"
  "///////////////////////////////4AAAAAAv/////////////////////////////////UAAAAAz/////////////////////"
  "////////////8gAAAA7//////////////////////////////////RAAAA///////////////////////////////////4AAAB//"
  "////////////+mQxEke///////////////EAAC////////////+1AAAAAAABf/////////////gAAC3//////////9QAAAAAAAAA"
  "Aa////////////8QAAADWL7/////+gAAAAAAAAAAAAf///////////+AAAAAAAATab7/kAAAAAAAAAAAAABv///////////QAAAA"
  "AAAAAAATAAAAAAAAAAAAAAAK///////////xAAAAAAAAAAAAAAAAAAAAAAAAAAAA7//////////2AAAAAAAAAAAAAAAAAAAAAAAA"
  "AAAAb//////////6AAAAAAAAAAAAAAAAAAAAAAAAAAAADv/////////+AAAAAAAAAAAAAAAAAAAAAAAAAAAACf//////////AAAA"
  "AAAAAAAAAAAAAAAAAAAAAAAABf//////////IAAAAAAAAAAAAAAAAAAAAAAAAAAAAf//////////MAAAAAAAAAAAAAAAAAAAAAAA"
  "AAAAAP//////////UAAAAAAAAAAAAAAAAAAAAAAAAAAAAN//////////YAAAAAAAAAAAAAAAAAAAAAAAAAAAAM//////////cAAA"
  "AAAAAAAAAAAAAAAAAAAAAAAAAN//////////YAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////////UAAAAAAAAAAAAAAAAAAAAAAA"
  "AAAAAf//////////S8zMzMzMzMzEAAAAAAAAAAAAAAAABf//////////Hv/////////4AAAAAAAAAAAAAAAACf//////////DP//"
  "///////7AAAAAAAAAAAAAAAADv/////////8Cv//////////EAAAAAAAAAAAAAAAb//////////4B///////////gAAAAAAAAAAA"
  "AAAA7//////////0A///////////8wAAAAAAAAAAAAAK///////////gAN///////////RAAAAAAAAAAAAB///////////+AAH//"
  "/////////9IAAAAAAAAAAAj///////////8gAB////////////9gAAAAAAAAAr////////////kAAAv////////////8YAAAAAAC"
  "n/////////////EAAAL//////////////8hlRXnv/////////////3AAAAB//////////////////////////////////hAAAAAN"
  "////////////////////////////////9AAAAAAD////////////////////////////////YAAAAAAAX///////////////////"
  "///////////4AAAAAAAABf////////////////////////////+gAAAAAAAAAF////////////////////////////kAAAAAAAAA"
  "AATv/////////////////////////1AAAAAAAAAAAAAa////////////////////////0gAAAAAAAAAAAAAATv//////////////"
  "///////4AAAAAAAAAAAAAAAAAX7///////////////////gQAAAAAAAAAAAAAAAAAABL////////////////5xAAAAAAAAAAAAAA"
  "AAAAAAAAJ67///////////xzAAAAAAAAAAAAAAAAAAAAAAAAAAAmmr3v//7KhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACaL3v/+"
  "26lRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFnv//////////2VEAAAAAAAAAAAAAAAAAAAAAAAABfv//////////////+BAAAAAAAA"
  "AAAAAAAAAAAAAAGP//////////////////kgAAAAAAAAAAAAAAAAAAAF7////////////////////4AAAAAAAAAAAAAAAAAAGv//"
  "////////////////////wgAAAAAAAAAAAAAAAD3////////////////////////2AAAAAAAAAAAAAAA/////////////////////"
  "//////cAAAAAAAAAAAAAT///////////////////////////9wAAAAAAAAAAAD/////////////////////////////2AAAAAAAA"
  "AAAu//////////////////////////////UAAAAAAAAADf//////////////////////////////4QAAAAAAAAn/////////////"
  "//////////////////+gAAAAAAAE/////////////////////////////////1AAAAAAAe//////////////25d4rf//////////"
  "///+AAAAAAB/////////////+SAAAAABfv////////////UAAAAAH////////////4AAAAAAAAAY////////////wAAAAAn/////"
  "//////9AAAAAAAAAAAT///////////8wAAAB///////////+IAAAAAAAAAAABP//////////+QAAAH///////////zAAAAAAAAAA"
  "AAAI///////////gAAAO//////////9gAAAAAAAAAAAAAA7//////////xAABP//////////sAAAAAAAAAAAAAAAb//////////1"
  "AACv//////////MAAAAAAAAAAAAAAAH//////////4AAD//////////7AAAAAAAAAAAAAAAACKqqqqqqqqqnAAT//////////zAA"
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAn//////////QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3/////////+AAAAAAAAAAAAAAAAAAA"
  "AAAAAAAAAAAB//////////8wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF//////////4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI////"
  "//////oAAAAAAAAVi97//tuEAAAAAAAAAAAAAL//////////cAAAAAAWv/////////+mEAAAAAAAAAAO//////////UAAAABj///"
  "//////////+BAAAAAAAAAf//////////IAAAB/////////////////cAAAAAAAA///////////AAACz//////////////////TAA"
  "AAAABf/////////9AABP////////////////////QAAAAAB//////////8AAX/////////////////////9gAAAACP/////////8"
  "AE///////////////////////4AAAACv/////////7Av////////////////////////UAAAC//////////6DP//////////////"
  "//////////8gAADP/////////5b//////////////////////////RAADP/////////9///////////////////////////5AADf"
  "/////////////////9l1RXnv//////////////IADf////////////////kwAAAAADr/////////////kADv///////////////C"
  "AAAAAAAAA8////////////8gDf//////////////kAAAAAAAAAAAr///////////+QDf/////////////3AAAAAAAAAAAACf////"
  "///////wDP////////////+QAAAAAAAAAAAAAM///////////zDP////////////0AAAAAAAAAAAAAAB///////////4C///////"
  "//////QAAAAAAAAAAAAAAAf//////////8Cv///////////7AAAAAAAAAAAAAAAAH///////////Gf///////////0AAAAAAAAAA"
  "AAAAAACf//////////N////////////wAAAAAAAAAAAAAAAABP//////////Vf//////////+wAAAAAAAAAAAAAAAAAP////////"
  "//ZP//////////+AAAAAAAAAAAAAAAAAAN//////////cf//////////9gAAAAAAAAAAAAAAAAAM//////////kO//////////9A"
  "AAAAAAAAAAAAAAAAAK//////////oL//////////9AAAAAAAAAAAAAAAAAAK//////////kI//////////9gAAAAAAAAAAAAAAAA"
  "AM//////////kF//////////9wAAAAAAAAAAAAAAAAAN//////////gB//////////+gAAAAAAAAAAAAAAAAAf//////////YA3/"
  "/////////wAAAAAAAAAAAAAAAABf//////////MAj//////////0AAAAAAAAAAAAAAAACf//////////EAT//////////7AAAAAA"
  "AAAAAAAAAAH//////////9AADv//////////MAAAAAAAAAAAAAAAj//////////5AACP//////////wAAAAAAAAAAAAAAC//////"
  "/////1AAAv//////////+AAAAAAAAAAAAAAd///////////wAAAL///////////2AAAAAAAAAAAAC///////////+gAAAD//////"
  "//////cAAAAAAAAAABz///////////8wAAAAv///////////+iAAAAAAAABN////////////oAAAAAP/////////////ggAAAAAE"
  "v/////////////IAAAAACP/////////////9l1Rnr//////////////4AAAAAAAN/////////////////////////////////xAA"
  "AAAAAD////////////////////////////////9AAAAAAAAAb///////////////////////////////YAAAAAAAAACf////////"
  "/////////////////////4AAAAAAAAAAAK////////////////////////////+wAAAAAAAAAAAAn///////////////////////"
  "////kAAAAAAAAAAAAAB//////////////////////////2AAAAAAAAAAAAAAAD7///////////////////////0wAAAAAAAAAAAA"
  "AAAAGf/////////////////////5EAAAAAAAAAAAAAAAAAADv///////////////////gQAAAAAAAAAAAAAAAAAAAAA5////////"
  "////////+BAAAAAAAAAAAAAAAAAAAAAAAAFa////////////6kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAmm97///7KhSAAAAAAAAAA"
  "AAAADv////////////////////////////////////8O/////////////////////////////////////w7/////////////////"
  "////////////////////Dv////////////////////////////////////8O/////////////////////////////////////w7/"
  "////////////////////////////////////Dv////////////////////////////////////8O////////////////////////"
  "/////////////w7/////////////////////////////////////Dv////////////////////////////////////8O////////"
  "/////////////////////////////w7/////////////////////////////////////Dv//////////////////////////////"
  "//////8LzMzMzMzMzMzMzMzMzMzMzMzMzO///////////wAAAAAAAAAAAAAAAAAAAAAAAAAAn//////////9AAAAAAAAAAAAAAAA"
  "AAAAAAAAAAH///////////QAAAAAAAAAAAAAAAAAAAAAAAAACP//////////wAAAAAAAAAAAAAAAAAAAAAAAAAAf//////////9A"
  "AAAAAAAAAAAAAAAAAAAAAAAAAJ///////////AAAAAAAAAAAAAAAAAAAAAAAAAAB///////////0AAAAAAAAAAAAAAAAAAAAAAAA"
  "AAn//////////8AAAAAAAAAAAAAAAAAAAAAAAAAAL///////////QAAAAAAAAAAAAAAAAAAAAAAAAACf//////////wAAAAAAAAA"
  "AAAAAAAAAAAAAAAAAv//////////8wAAAAAAAAAAAAAAAAAAAAAAAAAJ//////////+wAAAAAAAAAAAAAAAAAAAAAAAAAC//////"
  "/////zAAAAAAAAAAAAAAAAAAAAAAAAAAr//////////7AAAAAAAAAAAAAAAAAAAAAAAAAAL///////////MAAAAAAAAAAAAAAAAA"
  "AAAAAAAACv//////////sAAAAAAAAAAAAAAAAAAAAAAAAAAv//////////8wAAAAAAAAAAAAAAAAAAAAAAAAAK//////////+wAA"
  "AAAAAAAAAAAAAAAAAAAAAAAD///////////zAAAAAAAAAAAAAAAAAAAAAAAAAAv//////////6AAAAAAAAAAAAAAAAAAAAAAAAAA"
  "P///////////IAAAAAAAAAAAAAAAAAAAAAAAAAC///////////oAAAAAAAAAAAAAAAAAAAAAAAAAA///////////8gAAAAAAAAAA"
  "AAAAAAAAAAAAAAAL//////////+gAAAAAAAAAAAAAAAAAAAAAAAAAD///////////yAAAAAAAAAAAAAAAAAAAAAAAAAAv///////"
  "///6AAAAAAAAAAAAAAAAAAAAAAAAAAT///////////IAAAAAAAAAAAAAAAAAAAAAAAAADP//////////kAAAAAAAAAAAAAAAAAAA"
  "AAAAAABP//////////8gAAAAAAAAAAAAAAAAAAAAAAAAAM//////////+QAAAAAAAAAAAAAAAAAAAAAAAAAE///////////yAAAA"
  "AAAAAAAAAAAAAAAAAAAAAAz//////////5AAAAAAAAAAAAAAAAAAAAAAAAAAT///////////EAAAAAAAAAAAAAAAAAAAAAAAAADP"
  "//////////kAAAAAAAAAAAAAAAAAAAAAAAAABf//////////8QAAAAAAAAAAAAAAAAAAAAAAAAAN//////////+AAAAAAAAAAAAA"
  "AAAAAAAAAAAAAF///////////xAAAAAAAAAAAAAAAAAAAAAAAAAA3//////////4AAAAAAAAAAAAAAAAAAAAAAAAAAX/////////"
  "//EAAAAAAAAAAAAAAAAAAAAAAAAADf//////////gAAAAAAAAAAAAAAAAAAAAAAAAABf//////////8QAAAAAAAAAAAAAAAAAAAA"
  "AAAAAN//////////+AAAAAAAAAAAAAAAAAAAAAAAAAAG///////////xAAAAAAAAAAAAAAAAAAAAAAAAAA7//////////3AAAAAA"
  "AAAAAAAAAAAAAAAAAAAAb///////////EAAAAAAAAAAAAAAAAAAAAAAAAADv//////////cAAAAAAAAAAAAAAAAAAAAAAAAABv//"
  "////////4QAAAAAAAAAAAAAAAAAAAAAAAAAO//////////9wAAAAAAAAAAAAAAAAAAAAAAAAAH///////////gAAAAAAAAAAAAAA"
  "AAAAAAAAAAAA7//////////3AAAAAAAAAAAAAAAAAAAAAAAAAAf//////////+AAAAAAAAAAAAAAAAAAAAAAAAAAHv//////////"
  "YAAAAAAAAAAAAAAAAAAAAAAAAAB///////////4AAAAAAAAAAAAAAAAAAAAAAAAAAf//////////9gAAAAAAAAAAAAAAAAAAAAAA"
  "AAAH///////////gAAAAAAAAAAAAAAAAAAAAAAAAAB///////////2AAAAAAAAAAAAAAAAAAAAAAAAAAj//////////+AAAAAAAA"
  "AAAAAAAAAAAAAAAAAAH///////////YAAAAAAAAAAAAAAAAAAAAAAAAACP//////////0AAAAAAAAAAAAAAAAAAAAAAAAAAf////"
  "//////9QAAAAAAAAAAAAAAAAAAAAAAAAAI///////////QAAAAAAAAAAAAAAAAAAAAAAAAAB///////////1AAAAAAAAAAAAAAAA"
  "AAAAAAAAAAj//////////9AAAAAAAAAAAAAAAAAAAAAAAAAAH///////////UAAAAAAAAAAAAAAAAAAAAAAAAACf//////////0A"
  "AAAAAAAAAAAAAAAAAAAAAAAAAv//////////9QAAAAAAAAAAAAAAAAAAAAAAAAAJ///////////AAAAAAAAAAAAAAAAAAAAAAAAA"
  "AC///////////0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZq97//suoUQAAAAAAAAAAAAAAAAAAAAAAAAAAACe+//////"
  "/////9phAAAAAAAAAAAAAAAAAAAAAAAAW/////////////////owAAAAAAAAAAAAAAAAAAAAGO///////////////////9YAAAAA"
  "AAAAAAAAAAAAAE7//////////////////////DAAAAAAAAAAAAAAAAGv////////////////////////gAAAAAAAAAAAAAAE////"
  "///////////////////////SAAAAAAAAAAAABP///////////////////////////+IAAAAAAAAAAAX/////////////////////"
  "////////4wAAAAAAAAAE///////////////////////////////yAAAAAAAAAe///////////////////////////////9AAAAAA"
  "AACv////////////////////////////////gAAAAAAAX////////////////c3///////////////8wAAAAAA7/////////////"
  "lRAAACa//////////////AAAAAAG////////////+BAAAAAAACr////////////yAAAAAM///////////+QAAAAAAAAABv//////"
  "/////4AAAAAv///////////zAAAAAAAAAAAF///////////+AAAABv//////////9QAAAAAAAAAAAAf///////////QAAACf////"
  "//////sAAAAAAAAAAAAADv//////////cAAADP//////////MAAAAAAAAAAAAABv//////////oAAADf/////////+AAAAAAAAAA"
  "AAAAAf//////////sAAADv/////////6AAAAAAAAAAAAAAAN//////////wAAADv/////////4AAAAAAAAAAAAAAAL//////////"
  "wAAADf/////////3AAAAAAAAAAAAAAAJ//////////sAAAC//////////3AAAAAAAAAAAAAAAK//////////kAAACf/////////5"
  "AAAAAAAAAAAAAAAL//////////cAAABf/////////8AAAAAAAAAAAAAAAO//////////MAAAAf//////////EAAAAAAAAAAAAAA/"
  "//////////AAAAAM//////////YAAAAAAAAAAAAACf/////////6AAAAAG//////////4QAAAAAAAAAAAAL//////////zAAAAAA"
  "7/////////+QAAAAAAAAAAAAz//////////AAAAAAAb//////////3AAAAAAAAAAAK//////////9AAAAAAADP//////////kAAA"
  "AAAAAAHP//////////kAAAAAAAAv///////////VAAAAAAAX7//////////+EAAAAAAAAE////////////6VMQE2r///////////"
  "/iAAAAAAAAAAT/////////////////////////////8gAAAAAAAAAAA+///////////////////////////9IAAAAAAAAAAAABv/"
  "////////////////////////+QAAAAAAAAAAAAAABM///////////////////////7MAAAAAAAAAAAAAAAAASe//////////////"
  "/////9gwAAAAAAAAAAAAAAAAAAABn/////////////////+AAAAAAAAAAAAAAAAAAAACjP////////////////////xxAAAAAAAA"
  "AAAAAAAAS/////////////////////////ogAAAAAAAAAAAAAr///////////////////////////6EAAAAAAAAAAAb/////////"
  "////////////////////5AAAAAAAAAAK///////////////////////////////3AAAAAAAACv//////////////////////////"
  "//////gAAAAAAAv//////////////IdUV53/////////////+AAAAAAH/////////////VEAAAAAAX7////////////1AAAAA///"
  "/////////+QAAAAAAAAAB/////////////IAAADv//////////+xAAAAAAAAAAAD3///////////wAAAf///////////sAAAAAAA"
  "AAAAAAHv//////////9QAA7//////////9EAAAAAAAAAAAAAAv///////////QAG///////////zAAAAAAAAAAAAAAAG////////"
  "///1AM//////////+gAAAAAAAAAAAAAAAA3//////////6Af//////////9AAAAAAAAAAAAAAAAAf///////////Bf//////////"
  "4AAAAAAAAAAAAAAAAAL///////////Sf//////////sAAAAAAAAAAAAAAAAADv//////////iv//////////kAAAAAAAAAAAAAAA"
  "AADP//////////nP//////////gAAAAAAAAAAAAAAAAAC///////////vf//////////kAAAAAAAAAAAAAAAAADP//////////zf"
  "//////////oAAAAAAAAAAAAAAAAADf//////////zP//////////0AAAAAAAAAAAAAAAAAH///////////u///////////8gAAAA"
  "AAAAAAAAAAAAX///////////qP//////////+AAAAAAAAAAAAAAAAAv///////////df///////////yAAAAAAAAAAAAAAAE////"
  "////////Qf///////////7AAAAAAAAAAAAAAAd////////////AL////////////kAAAAAAAAAAAAAC////////////6AF//////"
  "//////+QAAAAAAAAAAABv////////////0AA7////////////9MAAAAAAAAABe/////////////QAAX//////////////FEAAAAA"
  "AW3/////////////9AAACv///////////////Zh2eK3///////////////oAAAAe///////////////////////////////////+"
  "EAAAAE///////////////////////////////////zAAAAAAb/////////////////////////////////9QAAAAAABf////////"
  "////////////////////////MAAAAAAAAE///////////////////////////////iAAAAAAAAAAPf//////////////////////"
  "//////wgAAAAAAAAAAAH///////////////////////////lAAAAAAAAAAAAAAGv////////////////////////kQAAAAAAAAAA"
  "AAAAADr/////////////////////+SAAAAAAAAAAAAAAAAAAAWz/////////////////+1AAAAAAAAAAAAAAAAAAAAAAAnrv////"
  "////////2mIAAAAAAAAAAAAAAAAAAAAAAAAAABSKvN7//ty5dBAAAAAAAAAAAAAAAAAAAAAAAAAAAAADab3v//7sqEEAAAAAAAAA"
  "AAAAAAAAAAAAAAAAAAAWv////////////YMAAAAAAAAAAAAAAAAAAAAAAAACr////////////////nEAAAAAAAAAAAAAAAAAAAAA"
  "Ov//////////////////+BAAAAAAAAAAAAAAAAAAAr/////////////////////+YAAAAAAAAAAAAAAAAAX/////////////////"
  "//////+xAAAAAAAAAAAAAAAI/////////////////////////+MAAAAAAAAAAAAAHP//////////////////////////9AAAAAAA"
  "AAAAAB3////////////////////////////1AAAAAAAAAAAM//////////////////////////////QAAAAAAAAACv//////////"
  "////////////////////8gAAAAAAAAf////////////////////////////////hAAAAAAAD////////////////////////////"
  "/////5AAAAAAAM//////////////+5dnm///////////////QAAAAABf////////////+1AAAAABXP////////////4AAAAADf//"
  "/////////9QAAAAAAAAF7///////////9gAAAAb///////////+xAAAAAAAAAAG////////////gAAAA3///////////kAAAAAAA"
  "AAAAAK///////////3AAAD///////////7AAAAAAAAAAAAAAz//////////9AAAJ///////////hAAAAAAAAAAAAAALv////////"
  "//QAAN//////////9gAAAAAAAAAAAAAABv//////////oAAf//////////0AAAAAAAAAAAAAAAAO//////////8ABf//////////"
  "YAAAAAAAAAAAAAAAAH//////////9AB///////////IAAAAAAAAAAAAAAAAC//////////+QCf/////////9AAAAAAAAAAAAAAAA"
  "AA3//////////QC//////////6AAAAAAAAAAAAAAAAAAr//////////yDP/////////4AAAAAAAAAAAAAAAAAAn//////////1Df"
  "/////////3AAAAAAAAAAAAAAAAAAf//////////4Dv/////////3AAAAAAAAAAAAAAAAAAf//////////7DP/////////4AAAAAA"
  "AAAAAAAAAAAAn//////////+C//////////5AAAAAAAAAAAAAAAAAAr///////////Cv/////////8AAAAAAAAAAAAAAAAAA7///"
  "////////KP//////////EAAAAAAAAAAAAAAAAC////////////N///////////UAAAAAAAAAAAAAAAAH////////////VP//////"
  "////wAAAAAAAAAAAAAAAAO////////////cP//////////9AAAAAAAAAAAAAAAB/////////////gL///////////AAAAAAAAAAA"
  "AAAAL/////////////gH///////////4AAAAAAAAAAAAAAz/////////////kC////////////YAAAAAAAAAAAAK////////////"
  "//kA3///////////9wAAAAAAAAAAG///////////////oAX////////////6IAAAAAAAAE3///////////////oADf//////////"
  "//+CAAAAAAS/////////////////oABf//////////////2XVGev//////////////////kAAN//////////////////////////"
  "/e//////////kAAC//////////////////////////88//////////gAAAX/////////////////////////kN//////////cAAA"
  "Cf///////////////////////8EN//////////YAAAAL///////////////////////hAO//////////QAAAAAn/////////////"
  "////////4gAP//////////MAAAAAB////////////////////9IAAP//////////EAAAAAAF//////////////////+hAAA/////"
  "//////AAAAAAAAGf///////////////+QAAABf/////////9AAAAAAAAACr/////////////5gAAAACP/////////6AAAAAAAAAA"
  "Anz/////////+lAAAAAACv/////////3AAAAAAAAAAAAAVms3//tp0AAAAAAAADf/////////1AAAAAAAAAAAAAAAAAAAAAAAAAA"
  "AAAAL//////////xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAb//////////QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv/////////+Q"
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//////////9QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG//////////8QAM3d3d3d3d3dgAAA"
  "AAAAAAAAAAAAAO//////////sAAM//////////4AAAAAAAAAAAAAAABv//////////YAAJ//////////9AAAAAAAAAAAAAAAHv//"
  "////////EAAF///////////AAAAAAAAAAAAAAAr//////////6AAAC///////////1AAAAAAAAAAAAAG///////////zAAAA3///"
  "////////IAAAAAAAAAAABP///////////AAAAAb///////////4wAAAAAAAAAAf///////////9QAAAAH////////////3AAAAAA"
  "AAAb////////////wAAAAACf////////////1hAAAAADr/////////////MAAAAAAv//////////////yXZ5vv/////////////6"
  "AAAAAAAI/////////////////////////////////hAAAAAAAA3///////////////////////////////9QAAAAAAAAP///////"
  "////////////////////////kAAAAAAAAACP/////////////////////////////8AAAAAAAAAAAK//////////////////////"
  "///////RAAAAAAAAAAAAr///////////////////////////0gAAAAAAAAAAAACv/////////////////////////9EAAAAAAAAA"
  "AAAAAI////////////////////////+xAAAAAAAAAAAAAAAATv//////////////////////cAAAAAAAAAAAAAAAAAAa////////"
  "/////////////TAAAAAAAAAAAAAAAAAAAAS//////////////////+YAAAAAAAAAAAAAAAAAAAAAACr///////////////1gAAAA"
  "AAAAAAAAAAAAAAAAAAAAAWrv//////////2DAAAAAAAAAAAAAAAAAAAAAAAAAAAAACaaze//7ahRAAAAAAAAAAAAAAAAAA=="
  ;
static const Glyph FN_HUGE_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 27, 0},
  {0x0030, 66, 84, 5, -83, 76, 0},
  {0x0031, 36, 81, 5, -81, 48, 5544},
  {0x0032, 59, 83, 6, -83, 71, 8460},
  {0x0033, 63, 84, 5, -83, 72, 13357},
  {0x0034, 66, 81, 5, -81, 76, 18649},
  {0x0035, 60, 82, 7, -81, 72, 23995},
  {0x0036, 63, 84, 5, -83, 73, 28915},
  {0x0037, 58, 81, 4, -81, 65, 34207},
  {0x0038, 63, 84, 5, -83, 73, 38905},
  {0x0039, 63, 84, 5, -83, 73, 44197},
};
AAFont FN_HUGE_F = { nullptr, FN_HUGE_F_GLYPHS, 11, 109, 28, FN_HUGE_F_B64, 24745 };

// FN_BIG_F: 68px, 11 глифов, 9224 байт
static const char FN_BIG_F_B64[] PROGMEM =
  "AAAAAAAAAEm87/3KgwAAAAAAAAAAAAAAAAOe////////6CAAAAAAAAAAAAABr///////////+AAAAAAAAAAAAG//////////////"
  "5AAAAAAAAAAI////////////////UAAAAAAAAH/////////////////1AAAAAAAH//////////////////9AAAAAAD//////////"
  "/////////+EAAAAAz////////Zd57///////+QAAAAb///////1AAAAF7///////MAAAD///////sQAAAAAt///////AAABf////"
  "//0AAAAAAAH///////IAAL//////8wAAAAAAAF//////+AAC//////+gAAAAAAAADP/////+AAf//////zAAAAAAAAAF//////9A"
  "C//////9AAAAAAAAAAD//////4AO//////gAAAAAAAAAAL//////sC//////9AAAAAAAAAAAf//////wX//////xAAAAAAAAAAA/"
  "//////KP/////+AAAAAAAAAAAB//////9a//////wAAAAAAAAAAAD//////3r/////+gAAAAAAAAAAAN//////i//////5AAAAAA"
  "AAAAAAz/////+c//////gAAAAAAAAAAAC//////53/////+AAAAAAAAAAAAK//////rv/////3AAAAAAAAAAAAr/////+9//////"
  "gAAAAAAAAAAACv/////7z/////+AAAAAAAAAAAAL//////rP/////5AAAAAAAAAAAAv/////+b//////oAAAAAAAAAAADP/////4"
  "r//////AAAAAAAAAAAAO//////eP/////+AAAAAAAAAAAB//////9V//////8AAAAAAAAAAAP//////yL//////0AAAAAAAAAABv"
  "//////AP//////gAAAAAAAAAAL//////wAz//////AAAAAAAAAAA//////+QCP//////IAAAAAAAAAX//////1AC//////+QAAAA"
  "AAAADP//////AADP//////IAAAAAAABf//////kAAG///////QAAAAAAAe//////8wAAH///////sQAAAAAt///////QAAAH////"
  "///9QAAABe///////0AAAADf///////9l3rv///////6AAAAAD////////////////////EAAAAACP//////////////////UAAA"
  "AAAAj/////////////////YAAAAAAAAJ////////////////YAAAAAAAAAB//////////////+UAAAAAAAAAAAKv///////////5"
  "EAAAAAAAAAAAAASv////////6TAAAAAAAAAAAAAAAABJvO/+yoMAAAAAAAAAAAAAAAGv//////4AAAAATv///////gAAAAn/////"
  "///+AAAD3/////////4AAH///////////gAs///////////+Bf////////////6v/////////////v/////////////+//////+V"
  "//////7/////5AT//////v////sQBP/////+////YAAE//////7//8IAAAT//////v/3AAAABP/////+/TAAAAAE//////6AAAAA"
  "AAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAA"
  "AAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+"
  "AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE////"
  "//4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT/"
  "/////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAT//////gAAAAAABP/////+AAAAAAAE//////4AAAAAAAFIve/+3JUQAAAA"
  "AAAAAAAAADv/////////xQAAAAAAAAAAA8////////////5gAAAAAAAAB///////////////sQAAAAAAC////////////////+IA"
  "AAAACf/////////////////iAAAAB///////////////////0AAAAv///////////////////3AAAK///////9dCNo7///////8g"
  "AC///////4AAAAAI///////3AAf//////0AAAAAABP//////wADP/////5AAAAAAAAj//////xAf//////EAAAAAAAAO//////MC"
  "//////oAAAAAAAAAr/////9QT/////9wAAAAAAAAB//////3BN3d3d3VAAAAAAAAAH//////YAAAAAAAAAAAAAAAAAr/////9QAA"
  "AAAAAAAAAAAAAADP/////yAAAAAAAAAAAAAAAAAv/////+AAAAAAAAAAAAAAAAAK//////gAAAAAAAAAAAAAAAAD//////8gAAAA"
  "AAAAAAAAAAAB7/////+gAAAAAAAAAAAAAAAAv//////yAAAAAAAAAAAAAAAAn//////2AAAAAAAAAAAAAAAAn//////7AAAAAAAA"
  "AAAAAAAAn//////9EAAAAAAAAAAAAAAAn///////IAAAAAAAAAAAAAAAr///////MAAAAAAAAAAAAAAAv///////QAAAAAAAAAAA"
  "AAABv///////UAAAAAAAAAAAAAABz///////UAAAAAAAAAAAAAAB3///////UAAAAAAAAAAAAAAC7///////QAAAAAAAAAAAAAAC"
  "7///////MAAAAAAAAAAAAAAD////////MAAAAAAAAAAAAAAE////////MAAAAAAAAAAAAAAF////////MAAAAAAAAAAAAAAF////"
  "///+MAAAAAAAAAAAAAAG///////+IAAAAAAAAAAAAAAH///////+IAAAAAAAAAAAAAAI///////+IAAAAAAAAAAAAAAJ////////"
  "hVVVVVVVVVVVVVEK//////////////////////8g7//////////////////////yDv//////////////////////IO//////////"
  "////////////8g7//////////////////////yDv//////////////////////IO//////////////////////8g7///////////"
  "///////////yAAAAAAAAFIze/+3IQQAAAAAAAAAAAAAAW/////////+0AAAAAAAAAAAAXv///////////9MAAAAAAAAAG///////"
  "////////gAAAAAAAAu////////////////sAAAAAAD7/////////////////sAAAAAHv//////////////////gAAAAK////////"
  "////////////IAAAT////////IUzaO///////7AAAK///////VAAAAAZ///////yAAH//////9EAAAAAAH//////9wAG//////4g"
  "AAAAAAAM//////sACP/////3AAAAAAAABP/////9AAr/////8gAAAAAAAAD//////wAGiIiIiIAAAAAAAAAA7/////8AAAAAAAAA"
  "AAAAAAAAAP/////9AAAAAAAAAAAAAAAAAAL/////+wAAAAAAAAAAAAAAAAAI//////cAAAAAAAAAAAAAAAAAP//////xAAAAAAAA"
  "AAAAAAAABO//////gAAAAAAAAAAAAAAAAr///////QAAAAAAAAAABYiIrO///////8IAAAAAAAAAAAr///////////kAAAAAAAAA"
  "AAAK//////////1QAAAAAAAAAAAACv///////+hAAAAAAAAAAAAAAAr////////8lQAAAAAAAAAAAAAK///////////4EAAAAAAA"
  "AAAACv////////////UAAAAAAAAAAAr/////////////gAAAAAAAAAAAAAASR8////////YAAAAAAAAAAAAAAAADz///////MAAA"
  "AAAAAAAAAAAAAAr//////6AAAAAAAAAAAAAAAAAA3//////yAAAAAAAAAAAAAAAAAF//////9gAAAAAAAAAAAAAAAAAP//////kA"
  "AAAAAAAAAAAAAAAADf/////7WIiIiIhAAAAAAAAAAA7//////K//////oAAAAAAAAAAf//////p///////EAAAAAAAAAb//////4"
  "X//////6AAAAAAAAAe//////9h///////5AAAAAAAC3///////EK///////9YAAAABj///////+wA/////////65eKz/////////"
  "QACf////////////////////+QAADf///////////////////+EAAALf//////////////////4gAAAAHf/////////////////R"
  "AAAAAAGf///////////////4EAAAAAAAA8/////////////7MAAAAAAAAAADn//////////oIAAAAAAAAAAAAAA2rN7/7cliAAAA"
  "AAAAAAAAAAAAAAAAAF////////wAAAAAAAAAAAAAAAAB7////////AAAAAAAAAAAAAAAAAn////////8AAAAAAAAAAAAAAAAT///"
  "//////wAAAAAAAAAAAAAAADf/////////AAAAAAAAAAAAAAACP/////////8AAAAAAAAAAAAAAA///////////wAAAAAAAAAAAAA"
  "AN///////////AAAAAAAAAAAAAAH///////////8AAAAAAAAAAAAAC////////////wAAAAAAAAAAAAAz////////////AAAAAAA"
  "AAAAAAb/////+t/////8AAAAAAAAAAAAH//////hz/////wAAAAAAAAAAACv/////1DP/////AAAAAAAAAAABf/////7AM/////8"
  "AAAAAAAAAAAe//////EAz/////wAAAAAAAAAAJ//////YADP/////AAAAAAAAAAE//////sAAM/////8AAAAAAAAAA3/////8gAA"
  "z/////wAAAAAAAAAj/////9wAADP/////AAAAAAAAAP//////AAAAM/////8AAAAAAAADf/////zAAAAz/////wAAAAAAAB/////"
  "/4AAAADP/////AAAAAAAAv/////9AAAAAM/////8AAAAAAAM//////MAAAAAz/////wAAAAAAG//////kAAAAADP/////AAAAAAB"
  "//////4QAAAAAM/////8AAAAAAr/////9AAAAAAAz/////wAAAAAX/////+QAAAAAADP/////AAAAAHv/////hAAAAAAAM/////8"
  "AAAACf/////1AAAAAAAAz/////wAAABP/////7AAAAAAAADP/////AAAAK//////////////////////////r///////////////"
  "//////////+v/////////////////////////6//////////////////////////r/////////////////////////+v////////"
  "/////////////////6//////////////////////////r/////////////////////////8jMzMzMzMzMzMzMzP//////TMzMwAA"
  "AAAAAAAAAAAAAP/////8AAAAAAAAAAAAAAAAAAAA//////wAAAAAAAAAAAAAAAAAAAD//////AAAAAAAAAAAAAAAAAAAAP/////8"
  "AAAAAAAAAAAAAAAAAAAA//////wAAAAAAAAAAAAAAAAAAAD//////AAAAAAAAAAAAAAAAAAAAP/////8AAAAAAAAAAAAAAAAAAAA"
  "//////wAAAAABv//////////////////+gAAAH///////////////////6AAAAj///////////////////oAAACv////////////"
  "//////+gAAAL///////////////////6AAAA3///////////////////oAAADv//////////////////+gAAAP//////////////"
  "/////6AAAB//////dmZmZmZmZmZmZmQAAAP/////8AAAAAAAAAAAAAAAAABP/////gAAAAAAAAAAAAAAAAAG/////8AAAAAAAAAA"
  "AAAAAAAAf/////oAAAAAAAAAAAAAAAAACf////+QAAAAAAAAAAAAAAAAAK/////3AAAAAAAAAAAAAAAAAAz/////UAAAAAAAAAAA"
  "AAAAAADf////9AAAAlaHZBAAAAAAAAAP/////yACjf/////IIAAAAAAA//////AY/////////4EAAAAAL/////8c///////////j"
  "AAAAA//////t////////////9QAAAF////////////////////QAAAb////////////////////yAACP////////////////////"
  "wAAJ////////pSETfP///////1AAjv/////5EAAAAAX///////0AAAFHrf/0AAAAAAAC7//////0AAAAAAAiAAAAAAAAA///////"
  "gAAAAAAAAAAAAAAAAAn//////QAAAAAAAAAAAAAAAAAv//////EAAAAAAAAAAAAAAAAA3/////8gAAAAAAAAAAAAAAAACv/////z"
  "AAAAAAAAAAAAAAAAAJ//////UAAAAAAAAAAAAAAAAAn/////9AAAAAAAAAAAAAAAAACv/////zaZmZmZkgAAAAAAAAAN//////Gf"
  "/////1AAAAAAAAAC//////8H//////oAAAAAAAAAj/////+wX//////0AAAAAAAAL//////2AP//////8gAAAAAAHf//////EAn/"
  "/////+UAAAAATv//////kAA////////9dCE2z///////8QAAj///////////////////+AAAAd//////////////////+wAAAALv"
  "/////////////////RAAAAAC7////////////////BAAAAAAAa//////////////+AAAAAAAAABe////////////xAAAAAAAAAAA"
  "BL/////////7QAAAAAAAAAAAAAAVjN7/7bhAAAAAAAAAAAAAAAAAACes3/7bgwAAAAAAAAAAAAAAABfP////////kgAAAAAAAAAA"
  "AABf///////////6EAAAAAAAAAACv/////////////5AAAAAAAAAAu///////////////3AAAAAAAALv////////////////YAAA"
  "AAAC7/////////////////9QAAAAAM///////////////////hAAAABv/////////d/////////6AAAAHv//////+CAAAo//////"
  "//IAAAn//////8IAAAAAHP//////gAAB///////AAAAAAAAd//////4AAG//////4QAAAAAAAD//////8gAM//////YAAAAAAAAA"
  "z/////9QAv/////+AAAAAAAAAANmZmZmYwCP/////3AAAAAAAAAAAAAAAAAAC//////yAAAAAAAAAAAAAAAAAADv/////gAAAAAC"
  "RlQgAAAAAAAAL/////+gAAAWz/////pQAAAAAAX/////+AABn////////+UAAAAAj/////9QA9///////////BAAAAn/////8wX/"
  "///////////+IAAAr/////8z//////////////4gAAv/////8t///////////////AAAz//////P///////////////4AA3/////"
  "////+1IROO////////EA7////////9MAAAABj///////kA7////////BAAAAAABv//////8A3///////4QAAAAAAAI//////9A3/"
  "//////UAAAAAAAAA7/////+Qv//////9AAAAAAAAAAf//////Ar//////4AAAAAAAAAAL//////gj//////0AAAAAAAAAAD/////"
  "/wb//////yAAAAAAAAAADf/////xP//////yAAAAAAAAAADv/////wD//////0AAAAAAAAAAD//////gC//////3AAAAAAAAAAP/"
  "/////QB//////9AAAAAAAAAAj/////+wAv//////QAAAAAAAAB7/////9gAK//////0QAAAAAAAJ//////8QAD//////+xAAAAAA"
  "B///////wAAAz//////8MAAAABn///////QAAAT///////+1ISSf///////8AAAACP///////////////////zAAAAAM////////"
  "//////////9gAAAAAB7/////////////////gAAAAAAAHP///////////////4AAAAAAAAAK//////////////9QAAAAAAAAAAXf"
  "///////////5IAAAAAAAAAAAAFz////////+kgAAAAAAAAAAAAAAAVnN7/7LcwAAAAAAAAj//////////////////////xj/////"
  "/////////////////xj//////////////////////xj//////////////////////xj//////////////////////xj/////////"
  "/////////////xj//////////////////////xj//////////////////////xNmZmZmZmZmZmZmZmz//////wAAAAAAAAAAAAAA"
  "AB//////+QAAAAAAAAAAAAAAAH//////8QAAAAAAAAAAAAAAAf//////gAAAAAAAAAAAAAAACP//////EAAAAAAAAAAAAAAAH///"
  "///4AAAAAAAAAAAAAAAAj//////xAAAAAAAAAAAAAAAB//////+AAAAAAAAAAAAAAAAI//////8QAAAAAAAAAAAAAAAf//////cA"
  "AAAAAAAAAAAAAACf//////EAAAAAAAAAAAAAAAL//////3AAAAAAAAAAAAAAAAn//////hAAAAAAAAAAAAAAAC//////9wAAAAAA"
  "AAAAAAAAAK//////4AAAAAAAAAAAAAAAAv//////YAAAAAAAAAAAAAAACv/////+AAAAAAAAAAAAAAAAL//////2AAAAAAAAAAAA"
  "AAAAr//////gAAAAAAAAAAAAAAAD//////9gAAAAAAAAAAAAAAAL//////0AAAAAAAAAAAAAAAA///////UAAAAAAAAAAAAAAAC/"
  "/////9AAAAAAAAAAAAAAAAP//////1AAAAAAAAAAAAAAAAv//////QAAAAAAAAAAAAAAAD//////9QAAAAAAAAAAAAAAAM//////"
  "0AAAAAAAAAAAAAAABP//////QAAAAAAAAAAAAAAADP/////8AAAAAAAAAAAAAAAAT//////0AAAAAAAAAAAAAAAAz//////AAAAA"
  "AAAAAAAAAAAE//////9AAAAAAAAAAAAAAAAN//////wAAAAAAAAAAAAAAABf//////MAAAAAAAAAAAAAAADf/////7AAAAAAAAAA"
  "AAAAAAX//////zAAAAAAAAAAAAAAAA3/////+wAAAAAAAAAAAAAAAF//////8wAAAAAAAAAAAAAAAN//////sAAAAAAAAAAAAAAA"
  "Bv//////MAAAAAAAAAAAAAAADv/////6AAAAAAAAAAAAAAAAAAAAAAFIve/+3JUgAAAAAAAAAAAAAABb/////////8YQAAAAAAAA"
  "AAAF7////////////3AAAAAAAAAAG///////////////0wAAAAAAAC7////////////////0AAAAAAAu//////////////////QA"
  "AAAADf//////////////////8gAAAAj/////////7f////////+wAAAB////////owAAKP///////0AAAG///////jAAAAACz///"
  "///6AAAM//////8wAAAAAAHv//////AAAO//////cAAAAAAABP//////IAAP//////EAAAAAAAAO//////QAAf/////+AAAAAAAA"
  "AL//////UAAP/////9AAAAAAAAAK//////QAAO//////AAAAAAAAAM//////EAAK//////MAAAAAAAAP/////9AAAE//////sAAA"
  "AAAACP/////4AAAA3/////9gAAAAAAP//////xAAAAP//////4AAAAAG//////9gAAAABv//////50IUbP//////oAAAAAAF////"
  "/////////////4AAAAAAAAPv//////////////9gAAAAAAAAAH3////////////oEAAAAAAAAAAAOv//////////xRAAAAAAAAAA"
  "GP//////////////kgAAAAAAAF/////////////////4AAAAAACf//////////////////wQAAAAr////////ZiJz////////BAA"
  "AH///////8IAAAAa///////6AAAv//////9QAAAAAAPv//////UACv//////QAAAAAAAAv//////4AH//////5AAAAAAAAAG////"
  "//9Qb//////yAAAAAAAAAA7/////+gr//////QAAAAAAAAAAr//////gz/////+wAAAAAAAAAAj//////x7/////+wAAAAAAAAAA"
  "f//////y3//////QAAAAAAAAAAn//////yv//////xAAAAAAAAAA3//////wn//////4AAAAAAAAAE///////gX///////MAAAAA"
  "AAAd//////+QDv//////5AAAAAAALf//////8wCP///////7IAAAAZ////////wAAN/////////amKz/////////IAAD////////"
  "/////////////2AAAAT///////////////////9wAAAAA///////////////////YAAAAAACv////////////////TAAAAAAAABN"
  "/////////////+YAAAAAAAAAAAOf//////////tAAAAAAAAAAAAAAANqze//3KdAAAAAAAAAAAAAAAAAJqzf/9ylEAAAAAAAAAAA"
  "AAAAGO/////////WAAAAAAAAAAAAAY////////////1QAAAAAAAAAAPv/////////////7EAAAAAAAAG////////////////0gAA"
  "AAAABf/////////////////yAAAAAAT//////////////////9EAAAAB////////////////////oAAAAJ////////tjI2v/////"
  "//9QAAAv///////DAAAAAs///////gAACf//////oAAAAAAAr//////1AADv/////8AAAAAAAADP/////8AAP//////zAAAAAAAA"
  "Av//////MAj/////+wAAAAAAAAAJ//////kAr/////9gAAAAAAAAAE//////0Az/////8gAAAAAAAAAB//////8g3/////8AAAAA"
  "AAAAAA//////9Q7/////8AAAAAAAAAAA//////+A3/////8QAAAAAAAAAB//////+wv/////9QAAAAAAAAAE///////Ar/////+Q"
  "AAAAAAAAAJ///////gb//////xAAAAAAAAAv///////wL//////6AAAAAAAAC////////wDf//////gAAAAAAAn////////wB///"
  "////+hAAAAAr/////////xAO////////lBAkn//////////wAG////////////////3//////wAAr///////////////L//////g"
  "AAHf/////////////1D//////QAAAc////////////+AD//////AAAABr///////////UAL/////+wAAAABN////////+yAAT///"
  "//+AAAAAAAWv/////oIAAAf/////9AAAAAAAAANGdTEAAAAAr/////8QAAAAAAAAAAAAAAAAAA//////4AAAAAAAAAAAAAAAAAAE"
  "//////sAJ3d3d3dQAAAAAAAAAL//////UAP//////xAAAAAAAAA///////AAD//////3AAAAAAAADP/////5AADP//////MAAAAA"
  "AAn//////zAABv//////4gAAAAAa///////AAAAP///////5IAABfv//////8gAAAH/////////9zv////////gAAAAA3///////"
  "///////////+EAAAAAP//////////////////zAAAAAABP////////////////8wAAAAAAAF////////////////QAAAAAAAAAPf"
  "/////////////TAAAAAAAAAAAI////////////cAAAAAAAAAAAAAGO////////2CAAAAAAAAAAAAAAAAN73v/sqDAAAAAAAAAAA="
  ;
static const Glyph FN_BIG_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 16, 0},
  {0x0030, 40, 51, 3, -50, 46, 0},
  {0x0031, 22, 49, 3, -49, 29, 2040},
  {0x0032, 37, 50, 3, -50, 43, 3118},
  {0x0033, 38, 51, 3, -50, 44, 4968},
  {0x0034, 40, 49, 3, -49, 46, 6906},
  {0x0035, 37, 50, 4, -49, 43, 8866},
  {0x0036, 39, 51, 3, -50, 44, 10716},
  {0x0037, 36, 49, 2, -49, 40, 12705},
  {0x0038, 39, 51, 3, -50, 44, 14469},
  {0x0039, 39, 51, 3, -50, 44, 16458},
};
AAFont FN_BIG_F = { nullptr, FN_BIG_F_GLYPHS, 11, 66, 17, FN_BIG_F_B64, 9224 };

// FN_MID_F: 44px, 11 глифов, 3840 байт
static const char FN_MID_F_B64[] PROGMEM =
  "AAAAAEnO/9xyAAAAAAAAAF7//////7IAAAAAABv/////////cAAAAAHP//////////cAAAAM////////////YAAAb/////p4z///"
  "//EAAf////sQAATv///6AAf////AAAAAP////xAN////IAAAAAj///9wL///+wAAAAAB////0G////YAAAAAAM////Cf///yAAAA"
  "AAB////zz///8AAAAAAAX///9t///9AAAAAAAD////jv///AAAAAAAAv///5////sAAAAAAAH///+v///7AAAAAAAB////rv///A"
  "AAAAAAAv///53///0AAAAAAAP///+M////AAAAAAAF////ef///yAAAAAAB////0b///9gAAAAAAv///8T////sAAAAAAf///9AN"
  "////IAAAAAj///+AB////8AAAAA/////IAH////7EAAD7///+wAAf/////p4z/////IAAAz///////////9wAAAB3//////////4"
  "AAAAABz/////////gAAAAAAAbv//////wwAAAAAAAABJzv/ccgAAAAAAAAAa////8QAAA+/////xAACP//////EALf//////8Qb/"
  "///////xD/////////EP///2f///8Q///CB////xD/+AAH////EP4wAAf///8QoQAAB////xAAAAAH////EAAAAAf///8QAAAAB/"
  "///xAAAAAH////EAAAAAf///8QAAAAB////xAAAAAH////EAAAAAf///8QAAAAB////xAAAAAH////EAAAAAf///8QAAAAB////x"
  "AAAAAH////EAAAAAf///8QAAAAB////xAAAAAH////EAAAAAf///8QAAAAB////xAAAAAH////EAAAAAf///8QAAAAB////xAAAA"
  "Fq3//rcwAAAAAAAZ///////8QAAAAATv////////+AAAAD///////////5AAAf////////////YACf////p1av////8QD////0AA"
  "AC3///9gX///9gAAAAP///+gj///8AAAAADP///An///wAAAAACf///QIiIiIAAAAACv//+wAAAAAAAAAADf//+QAAAAAAAAAAT/"
  "//9QAAAAAAAAAB3///0AAAAAAAAAAL////QAAAAAAAAACv///5AAAAAAAAAAr////AAAAAAAAAAL////0QAAAAAAAAHP///+IAAA"
  "AAAAAB3////iAAAAAAAAAu////0QAAAAAAAAPv///8EAAAAAAAAD/////BAAAAAAAABP////sQAAAAAAAAX////7AAAAAAAAAH//"
  "//+wAAAAAAAACP////9mZmZmZmZiX//////////////1X//////////////1X//////////////1X//////////////1X///////"
  "///////1AAAAA4zv/tphAAAAAAAAXf//////+BAAAAABv/////////4wAAAB3///////////MAAAv////////////QAAX////+hl"
  "fP////cADP///3AAAAb////QAf///5AAAAAJ////ED////MAAAAAT///8wAREREAAAAABP///xAAAAAAAAAAAI///+AAAAAAAAAA"
  "AD////gAAAAAAAAAAp////0AAAAAAAXu7/////wgAAAAAABv/////9cAAAAAAAAG/////6MAAAAAAAAAb//////+gAAAAAAABv//"
  "/////9MAAAAAAAAAJI/////hAAAAAAAAAAAc////kAAAAAAAAAAAH////wAAAAAAAAAAAK////JEREQwAAAAAAj///9c////AAAA"
  "AADP///1r///9gAAAABP////Jf////cQAABf////0A7/////qIrf////9gBP/////////////AAAf////////////RAAAF//////"
  "////+hAAAAAZ////////xAAAAAAAAVne//2nIAAAAAAAAAAAAAz////8AAAAAAAAAABv/////AAAAAAAAAAC//////wAAAAAAAAA"
  "C//////8AAAAAAAAAF///////AAAAAAAAAHv//////wAAAAAAAAJ///////8AAAAAAAAT///+v///AAAAAAAAN///5b///wAAAAA"
  "AAj///4W///8AAAAAAAv///0Bv///AAAAAAAz///oAb///wAAAAABv///xAG///8AAAAAB////YABv///AAAAACv///AAAb///wA"
  "AAAF////IAAG///8AAAAHv//+AAABv///AAAAJ///9AAAAb///wAAAP///8wAAAG///8AAAN///5AAAABv///AAAf///8QAAAAb/"
  "//wAAN////////////////zf///////////////83////////////////N////////////////zf///////////////8RVVVVVVV"
  "VVv///5VVAAAAAAAAAAI///8AAAAAAAAAAAACP///AAAAAAAAAAAAAj///wAAAAAAAAAAAAI///8AAAAAAAAAAAACP///AAAAB//"
  "//////////9QAAL////////////1AABP////////////UAAF////////////9QAAf////////////1AACP//+nd3d3d3d3IAAK//"
  "/1AAAAAAAAAAAAv///MAAAAAAAAAAADf//8gAAAAAAAAAAAO///wAAAAAAAAAAAA///+AAAAAAAAAAAAH///0AWt/+thAAAAA///"
  "+yz/////9wAAAE///8////////sQAAX////////////7AAB/////////////9wAI////5yACb/////EAAUecoQAAAB3///9wAAAA"
  "AAAAAAAv///7AAAAAAAAAAAAr///8AAAAAAAAAAAB////wAAAAAAAAAAAF////ETMzMwAAAAAAj///8C////UAAAAAC////QD///"
  "+wAAAABP///5AL////kAAABO////MAT////+dUav////sAAK////////////8gAAHP//////////9AAAABr/////////4wAAAAAF"
  "3///////gQAAAAAAADjO/+2lEAAAAAAAAAAozv/sgwAAAAAAAAPP//////swAAAAAAj/////////cAAAAAj//////////5AAAAf/"
  "//////////9gAAL/////687/////EADP///8MAAF7///+AA////7AAAAAu///+AJ////EAAAAAf///8g////gAAAAAABEREQT///"
  "8gAAAAAAAAAAB////gABfO/9lAAAAK///7AI//////wwAA3///kc////////UADv//+K/////////0AP///9///+//////8Q////"
  "//5RACr////4D/////sQAAAG////8O////8QAAAACv///z3///+AAAAAAD////e////1AAAAAAD///+I////MAAAAAAO///4T///"
  "9gAAAAAB////cf///6AAAAAAX///9Qr///9AAAAAHv///xA////+QAAALP///6AAv////6dGn/////IAAe////////////gAAAP/"
  "//////////oAAAAC7/////////gAAAAAAY///////7MAAAAAAAAWrf/+tzAAAABv//////////////b//////////////2//////"
  "////////9v//////////////b//////////////zd3d3d3d3d3////8AAAAAAAAABf///4AAAAAAAAAA3///8QAAAAAAAABf///3"
  "AAAAAAAAAA3///8QAAAAAAAABv///3AAAAAAAAAA3///8QAAAAAAAABv///3AAAAAAAAAA7///4QAAAAAAAABv///3AAAAAAAAAA"
  "7///4QAAAAAAAABv///3AAAAAAAAAA7///4AAAAAAAAABv///3AAAAAAAAAA7///4AAAAAAAAABv///3AAAAAAAAAA7///4AAAAA"
  "AAAAB////2AAAAAAAAAA7///4AAAAAAAAAB////2AAAAAAAAAA7///4AAAAAAAAAB////2AAAAAAAAAB7///4AAAAAAAAAB////2"
  "AAAAAAAAAB7///4AAAAAAAAAB////2AAAAAAAAAB////4AAAAAAAAAAAAAOM7//aYQAAAAAAAF3///////ogAAAAAb//////////"
  "YAAAAc///////////3AAAJ////////////8wAD/////VITj////8AAn///+gAAAC////8gC////xAAAABv///1AN///7AAAAAB//"
  "//cAr///sAAAAAH///9AB////gAAAABf///xAB////gAAAAe///6AABv///6IABd////EAAAf/////7////+IAAAAEv////////5"
  "EAAAAAAp///////1AAAAAALP/////////4AAAAX////////////BAAT////7UhN+////0ADv///1AAAAG////4B////3AAAAAB3/"
  "//8s////EAAAAACP///3////4AAAAAAE////n////wAAAAAAb///+d////UAAAAAC////3n////yAAAAB/////Mv////9yAAO///"
  "//wAj//////+//////8gAK////////////9QAAB///////////0wAAAAKv///////+cAAAAAAAFpzv/+uEAAAAAAAAAFne/+yDAA"
  "AAAAAAB+///////EAAAAAALP////////+AAAAAL///////////sAAAHv///////////4AACf////2Fae////9AAv////gAAAGf//"
  "/8AH////gAAAAAr///9Az///4AAAAAAf///6Dv//+gAAAAAAz///4P///3AAAAAACf///y////kAAAAAAL////Xf///AAAAAAA//"
  "//9q////UAAAAAj////3X////jAAAAb/////gO////+UElv/////+QX//////////f///4AJ/////////y////cACP///////kD/"
  "//9gAATf////+xAv///zAAAASLzKcgAF////AAAAAAAAAAAAn///wCMzMzAAAAAADv//+Aj///8gAAAAB////yBf///7AAAAA///"
  "/8AA7///+yAABv////QAB//////bz/////oAAAz///////////4gAAAu//////////8wAAAALP////////0wAAAAAAfv//////gA"
  "AAAAAAAAWd//22EAAAAA"
  ;
static const Glyph FN_MID_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 10, 0},
  {0x0030, 26, 32, 2, -32, 30, 0},
  {0x0031, 16, 32, 1, -32, 19, 832},
  {0x0032, 24, 32, 2, -32, 28, 1344},
  {0x0033, 25, 32, 2, -32, 28, 2112},
  {0x0034, 26, 32, 2, -32, 30, 2912},
  {0x0035, 25, 32, 2, -32, 28, 3744},
  {0x0036, 25, 32, 2, -32, 29, 4544},
  {0x0037, 23, 32, 1, -32, 26, 5344},
  {0x0038, 25, 32, 2, -32, 29, 6080},
  {0x0039, 25, 32, 2, -32, 29, 6880},
};
AAFont FN_MID_F = { nullptr, FN_MID_F_GLYPHS, 11, 43, 11, FN_MID_F_B64, 3840 };

// FN_TITLE_F: 22px, 207 глифов, 19123 байт
static const char FN_TITLE_F_B64[] PROGMEM =
  "D/9w//YP/2D/9g//UP/1Dv9Q7/QO/0Df9ArdMAAABJcB//cv/5COwt/0L//P8x/+v/If/b/xD/yv8Q/8n/AO+2ugCbcAAL/AAf9g"
  "AADfkAP/MAAA/3AG/xAAA/9ACf4ACP///////wv///////wGff53j/p1AA36AD/0AAAP9wBv8QA3j/p3v/dwj///////8L//////"
  "/8AAr9AB/3AAAN+gA/9AAAD/cAb/EAAC/1AI/wAAAAAAXgAAAAAAAF8AAAAAAYz/61AAAE7////7AAHv/////5AH//RfCf/wCv/Q"
  "XwGqogj/9G8AAAAD////QAAAAG////+iAAACnv///0AAAAB/v//xAAAAXwP/9Q//QF8A7/cM/9NfB//0Bf//7///0QCP/////jAA"
  "Ap3/63AAAAAAXwAAAAAAAF4AAAAAbf1gAAAA32AABv//9QAACfsAAA35Gv0AAE/xAAAP9AX/AAHvUAAAD/QF/wAK+gAAAA36K/wA"
  "X+EAAAAG///1Ae9AAAAAAG38UAv5AAAAAAAAAABv0QAAAAAAAAAC/zADv+oQAAAAC/gAL///wAAAAH/QAI/ST/MAAAL/MACvoA/1"
  "AAAM9wAAj9JP8wAAj8AAAC///8AAA/8gAAADz+oQAACN/ZEAAAAAz///4QAAAG//vv9wAAAK/0Af+wAAAK/zAv+gAAAG/6Pv9AAA"
  "AB7///cAAAAAf//3AAAAAH///yAKpwBv/7/+Ev+QD/9gj/1/9wH/8QCv//8wD/9gAM//sACv/8rf//gAAd/////v9gAAbO/ZIv/0"
  "3/TP87/yv/Gv8Z/wa6AACv9gA//xAK/5AA//QAX/8ACf+wAM/4AA//YAH/9AAv/zAD//IAL/8wAf/0AA7/cAC/+gAH/+AAH/8wAL"
  "/5AAP/8QAL/2L/4QAL/3AAX/4AAf/0AAv/kAB//QAE//EAH/8wAP/1AA7/YADf9wAO/2AA//UAL/8wBf/wAK/7AA//UAT/8AC/+A"
  "Av/xAAAA7yAABDDfEWAO+M9e8xn///+zAC7/9QAY////oh74z1/zBDDfEWAAAO8gAAAAAAAAAAAM2wAAAAAO/QAAAAAO/QAAAAAO"
  "/QAACZmf/5mZH///////H///////AAAO/QAAAAAO/QAAAAAO/QAAAAAO/QAAAAADQwAACapA//If/QT/gG/zCP4Av6AI////yP//"
  "/8WZmZlwSnAf/2L/9wj8EAAAv/IAAA/+AAAE/5AAAI/1AAAM/xAAAf/AAABf+AAACf9AAADf8AAAL/sAAAb/cAAAr/IAAA/+AAAD"
  "/6AAAH/2AAAL/xAAAP/QAABP+QAACP9AAAAjMAAAAABL7+owAACP////YACP//3//1Af/7AB3/0H//EAA//0v/oAAA3/jf+AAACv"
  "+v/2AAAJ/8//YAAAn/zf+AAACv+r/6AAAN/4j/8QAD//Uf/7AB3/0Aj//8//9QAI////9gAABb/+owAAAE7/8AGf//8A3///8A/7"
  "X/8A9wT/8AMAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAAT/8AAp3+xwAAX////+IC//+8//wI"
  "/9EAX/87/3AADf9hEQAADv9QAAAAX/8QAAAD//cAAAA//6AAAAT/+wAAAF//oAAABv/6AAAAf/+gAAAH//+7u7t7//////+r////"
  "//+gAXzvyRAAA/////9AAe//u///IG/+IAHv9gWIUAAK/5AAAAAB7/YAAAV57/sAAAC///YAAAAL///5EAAAABb/+gAAAAAH//Ga"
  "pAAAX/8r/9IAHf/wT//8z//4AG/////5AAApz/2jAAAAAAn//gAAAAP//+AAAADf//4AAACP/v/gAAAv/1/+AAAM/3P/4AAG/9A/"
  "/gAC//MD/+AAv/gAP/4AX/0AA//gDv/aqr//qf///////+////////4AAAAE/+AAAAAAT/4AAAAABP/gAJ//////IAr/////8gDP"
  "/Lu7uyAN/yAAAAAA//AAAAAAD/8CViAAAv/p///CAD//////4QKt9yF//5AAAAAAf/0AAAAAA//wWZYAAF/+Bv/yAB3/oB7/+7//"
  "8gA+////9QAAF8/8kQAAAErv2jAAAI////9wAG///v//UA3/sQLf/AX/4AADmZCv+AFVMAAM/2f//9MA7/v////zD//8MV7/0P/+"
  "EABP/x3/oAAA//Sf/AAAH/8k//UACv/gC//8rv/1ABv////4AAAFvv2jAAP///////P///////K7u7u+//AAAAAN/6AAAABf/yAA"
  "AADf+gAAAAX/8gAAAA3/kAAAAF//IAAAAN/5AAAABf/yAAAADf+QAAAAb/8gAAAA3/kAAAAG//EAAAAO/5AAAAABfO/ZIAAD////"
  "/2AA7/+p7/8wT/8wAN/5Bv/QAAn/oC//IADf9wB//off/AAATv//9wAAX/////kAX/+CFf/5Df+gAAX/8f/3AAA//0z/0AAI//Fv"
  "/+iM//sAf/////sAACnP/aQAAAGM/scAAATv///9MAL//7z//hCv/iAD//gN/2AAB//g//QAAF//Lf+AAAr/84//cSj//0Hv///8"
  "//ICv//7L/8QACVSBP/geqYAAK/6CP/0AH//IC//////oABP////wQAAGd/8YAAASnAf/2L/9wj8EAAAAAAAAAAAAABKcB//Yv/3"
  "CPwQOpEN/5D/+gb9MAAAAAAAAAAAAAAAAAmqQP/yH/0E/4Bv8wj+AL+gAAAAAAAAIAAAAABtsAAAAY//sAADr///oAS///+jAt//"
  "/nEAA//8QAAAA///owAAAY7//9YQAABt///5MAAAS///sAAAACn/sAAAAAAXrv/////97//////au7u7u7kAAAAAAAAAAAAAAO//"
  "////3v/////9q7u7u7uTAAAAAAAN1QAAAAAN/+cQAAAL///5IAAAS///+0AAABjv//0QAAAEz/8gAABK//8gAX3//+cDr///xQAN"
  "//+jAAAN/5IAAAALcQAAAAAAAXz/2BAAHf////IAr//d//0A//UAb/8hmZAAL/9AAAAAj/8QAAAJ//kAAAC//5AAAAf/9QAAAAv/"
  "UAAAAA3/IAAAAAERAAAAAASWAAAAAC//UAAAAD//gAAAAAn7IAAAAAAWvf/tlAAAAAAAj//////9QAAAAc//+5ib//9wAADP/lAA"
  "AACP/1AAj/0QAAAAAD//EB//MAbP6l/wf/kG/6AJ/////wDv4K/yA//pjv/wCv8t/wCv8gAe/wB/9P/QDfkAAI/wBf9f/AD/cAAH"
  "/wBf9P/QDfkAAI/wBv8u/gC/4QAO/wCf8L/yBP/WbP/1X/kG/6AK///87//9EB//UAfP2RO/6iAAf/9gAAAAAAAAAACv/9dCETWR"
  "AAAAAI///////2AAAAAAOv/////mAAAAAAAANndkIAAAAAAAA///cAAAAAAI///QAAAAAA7///MAAAAAP/6v+AAAAACf+W/+AAAA"
  "AO/1H/8wAAAE//EM/5AAAAn/wAj/4AAAD/9wAv/0AABP/6mZ//oAAK///////wAA////////UAX/8wAADf+wCv/gAAAI//EP/5AA"
  "AAP/9l//UAAAAO/7n////sgQCf/////+IJ//u77/+wn/sAAL//Cf+wAAX/8J/7AACP/An/1ESP/zCf////+yAJ//////5An/sAAq"
  "//Kf+wAADv+J/7AAAM/6n/sAAD//if/7u9//85//////9wn////9owAAAGz/21AAAALP////0gAC///////hAL//ggGP/6Bf/2AA"
  "AH//C//QAAABmZLv+QAAAAAAD/9gAAAAAAD/9gAAAAAADv+AAAAAAAC//QAAABmZJf/1AAAH//EM//cQF//6AC///////RAAPf//"
  "//wgAAAHz/2lAACf///+tgAAn//////TAJ//3f///xCf+wABj/+gn/sAAAb/9J/7AAAA3/mf+wAAAJ/8n/sAAAB//Z/7AAAAf/2f"
  "+wAAAJ/8n/sAAADf+Z/7AAAF//Sf+wABf/+gn//d7///EJ//////sgCf///+tQAAn//////yn//////yn/+7u7uyn/sAAAAAn/sA"
  "AAAAn/sAAAAAn/+7u7tgn/////+Qn/////+Qn/sAAAAAn/sAAAAAn/sAAAAAn/sAAAAAn/+7u7uyn//////zn//////zn//////5"
  "//////+f/7u7u7n/sAAAAJ/7AAAACf+wAAAAn/sAAAAJ//u7u7Of/////0n/////9J/7AAAACf+wAAAAn/sAAAAJ/7AAAACf+wAA"
  "AAn/sAAAAAAAbP/bUAAAAs/////SAAL//////+EAv/+CAX//oF//YAAAf/8a/9AAAAFEQe/5AAAAAAAP/2AAKIiIg//2AAP///9+"
  "/4AAP///97/9AAAADv9V//UAAAP/8gz/9yAW7/sAL///////EAA9/////TAAAAfP/bYAAJ/7AAAAX/+f+wAAAF//n/sAAABf/5/7"
  "AAAAX/+f+wAAAF//n/sAAABf/5//u7u73/+f////////n////////5/7AAAAX/+f+wAAAF//n/sAAABf/5/7AAAAX/+f+wAAAF//"
  "n/sAAABf/5/7AAAAX/+f+5/7n/uf+5/7n/uf+5/7n/uf+5/7n/uf+5/7n/uf+wAAAADf9gAAAADf9gAAAADf9gAAAADf9gAAAADf"
  "9gAAAADf9gAAAADf9gAAAADf9gAAAADf9gAAAADf9k7uAADf9j//EAD/9R//cAT/8gv//L//wAHv////IAAYz/2RAJ/7AAAF//sJ"
  "/7AABP/8AJ/7AAL//hAJ/7AB3/8gAJ/7AM//QAAJ/7Cf/2AAAJ/7X/+AAAAJ/87/+AAAAJ/////zAAAJ//+O/9AAAJ//kE//gAAJ"
  "/9AAn/9AAJ/7AAHv/hAJ/7AABP/5AJ/7AAAK//QJ/7AAAB7/4Z/7AAAACf+wAAAAn/sAAAAJ/7AAAACf+wAAAAn/sAAAAJ/7AAAA"
  "Cf+wAAAAn/sAAAAJ/7AAAACf+wAAAAn/sAAAAJ/7AAAACf/7u7u3n/////+p//////qf//oAAAA///8Z///xAAAI///xn///YAAA"
  "7///Gf/v+wAAT/3/8Z/6//EACf+f/xn/q/9wAP/1//Gf+3/8AE/+P/8Z/7L/8gr/lP/xn/sN/2Dv9E//Gf+wf/ov/gT/8Z/7Av/m"
  "/5BP/xn/sAz/v/ME//Gf+wBv//4AT/8Z/7AB//+ABP/xn/sAC//yAE//Gf+wAF/9AAT/8Z//YAAAH/9Z//8gAAH/9Z//+gAAH/9Z"
  "///1AAH/9Z/9/+EAH/9Z/7v/gAH/9Z/8P/8wH/9Z/8Cv/AH/9Z/9Av/2D/9Z/9AH/+H/9Z/9AA3/f/9Z/9AAP/7v9Z/9AACf//9Z"
  "/9AAAe//9Z/9AAAF//9Z/9AAAAv/9QAAbP/rYAAAAs/////CAAL///////EAv/+CAo//oF//YAAAf/9L/9AAAADv+e/5AAAACv/f"
  "/2AAAAB//v/2AAAAB//u/4AAAACv/b/9AAAADv+l//UAAAb/9Az/9yAo//sAL///////IAAs/////CAAAAfP/8YAAJ////62AAn/"
  "/////BCf/7vf//kJ/7AAG//xn/sAAC//Sf+wAAD/9p/7AABP/zn/sAFe//Cf//////UJ//////YAn/6qqGEACf+wAAAAAJ/7AAAA"
  "AAn/sAAAAACf+wAAAAAJ/7AAAAAAAABs/+tgAAACz////8IAAv//////8QC//4ICj/+gX/9gAAB//0v/0AAAAO/57/kAAAAK/9//"
  "YAAAAH/+//YAAAAH/+7/gAAAAK/9v/0AO7YN/5X/9QCv+f/0DP/3Id///AAv//////8gACz/////sAAAB8//zP9wAAAAAAAd/0AA"
  "AAAAABIhn////sYACf/////9EJ//u8//+wn/sAAa//Kf+wAAH/9Z/7AAAf/2n/sAAI//Of/qq+//wJ//////4gn/////0QCf+wB/"
  "/yAJ/7AB7/oAn/sAB//zCf+wAB7/sJ/7AAB//zn/sAAA7/wAAHzv20AAAD7////7AAHv/+3//5AG//QACf/wCv/AAAC7sgj/9AAA"
  "AAAD///YQAAAAG////+iAAACjv///0AAAAAmr//xAREAAAP/9Q//QAAA7/cM/9IACP/0BP//7f//0AB//////iAAApzv62AAP///"
  "/////j////////4ru73/+7u6AAAF//AAAAAABf/wAAAAAAX/8AAAAAAF//AAAAAABf/wAAAAAAX/8AAAAAAF//AAAAAABf/wAAAA"
  "AAX/8AAAAAAF//AAAAAABf/wAAAAAAX/8AAAAAAF//AAAJ/7AAAAr/qf+wAAAK/6n/sAAACv+p/7AAAAr/qf+wAAAK/6n/sAAACv"
  "+p/7AAAAr/qf+wAAAK/6n/sAAACv+p/8AAAAr/qP/QAAAM/5X/8wAAL/9i//5AA9//MH//////+AAI/////5AAACnP/KMABf/1AA"
  "AADv+w//oAAAA//2Cv/xAAAJ//EE//UAAA7/sADv+gAAP/9gAJ//EACP/xAAP/9QAN/7AAAO/6AC//UAAAj/8Af/8QAAA//0C/+g"
  "AAAA3/gP/1AAAAB//U//AAAAAC//n/oAAAAADP//9AAAAAAG///wAAAAAAH//5AAAG//MAAH//QAAH//Mf/3AAC//4AACv/gDf+w"
  "AA///AAA7/oAn/8AA///8AAv/2AE//IAf/3/MAb/8QAf/2AL/3/3AK/9AADP+gD/8v+wDf+QAAj/4D/8D/8B//QAAD//Fv+Av/NP"
  "/xAAAP/0n/QH/2f/wAAAC/98/wA/+a/3AAAAb/r/wAD/zf8wAAAC/+/4AAv///AAAAAO//8wAG//+gAAAACf//AAAv//YAAAAAX/"
  "+wAADv/yAAAK//MAAA3/4QHv/QAAj/9AAE//gAP/+QAACv/yDP/QAAAB7/pf/zAAAABP/+/4AAAAAAr//9AAAAAAAe//QAAAAAAD"
  "//+QAAAAAB7///QAAAAAr/7P/hAAAAX/9j//oAAAH//ACP/1AAC//yAA3/4QBv/2AAA//7Av/7AAAAn/9j//oAAACf/0Cf/zAAAv"
  "/7AB//sAAJ//IABv/0AC//gAAA3/0Ar/4QAABP/1L/9QAAAAr/yf/AAAAAAf///zAAAAAAf//5AAAAAAAN//EAAAAAAAn/sAAAAA"
  "AACf+wAAAAAAAJ/7AAAAAAAAn/sAAAAAAACf+wAAAAAAAJ/7AAAA3///////bf//////9pu7u7vv/xAAAAA//1AAAAAe/5AAAAAL"
  "/9EAAAAH//MAAAAD//cAAAAA3/wAAAAAn/8gAAAAT/9QAAAAHv+QAAAAC//AAAAABv/8u7u7tc///////2z///////Yf//8x///z"
  "H/+HEf/xAB//EAH/8QAf/xAB//EAH/8QAf/xAB//EAH/8QAf/xAB//EAH/8QAf/xAB//EAH/93Ef//8x///zn/QAAAX/gAAAH/wA"
  "AADP8QAACP9QAABP+QAAAP/QAAAL/yAAAH/2AAAC/6AAAA7/AAAAr/MAAAX/cAAAH/wAAADf8AAACf9AAABP+AAAAf/QAAAM/xAA"
  "ACMx7//17//1d+/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1AM/1Z+/17//17//1AAP/4AAAC//2AAA/"
  "+v4AAK+x/1AC/0Cf0Ar9AC/1HuYACuv//////3//////94iIiIiIQe/gAF/2AAr9AAFVEABs7+owABz////1AJ//qN//EFi0AB//"
  "QAAAEm//YAW+////YI///J7/Yf/2AA3/ZP/gAC//Yf/6V+//YK///9z/YAff+hr/av+QAAAACv+QAAAACv+QAAAACv+QAAAACv+S"
  "rvtACv+u///3Cv//u///Kv/1AC//mv/AAAn/yv+QAAb/+v+QAAb/6v/AAAn/yv/1AC//mv//u///Kv+v///3Cv+Cv/tAAAAZz+xQ"
  "AABf////sAAv/+q//4AK/9EAf/4A7/YAAGMQH/8wAAAAAf/zAAAAAA7/YAAHQQCv/RAH/+AC//6r//gABf////sAAAKc/sUAAAAA"
  "AADP+AAAAAAM/4AAAAAAz/gAAAAADP+AAFz+kc/4AJ///8z/gE//6s//+Av/4QB//4D/9wAA7/gf/0AADP+B//QAAM/4D/9wAA7/"
  "gM/+EAf/+AT//6z//4AJ///8v/gABs/pG/+AACnf6zAAAF////+AAB//yK//QAr/oABv/QDv8wAA//Af//////8x///////0D/8g"
  "AAAAAL/5AAKXQAP//Inv/AAG/////SAAApz/1xAAAASJcwAK//9gBf//8gCf/SEAC/+QAN////8d////8Wff/HcAC/+AAAC/+AAA"
  "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"
  "/2AACf9wAAn/kAAG//QQAK//0AAH/9ABz//AB//iAAn/gAAJ/3AACf9gAAz/YAe//zAO//kADvxwAAAJ7qEAOIIK///iCf8h//3/"
  "/f/wT/YE7//4AoggAa/oAAAq79gQAD////0ADP/9//gA//EE/8AP/zADMwCf/5IAAAH///owA//v//+Av/EW3/9b/2AAj/pv/8UB"
  "/7Cf//7v8wA6///xAAACn/+QAAAAP/4E/6AB//Af/7z//ABf////MAA67+ogAAAAKd/9kwAAAAAH/////4AAAAHP/+ut//0QAAv/"
  "1AEgPf/AAF/9BN/+cL/2AM/yX///+B/9Af+w/7Ip/xn/Iv9z/xAARBb/Qv9z/wAAMxb/Qf+w/7Iq/xn/IM/yX///9x/9AF/8BN//"
  "cL/3AAv/0wEgPP/QAAHf/9qt//0gAAAI/////5EAAAAAOd/+owAAAAA//1P/9QAu/3Lv9wAd/6Hf+gAL/8C//AAJ/+GP/hAAv/wK"
  "/9EAAd/6HP+wAALv+B7/gAAD//U//1AABf/zT/8wAAIiECIhAAWu/JIAABr/2+/2AAr6EABN9AX6D//kL+CvEPkuwH890A+B7AT2"
  "7AD//0A/i/APlfUF9Y9Q+A3QzyHvIAAAf5AF/3MUv9EABO///6EAAAFYpzAAABruogDf//4X/2X/m/oAj8v5AI/H/1Xvke///hAa"
  "77IAAABEMAAAAADv0AAAAADv0AAAiIj/+Ihw///////w///////wAADv0AAAAADv0AAAAADNsAAAAAAAAAAA///////w///////w"
  "mZmZmZmQW92kAH////UO+xPvwAAADfsAAC3/MABv/TABv/cAAM////8M////8AKd7GAD////gK/iLP4AAALfwAAf/4EAAXn/sBEQ"
  "CP9N/jLP9G////0ATP/YEAAGvv//+wC/////+wf///qP+w7///MO+x////MO+x////MO+w7///MO+wj///MO+wDP//MO+wAH3/MO"
  "+wAAABAO+wAAAAAO+wAAAAAO+wAAAAAO+wAAAAAO+wAAAAAO+wSnAf/2L/9wn8EM/6DP+wAAAe/4Hv+AAAA//1L/9gAABf/zT/9A"
  "AAB//if/8gAAX/81//QAA//1P/9gAC7/ce/4AAHf+gz/oAAL/8Cv/AAAAiIQIiEAAAPf8gAAAC/zAC//8gAAAM9wAC0/8gAAB/wA"
  "ABAf8gAAP/IAAAAf8gAA32AAAAAf8gAI+wAAAAAf8gA/8gAAAAAf8gHfUAP/0AAd0Qn6AAz/0AAAAE/hAF/v0AAAAe9QAO9v0AAA"
  "CvkAB/ov0AAAX+EAH/Iv0AAB/0AAb////gAL+AAATMzf+wBv0AAAAAA/0APf8gAAAC/zAAL//yAAAAz3AAAtP/IAAAf8AAABAf8g"
  "AAP/IAAAAB/yAADfYAAAAAH/IACPsAAAAAAf8gA/8gAAAAAB/yAd9QGu/EAAHuIJ+gC/7f8gAAAE/hAKsg32AAAB71AAAAHvQAAA"
  "r5AAAAC/oAAAX+EAAAHPsAAAH/QAAAHPwAAAC/gAAADP/cxwBv0AAAAO///5AZ78QAAAAH/QAAv/7/IAAAP/IAAIgg31AAAN9wAA"
  "AAi/wQAAj8AAAAAN/5EAA/8gAAAAAC36AB32AAAAFVEM/ACfsAAAAA7/7/YE/hAJ/4ACv/1gHvUAL/+AAAAAAK+gAL/vgAAAAAX+"
  "EAT9j4AAAAAf9AAN9I+AAAAAv5AAb7CPgAAABv0AAM////gAAC/zAACczO/mAADPgAAAAACfgAClAAAGoACv9QAG/6AL//UG//oA"
  "C//5//oAAAv///oAAAAN//wAAAAG///1AAAG//7/9QAG//oL//UA7/oAC//QAuoAAAviAAEAAAABAAAAalAAAABP/yAAAAX/8wAA"
  "AAv6AAAAAAAAAAmZmZmZmf//////7//////+AAAAAAAAAAv6AAAABf/zAAAAT/8gAAAAalAAAAjnAb5AAB//Bf+wAAv5Ae9gAAAQ"
  "AAEAAAAAAAAACf//////Kf//////Kf/7u7u7Kf+wAAAACf+wAAAACf+wAAAACf/7u7u2Cf/////5Cf/////5Cf+wAAAACf+wAAAA"
  "Cf+wAAAACf+wAAAACf/7u7u7Kf//////Of//////MAAAP//3AAAAAACP//0AAAAAAO///zAAAAAD/+r/gAAAAAn/lv/gAAAADv9R"
  "//MAAABP/xDP+QAAAJ/8AI/+AAAA//cAL/9AAAT/+pmf/6AACv//////8AAP///////1AF//MAAA3/sAr/4AAACP/xD/+QAAAD//"
  "Zf/1AAAADv+5//////8An//////wCf/7u7u6AJ/7AAAAAAn/sAAAAACf+wAAAAAJ/9ZmUxAAn/////9wCf//////gJ/7AAKv/xn/"
  "sAAA//Sf+wAADv9Z/7AABf/yn/6Zm//8Cf/////+IJ/////YEAn////sgQCf/////+IJ//u77/+wn/sAAL//Cf+wAAX/8J/7AACP"
  "/An/1ESP/zCf////+yAJ//////5An/sAAq//Kf+wAADv+J/7AAAM/6n/sAAD//if/7u9//85//////9wn////9owCf//////n///"
  "///5//u7u7uf+wAAAAn/sAAAAJ/7AAAACf+wAAAAn/sAAAAJ/7AAAACf+wAAAAn/sAAAAJ/7AAAACf+wAAAAn/sAAAAJ/7AAAACf"
  "+wAAAAAAAP//////9AAAAA///////0AAAAL//Lu7//QAAAA//xAAD/9AAAAE//AAAP/0AAAAX/4AAA//QAAAB//QAAD/9AAAAJ/7"
  "AAAP/0AAAAv/kAAA//QAAADf9wAAD/9AAAAf/zAAAP/0AAAG/+AAAA//QAAB7/gAAAD/9AAr7//Lu7u//9sz///////////0P///"
  "////////Q//wAAAAAAD/9D//AAAAAAAP/0P/8AAAAAAA//QXdwAAAAAAB3cp//////8p//////8p//u7u7sp/7AAAAAJ/7AAAAAJ"
  "/7AAAAAJ//u7u7YJ//////kJ//////kJ/7AAAAAJ/7AAAAAJ/7AAAAAJ/7AAAAAJ//u7u7sp//////85//////8x7/8gAA7/YAAJ"
  "//YF//kAAO/2AAL//QAL//IADv9gAJ//MAAv/6AA7/YAL/+QAACP/yAO/2AK//EAAADf+wDv9gL/9gAAAAT/8w7/YK/8AAAAAAr/"
  "//////8wAAAAAN////////cAAAAAj/+7//29//IAAAAv/4AO/2Af/6AAAAv/4QDv9gB//0AABf/2AA7/YADv/QAB7/0AAO/2AAb/"
  "9wCf/0AADv9gAA3/8j//sAAA7/YAAE//oAF878kQAAP/////QAHv/7v//yBv/iAB7/YFiFAACv+QAAAAAe/2AAAFee/7AAAAv//2"
  "AAAAC///+RAAAAAW//oAAAAAB//xmqQAAF//K//SAB3/8E///M//+ABv////+QAAKc/9owAJ/9AAAAv/9Z/9AAAF//9Z/9AAAe//"
  "9Z/9AACf//9Z/9AAP/7v9Z/9AAz/f/9Z/9AH/+H/9Z/9Av/2D/9Z/8Cv/AH/9Z/8P/8wH/9Z/7v/kAH/9Z/9/+EAH/9Z///1AAH/"
  "9Z//+wAAH/9Z//8gAAH/9Z//cAAAH/9QAIwwA+gAAAAF/DK/kAAAAAv//+EAAAAABruBAAAAAAAAAAAAAJ/9AAAAv/9Z/9AAAF//"
  "9Z/9AAAe//9Z/9AACf//9Z/9AAP/7v9Z/9AAz/f/9Z/9AH/+H/9Z/9Av/2D/9Z/8Cv/AH/9Z/8P/8wH/9Z/7v/kAH/9Z/9/+EAH/"
  "9Z///1AAH/9Z//+wAAH/9Z//8gAAH/9Z//cAAAH/9Z/7AAAE//oJ/7AAAe/9EJ/7AAC//zAJ/7AAb/9gAJ/7AD//oAAJ/7AN/+EA"
  "AJ//vP/zAAAJ////+AAAAJ/////hAAAJ/7Av/6AAAJ/7AH//YAAJ/7AAv/8gAJ/7AAL//AAJ/7AABv/4AJ/7AAAL//MJ/7AAAB7/"
  "4QAA3//////xAADv//////EAAP/8u73/8QAB//IABP/xAAL/8QAE//EABP/wAAT/8QAF/+AABP/xAAb/0AAE//EACP+wAAT/8QAJ"
  "/6AABP/xAAv/gAAE//EAD/9QAAT/8QBf/yAABP/xLP/8AAAE//E///MAAAT/8T/aEAAABP/xn//6AAAAP///Gf//8QAACP//8Z//"
  "/2AAAO///xn/7/sAAE/9//Gf+v/xAAn/n/8Z/6v/cAD/9f/xn/t//ABP/j//Gf+y//IK/5T/8Z/7Df9g7/RP/xn/sH/6L/4E//Gf"
  "+wL/5v+QT/8Z/7AM/7/zBP/xn/sAb//+AE//Gf+wAf//gAT/8Z/7AAv/8gBP/xn/sABf/QAE//Gf+wAAAF//n/sAAABf/5/7AAAA"
  "X/+f+wAAAF//n/sAAABf/5/7AAAAX/+f/7u7u9//n////////5////////+f+wAAAF//n/sAAABf/5/7AAAAX/+f+wAAAF//n/sA"
  "AABf/5/7AAAAX/+f+wAAAF//AABs/+tgAAACz////8IAAv//////8QC//4ICj/+gX/9gAAB//0v/0AAAAO/57/kAAAAK/9//YAAA"
  "AH/+//YAAAAH/+7/gAAAAK/9v/0AAAAO/6X/9QAABv/0DP/3ICj/+wAv//////8gACz////8IAAAB8//xgAAn////////5//////"
  "//+f/7u7u9//n/sAAABf/5/7AAAAX/+f+wAAAF//n/sAAABf/5/7AAAAX/+f+wAAAF//n/sAAABf/5/7AAAAX/+f+wAAAF//n/sA"
  "AABf/5/7AAAAX/+f+wAAAF//n/sAAABf/5////62AAn//////BCf/7vf//kJ/7AAG//xn/sAAC//Sf+wAAD/9p/7AABP/zn/sAFe"
  "//Cf//////UJ//////YAn/6qqGEACf+wAAAAAJ/7AAAAAAn/sAAAAACf+wAAAAAJ/7AAAAAAAABs/9tQAAACz////9IAAv//////"
  "4QC//4IBj/+gX/9gAAB//wv/0AAAAZmS7/kAAAAAAA//YAAAAAAA//YAAAAAAA7/gAAAAAAAv/0AAAAZmSX/9QAAB//xDP/3EBf/"
  "+gAv//////0QAD3////8IAAAB8/9pQAAP////////j////////4ru73/+7u6AAAF//AAAAAABf/wAAAAAAX/8AAAAAAF//AAAAAA"
  "Bf/wAAAAAAX/8AAAAAAF//AAAAAABf/wAAAAAAX/8AAAAAAF//AAAAAABf/wAAAAAAX/8AAAAAAF//AAAE//kAAAP/+Az/8QAAn/"
  "8gT/9wAB//oADP/gAG//MABP/1AM/8AAAM/7Av/1AAAF//GP/gAAAA3/bf9wAAAAX/z/8QAAAADf//kAAAAABf//IAAAAAAO/7AA"
  "AAAABP/0AAAAAu//+wAAAAAv//4gAAAAAv/qIAAAAAAAAH/9AAAAAAAAB//QAAAAAAJ7///JQAAABv//////oQAI////////0AL/"
  "+yf/0H//cJ/9AH/9AH//DP9wB//QAf/y//QAf/0AD/9f/1AH/9AA//TP9wB//QAf/yn/4Af/0Aj/8C//w3/9GP/2AH////////wA"
  "AF//////+QAAABau//tzAAAAAAB//QAAAAAAAAbuwAAAAAr/8wAADf/hAe/9AACP/0AAT/+AA//5AAAK//IM/9AAAAHv+l//MAAA"
  "AE//7/gAAAAACv//0AAAAAAB7/9AAAAAAAP//5AAAAAAHv//9AAAAACv/s/+EAAABf/2P/+gAAAf/8AI//UAAL//IADf/hAG//YA"
  "AD//sC//sAAACf/2n/sAAADP+QCf+wAAAM/5AJ/7AAAAz/kAn/sAAADP+QCf+wAAAM/5AJ/7AAAAz/kAn/sAAADP+QCf+wAAAM/5"
  "AJ/7AAAAz/kAn/sAAADP+QCf+wAAAM/5AJ/7AAAAz/kAn/sAAADP+QCf/7u7u//9kp/////////0n/////////MAAAAAAAD/8wAA"
  "AAAAAP/yAAAAAAAA//IAAAAAAAB3ca/6AAAD//Kv+gAAA//yr/oAAAP/8q/6AAAD//Kv+wAAA//yj/0AAAP/8l//YAAG//Ie//7M"
  "///yBP//////8gAp3/2U//IAAAAAA//yAAAAAAP/8gAAAAAD//IAAAAAA//yAAAAAAP/8gAAAAAD//Kf+wAAv/cAAP/1n/sAAL/3"
  "AAD/9Z/7AAC/9wAA//Wf+wAAv/cAAP/1n/sAAL/3AAD/9Z/7AAC/9wAA//Wf+wAAv/cAAP/1n/sAAL/3AAD/9Z/7AAC/9wAA//Wf"
  "+wAAv/cAAP/1n/sAAL/3AAD/9Z/7AAC/9wAA//Wf+wAAv/cAAP/1n/+7u//9u7v/9Z////////////Wf///////////1n/sAAL/3"
  "AAD/9QCf+wAAv/cAAP/1AJ/7AAC/9wAA//UAn/sAAL/3AAD/9QCf+wAAv/cAAP/1AJ/7AAC/9wAA//UAn/sAAL/3AAD/9QCf+wAA"
  "v/cAAP/1AJ/7AAC/9wAA//UAn/sAAL/3AAD/9QCf+wAAv/cAAP/1AJ/7AAC/9wAA//UAn/sAAL/3AAD/9QCf/7u7//27u//7kJ//"
  "///////////wn/////////////AAAAAAAAAAAAT/8AAAAAAAAAAABP/wAAAAAAAAAAAE/+AAAAAAAAAAAAJ3YD////9gAAAAAD//"
  "//9gAAAAACu7v/9gAAAAAAAADv9gAAAAAAAADv9gAAAAAAAADv/KqXUAAAAADv/////lAAAADv//////QAAADv9gAU3/8AAADv9g"
  "AAL/8wAADv9gAAD/9QAADv9gAAH/9AAADv9gAAr/8QAADv/aq+//gAAADv/////7AAAADv///9tAAJ/7AAAAAACP/J/7AAAAAACP"
  "/J/7AAAAAACP/J/7AAAAAACP/J/7AAAAAACP/J/+qqhRAACP/J//////gACP/J//////+QCP/J/7AAKv/0CP/J/7AAAN/4CP/J/7"
  "AAAK/6CP/J/7AAAM/5CP/J/7AABf/1CP/J/+qr3//QCP/J//////4gCP/J////7HAACP/J/7AAAAAAn/sAAAAACf+wAAAAAJ/7AA"
  "AAAAn/sAAAAACf/qqoUQAJ//////gAn//////5Cf+wACr/9J/7AAAN/4n/sAAAr/qf+wAADP+Z/7AABf/1n/6qvf/9Cf/////+IJ"
  "////7HAAAABK3/2BAAAAG/////5QAAC///////YAB//5EATf/xAM/6AAAB7/oAZmIAAAB//wAAAAm7u8//IAAADf////9AAAAN//"
  "///zAAAAAAAE//ILu0AAAAj/4Av/sAAAL/+QBf/6IATf/hAAr//////1AAAJ/////2AAAAA6z/2SAACf+wAAAGvf62AACf+wAAPf"
  "////wgCf+wAC///////xCf+wAd//cgKP/7Cf+wBf/1AAAG//Sf+wCv/AAAAA3/qf/oj/+AAAAAr/2f////9gAAAAf/6f////9gAA"
  "AAj/6f+wDf+AAAAAr/yf+wCf/QAAAA7/mf+wBf/2AAAH//Of+wAM//cgKP/6Cf+wAC///////xCf+wAAPf////4wCf+wAAAGvf+2"
  "AAAAA63////wB///////BP//3L3/8L//MABP/w7/gAAE//D/+AAAT/8M/+EABP/wb//8qs//AJ//////8AB//////wAL/+AE//AD"
  "//YAT/8Av/4ABP/wT/9gAE//DP/QAAT/9f/1AABP/wAGzv6jAAHP////UAn/+o3/8QWLQAH/9AAAASb/9gBb7///9gj//8nv9h//"
  "YADf9k/+AAL/9h//pX7/9gr///3P9gB9/6Gv9gAAAAAAMgAABs7//7AAHP////8QC//9upYQBP/CAAAAAK/xFnQQAA76f///cAD/"
  "z////3Af//YTz/8S//gAAv/1L/9AAA3/cP/zAADP+A3/YAAP/1Cf/RAH//IB//6b//kABf////sQAAKd/rYACv///sUAr/////gK"
  "/7id//Gv9gAf/yr/YAX/0K////+RCv////+Ar/YAGv+K/2AAb/2v+neO/7r/////9K////6jCv////mv////mv/ZmZWv+QAACv+Q"
  "AACv+QAACv+QAACv+QAACv+QAACv+QAACv+QAACv+QAAAAD/////8wAAD/////8wAAL/+Ij/8wAAP/wADf8wAAX/sADf8wAAf/kA"
  "Df8wAAn/cADf8wAAv/QADf8wAB//AADf8wBt/+mZn/+pCv////////Gv////////Gv+AAAAA//Gv+AAAAA//Gv+AAAAA//FYhAAA"
  "AAiIAAAp3+swAABf////gAAf/8iv/0AK/6AAb/0A7/MAAP/wH///////Mf//////9A//IAAAAAC/+QACl0AD//yJ7/wABv////0g"
  "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"
  "////Sv//////////8wAAAAAAAAAP/zAAAAAAAAAA//IAAAAAAAAAD/8gAAAAAAAAAHdx3///gAAAAA3///gAAAAAV33/gAAAAAAA"
  "v/gAAAAAAAv////YEAAAv/////4gAAv/2Zv/+wAAv/gABf/wAAv/gABP/wAAv/2Zv/+wAAv/////4gAAv////YEAr/kAAAAA7/av"
  "+QAAAADv9q/5AAAAAO/2r/kAAAAA7/av///9gQDv9q//////IO/2r/2Zv//A7/av+QAE//Dv9q/5AAP/8O/2r/2Zv//A7/av////"
  "/yDv9q////2BAO/2r/kAAAAAr/kAAAAAr/kAAAAAr/kAAAAAr////YEAr/////8gr/2Zv//Ar/kABP/wr/kAA//wr/2Zv//Ar///"
  "//8gr////YEAAAbO/IEAAAz////kAAn/+6//4QD/9gAu/4AXdwAAj/wAAAL////wAAAv////AWZgAAj/0A//YAHv+QCf/8r//hAB"
  "z////kAAAGzvyRAAr/gAAFvv2SAAr/gAC/////YAr/gAr//K7/8wr/gC//cADP+wr/yL//AABf/wr////8AAAv/yr////9AAA//x"
  "r/gF//EABv/wr/gB//gAHf+gr/gAj//K7/8gr/gAC/////UAr/gAAFvv2SAAACnf///1A//////1Df/6iO/1H/8wAL/1L/8gAL/1"
  "Dv/GVN/1Bf/////1AD/////1AH//EL/1Av/2AL/1C//AAL/1X/8wAL/1ABvkA9wgAAX/sJ/3AAAe9QT+MAAAAQAAAAAAAAAAAAAA"
  "ACnf6zAAAF////+AAB//yK//QAr/oABv/QDv8wAA//Af//////8x///////0D/8gAAAAAL/5AAKXQAP//Inv/AAG/////SAAApz/"
  "1xAP//////////////mZmZmZmf////////////////////////////+ZmZmZmZmZmZmZmQB/4Av8Af+QX/cK/1Dv8hu7AG/9CP+A"
  "r/MN/gD/oB/1ArsQAH/gBv8Av8AK/AH/kA/6Bf9wT/gK/1Cf9Q7/IN/zG7sBu7EG/9CP+wj/gK/2Cv8wz/EN/gD/wA/6Af+AH/UD"
  "/zArsQO6AAmqQKqiD/8h//Af/QP/sE/4Bv9gb/MI/xCP8Ar9AK+gDfgAAGzZEAj//9Ef///3P///+R////cJ///hAI77IASnAAAZ"
  "kgAAekAf/2AAv/sABf/xL/9wAM/9AAf/8gj8EABO5AABz5AAbf1gAAAA32AAAAAAAAb///UAAAn7AAAAAAAADfka/QAAT/EAAAAA"
  "AAAP9AX/AAHvUAAAAAAAAA/0Bf8ACvoAAAAAAAAADfor/ABf4QAAAAAAAAAG///1Ae9AAAAAAAAAAABt/FAL+QAAAAAAAAAAAAAA"
  "AG/RAr7ZEAGd6iAAAAAC/zAe//+wDP//4QAAAAv4AH/iX/JP9C/2AAAAf9AAr6AP9W/gC/kAAAL/MACvoA/1b+AL+QAADPcAAH/i"
  "X/NP9D/2AACPwAAAH///sA3//+EAA/8gAAADz+kQAa77IE/6X/d/9I/xr9C/oCMQT/oAT/tf9wBf93/0AG/0j/EAj/Gv0ACf0L+g"
  "AL+gIxAAIxAAA//1AC7/cAHf+gAL/8AAn/4QAL/8AAAd/6AAAu/4AAA//1AABf/zAAAiIQz/oAAAHv+AAAA//1AAAF//MAAAf/4g"
  "AAX/8wAD//UAAu/3AAHf+gAAv/wAAAIiEAAAAAAErf60AAAAr////5AACv////9QAG//kgJrAADf+gAAAACb//y7u3AD//////9Q"
  "AAb/8AAAAAAG//AAAAAA//////IAA8z//cyAAAAA3/oAAAAAAG//kQFZAAAL/////0AAAb////+QAAAEvf61AAC////9tQAAAL//"
  "////wQAAv/67vv/6AAC/+QAAj/8gAL/5AAAP/2AAv/kAAA7/YAC/+QAAb/8wqu/9qr3//AD////////RAP/////+tgAAAL/5AAAA"
  "AACq7/2qoAAAAP/////wAAAA//////AAAAAAv/kAAAAAAAC/+QAAAAAJ/3AAAE/3ACvvswn/8gAAT/cC////Of/6AABP9wn+Mt+p"
  "//9AAE/3DPgAf9n//9AAT/cM+AB/2f+P9wBP9wn+It+p/zz/IE/3Av///yn/M/+gT/cAK++zCf8wn/RP9wAAAAAJ/zAf/U/3BczM"
  "zGn/MAb/v/cG////if8wAN//9wAAAAAJ/zAAT//3AAAAAAn/MAAK//cAAAAACf8wAAL/9wAAAAAJ/zAAAH/3AAAAAAL//8P7AN8Q"
  "OPQj/xP/EAbxA/9p/xAG8QP6zq8QBvED9P5vEAbxA/OoXxAAAAAiAAAAAAAAAC7iAAAAAAAALv9wAAAAAAAu/4AAAAAAAC7/gAAA"
  "AAAALv9gAAAAAAAu/0AAAAAAAD7/3v//////Sf/////////0Cv/HmZmZmZkgCv+xAAAAAAAACv/BAAAAAAAACv/RAAAAAAAACv/R"
  "AAAAAAAACv9wAAAAAAAACoAAAAAAAAAAAAAAAAAAAAAJcAAAAAAAAJ/4AAAAAAAJ//+AAAAAAK////gAAAAK/5/6/5AAAK/7T/LP"
  "+QAL/8Ff9B3/kJ/9EF/0At/3LsEAX/QAHdECEABf9AABEAAAAF/0AAAAAAAAX/QAAAAAAABf9AAAAAAAAF/0AAAAAAAAX/QAAAAA"
  "AABf9AAAAAAAAAAiAAAAAAAAAC7iAAAAAAAAB//iAAAAAAAACP/iAAAAAAAACP/iAAAAAAAAB//iAAAAAAAABf/iBP//////7f/i"
  "T/////////+CmZmZmZl8/5AAAAAAABv/kAAAAAAAHf+gAAAAAAAt/6AAAAAAAC3/oAAAAAAAB/+gAAAAAAAACaAAAAAAAAAAAAAA"
  "AAAAAAX/QAAAAAAABf9AAAAAAAAF/0AAAAAAAAX/QAAAAAAABf9AAAAAAAAF/0AAAAAQAAX/QAAQAcoABf9AAcsK/6AF/0Ac/4Hf"
  "+gX/QM/8EB3/hP8q/8EAAd/3/3/8EAAAHf///8EAAAAB3//8EAAAAAAd/8EAAAAAAAHcEAAAAAAAABEAAAAMzMzMzMv//////+//"
  "/////gLP6hAF/zDP//9iv/Ev/7////sE/2Ab//4gAAAABIYQABnuoQAlUQr///Ya/yH/+/////BP9gK///gBRBAASJYAAAAAJEAA"
  "AAAL/QAAAAL/cA7//////e//////2ru9/8u5AACv0AAAAB/3AADv/////97//////avf/Lu7kAr+AAAAAf+AAAAAAAAAAAJQAAAA"
  "Sd/wADe////wrv///qYg//+mIAAA///rcwAAWu////tgAAJ7///wAAAABI3wAAAAAAAQ///////w///////wmZmZmZmQUQAAAAAA"
  "/9hAAAAA////tyAAN77///6QAAAmr//wAAN7///we////+lQ///7YgAA/IQAAAAAEAAAAAAA///////w///////wmZmZmZmf////"
  "//////H//////////x/9iIiIiIjP8f+QAAAAAAf/H/kAAAAAAH/x/5AAAAAAB/8f+QAAAAAAf/H/kAAAAAAH/x/5AAAAAAB/8f+Q"
  "AAAAAAf/H/kAAAAAAH/x/5AAAAAAB/8f+QAAAAAAf/H/yIiIiIiM/x//////////8f//////////EAAAAAAOcQAAAA//cQAAD///"
  "cQAP////cQ//////b/////kf///5EA//+RAAD/kQAAAIIAAAAAAAAAAAAAARAAAAAAAAABzBAAAAAAAAHP/AAAAAAAAc//gAAAAA"
  "ABz/+AADkAAAHP/4AAP/oAAc//cAAJ//oBz/9wAAAK//vf/3AAAAAK////cAAAAAAK//9wAAAAAAAK/3AAAAAAAAAJcAAAAAAA=="
  ;
static const Glyph FN_TITLE_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 5, 0},
  {0x0021, 5, 16, 1, -16, 7, 0},
  {0x0022, 8, 7, 2, -16, 12, 80},
  {0x0023, 14, 16, 0, -16, 14, 136},
  {0x0024, 14, 20, 0, -18, 14, 360},
  {0x0025, 20, 16, 1, -16, 22, 640},
  {0x0026, 15, 16, 0, -16, 15, 960},
  {0x0027, 4, 7, 2, -16, 7, 1200},
  {0x0028, 7, 20, 1, -17, 8, 1228},
  {0x0029, 7, 20, 0, -17, 8, 1368},
  {0x002A, 10, 10, 1, -16, 12, 1508},
  {0x002B, 12, 12, 1, -12, 15, 1608},
  {0x002C, 5, 7, 1, -3, 7, 1752},
  {0x002D, 8, 3, 1, -8, 10, 1787},
  {0x002E, 5, 4, 1, -4, 7, 1811},
  {0x002F, 9, 20, 0, -17, 9, 1831},
  {0x0030, 13, 16, 1, -16, 15, 2011},
  {0x0031, 9, 16, 0, -16, 9, 2219},
  {0x0032, 12, 16, 1, -16, 14, 2363},
  {0x0033, 13, 16, 1, -16, 14, 2555},
  {0x0034, 13, 16, 1, -16, 15, 2763},
  {0x0035, 13, 16, 1, -16, 14, 2971},
  {0x0036, 13, 16, 1, -16, 14, 3179},
  {0x0037, 12, 16, 0, -16, 13, 3387},
  {0x0038, 13, 16, 1, -16, 14, 3579},
  {0x0039, 13, 16, 1, -16, 14, 3787},
  {0x003A, 5, 12, 1, -12, 7, 3995},
  {0x003B, 5, 16, 1, -12, 8, 4055},
  {0x003C, 12, 13, 1, -13, 15, 4135},
  {0x003D, 11, 8, 2, -10, 15, 4291},
  {0x003E, 12, 13, 2, -13, 15, 4379},
  {0x003F, 12, 16, 0, -16, 12, 4535},
  {0x0040, 21, 21, 1, -16, 22, 4727},
  {0x0041, 16, 16, 0, -16, 16, 5168},
  {0x0042, 13, 16, 1, -16, 15, 5424},
  {0x0043, 15, 16, 1, -16, 16, 5632},
  {0x0044, 14, 16, 1, -16, 16, 5872},
  {0x0045, 12, 16, 1, -16, 13, 6096},
  {0x0046, 11, 16, 1, -16, 13, 6288},
  {0x0047, 15, 16, 1, -16, 17, 6464},
  {0x0048, 14, 16, 1, -16, 16, 6704},
  {0x0049, 4, 16, 1, -16, 6, 6928},
  {0x004A, 12, 16, 0, -16, 13, 6992},
  {0x004B, 15, 16, 1, -16, 16, 7184},
  {0x004C, 11, 16, 1, -16, 12, 7424},
  {0x004D, 19, 16, 1, -16, 20, 7600},
  {0x004E, 15, 16, 1, -16, 17, 7904},
  {0x004F, 15, 16, 1, -16, 17, 8144},
  {0x0050, 13, 16, 1, -16, 14, 8384},
  {0x0051, 15, 18, 1, -16, 17, 8592},
  {0x0052, 13, 16, 1, -16, 14, 8862},
  {0x0053, 14, 16, 0, -16, 14, 9070},
  {0x0054, 14, 16, 0, -16, 15, 9294},
  {0x0055, 14, 16, 1, -16, 16, 9518},
  {0x0056, 16, 16, 0, -16, 16, 9742},
  {0x0057, 23, 16, 0, -16, 23, 9998},
  {0x0058, 16, 16, 0, -16, 16, 10366},
  {0x0059, 16, 16, 0, -16, 16, 10622},
  {0x005A, 13, 16, 1, -16, 15, 10878},
  {0x005B, 7, 20, 1, -17, 8, 11086},
  {0x005C, 9, 20, 0, -17, 9, 11226},
  {0x005D, 6, 20, 1, -17, 8, 11406},
  {0x005E, 10, 7, 0, -16, 11, 11526},
  {0x005F, 11, 3, 0, 0, 10, 11596},
  {0x0060, 6, 4, 1, -17, 8, 11629},
  {0x0061, 12, 12, 0, -12, 13, 11653},
  {0x0062, 12, 16, 1, -16, 14, 11797},
  {0x0063, 13, 12, 0, -12, 13, 11989},
  {0x0064, 13, 16, 0, -16, 14, 12145},
  {0x0065, 13, 12, 0, -12, 13, 12353},
  {0x0066, 9, 17, 0, -17, 9, 12509},
  {0x0067, 13, 17, 0, -12, 14, 12662},
  {0x0068, 12, 16, 1, -16, 14, 12883},
  {0x0069, 4, 17, 1, -17, 6, 13075},
  {0x006A, 6, 22, -1, -17, 6, 13143},
  {0x006B, 12, 16, 1, -16, 13, 13275},
  {0x006C, 4, 16, 1, -16, 6, 13467},
  {0x006D, 18, 12, 1, -12, 20, 13531},
  {0x006E, 12, 12, 1, -12, 14, 13747},
  {0x006F, 13, 12, 0, -12, 14, 13891},
  {0x0070, 12, 17, 1, -12, 14, 14047},
  {0x0071, 13, 17, 0, -12, 14, 14251},
  {0x0072, 8, 12, 1, -12, 9, 14472},
  {0x0073, 12, 12, 0, -12, 12, 14568},
  {0x0074, 8, 15, 0, -15, 8, 14712},
  {0x0075, 12, 12, 1, -12, 14, 14832},
  {0x0076, 13, 12, 0, -12, 13, 14976},
  {0x0077, 19, 12, 0, -12, 19, 15132},
  {0x0078, 13, 12, 0, -12, 13, 15360},
  {0x0079, 13, 17, 0, -12, 13, 15516},
  {0x007A, 11, 12, 1, -12, 13, 15737},
  {0x007B, 9, 20, 1, -17, 10, 15869},
  {0x007C, 4, 27, 2, -22, 8, 16049},
  {0x007D, 8, 20, 1, -17, 10, 16157},
  {0x007E, 13, 5, 1, -9, 15, 16317},
  {0x00A7, 11, 19, 1, -16, 13, 16382},
  {0x00A9, 18, 16, 1, -16, 20, 16591},
  {0x00AB, 13, 11, 1, -12, 15, 16879},
  {0x00AE, 13, 13, 1, -16, 15, 17022},
  {0x00B0, 8, 8, 1, -16, 10, 17191},
  {0x00B1, 12, 13, 1, -13, 15, 17255},
  {0x00B2, 9, 9, 1, -19, 10, 17411},
  {0x00B3, 9, 10, 1, -19, 10, 17492},
  {0x00B6, 12, 16, 0, -16, 13, 17582},
  {0x00B7, 5, 4, 1, -10, 7, 17774},
  {0x00BB, 14, 11, 0, -12, 15, 17794},
  {0x00BC, 18, 16, 0, -16, 19, 17948},
  {0x00BD, 19, 16, 0, -16, 19, 18236},
  {0x00BE, 20, 16, 0, -16, 20, 18540},
  {0x00D7, 13, 12, 1, -12, 15, 18860},
  {0x00F7, 11, 13, 2, -13, 15, 19016},
  {0x0401, 12, 21, 1, -21, 13, 19159},
  {0x0410, 16, 16, 0, -16, 16, 19411},
  {0x0411, 13, 16, 1, -16, 14, 19667},
  {0x0412, 13, 16, 1, -16, 15, 19875},
  {0x0413, 11, 16, 1, -16, 13, 20083},
  {0x0414, 19, 20, 0, -16, 19, 20259},
  {0x0415, 12, 16, 1, -16, 13, 20639},
  {0x0416, 23, 16, 0, -16, 24, 20831},
  {0x0417, 13, 16, 1, -16, 14, 21199},
  {0x0418, 15, 16, 1, -16, 17, 21407},
  {0x0419, 15, 21, 1, -21, 17, 21647},
  {0x041A, 15, 16, 1, -16, 16, 21962},
  {0x041B, 16, 16, 0, -16, 16, 22202},
  {0x041C, 19, 16, 1, -16, 20, 22458},
  {0x041D, 14, 16, 1, -16, 16, 22762},
  {0x041E, 15, 16, 1, -16, 17, 22986},
  {0x041F, 14, 16, 1, -16, 16, 23226},
  {0x0420, 13, 16, 1, -16, 14, 23450},
  {0x0421, 15, 16, 1, -16, 16, 23658},
  {0x0422, 14, 16, 0, -16, 15, 23898},
  {0x0423, 15, 16, 0, -16, 15, 24122},
  {0x0424, 17, 18, 1, -17, 18, 24362},
  {0x0425, 16, 16, 0, -16, 16, 24668},
  {0x0426, 16, 20, 1, -16, 17, 24924},
  {0x0427, 14, 16, 1, -16, 16, 25244},
  {0x0428, 20, 16, 1, -16, 22, 25468},
  {0x0429, 22, 20, 1, -16, 22, 25788},
  {0x042A, 18, 16, 0, -16, 18, 26228},
  {0x042B, 18, 16, 1, -16, 20, 26516},
  {0x042C, 13, 16, 1, -16, 15, 26804},
  {0x042D, 16, 16, 0, -16, 16, 27012},
  {0x042E, 21, 16, 1, -16, 23, 27268},
  {0x042F, 13, 16, 0, -16, 14, 27604},
  {0x0430, 12, 12, 0, -12, 13, 27812},
  {0x0431, 13, 17, 0, -17, 13, 27956},
  {0x0432, 11, 12, 1, -12, 13, 28177},
  {0x0433, 9, 12, 1, -12, 10, 28309},
  {0x0434, 15, 16, 0, -12, 15, 28417},
  {0x0435, 13, 12, 0, -12, 13, 28657},
  {0x0436, 19, 12, 0, -12, 19, 28813},
  {0x0437, 11, 12, 0, -12, 11, 29041},
  {0x0438, 12, 12, 1, -12, 14, 29173},
  {0x0439, 12, 17, 1, -17, 14, 29317},
  {0x043A, 12, 12, 1, -12, 13, 29521},
  {0x043B, 12, 12, 0, -12, 13, 29665},
  {0x043C, 16, 12, 1, -12, 18, 29809},
  {0x043D, 12, 12, 1, -12, 14, 30001},
  {0x043E, 13, 12, 0, -12, 14, 30145},
  {0x043F, 12, 12, 1, -12, 14, 30301},
  {0x0440, 12, 17, 1, -12, 14, 30445},
  {0x0441, 13, 12, 0, -12, 13, 30649},
  {0x0442, 11, 12, 0, -12, 11, 30805},
  {0x0443, 13, 17, 0, -12, 13, 30937},
  {0x0444, 17, 20, 0, -16, 17, 31158},
  {0x0445, 13, 12, 0, -12, 13, 31498},
  {0x0446, 13, 16, 1, -12, 14, 31654},
  {0x0447, 11, 12, 1, -12, 13, 31862},
  {0x0448, 17, 12, 1, -12, 19, 31994},
  {0x0449, 19, 16, 1, -12, 20, 32198},
  {0x044A, 15, 12, 0, -12, 15, 32502},
  {0x044B, 16, 12, 1, -12, 18, 32682},
  {0x044C, 12, 12, 1, -12, 13, 32874},
  {0x044D, 13, 12, 0, -12, 13, 33018},
  {0x044E, 18, 12, 1, -12, 19, 33174},
  {0x044F, 12, 12, 0, -12, 13, 33390},
  {0x0451, 13, 17, 0, -17, 13, 33534},
  {0x2013, 11, 3, 0, -8, 11, 33755},
  {0x2014, 22, 3, 0, -8, 22, 33788},
  {0x2018, 5, 7, 1, -16, 7, 33854},
  {0x2019, 5, 7, 1, -16, 7, 33889},
  {0x201C, 10, 7, 1, -16, 12, 33924},
  {0x201D, 10, 7, 1, -16, 12, 33994},
  {0x201E, 10, 7, 1, -3, 11, 34064},
  {0x2022, 8, 7, 1, -10, 10, 34134},
  {0x2026, 20, 4, 1, -4, 22, 34190},
  {0x2030, 28, 16, 1, -16, 31, 34270},
  {0x2032, 4, 7, 1, -16, 6, 34718},
  {0x2033, 10, 7, 1, -16, 12, 34746},
  {0x2039, 8, 11, 1, -12, 9, 34816},
  {0x203A, 9, 11, 0, -12, 9, 34904},
  {0x20AC, 14, 16, 0, -16, 15, 35003},
  {0x20BD, 16, 16, 0, -16, 16, 35227},
  {0x2116, 22, 16, 1, -16, 24, 35483},
  {0x2122, 14, 6, 0, -16, 14, 35835},
  {0x2190, 17, 17, 2, -15, 21, 35919},
  {0x2191, 16, 16, 2, -16, 20, 36208},
  {0x2192, 17, 17, 2, -15, 21, 36464},
  {0x2193, 16, 17, 2, -16, 20, 36753},
  {0x2212, 11, 3, 2, -8, 15, 37025},
  {0x2248, 13, 10, 1, -11, 15, 37058},
  {0x2260, 11, 13, 2, -13, 15, 37188},
  {0x2264, 12, 13, 1, -13, 15, 37331},
  {0x2265, 12, 13, 1, -13, 15, 37487},
  {0x25A1, 17, 16, 2, -16, 20, 37643},
  {0x25B8, 10, 11, 0, -11, 10, 37915},
  {0x2713, 17, 13, 2, -14, 19, 38025},
};
AAFont FN_TITLE_F = { nullptr, FN_TITLE_F_GLYPHS, 207, 22, 6, FN_TITLE_F_B64, 19123 };

// FN_SEMI_F: 16px, 207 глифов, 10323 байт
static const char FN_SEMI_F_B64[] PROGMEM =
  "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"
  "aq/xDfcAAC/wBf9gAs+QAJ////0QAAS+/YAA30AABfzfQAAF/N9AAAX830AABfzfQAAF/N/////839zMzfzfQAAF/N9AAAX830AA"
  "BfzfQAAF/N9AAAX8303030303030303030303030AAAA/yAAAA/yAAAA/yAAAA/yAAAA/yAAAA/yAAAA/yJTAA/yb8AB/xP/IG/w"
  "DP/f9wAZ79cA30AAX/XfQAP/cN9AHvoA30DPwADfSf0QAN+f+AAA3/7/MADf8p/QAN9QHvgA30AE/zDfQACv0N9AAB7430AAAN9A"
  "AADfQAAA30AAAN9AAADfQAAA30AAAN9AAADfQAAA30AAAN/czMXf///23/gAAAz/nf/gAAL/+d/vMAB/7536+QAN+vnfX+AD/o+d"
  "899Aj5j53zj6DfOPnfMv4v4I+d8wz4+Aj53zB//yCPnfMB/9AI+d8wC/cAj539AAAv/f9wAC/9//IAL/36+gAv/fTvQC/99F/QL/"
  "31DPcv/fUD/z/99QCfr/31AB7//fUABf/99QAAv/AAS+/HAAAI////wQBP9wBO+ADPgAAE/xD/IAAA30L/AAAAv2L/AAAAv2D/IA"
  "AA30DPgAAE/xBP9gA++AAI////wQAAS+/HAA3//9kQ39zf/Q30AC/230AAn530AAn530AC/239vP/Q3//9kQ30AAAA30AAAA30AA"
  "AA30AAAAAAS+/HAAAI////wQBP9wBO+ADPgAAE/xD/IAAA30L/AAAAv2L/AAAAv3D/IAEA31DPgC/E/xBP9gb/+AAI////0AAAS+"
  "/O8wAAAAAC3A3//9kQ39zf/Q30AC7230AAn530AAr530AV/13///+w39zvwA30A/8w30AK+w30AC/030AAn8ADvv2BAD//7/wAz5"
  "EC71DvQAA2ML/VAAAALf/7UAAAa//7AAAABe9imAAAj6H/YALfcH//7/4QBc79kQb/////5MzP/cywAAz1AAAADPUAAAAM9QAAAA"
  "z1AAAADPUAAAAM9QAAAAz1AAAADPUAAAAM9QAAAAz1AA30AACPrfQAAI+t9AAAj630AACPrfQAAI+t9AAAj630AACPrfQAAI+r9w"
  "AAv3f/QAb/MM////gAB9/sUAf9AAAD/xL/MAAI/ADPgAAN9gBv0AAv8QAf8gCPsAAL+ADfYAAG/QL/EAAB/yb7AAAAv2r2AAAAX6"
  "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"
  ;
static const Glyph FN_SEMI_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 4, 0},
  {0x0021, 3, 12, 1, -12, 5, 0},
  {0x0022, 6, 5, 1, -12, 8, 36},
  {0x0023, 11, 12, 0, -12, 10, 66},
  {0x0024, 10, 16, 0, -14, 10, 198},
  {0x0025, 14, 13, 1, -12, 16, 358},
  {0x0026, 11, 12, 0, -12, 11, 540},
  {0x0027, 3, 5, 1, -12, 5, 672},
  {0x0028, 5, 15, 1, -13, 6, 687},
  {0x0029, 5, 15, 0, -13, 6, 762},
  {0x002A, 7, 7, 1, -12, 9, 837},
  {0x002B, 9, 9, 1, -9, 11, 886},
  {0x002C, 4, 5, 0, -2, 5, 967},
  {0x002D, 6, 2, 1, -6, 7, 987},
  {0x002E, 3, 3, 1, -3, 5, 999},
  {0x002F, 6, 14, 0, -12, 6, 1008},
  {0x0030, 10, 12, 0, -12, 11, 1092},
  {0x0031, 6, 12, 0, -12, 7, 1212},
  {0x0032, 8, 12, 1, -12, 10, 1284},
  {0x0033, 10, 12, 0, -12, 10, 1380},
  {0x0034, 10, 12, 0, -12, 11, 1500},
  {0x0035, 9, 12, 1, -12, 10, 1620},
  {0x0036, 10, 12, 0, -12, 10, 1728},
  {0x0037, 9, 12, 0, -12, 9, 1848},
  {0x0038, 10, 12, 0, -12, 10, 1956},
  {0x0039, 10, 12, 0, -12, 10, 2076},
  {0x003A, 3, 9, 1, -9, 5, 2196},
  {0x003B, 4, 12, 0, -9, 5, 2223},
  {0x003C, 9, 9, 1, -9, 11, 2271},
  {0x003D, 9, 5, 1, -7, 11, 2352},
  {0x003E, 9, 9, 1, -9, 11, 2397},
  {0x003F, 8, 12, 0, -12, 9, 2478},
  {0x0040, 16, 15, 0, -12, 16, 2574},
  {0x0041, 12, 12, 0, -12, 12, 2814},
  {0x0042, 9, 12, 1, -12, 11, 2958},
  {0x0043, 11, 12, 0, -12, 12, 3066},
  {0x0044, 10, 12, 1, -12, 12, 3198},
  {0x0045, 8, 12, 1, -12, 10, 3318},
  {0x0046, 8, 12, 1, -12, 9, 3414},
  {0x0047, 12, 12, 0, -12, 12, 3510},
  {0x0048, 10, 12, 1, -12, 12, 3654},
  {0x0049, 3, 12, 1, -12, 4, 3774},
  {0x004A, 9, 12, 0, -12, 9, 3810},
  {0x004B, 10, 12, 1, -12, 11, 3918},
  {0x004C, 8, 12, 1, -12, 9, 4038},
  {0x004D, 13, 12, 1, -12, 15, 4134},
  {0x004E, 10, 12, 1, -12, 12, 4290},
  {0x004F, 12, 12, 0, -12, 12, 4410},
  {0x0050, 9, 12, 1, -12, 10, 4554},
  {0x0051, 12, 13, 0, -12, 12, 4662},
  {0x0052, 9, 12, 1, -12, 10, 4818},
  {0x0053, 10, 12, 0, -12, 10, 4926},
  {0x0054, 10, 12, 0, -12, 11, 5046},
  {0x0055, 10, 12, 1, -12, 12, 5166},
  {0x0056, 12, 12, 0, -12, 12, 5286},
  {0x0057, 16, 12, 0, -12, 16, 5430},
  {0x0058, 12, 12, 0, -12, 12, 5622},
  {0x0059, 11, 12, 0, -12, 11, 5766},
  {0x005A, 10, 12, 0, -12, 10, 5898},
  {0x005B, 5, 15, 1, -13, 6, 6018},
  {0x005C, 6, 14, 0, -12, 6, 6093},
  {0x005D, 5, 15, 0, -13, 6, 6177},
  {0x005E, 8, 6, 0, -12, 8, 6252},
  {0x005F, 8, 2, 0, 0, 8, 6300},
  {0x0060, 4, 3, 1, -13, 6, 6316},
  {0x0061, 9, 9, 0, -9, 9, 6328},
  {0x0062, 9, 12, 1, -12, 10, 6409},
  {0x0063, 9, 9, 0, -9, 9, 6517},
  {0x0064, 9, 12, 0, -12, 10, 6598},
  {0x0065, 9, 9, 0, -9, 9, 6706},
  {0x0066, 6, 13, 0, -13, 6, 6787},
  {0x0067, 9, 13, 0, -9, 10, 6865},
  {0x0068, 8, 12, 1, -12, 10, 6982},
  {0x0069, 4, 13, 0, -13, 4, 7078},
  {0x006A, 5, 16, -1, -13, 4, 7130},
  {0x006B, 8, 12, 1, -12, 9, 7210},
  {0x006C, 3, 12, 1, -12, 4, 7306},
  {0x006D, 13, 9, 1, -9, 14, 7342},
  {0x006E, 8, 9, 1, -9, 10, 7459},
  {0x006F, 10, 9, 0, -9, 10, 7531},
  {0x0070, 9, 13, 1, -9, 10, 7621},
  {0x0071, 9, 13, 0, -9, 10, 7738},
  {0x0072, 6, 9, 1, -9, 6, 7855},
  {0x0073, 9, 9, 0, -9, 9, 7909},
  {0x0074, 6, 12, 0, -12, 6, 7990},
  {0x0075, 8, 9, 1, -9, 10, 8062},
  {0x0076, 10, 9, 0, -9, 9, 8134},
  {0x0077, 14, 9, 0, -9, 13, 8224},
  {0x0078, 9, 9, 0, -9, 9, 8350},
  {0x0079, 10, 13, 0, -9, 9, 8431},
  {0x007A, 9, 9, 0, -9, 9, 8561},
  {0x007B, 6, 15, 1, -13, 7, 8642},
  {0x007C, 3, 20, 1, -16, 6, 8732},
  {0x007D, 7, 15, 0, -13, 7, 8792},
  {0x007E, 9, 5, 1, -7, 11, 8897},
  {0x00A7, 9, 14, 0, -12, 9, 8942},
  {0x00A9, 13, 12, 1, -12, 15, 9068},
  {0x00AB, 10, 8, 0, -9, 10, 9224},
  {0x00AE, 10, 10, 0, -12, 11, 9304},
  {0x00B0, 7, 6, 0, -12, 7, 9404},
  {0x00B1, 9, 9, 1, -9, 11, 9446},
  {0x00B2, 7, 7, 0, -14, 7, 9527},
  {0x00B3, 7, 7, 0, -14, 7, 9576},
  {0x00B6, 9, 12, 0, -12, 10, 9625},
  {0x00B7, 3, 3, 1, -7, 5, 9733},
  {0x00BB, 10, 8, 0, -9, 10, 9742},
  {0x00BC, 13, 12, 0, -12, 13, 9822},
  {0x00BD, 14, 12, 0, -12, 14, 9978},
  {0x00BE, 14, 12, 0, -12, 15, 10146},
  {0x00D7, 9, 8, 1, -9, 11, 10314},
  {0x00F7, 9, 9, 1, -9, 11, 10386},
  {0x0401, 8, 16, 1, -16, 10, 10467},
  {0x0410, 12, 12, 0, -12, 12, 10595},
  {0x0411, 9, 12, 1, -12, 10, 10739},
  {0x0412, 9, 12, 1, -12, 11, 10847},
  {0x0413, 8, 12, 1, -12, 9, 10955},
  {0x0414, 13, 15, 0, -12, 14, 11051},
  {0x0415, 8, 12, 1, -12, 10, 11246},
  {0x0416, 17, 12, 0, -12, 17, 11342},
  {0x0417, 10, 12, 0, -12, 10, 11546},
  {0x0418, 10, 12, 1, -12, 12, 11666},
  {0x0419, 10, 16, 1, -16, 12, 11786},
  {0x041A, 10, 12, 1, -12, 11, 11946},
  {0x041B, 11, 12, 0, -12, 12, 12066},
  {0x041C, 13, 12, 1, -12, 15, 12198},
  {0x041D, 10, 12, 1, -12, 12, 12354},
  {0x041E, 12, 12, 0, -12, 12, 12474},
  {0x041F, 10, 12, 1, -12, 12, 12618},
  {0x0420, 9, 12, 1, -12, 10, 12738},
  {0x0421, 11, 12, 0, -12, 12, 12846},
  {0x0422, 10, 12, 0, -12, 11, 12978},
  {0x0423, 11, 12, 0, -12, 11, 13098},
  {0x0424, 13, 14, 0, -13, 13, 13230},
  {0x0425, 12, 12, 0, -12, 12, 13412},
  {0x0426, 11, 15, 1, -12, 12, 13556},
  {0x0427, 10, 12, 1, -12, 11, 13721},
  {0x0428, 14, 12, 1, -12, 16, 13841},
  {0x0429, 15, 15, 1, -12, 16, 14009},
  {0x042A, 13, 12, 0, -12, 13, 14234},
  {0x042B, 13, 12, 1, -12, 15, 14390},
  {0x042C, 9, 12, 1, -12, 11, 14546},
  {0x042D, 11, 12, 0, -12, 12, 14654},
  {0x042E, 15, 12, 1, -12, 17, 14786},
  {0x042F, 10, 12, 0, -12, 10, 14966},
  {0x0430, 9, 9, 0, -9, 9, 15086},
  {0x0431, 9, 13, 0, -13, 10, 15167},
  {0x0432, 8, 9, 1, -9, 9, 15284},
  {0x0433, 6, 9, 1, -9, 7, 15356},
  {0x0434, 10, 12, 0, -9, 10, 15410},
  {0x0435, 9, 9, 0, -9, 9, 15530},
  {0x0436, 14, 9, 0, -9, 14, 15611},
  {0x0437, 8, 9, 0, -9, 8, 15737},
  {0x0438, 8, 9, 1, -9, 10, 15809},
  {0x0439, 8, 13, 1, -13, 10, 15881},
  {0x043A, 8, 9, 1, -9, 9, 15985},
  {0x043B, 9, 9, 0, -9, 10, 16057},
  {0x043C, 11, 9, 1, -9, 13, 16138},
  {0x043D, 8, 9, 1, -9, 10, 16237},
  {0x043E, 10, 9, 0, -9, 10, 16309},
  {0x043F, 8, 9, 1, -9, 10, 16399},
  {0x0440, 9, 13, 1, -9, 10, 16471},
  {0x0441, 9, 9, 0, -9, 9, 16588},
  {0x0442, 8, 9, 0, -9, 8, 16669},
  {0x0443, 10, 13, 0, -9, 9, 16741},
  {0x0444, 12, 15, 0, -12, 12, 16871},
  {0x0445, 9, 9, 0, -9, 9, 17051},
  {0x0446, 9, 12, 1, -9, 10, 17132},
  {0x0447, 8, 9, 1, -9, 10, 17240},
  {0x0448, 12, 9, 1, -9, 14, 17312},
  {0x0449, 13, 12, 1, -9, 14, 17420},
  {0x044A, 10, 9, 0, -9, 11, 17576},
  {0x044B, 11, 9, 1, -9, 13, 17666},
  {0x044C, 8, 9, 1, -9, 9, 17765},
  {0x044D, 9, 9, 0, -9, 9, 17837},
  {0x044E, 13, 9, 1, -9, 14, 17918},
  {0x044F, 9, 9, 0, -9, 9, 18035},
  {0x0451, 9, 13, 0, -13, 9, 18116},
  {0x2013, 8, 2, 0, -6, 8, 18233},
  {0x2014, 16, 2, 0, -6, 16, 18249},
  {0x2018, 4, 5, 1, -12, 5, 18281},
  {0x2019, 4, 5, 1, -12, 5, 18301},
  {0x201C, 7, 5, 1, -12, 8, 18321},
  {0x201D, 7, 5, 1, -12, 8, 18356},
  {0x201E, 7, 5, 0, -2, 8, 18391},
  {0x2022, 6, 5, 1, -7, 8, 18426},
  {0x2026, 13, 3, 1, -3, 15, 18456},
  {0x2030, 20, 13, 1, -12, 22, 18495},
  {0x2032, 4, 5, 0, -12, 4, 18755},
  {0x2033, 8, 5, 0, -12, 8, 18775},
  {0x2039, 6, 8, 0, -9, 7, 18815},
  {0x203A, 6, 8, 0, -9, 7, 18863},
  {0x20AC, 10, 12, 0, -12, 11, 18911},
  {0x20BD, 11, 12, 0, -12, 12, 19031},
  {0x2116, 16, 12, 1, -12, 18, 19163},
  {0x2122, 10, 5, 0, -12, 10, 19355},
  {0x2190, 13, 12, 1, -11, 15, 19405},
  {0x2191, 12, 12, 1, -12, 14, 19561},
  {0x2192, 12, 12, 2, -11, 15, 19705},
  {0x2193, 12, 12, 1, -12, 14, 19849},
  {0x2212, 9, 2, 1, -6, 11, 19993},
  {0x2248, 9, 7, 1, -8, 11, 20011},
  {0x2260, 9, 9, 1, -9, 11, 20074},
  {0x2264, 9, 9, 1, -9, 11, 20155},
  {0x2265, 9, 9, 1, -9, 11, 20236},
  {0x25A1, 13, 12, 1, -12, 15, 20317},
  {0x25B8, 8, 8, 0, -8, 8, 20473},
  {0x2713, 12, 9, 1, -10, 14, 20537},
};
AAFont FN_SEMI_F = { nullptr, FN_SEMI_F_GLYPHS, 207, 16, 4, FN_SEMI_F_B64, 10323 };

// FN_SMALL_F: 14px, 207 глифов, 7830 байт
static const char FN_SMALL_F_B64[] PROGMEM =
  "u7u7q6qqqkQAqqucTxiz8IsvBpLQAC4AmAAEwAtQAHoA4wH////4AcUT4QAOIFwAAfEHoAv////wBbAMQACJAPIACmAfAAAABQAA"
  "AADQAAAH7+gAB/jo+QDYDQbQDZDQAABvvgAAAEz/kQAADX6wAADQPxL0DQTxC+fo6wAZ7+kQAADQAAAABAAACvwQAJkAXRtwA+EA"
  "egiQDVAAXSxwiwAACeoS8gAAAAAMYAAAAABsAr1QAAHjC5PxAAuADUDjAF0AC3LxAeQAA+9wAI/5AABPVPUAB9AOcAA/NvIAAL/1"
  "AAAb+gAADNT1HSPyBvfwPxAK+wDrM7+gAr/7T3nIuLaQCjBfELoB9APxBfAH0AfQBfAC8gDnAH0AH0KxAOcAnQA/IA9ADmALkAyA"
  "DmAfQF8AuALxAADwABw+PBBN/UAY39gQgeGAAAsAAADTAAAPMAER9BG////wAPMAAA8wAADCAArAxw8x0A//9wIiIYm7AAmQANUA"
  "HxAGwACoAA5AAvAAewALcADzAE4ACKAAIgAABM/DAD+DrxC6AA2A9QAIwfMABuLyAAXx8wAG4PUACMC6AA2AT3OvIAXfwwAc9z6+"
  "dYDXAA1wANcADXAA1wANcADXAA1wANcH77IH9Uvh1wAPQxAB9QAAbxAAP2AAHqAADMEACuEAB/UiIf///4AH78QAj3SvILYAH2AA"
  "AA9AABOtAAC/9AAAAW9gAAAJwdQACrC+Y39QGe/VAAAB/QAAAJ/QAAAvjQAAC4bQAATxbQAA1wbQAG4AbQAegijiE/////QAAAbQ"
  "AAAAbQBP//814iIgfAAACbAQAL7/5QaCGfIAAA2AAACqtwANiPc68gjvwwADz9UAL5SPQJoACpDkAQAB9d/3Av5Rb1L3AAqx9AAH"
  "0MgAC6BPc48wBd/EBf///0EiIm8gAAC7AAAD8wAACsAAAC9AAACdAAAB9gAACOAAAB9wAAB/EAAAB+/DAG9TnxDJAA9gqQAPQF9S"
  "ngAL//YAvTFvUfQACrHzAAnAzUN/YBnv1gAI77IAj2SuEPYADXLyAAqw9QAN0K4xj9Ab/7iwABEJkNYAH0CeZMwAGe6hAj3UQAAA"
  "CJuwjQBrAAAAAAAAABIAqwDXAPIBsAAAAHkAB+5QbtYAz1AABN5xAABd+BAABdoAAAAn///7EiIiISIiIX///7aRAAADz5EAAAS/"
  "gQAAA+8QAF3nAG3nAAbnAAACEAAAAE39UC+jnyXRAPYAAB9AABzRAB3RAAXxAABJAAAAAAAAbQAAB+EAAAGM7rcAAATqQSXMIAH1"
  "AAAAmwCrAr/LYeQOQMkk9wmB8i8QC3B6LwPgAKcHoPIvEAxwiQ5AyRX7LUCrAs+03oAB9QAAAAAABfpCE2AAAAGc7+oAAAAvsAAA"
  "AHzxAAAA19YAAALynAAAB+BPEAANkA9wAC9SK8AAj///8gDZAAD3AvQAAJ0I4AAATyz//qEMkjXqDIAAfgyAAG4MkSTnDP//wgyA"
  "Ar4cgAAfTIAAD1ySJK8c///DAACd/WAAHeZI+AB+EABfIOcAAAcx9AAAAALyAAAAAfQAAAAA5wAABzB+EABfIB3mR/kAAZ39YAz/"
  "/ZEAySNt4QyAAB2QyAAAXwyAAALyyAAAH0yAAALyyAAAXwyAAB2QySNt4Qz//ZEAz///fJIiIcgAAAyAAADJIiIM///xyAAADIAA"
  "AMgAAAySIiHP//+M///2ySIiHIAAAMgAAAyAAADP//8MkiIgyAAADIAAAMgAAAyAAAAACd/VAADOZI9wBvIAB/INgAAAtA9AAAAA"
  "LyABIiEfMAX/+Q9gAADXCeEAA/QB7WR/oAAZ39cAyAAALzyAAALzyAAALzyAAALzySIiTzz////zyAAALzyAAALzyAAALzyAAALz"
  "yAAALzyMjIyMjIyMjIyMgAAAnAAACcAAAJwAAAnAAACcAAAJwAAAnEwACcTzAMoes29QPP5wyAAD+cgALrDIAd0QyAviAMiPMADM"
  "/2AAz1jyAMkA2wDIAD9gyAAI8cgAANvIAAAMgAAAyAAADIAAAMgAAAyAAADIAAAMgAAAyAAADJIiIc///0z0AAAK9s+gAAH/bL8A"
  "AF7mx/UAC55serAB9ObHTxBuDmxw5wyA5scJwvIObHA/fADmxwDfcA5scAfxAObPIAAPXPoAAPXK9AAPXIrQAPXIL2APXICPEPXI"
  "AOkPXIAF8/XIAAu/XIAAL/XIAACPUACN/GAADeZI+AB+EABfMOcAAAyR9AAACbLyAAAH0fQAAAmw5wAADJB+EABPMB3mSPgAAZ38"
  "YAz//pEMkjXqDIAAXxyAAC8sgABfHJIl6gz//pEMgAAADIAAAAyAAAAMgAAAAACN/GAADeZI+AB+EABfMOcAAAyR9AAACbLyAAAH"
  "0fQAAAmw5wBzDIB+EG5vMB3mTvgAAZ385wAAAABNLP/+kQySNeoMgABfHIAALyyAAF8MkiXrDP//oAyADbAMgAT0DIAAzAyAAD9Q"
  "Bt/oAAf2N+kA1wAF0A2AAAAAf6MAAABt/nAAAAKPoAAAAE8R0wAD8g3UE9wAK//7IAABIQAF////9hIk9SIQAC8wAAAC8wAAAC8w"
  "AAAC8wAAAC8wAAAC8wAAAC8wAAAC8wAAAC8wAMgAAC88gAAC88gAAC88gAAC88gAAC88gAAC88gAAC88kAAD8o4QAI8B/FSfYAKu"
  "/FAI4AAATyLzAACdANkAAOcAfgAD8gAvMAnAAA2ADnAAB9A/IAAC8owAAADHxwAAAHzyAAAAH8AACdAAD8AAH1TxAD/wAE8R9AB7"
  "9ACNAMgAuMcAyQCMAPSLAPUATwPxTwTxAB83wB830AAMeoAMe4AACK5ACK5AAATvEATvEAAB/AAB/AAC9wAA2gB/IAfxAA2wL2AA"
  "A/S7AAAAjvIAAAAvsAAAALz0AAAG8p4QAB+AHpAArQAF8wXzAAC9BvMAAK0A2wAD9ABPQAywAArQXyAAAvXZAAAAj/EAAAAfcAAA"
  "AA5gAAAADmAAAAAOYAAAAA5gAAP////gIiIukAAAfhAAAvUAAAvAAABfIAAB6AAACeEAAD9AAADLIiIi////9/9HwQewB7AHsAew"
  "B7AHsAewB7AHsAfAB/9JkABdAAHyAAxgAIoAA/AADzAAtwAGwAAvAADkAAqAABI/+QGpAKkAqQCpAKkAqQCpAKkAqQCpAKk/+QCv"
  "MAL5sAmh8y8wmiQAFf///2IiIiG6AeIAADvvoA60XoAQAJwBWb/B7YWMXwAJxPUV/Aj/yMAAEAD1AAAPUAAA9QAAD2z9QP5zjz+Q"
  "ALr2AAffYAB9+QALr/Yo8/bP1QAI78MAnlO+EfQAFhTwAAAE8AAAAfQAFxCeQ74QCO/DAAAADIAAAAyAAAAMgBnufICuQ7+B9AAf"
  "hPAADYTwAA2B9AAfgK5Dv4AZ/3uACe+yAKxDrhLyAB9E////c/EREQH1AAUQjlOvIAjvxAAJ/AT1IG4A7/+hbhEG4ABuAAbgAG4A"
  "BuAAbgAAnve4CuQ7+B9AAfg/AADYTwAAyB9AAfgK1Dv4Aa/3yAAAANcKozjzAb/9UPUAAA9QAAD1AAAPa/1A/VO+D3AE8vUAHz9Q"
  "AfP1AB8/UAHz9QAfMcUKQAAPUPUPUPUPUPUPUPUBxQCkAAAA9QD1APUA9QD1APUA9QD1APUG8j+A9QAAD1AAAPUAAA9QDMH1C9EP"
  "WdEA/fQAD9zRAPUeoA9QT2D1AH8vX19fX19fX19fX19b+Qr+QPxV/IS/D2AJ4APy9QCMAB8/UAjAAfP1AIwAHz9QCMAB8/UAjAAf"
  "P1v9QP1Tvg9wBPL1AB8/UAHz9QAfP1AB8/UAHzAI77IAnlOuEfQADnTwAAqU8AAKofQADnCeQ64QCO+yD1z9QP5zjz+QALr2AAff"
  "YAB9+QALr+Yo8/a/1Q9QAAD1AAAKMAAAAZ7nuArkO/gfQAH4TwAA2E8AANgfQAH4CuQ7+AGf98gAAADIAAAAyAAAAIX2z/5j9wD1"
  "APUA9QD1APUAAs/oANsk9A9gAQCfxyAAON9AMADKH5JfcE3+gAlwALgA7/8RyRALgAC4AAuAALgACsIAPfP1AB8/UAHz9QAfP1AB"
  "8/UAHz6AA/OuM68yv9PzfgAB9S8wBvAMkAuQBuAfMAH0bgAAqbgAAE7yAAAOwABvAB+AB9LzBfwAyA1wmPEfQIsNPVTwBPLwiYsA"
  "D4sEzGAAr3AP8QAG8gC9AC9QCsAH4U8gAMjXAAA/0AAAT9AAAebIAAnQPzBPMAnQfgAB9S8wBvAMkAuQBuAfMAH0bgAAqbgAAF7y"
  "AAAOwAAADmAAAn8QAA7VAAAP//+wIiT2AADKAACOEABPMAAegAAL0iIi///+AAahAE9xAIwAAIoAAJoAAtcAD7EABvUAAKkAAIoA"
  "AIsAAG8gAAryOj4+Pj4+Pj4+Pj4+Pj4+Pj4/kAA/UADHAAqAAKkAB+QAC/AH4wCpAAqAAMcAP1A/kAABAAAE/5AdG6T5fwpAXvUA"
  "Cv5gB+R/IJsAowP3AACd/TA/EZ9S8gB+CuUE8Af85gACzhCDAfQLwk8wLf+QAAEAAAKt/ZEABftkbeIB9zz8OsCMHpS9H0uF4AKx"
  "x9Z7AAAJq4XgArDHjB6UzB9B9zz8KsAF+1Rt4wACrf2RAAAGUHMAbyrABPR+EC9k8wALsegAAdkvUAAudPMAPP1wAF5RPKAOR5cN"
  "Q9Cyw3k8C74GkOKhk8UG1AKrAATP2AAE34AOc/QfAKcOc+QE34AADzAAAPMAn///4SL1IgAPMAAAIACf///hIiIiBsxwLjPzAATx"
  "AF9QCOMAP//3B96hGCH0AH+gAALmP0LoB9+xAa7/8wv/w/Mv/7HzP/+x8x//sfMK/7HzAI2h8wAAAfMAAAHzAAAB8wAAAfOJuycU"
  "cAALwdgAAdovYAAvdPMAbynRBPR+IC9k8wA+8AAC8gdvAAC4AALwAF0AAC8AHkAAAvAJkAAALwThC/AAANUE3wAAiwDF8AA+IFwf"
  "AAxgCv/5BsAAAB8D7wAALyAHbwAAuAAALwAF0AAALwAeQAAALwCZAAAALwThPOgAAA1QZh8QAIsAAF0AA+IAAuMADGAAHmAAbAAA"
  "n/8wnsIAAeQBUKcACZAADeIAPhAAAKoA1QACcIwHsAABrsQuIJ8QAADHAt8QAAbACl8QAB4wPQ8QAKgAj++wBNAAAA8UsAB4HbB/"
  "QB3fQACPwAB/XbBfQB2QMAASABswAALlAAAAAAEiIiKf///QAAAAAC5QAAGzAAuQ1wBkBzAAAAAM///3ySIiHIAAAMgAAAySIiDP"
  "//8cgAAAyAAADIAAAMkiIhz///gAAvsAAAAHzxAAAA19YAAALynAAAB+BPEAANkA9wAC9SK8AAj///8gDZAAD3AvQAAJ0I4AAATy"
  "z///UMkiIhDIAAAAyAAAAMkiEADP//wwyAA74MgAAvPIAALyySJM0M//6iDP/+oQySNeoMgAB+DIAAbgyRJOcM///CDIACvhyAAB"
  "9MgAAPXJIkrxz//8MM///3ySIiHIAAAMgAAAyAAADIAAAMgAAAyAAADIAAAMgAAAyAAAAADP//+gAA2CIroAAPYACqAAD1AAqgAB"
  "8wAKoAA/EACqAATwAAqgAI0AAKoADJAACqAV9SIiuyX//////V4AAAAH1eAAAAB9EwAAAAEs///3ySIiHIAAAMgAAAySIiDP//8c"
  "gAAAyAAADIAAAMkiIhz///gvgAD2AB+AjxAPYAnhAegA9gL2AAbyD2CtAAANkPYvQAAAj///4AAAH3L3P3AACdAPYH8QA/QA9gDZ"
  "AMsAD2AF818wAPYADMAH78QAj3SvILYAH2AAAA9AABOtAAC/9AAAAW9gAAAJwdQACrC+Y39QGe/VDIAACPXIAAL/XIAAu/XIAE8/"
  "XIANkPXIB/EPXIH3APXIrQAPXK9AAPXPoAAPXPIAAPUAEAAAAAmC4gAAG9YAAAAAAADIAACPXIAAL/XIAAu/XIAE8/XIANkPXIB/"
  "EPXIH3APXIrQAPXK9AAPXPoAAPXPIAAPXIAAL4yAAMwMgAfyDIAvYAySywAM//QADIC9AAyAHpAMgAX0DIAArhyAAB6wAf///0AD"
  "9CI/QATwAB9ABfAAH0AG4AAfQAjQAB9ACcAAH0AKoAAfQA2AAB9BX0AAH0X4AAAfTPQAAAr2z6AAAf9svwAAXubH9QALnmx6sAH0"
  "5sdPEG4ObHDnDIDmxwnC8g5scD98AObHAN9wDmxwB/EA5sgAAC88gAAC88gAAC88gAAC88kiIk88////88gAAC88gAAC88gAAC88"
  "gAAC88gAAC8wAI38YAAN5kj4AH4QAF8w5wAADJH0AAAJsvIAAAfR9AAACbDnAAAMkH4QAE8wHeZI+AABnfxgDP////PJIiJPPIAA"
  "AvPIAAAvPIAAAvPIAAAvPIAAAvPIAAAvPIAAAvPIAAAvPIAAAvPP/+kQySNeoMgABfHIAALyyAAF8ckiXqDP/+kQyAAAAMgAAADI"
  "AAAAyAAAAAAJ39YAAd5kj4AH4QAF8g5wAABzH0AAAAAvIAAAAB9AAAAADnAAAHMH4QAF8gHeZH+QABnf1gBf////YSJPUiEAAvMA"
  "AAAvMAAAAvMAAAAvMAAAAvMAAAAvMAAAAvMAAAAvMAAAAvMAB/EAAvQfYACOAKwADoAD8wTyAAyQnAAAbg9gAAD48QAACPoAAAA/"
  "MAABOsAAAE/SAAAAAA5wAAAAWPxyAAHPv8z3AK0Q5wXzD1AOcAyS8gDnAJsfMA5wCqDZAOcB9gT6TpbsAAPP/+kQAAAOcAAAAABT"
  "AAAvcAANoAfyAH8QANsC9gAAP0uwAAAI7yAAAAL7AAAAC89AAABvKeEAAfgB6QAK0ABfMF8wAAvQyAAAfgyAAAfgyAAAfgyAAAfg"
  "yAAAfgyAAAfgyAAAfgyAAAfgyAAAfgySIijiz////+AAAABuAAAABuAAAAAT9gAAyfYAAMn2AADJ5gAAyckAAMl/c0r5CO/q2QAA"
  "AMkAAADJAAAAyQAAAMnIAA9QAvPIAA9QAvPIAA9QAvPIAA9QAvPIAA9QAvPIAA9QAvPIAA9QAvPIAA9QAvPIAA9QAvPJIi9yJPPP"
  "//////PIAA9QAvMMgAD1AC8wyAAPUALzDIAA9QAvMMgAD1AC8wyAAPUALzDIAA9QAvMMgAD1AC8wyAAPUALzDJIi9yJPQM//////"
  "/zAAAAAAAfMAAAAAAB8wAAAAAAAxX//gAAABEY4AAAAAB+AAAAAAfgAAAAAH///VAAB+IjnzAAfgAAyQAH4AAKsAB+AADZAAfiI5"
  "8wAH///UDIAAAAPyyAAAAD8sgAAAA/LIAAAAPyySIQAD8s///UA/LIABnxPyyAAA9T8sgAAfQ/LJIjvhPyz//7ID8sgAAADIAAAA"
  "yAAAAMgAAADJIhAAz//9QMgAGfHIAAD1yAAB9MkiO+HP//sgAEz+oQAF+UXOIA6AAAywGRAABPEAACIj9AAC///2AAAAAPQYEAAD"
  "8g6AAAywBflFzyAATP6iAMgABM/qEAyABfpWziDIAfgAAMoMgG8QAATxyRrAAAAfPP/6AAAA9cgJwAAAHzyAbwAABPHIAfcAAMoM"
  "gAb5Vc4gyAAEz+oQABnv/8CuUyrB9QAIwvIACMD0AAjAvlIqwAr//8ALwAjAT0AIwMsACMXzAAjAO++gDrRegBAAnAFZv8HthYxf"
  "AAnE9RX8CP/IwAAQAAAAACAAbf/iBvdDAA1QAAAvTfwwP9Q64V9AAPZPAADIPwAAyB9AAfUI5DvgAI77IP//ww9SO9D0AasP//0g"
  "9BGeD0AC8vUinx///mD//99iIvUAD1AA9QAPUAD1AA9QAADf//IAD2JPIADzAfIAHyAfIAPwAfIAfQAfIC6CI/Qc////9cgAAA9c"
  "gAAA9SIAAAMQCe+yAKxDrhLyAB9E////c/EREQH1AAUQjlOvIAjvxAP2APQC9wT0D0HZAAby9bsAAAv//xAAA/X26AAA2Q9E8wCe"
  "EPQJ0E9AD0AekF39MB9hngAACMAAP+IAABngEgAvM/Yp8Qbv1Q9QBfP1Ae8/UJzz9T8/P11x8/zQHz/zAfP5AB8wEAEADGPwACzV"
  "AAAAAA9QBfP1Ae8/UJzz9T8/P11x8/zQHz/zAfP5AB8/UAnh9QT0D1HpAPa9AA//kAD1T1APUH8w9QCeED///wTyJvBfAE8F4ATw"
  "bQBPCLAE8tcAT+sQBP/yAAb7/oAAzr+eAD+b9fUJub9ZsPWb9T9OCb9QzYCb9QbyCb9QAfP1AB8/UAHz9iI/P///8/UAHz9QAfP1"
  "AB8wCO+yAJ5TrhH0AA508AAKlPAACqH0AA5wnkOuEAjvsg////L3Ik8vUAHy9QAfL1AB8vUAHy9QAfL1AB8vXP1A/nOPP5AAuvYA"
  "B99gAH35AAuv5ijz9r/VD1AAAPUAAAowAAAAjvwwCeU74R9AAWFPAAAATwAAAB9AAXEJ5DvhAI78MO///2In4iEAbgAABuAAAG4A"
  "AAbgAABuAAAG4AB+AAH1LzAG8AyQC5AG4B8wAfRuAACpuAAAXvIAAA7AAAAOYAACfxAADtUAAAAA1wAAAA1wAAAA1wAACO/9QAnl"
  "2X8x9A1wq08A1wbk8A1wbh9A1wqwnk2H8wCO/9QAAA1wAAAA1wAAAAYwAC9QCsAH4U8gAMjXAAA/0AAAT9AAAebIAAnQPzBPMAnQ"
  "9QAfIPUAHyD1AB8g9QAfIPUAHyD1AB8g9iI/QP////IAAAHyAAAB8gAAADD1AE/1AE/mAE+8IW8t//8AEU8AAE8AAE/1AOYA1/UA"
  "5gDX9QDmANf1AOYA1/UA5gDX9QDmANf2Iuci1//////39QDmANcPUA5gDXD1AOYA1w9QDmANcPUA5gDXD1AOYA1w9iLnItgf////"
  "//cAAAAADXAAAAAA1wAAAAACHv+AAAAAyAAAAAySIAAAz//2AAyAGPIAyAAfQAySOfEAz//UD1AAAPP1AAAPP2IgAPP//+QPP1Aa"
  "8PP1AE8fP2I70PP//8MPP1AAAPUAAA9iIAD//+QPUBrw9QBPH2I70P//wwA8/oAB+TXoAUAAbwAG//8wASJPErEAfgHrNfYAPP1w"
  "D0AF39YA9AT3NfcPQLkABuD//2AAPx9R1wAE8PQJwACcD0Avk39A9ABM/VAAXf/7L3IZtfAAmx9hCbBf//sD8wmw2gCbbxAJsAgh"
  "gQAeUuMAAAAAAAnvsgCsQ64S8gAfRP///3PxEREB9QAFEI5TryAI78QP////IiIiL/////////IiIiIiIiIg8E4IsLgG8JsLcMIA"
  "8HhODGix9LhOFvDomx87c/DCWgC7LzDXXwDyegLAlgAFQADP+gP//xL//wBv5QiQCJAHm7AKwArAr8EACZAAAABdG3AD4QAAAAeg"
  "iQDVAAAAAF0scIsAAAAAAJ6hLyAAAAAAAAAMYAAAAAAAAAbAK9UCzVAAAeMLk/G4TgAAuADUDj4w8gBdAAty8cYvAB5AAD73BO5g"
  "D1LxPgNwD1D2LxDyPgLwNwKAAAZQBvIE9AL2AAuwAB2QAC5ycQALwAAdoAAvcAbyBPQC9gAAA8/pEAP6RtUA2gABAC8wAACP///y"
  "AH4AAACP//8wAC8wAAAA2gAAAAP6RtQAA8/pEA7//pEADoI16gAOYABvAA5gAF8ADmAD2wj///+yAS+CIQABLoIQAAj//6AAAA5g"
  "AAAADmAAAAywAA5gr+QM9AAOZvOfDPwADmmwLyyvUA5poC8siNAOZuOPDIH2DmCv5QyAbg5gAAAMgA1uZv//DIAE72AAAAyAAL9g"
  "AAAMgAA/YAAABMtOEuBVDYjQVQqpsEQHQ3AACEAAAAAJ4gAAAAniAAAACcEAAAAG/v////kLoiIiIhALwQAAAAAL0QAAAAAKUAAA"
  "AAClAAAACf9AAACNuPMAB/LGbzBfQMYI4RQAxgBQAADGAAAAAMYAAAAAxgAAAADGAAAAAMYAAAAAAaEAAAAAC9EAAAAACtEAAAAA"
  "CNFP////77EiIiIm4gAAAAjiAAAACeIAAAABwgAAAAxgAAAADGAAAAAMYAAAAAxgAAAADGAAAUAMYAUF8wxgjxB/LGbzAAjbj0AA"
  "AJ/0AAAAClAAAjMzMp///9PucBsbpfquBzArxAGrQBga2fd/CkBe9gAAC3ASIvQX///7AAxQASTyIX///7AfIAADgAAAAAABAAFr"
  "0Fr9g5/kAAFb/HIAAWzgAAABn///4SIiIhAAAAnXIAAnz8YQACv9Fr/XGdggABAAAAn///4SIiIr//////i4IiIiK4twAAAAqLcA"
  "AAAKi3AAAACotwAAAAqLcAAAAKi3AAAACotwAAAAqLgiIiIri//////4YAAAD+YAAP/+YA///9L//6IP+iAAogAAAAAAAATAAAAA"
  "BPcAEAAE9wBOIAT3AACeJPcAAACf9wAAAACXAAAA"
  ;
static const Glyph FN_SMALL_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 4, 0},
  {0x0021, 2, 11, 1, -11, 4, 0},
  {0x0022, 5, 4, 1, -11, 7, 22},
  {0x0023, 9, 11, 0, -11, 9, 42},
  {0x0024, 9, 15, 0, -13, 9, 141},
  {0x0025, 12, 11, 1, -11, 14, 276},
  {0x0026, 9, 11, 0, -11, 9, 408},
  {0x0027, 2, 4, 1, -11, 4, 507},
  {0x0028, 4, 13, 1, -11, 5, 515},
  {0x0029, 4, 13, 0, -11, 5, 567},
  {0x002A, 7, 6, 0, -11, 7, 619},
  {0x002B, 7, 7, 1, -7, 9, 661},
  {0x002C, 3, 4, 0, -1, 4, 710},
  {0x002D, 6, 2, 0, -5, 6, 722},
  {0x002E, 2, 2, 1, -2, 4, 734},
  {0x002F, 5, 13, 0, -11, 5, 738},
  {0x0030, 8, 11, 0, -11, 9, 803},
  {0x0031, 5, 11, 0, -11, 6, 891},
  {0x0032, 7, 11, 1, -11, 9, 946},
  {0x0033, 8, 11, 0, -11, 9, 1023},
  {0x0034, 9, 11, 0, -11, 9, 1111},
  {0x0035, 7, 11, 1, -11, 9, 1210},
  {0x0036, 8, 11, 0, -11, 9, 1287},
  {0x0037, 8, 11, 0, -11, 8, 1375},
  {0x0038, 8, 11, 0, -11, 9, 1463},
  {0x0039, 8, 11, 0, -11, 9, 1551},
  {0x003A, 2, 8, 1, -8, 4, 1639},
  {0x003B, 4, 10, 0, -7, 4, 1655},
  {0x003C, 7, 8, 1, -8, 9, 1695},
  {0x003D, 7, 4, 1, -6, 9, 1751},
  {0x003E, 8, 8, 1, -8, 9, 1779},
  {0x003F, 7, 11, 0, -11, 7, 1843},
  {0x0040, 13, 13, 0, -10, 14, 1920},
  {0x0041, 10, 11, 0, -11, 10, 2089},
  {0x0042, 8, 11, 1, -11, 9, 2199},
  {0x0043, 10, 11, 0, -11, 10, 2287},
  {0x0044, 9, 11, 1, -11, 10, 2397},
  {0x0045, 7, 11, 1, -11, 8, 2496},
  {0x0046, 7, 11, 1, -11, 8, 2573},
  {0x0047, 10, 11, 0, -11, 10, 2650},
  {0x0048, 9, 11, 1, -11, 10, 2760},
  {0x0049, 2, 11, 1, -11, 4, 2859},
  {0x004A, 7, 11, 0, -11, 8, 2881},
  {0x004B, 8, 11, 1, -11, 9, 2958},
  {0x004C, 7, 11, 1, -11, 8, 3046},
  {0x004D, 11, 11, 1, -11, 13, 3123},
  {0x004E, 9, 11, 1, -11, 11, 3244},
  {0x004F, 10, 11, 0, -11, 11, 3343},
  {0x0050, 8, 11, 1, -11, 9, 3453},
  {0x0051, 10, 12, 0, -11, 11, 3541},
  {0x0052, 8, 11, 1, -11, 9, 3661},
  {0x0053, 9, 12, 0, -11, 9, 3749},
  {0x0054, 9, 11, 0, -11, 9, 3857},
  {0x0055, 9, 11, 1, -11, 10, 3956},
  {0x0056, 10, 11, 0, -11, 10, 4055},
  {0x0057, 14, 11, 0, -11, 14, 4165},
  {0x0058, 10, 11, 0, -11, 10, 4319},
  {0x0059, 10, 11, 0, -11, 10, 4429},
  {0x005A, 8, 11, 0, -11, 9, 4539},
  {0x005B, 4, 13, 1, -11, 5, 4627},
  {0x005C, 5, 13, 0, -11, 5, 4679},
  {0x005D, 4, 13, 0, -11, 5, 4744},
  {0x005E, 6, 5, 0, -10, 7, 4796},
  {0x005F, 7, 2, 0, 0, 6, 4826},
  {0x0060, 3, 3, 1, -11, 5, 4840},
  {0x0061, 7, 9, 0, -8, 8, 4849},
  {0x0062, 7, 11, 1, -11, 9, 4912},
  {0x0063, 8, 8, 0, -8, 8, 4989},
  {0x0064, 8, 11, 0, -11, 9, 5053},
  {0x0065, 8, 8, 0, -8, 8, 5141},
  {0x0066, 5, 11, 0, -11, 5, 5205},
  {0x0067, 8, 11, 0, -8, 9, 5260},
  {0x0068, 7, 11, 1, -11, 8, 5348},
  {0x0069, 3, 11, 0, -11, 3, 5425},
  {0x006A, 4, 14, -1, -11, 3, 5458},
  {0x006B, 7, 11, 1, -11, 8, 5514},
  {0x006C, 2, 11, 1, -11, 3, 5591},
  {0x006D, 11, 8, 1, -8, 12, 5613},
  {0x006E, 7, 8, 1, -8, 8, 5701},
  {0x006F, 8, 8, 0, -8, 8, 5757},
  {0x0070, 7, 11, 1, -8, 9, 5821},
  {0x0071, 8, 11, 0, -8, 9, 5898},
  {0x0072, 4, 8, 1, -8, 5, 5986},
  {0x0073, 7, 8, 0, -8, 7, 6018},
  {0x0074, 5, 10, 0, -10, 5, 6074},
  {0x0075, 7, 8, 1, -8, 8, 6124},
  {0x0076, 8, 8, 0, -8, 8, 6180},
  {0x0077, 11, 8, 0, -8, 11, 6244},
  {0x0078, 8, 8, 0, -8, 8, 6332},
  {0x0079, 8, 11, 0, -8, 8, 6396},
  {0x007A, 7, 8, 0, -8, 8, 6484},
  {0x007B, 6, 13, 0, -11, 6, 6540},
  {0x007C, 2, 17, 1, -14, 5, 6618},
  {0x007D, 5, 13, 0, -11, 6, 6652},
  {0x007E, 8, 4, 1, -6, 9, 6717},
  {0x00A7, 7, 14, 0, -11, 8, 6749},
  {0x00A9, 11, 11, 1, -11, 13, 6847},
  {0x00AB, 8, 7, 0, -8, 8, 6968},
  {0x00AE, 9, 8, 0, -11, 9, 7024},
  {0x00B0, 6, 5, 0, -11, 6, 7096},
  {0x00B1, 7, 8, 1, -8, 9, 7126},
  {0x00B2, 6, 6, 0, -12, 6, 7182},
  {0x00B3, 6, 6, 0, -12, 6, 7218},
  {0x00B6, 8, 11, 0, -11, 8, 7254},
  {0x00B7, 2, 2, 1, -6, 4, 7342},
  {0x00BB, 8, 7, 0, -8, 8, 7346},
  {0x00BC, 11, 11, 0, -11, 11, 7402},
  {0x00BD, 12, 11, 0, -11, 12, 7523},
  {0x00BE, 12, 11, 0, -11, 12, 7655},
  {0x00D7, 7, 7, 1, -7, 9, 7787},
  {0x00F7, 7, 8, 1, -8, 9, 7836},
  {0x0401, 7, 14, 1, -14, 8, 7892},
  {0x0410, 10, 11, 0, -11, 10, 7990},
  {0x0411, 8, 11, 1, -11, 9, 8100},
  {0x0412, 8, 11, 1, -11, 9, 8188},
  {0x0413, 7, 11, 1, -11, 8, 8276},
  {0x0414, 11, 14, 0, -11, 11, 8353},
  {0x0415, 7, 11, 1, -11, 8, 8507},
  {0x0416, 13, 11, 0, -11, 13, 8584},
  {0x0417, 8, 11, 0, -11, 9, 8727},
  {0x0418, 9, 11, 1, -11, 11, 8815},
  {0x0419, 9, 15, 1, -15, 11, 8914},
  {0x041A, 8, 11, 1, -11, 9, 9049},
  {0x041B, 10, 11, 0, -11, 10, 9137},
  {0x041C, 11, 11, 1, -11, 13, 9247},
  {0x041D, 9, 11, 1, -11, 10, 9368},
  {0x041E, 10, 11, 0, -11, 11, 9467},
  {0x041F, 9, 11, 1, -11, 10, 9577},
  {0x0420, 8, 11, 1, -11, 9, 9676},
  {0x0421, 10, 11, 0, -11, 10, 9764},
  {0x0422, 9, 11, 0, -11, 9, 9874},
  {0x0423, 9, 11, 0, -11, 9, 9973},
  {0x0424, 11, 12, 0, -11, 12, 10072},
  {0x0425, 10, 11, 0, -11, 10, 10204},
  {0x0426, 9, 14, 1, -11, 10, 10314},
  {0x0427, 8, 11, 1, -11, 10, 10440},
  {0x0428, 12, 11, 1, -11, 13, 10528},
  {0x0429, 13, 14, 1, -11, 14, 10660},
  {0x042A, 11, 11, 0, -11, 11, 10842},
  {0x042B, 11, 11, 1, -11, 12, 10963},
  {0x042C, 8, 11, 1, -11, 9, 11084},
  {0x042D, 10, 11, 0, -11, 10, 11172},
  {0x042E, 13, 11, 1, -11, 14, 11282},
  {0x042F, 8, 11, 0, -11, 9, 11425},
  {0x0430, 7, 9, 0, -8, 8, 11513},
  {0x0431, 8, 12, 0, -12, 8, 11576},
  {0x0432, 7, 8, 1, -8, 8, 11672},
  {0x0433, 5, 8, 1, -8, 6, 11728},
  {0x0434, 9, 11, 0, -8, 9, 11768},
  {0x0435, 8, 8, 0, -8, 8, 11867},
  {0x0436, 11, 8, 0, -8, 11, 11931},
  {0x0437, 7, 8, 0, -8, 7, 12019},
  {0x0438, 7, 8, 1, -8, 8, 12075},
  {0x0439, 7, 12, 1, -12, 8, 12131},
  {0x043A, 7, 8, 1, -8, 8, 12215},
  {0x043B, 7, 8, 0, -8, 8, 12271},
  {0x043C, 9, 8, 1, -8, 11, 12327},
  {0x043D, 7, 8, 1, -8, 8, 12399},
  {0x043E, 8, 8, 0, -8, 8, 12455},
  {0x043F, 7, 8, 1, -8, 8, 12519},
  {0x0440, 7, 11, 1, -8, 9, 12575},
  {0x0441, 8, 8, 0, -8, 8, 12652},
  {0x0442, 7, 8, 0, -8, 7, 12716},
  {0x0443, 8, 11, 0, -8, 8, 12772},
  {0x0444, 9, 14, 0, -11, 10, 12860},
  {0x0445, 8, 8, 0, -8, 8, 12986},
  {0x0446, 8, 11, 1, -8, 8, 13050},
  {0x0447, 6, 8, 1, -8, 8, 13138},
  {0x0448, 10, 8, 1, -8, 12, 13186},
  {0x0449, 11, 11, 1, -8, 12, 13266},
  {0x044A, 9, 8, 0, -8, 9, 13387},
  {0x044B, 9, 8, 1, -8, 10, 13459},
  {0x044C, 7, 8, 1, -8, 8, 13531},
  {0x044D, 8, 8, 0, -8, 8, 13587},
  {0x044E, 11, 8, 1, -8, 12, 13651},
  {0x044F, 7, 8, 0, -8, 8, 13739},
  {0x0451, 8, 11, 0, -11, 8, 13795},
  {0x2013, 7, 2, 0, -5, 7, 13883},
  {0x2014, 14, 2, 0, -5, 14, 13897},
  {0x2018, 3, 4, 1, -11, 4, 13925},
  {0x2019, 3, 4, 1, -11, 4, 13937},
  {0x201C, 5, 4, 1, -11, 6, 13949},
  {0x201D, 5, 4, 1, -11, 6, 13969},
  {0x201E, 6, 4, 0, -1, 6, 13989},
  {0x2022, 6, 5, 1, -7, 8, 14013},
  {0x2026, 10, 2, 1, -2, 12, 14043},
  {0x2030, 17, 11, 1, -11, 19, 14063},
  {0x2032, 3, 4, 0, -11, 3, 14250},
  {0x2033, 6, 4, 0, -11, 6, 14262},
  {0x2039, 5, 7, 0, -8, 5, 14286},
  {0x203A, 5, 7, 0, -8, 5, 14321},
  {0x20AC, 9, 11, 0, -11, 9, 14356},
  {0x20BD, 10, 11, 0, -11, 10, 14455},
  {0x2116, 14, 11, 1, -11, 15, 14565},
  {0x2122, 8, 4, 0, -11, 9, 14719},
  {0x2190, 11, 9, 1, -9, 13, 14751},
  {0x2191, 10, 11, 1, -11, 12, 14850},
  {0x2192, 11, 9, 1, -9, 13, 14960},
  {0x2193, 10, 11, 1, -11, 12, 15059},
  {0x2212, 7, 2, 1, -5, 9, 15169},
  {0x2248, 8, 6, 1, -7, 9, 15183},
  {0x2260, 7, 8, 1, -8, 9, 15231},
  {0x2264, 7, 9, 1, -9, 9, 15287},
  {0x2265, 7, 9, 1, -9, 9, 15350},
  {0x25A1, 11, 11, 1, -11, 13, 15413},
  {0x25B8, 7, 7, 0, -7, 7, 15534},
  {0x2713, 11, 7, 1, -8, 12, 15583},
};
AAFont FN_SMALL_F = { nullptr, FN_SMALL_F_GLYPHS, 207, 14, 4, FN_SMALL_F_B64, 7830 };

// FN_TINY_F: 12px, 207 глифов, 6172 байт
static const char FN_TINY_F_B64[] PROGMEM =
  "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"
  "QAG/UJ9Rz1AAv99QAAC/UAAAADAAAA=="
  ;
static const Glyph FN_TINY_F_GLYPHS[] PROGMEM = {
  {0x0020, 0, 0, 0, 0, 3, 0},
  {0x0021, 2, 9, 1, -9, 4, 0},
  {0x0022, 5, 4, 1, -9, 6, 18},
  {0x0023, 8, 9, 0, -9, 8, 38},
  {0x0024, 8, 13, 0, -11, 8, 110},
  {0x0025, 10, 9, 1, -9, 12, 214},
  {0x0026, 8, 9, 0, -9, 8, 304},
  {0x0027, 2, 4, 1, -9, 4, 376},
  {0x0028, 3, 11, 1, -9, 4, 384},
  {0x0029, 4, 11, 0, -9, 4, 417},
  {0x002A, 6, 5, 0, -9, 6, 461},
  {0x002B, 6, 7, 1, -7, 8, 491},
  {0x002C, 3, 4, 0, -2, 4, 533},
  {0x002D, 5, 2, 0, -5, 6, 545},
  {0x002E, 2, 2, 1, -2, 4, 555},
  {0x002F, 5, 11, 0, -9, 5, 559},
  {0x0030, 8, 9, 0, -9, 8, 614},
  {0x0031, 5, 9, 0, -9, 5, 686},
  {0x0032, 7, 9, 0, -9, 7, 731},
  {0x0033, 7, 9, 0, -9, 8, 794},
  {0x0034, 8, 9, 0, -9, 8, 857},
  {0x0035, 7, 9, 0, -9, 8, 929},
  {0x0036, 8, 9, 0, -9, 8, 992},
  {0x0037, 7, 9, 0, -9, 7, 1064},
  {0x0038, 8, 9, 0, -9, 8, 1127},
  {0x0039, 8, 9, 0, -9, 8, 1199},
  {0x003A, 2, 7, 1, -7, 4, 1271},
  {0x003B, 3, 9, 0, -7, 4, 1285},
  {0x003C, 7, 7, 0, -7, 8, 1312},
  {0x003D, 6, 5, 1, -6, 8, 1361},
  {0x003E, 7, 7, 1, -7, 8, 1391},
  {0x003F, 6, 9, 0, -9, 7, 1440},
  {0x0040, 12, 12, 0, -9, 12, 1494},
  {0x0041, 9, 9, 0, -9, 9, 1638},
  {0x0042, 8, 9, 0, -9, 8, 1719},
  {0x0043, 9, 9, 0, -9, 9, 1791},
  {0x0044, 9, 9, 0, -9, 9, 1872},
  {0x0045, 7, 9, 0, -9, 7, 1953},
  {0x0046, 7, 9, 0, -9, 7, 2016},
  {0x0047, 9, 9, 0, -9, 9, 2079},
  {0x0048, 9, 9, 0, -9, 9, 2160},
  {0x0049, 3, 9, 0, -9, 3, 2241},
  {0x004A, 7, 9, 0, -9, 7, 2268},
  {0x004B, 9, 9, 0, -9, 8, 2331},
  {0x004C, 7, 9, 0, -9, 7, 2412},
  {0x004D, 11, 9, 0, -9, 11, 2475},
  {0x004E, 9, 9, 0, -9, 9, 2574},
  {0x004F, 9, 9, 0, -9, 9, 2655},
  {0x0050, 8, 9, 0, -9, 8, 2736},
  {0x0051, 9, 10, 0, -9, 9, 2808},
  {0x0052, 8, 9, 0, -9, 8, 2898},
  {0x0053, 8, 9, 0, -9, 8, 2970},
  {0x0054, 8, 9, 0, -9, 8, 3042},
  {0x0055, 8, 9, 0, -9, 9, 3114},
  {0x0056, 9, 9, 0, -9, 9, 3186},
  {0x0057, 12, 9, 0, -9, 12, 3267},
  {0x0058, 9, 9, 0, -9, 9, 3375},
  {0x0059, 9, 9, 0, -9, 9, 3456},
  {0x005A, 8, 9, 0, -9, 8, 3537},
  {0x005B, 3, 12, 1, -10, 4, 3609},
  {0x005C, 5, 11, 0, -9, 5, 3645},
  {0x005D, 4, 12, 0, -10, 4, 3700},
  {0x005E, 6, 5, 0, -9, 6, 3748},
  {0x005F, 6, 2, 0, 0, 6, 3778},
  {0x0060, 4, 2, 0, -9, 4, 3790},
  {0x0061, 7, 7, 0, -7, 7, 3798},
  {0x0062, 7, 9, 0, -9, 7, 3847},
  {0x0063, 7, 7, 0, -7, 7, 3910},
  {0x0064, 7, 9, 0, -9, 7, 3959},
  {0x0065, 7, 7, 0, -7, 7, 4022},
  {0x0066, 5, 10, 0, -10, 5, 4071},
  {0x0067, 7, 10, 0, -7, 8, 4121},
  {0x0068, 7, 9, 0, -9, 7, 4191},
  {0x0069, 3, 10, 0, -10, 3, 4254},
  {0x006A, 4, 13, -1, -10, 3, 4284},
  {0x006B, 7, 9, 0, -9, 7, 4336},
  {0x006C, 3, 9, 0, -9, 3, 4399},
  {0x006D, 10, 7, 0, -7, 11, 4426},
  {0x006E, 7, 7, 0, -7, 7, 4496},
  {0x006F, 7, 7, 0, -7, 7, 4545},
  {0x0070, 7, 10, 0, -7, 7, 4594},
  {0x0071, 7, 10, 0, -7, 7, 4664},
  {0x0072, 5, 7, 0, -7, 5, 4734},
  {0x0073, 7, 7, 0, -7, 7, 4769},
  {0x0074, 4, 9, 0, -9, 4, 4818},
  {0x0075, 7, 7, 0, -7, 7, 4854},
  {0x0076, 7, 7, 0, -7, 7, 4903},
  {0x0077, 10, 7, 0, -7, 10, 4952},
  {0x0078, 7, 7, 0, -7, 7, 5022},
  {0x0079, 7, 10, 0, -7, 7, 5071},
  {0x007A, 7, 7, 0, -7, 7, 5141},
  {0x007B, 5, 12, 0, -10, 5, 5190},
  {0x007C, 2, 15, 1, -12, 4, 5250},
  {0x007D, 5, 12, 0, -10, 5, 5280},
  {0x007E, 8, 3, 0, -5, 8, 5340},
  {0x00A7, 7, 11, 0, -9, 7, 5364},
  {0x00A9, 9, 9, 1, -9, 11, 5441},
  {0x00AB, 8, 6, 0, -7, 8, 5522},
  {0x00AE, 8, 7, 0, -9, 8, 5570},
  {0x00B0, 5, 5, 0, -9, 6, 5626},
  {0x00B1, 6, 7, 1, -7, 8, 5651},
  {0x00B2, 5, 5, 0, -10, 5, 5693},
  {0x00B3, 5, 6, 0, -11, 6, 5718},
  {0x00B6, 7, 9, 0, -9, 7, 5748},
  {0x00B7, 2, 2, 1, -5, 4, 5811},
  {0x00BB, 8, 6, 0, -7, 8, 5815},
  {0x00BC, 10, 9, 0, -9, 10, 5863},
  {0x00BD, 10, 9, 0, -9, 10, 5953},
  {0x00BE, 11, 9, 0, -9, 11, 6043},
  {0x00D7, 6, 6, 1, -6, 8, 6142},
  {0x00F7, 6, 7, 1, -7, 8, 6178},
  {0x0401, 7, 12, 0, -12, 7, 6220},
  {0x0410, 9, 9, 0, -9, 9, 6304},
  {0x0411, 8, 9, 0, -9, 8, 6385},
  {0x0412, 8, 9, 0, -9, 8, 6457},
  {0x0413, 7, 9, 0, -9, 7, 6529},
  {0x0414, 10, 11, 0, -9, 10, 6592},
  {0x0415, 7, 9, 0, -9, 7, 6702},
  {0x0416, 12, 9, 0, -9, 12, 6765},
  {0x0417, 7, 9, 0, -9, 8, 6873},
  {0x0418, 9, 9, 0, -9, 9, 6936},
  {0x0419, 9, 12, 0, -12, 9, 7017},
  {0x041A, 9, 9, 0, -9, 8, 7125},
  {0x041B, 9, 9, 0, -9, 9, 7206},
  {0x041C, 11, 9, 0, -9, 11, 7287},
  {0x041D, 9, 9, 0, -9, 9, 7386},
  {0x041E, 9, 9, 0, -9, 9, 7467},
  {0x041F, 9, 9, 0, -9, 9, 7548},
  {0x0420, 8, 9, 0, -9, 8, 7629},
  {0x0421, 9, 9, 0, -9, 9, 7701},
  {0x0422, 8, 9, 0, -9, 8, 7782},
  {0x0423, 8, 9, 0, -9, 8, 7854},
  {0x0424, 10, 10, 0, -9, 10, 7926},
  {0x0425, 9, 9, 0, -9, 9, 8026},
  {0x0426, 9, 11, 0, -9, 9, 8107},
  {0x0427, 8, 9, 0, -9, 8, 8206},
  {0x0428, 11, 9, 0, -9, 12, 8278},
  {0x0429, 12, 11, 0, -9, 12, 8377},
  {0x042A, 10, 9, 0, -9, 10, 8509},
  {0x042B, 10, 9, 0, -9, 11, 8599},
  {0x042C, 8, 9, 0, -9, 8, 8689},
  {0x042D, 9, 9, 0, -9, 9, 8761},
  {0x042E, 12, 9, 0, -9, 12, 8842},
  {0x042F, 7, 9, 0, -9, 8, 8950},
  {0x0430, 7, 7, 0, -7, 7, 9013},
  {0x0431, 7, 10, 0, -10, 7, 9062},
  {0x0432, 7, 7, 0, -7, 7, 9132},
  {0x0433, 6, 7, 0, -7, 5, 9181},
  {0x0434, 8, 9, 0, -7, 8, 9223},
  {0x0435, 7, 7, 0, -7, 7, 9295},
  {0x0436, 10, 7, 0, -7, 10, 9344},
  {0x0437, 6, 7, 0, -7, 6, 9414},
  {0x0438, 7, 7, 0, -7, 7, 9456},
  {0x0439, 7, 10, 0, -10, 7, 9505},
  {0x043A, 7, 7, 0, -7, 7, 9575},
  {0x043B, 7, 7, 0, -7, 7, 9624},
  {0x043C, 9, 7, 0, -7, 10, 9673},
  {0x043D, 7, 7, 0, -7, 7, 9736},
  {0x043E, 7, 7, 0, -7, 7, 9785},
  {0x043F, 7, 7, 0, -7, 7, 9834},
  {0x0440, 7, 10, 0, -7, 7, 9883},
  {0x0441, 7, 7, 0, -7, 7, 9953},
  {0x0442, 6, 7, 0, -7, 6, 10002},
  {0x0443, 7, 10, 0, -7, 7, 10044},
  {0x0444, 9, 12, 0, -9, 9, 10114},
  {0x0445, 7, 7, 0, -7, 7, 10222},
  {0x0446, 8, 9, 0, -7, 8, 10271},
  {0x0447, 7, 7, 0, -7, 7, 10343},
  {0x0448, 10, 7, 0, -7, 10, 10392},
  {0x0449, 11, 9, 0, -7, 10, 10462},
  {0x044A, 8, 7, 0, -7, 8, 10561},
  {0x044B, 9, 7, 0, -7, 9, 10617},
  {0x044C, 7, 7, 0, -7, 7, 10680},
  {0x044D, 7, 7, 0, -7, 7, 10729},
  {0x044E, 10, 7, 0, -7, 10, 10778},
  {0x044F, 7, 7, 0, -7, 7, 10848},
  {0x0451, 7, 10, 0, -10, 7, 10897},
  {0x2013, 6, 2, 0, -5, 6, 10967},
  {0x2014, 12, 2, 0, -5, 12, 10979},
  {0x2018, 3, 4, 1, -9, 4, 11003},
  {0x2019, 3, 4, 0, -9, 4, 11015},
  {0x201C, 5, 4, 1, -9, 6, 11027},
  {0x201D, 6, 4, 0, -9, 6, 11047},
  {0x201E, 6, 4, 0, -2, 6, 11071},
  {0x2022, 4, 4, 1, -5, 6, 11095},
  {0x2026, 10, 2, 1, -2, 11, 11111},
  {0x2030, 15, 9, 1, -9, 16, 11131},
  {0x2032, 3, 4, 0, -9, 3, 11266},
  {0x2033, 6, 4, 0, -9, 6, 11278},
  {0x2039, 5, 6, 0, -7, 5, 11302},
  {0x203A, 5, 6, 0, -7, 5, 11332},
  {0x20AC, 8, 9, 0, -9, 8, 11362},
  {0x20BD, 9, 9, 0, -9, 9, 11434},
  {0x2116, 13, 9, 0, -9, 13, 11515},
  {0x2122, 7, 3, 0, -9, 8, 11632},
  {0x2190, 9, 9, 1, -8, 11, 11653},
  {0x2191, 9, 9, 1, -9, 11, 11734},
  {0x2192, 10, 9, 1, -8, 11, 11815},
  {0x2193, 9, 9, 1, -9, 11, 11905},
  {0x2212, 6, 2, 1, -4, 8, 11986},
  {0x2248, 8, 5, 0, -6, 8, 11998},
  {0x2260, 6, 7, 1, -7, 8, 12038},
  {0x2264, 6, 7, 1, -7, 8, 12080},
  {0x2265, 6, 7, 1, -7, 8, 12122},
  {0x25A1, 9, 9, 1, -9, 11, 12164},
  {0x25B8, 6, 6, 0, -6, 6, 12245},
  {0x2713, 9, 7, 1, -7, 11, 12281},
};
AAFont FN_TINY_F = { nullptr, FN_TINY_F_GLYPHS, 207, 12, 3, FN_TINY_F_B64, 6172 };

AAFont* FONTS[FN_COUNT] = { &FN_HUGE_F, &FN_BIG_F, &FN_MID_F, &FN_TITLE_F, &FN_SEMI_F, &FN_SMALL_F, &FN_TINY_F };

// ===================== Состояние =====================
Surface sStrip;
uint16_t* bgPx = nullptr;           // фон 320×480
uint32_t count = 0;                 // всего нажатий (сохраняется)
uint32_t session = 0;               // с момента включения
float bestRate = 0;                 // рекорд: нажатий в секунду (сохраняется)
uint32_t pressT[24];                // время последних нажатий
int pressN = 0;
bool btnDown = false;               // кнопка вдавлена
uint32_t rippleT = 0;               // начало волны от нажатия
uint32_t holdT = 0;                 // начало удержания «Сбросить»
uint32_t hintT = 0;                 // подсказка про сброс
uint32_t flashT = 0;                // вспышка числа на круглых значениях
uint32_t partsT = 0;                // салют
std::vector<Particle> parts;
uint32_t saveAt = 0;                // когда записать в память
bool dirtyAll = true, dirtyNum = false, dirtyBtn = false, dirtyRow = false;

// ===================== Платформа =====================
void pushPixels(int x, int y, int w, int h, const uint16_t* px);
uint32_t nowMs();
void saveState();

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



// ===================== Рисование =====================
static inline uint16_t blendA(uint16_t bg, uint16_t fg, int a) {  // a: 0…255
  uint32_t rb = bg & 0xF81F;
  rb += (((fg & 0xF81F) - rb) * (uint32_t)(a >> 2)) >> 6;
  uint32_t g = bg & 0x07E0;
  g += (((fg & 0x07E0) - g) * (uint32_t)a) >> 8;
  return (uint16_t)((rb & 0xF81F) | (g & 0x07E0));
}

// Скруглённый прямоугольник: заливка с градиентом цвета и прозрачности сверху вниз, рамка 1 px
void rrectX(Surface& s, float x, float y, float w, float h, float r, uint16_t c0, uint16_t c1, int a0, int a1, uint16_t bc, int ba) {
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
    if (grad) {
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
void rr(Surface& s, float x, float y, float w, float h, float r, uint16_t c, int a) { rrectX(s, x, y, w, h, r, c, c, a, a, 0, 0); }
void glass(Surface& s, float x, float y, float w, float h, float r, int a) { rrectX(s, x, y, w, h, r, C_WHITE, C_WHITE, a, a, C_WHITE, std::min(255, a + 34)); }
void ring(Surface& s, float cx, float cy, float r, uint16_t c, int a) { rrectX(s, cx - r, cy - r, 2 * r, 2 * r, r, c, c, 0, 0, c, a); }
void disc(Surface& s, float cx, float cy, float r, uint16_t c, int a) { rr(s, cx - r, cy - r, 2 * r, 2 * r, r, c, a); }

// Залитый многоугольник со сглаживанием (4×4 выборки)
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

int capBase(const AAFont& f, float y, float h) { return (int)(y + (h + f.asc * 0.74f) * 0.5f + 0.5f); }
void drawCentered(Surface& s, const AAFont& f, int cx, int base, const std::string& t, uint16_t c) {
  drawText(s, f, cx - textW(f, t.c_str()) / 2, base, t.c_str(), c);
}

// Число с цифрами одинаковой ширины (чтобы не прыгало при смене цифр)
int digitCell(const AAFont& f) {
  int m = 0;
  for (char ch = '0'; ch <= '9'; ch++) { char b[2] = { ch, 0 }; m = std::max(m, textW(f, b)); }
  return m;
}
int numberW(const AAFont& f, const std::string& num) {
  int cell = digitCell(f), w = 0;
  for (char ch : num) w += ch == ' ' ? cell / 4 : cell;
  return w;
}
void drawNumber(Surface& s, const AAFont& f, int cx, int base, const std::string& num, uint16_t c) {
  int cell = digitCell(f), gap = cell / 4;
  int w = numberW(f, num);
  int x = cx - w / 2;
  for (char ch : num) {
    if (ch == ' ') { x += gap; continue; }
    char b[2] = { ch, 0 };
    drawText(s, f, x + (cell - textW(f, b)) / 2, base, b, c);
    x += cell;
  }
}

// «12 345» — разряды через пробел
std::string groupDigits(uint32_t n) {
  std::string d = std::to_string(n), r;
  for (size_t i = 0; i < d.size(); i++) {
    if (i && (d.size() - i) % 3 == 0) r += ' ';
    r += d[i];
  }
  return r;
}
const char* pluralPress(uint32_t n) {
  uint32_t m10 = n % 10, m100 = n % 100;
  if (m10 == 1 && m100 != 11) return "нажатие";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "нажатия";
  return "нажатий";
}
std::string fmtRate(float r) {
  char b[16];
  snprintf(b, sizeof b, "%.1f", r);
  std::string s = b;
  size_t dot = s.find('.');
  if (dot != std::string::npos) s[dot] = ',';
  return s;
}

// Фон: мягкие пятна цвета с плавными переходами (без полос благодаря дизерингу)
static const uint8_t BAYER4[16] = { 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };
static inline uint16_t rgbDither(float r, float g, float b, int x, int y) {
  float d = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5f) / 16.0f;
  int R = (int)(r * (31.0f / 255) + d), G = (int)(g * (63.0f / 255) + d), B = (int)(b * (31.0f / 255) + d);
  R = R < 0 ? 0 : R > 31 ? 31 : R;
  G = G < 0 ? 0 : G > 63 ? 63 : G;
  B = B < 0 ? 0 : B > 31 ? 31 : B;
  return (uint16_t)((R << 11) | (G << 5) | B);
}
bool makeBackdrop() {
  bgPx = (uint16_t*)malloc(SCREEN_W * SCREEN_H * 2);
  if (!bgPx) return false;
  const int GX = 4, GY = 6;
  static const uint8_t P[GY][GX][3] = {
    { { 22, 26, 52 }, { 40, 34, 78 }, { 34, 30, 70 }, { 18, 22, 46 } },
    { { 30, 52, 96 }, { 64, 52, 128 }, { 52, 44, 110 }, { 26, 36, 74 } },
    { { 24, 70, 110 }, { 70, 66, 150 }, { 96, 54, 140 }, { 40, 40, 96 } },
    { { 20, 56, 92 }, { 60, 50, 132 }, { 110, 52, 120 }, { 46, 34, 88 } },
    { { 16, 30, 60 }, { 36, 32, 84 }, { 62, 34, 82 }, { 28, 26, 62 } },
    { { 10, 12, 26 }, { 18, 18, 38 }, { 26, 20, 42 }, { 14, 14, 30 } },
  };
  for (int y = 0; y < SCREEN_H; y++) {
    float gyf = (y + 0.5f) * GY / SCREEN_H - 0.5f;
    int iy = std::max(0, std::min(GY - 2, (int)floorf(gyf)));
    float ty = clamp01(gyf - iy);
    ty = ty * ty * (3 - 2 * ty);
    for (int x = 0; x < SCREEN_W; x++) {
      float gxf = (x + 0.5f) * GX / SCREEN_W - 0.5f;
      int ix = std::max(0, std::min(GX - 2, (int)floorf(gxf)));
      float tx = clamp01(gxf - ix);
      tx = tx * tx * (3 - 2 * tx);
      float c[3];
      for (int k = 0; k < 3; k++) {
        float top = P[iy][ix][k] + (P[iy][ix + 1][k] - P[iy][ix][k]) * tx;
        float bot = P[iy + 1][ix][k] + (P[iy + 1][ix + 1][k] - P[iy + 1][ix][k]) * tx;
        c[k] = top + (bot - top) * ty;
      }
      bgPx[y * SCREEN_W + x] = rgbDither(c[0], c[1], c[2], x, y);
    }
  }
  return true;
}

// ===================== Логика =====================
float rateNow() {  // нажатий за последнюю секунду
  uint32_t t = nowMs();
  int n = 0;
  for (int i = 0; i < pressN; i++) if (t - pressT[i] <= 1000) n++;
  return (float)n;
}

void launchSalute(int big) {
  static const uint16_t COLS[6] = { MK565(255, 200, 80), MK565(255, 110, 150), MK565(110, 210, 255), MK565(140, 255, 160), MK565(200, 150, 255), MK565(255, 255, 255) };
  parts.clear();
  int n = big ? 90 : 56;
  for (int i = 0; i < n; i++) {
    float a = (rand() % 1000) / 1000.0f * 6.2832f, v = 3 + (rand() % 1000) / 1000.0f * (big ? 9 : 7);
    Particle p;
    p.x = BTN_X; p.y = CARD_Y + CARD_H / 2;
    p.vx = cosf(a) * v; p.vy = sinf(a) * v - 4;
    p.c = COLS[i % 6];
    parts.push_back(p);
  }
  partsT = nowMs();
}

void addPress() {
  uint32_t t = nowMs();
  count++;
  session++;
  if (pressN < 24) pressT[pressN++] = t;
  else { memmove(pressT, pressT + 1, sizeof(uint32_t) * 23); pressT[23] = t; }
  float r = rateNow();
  if (r > bestRate) bestRate = r;
  rippleT = t;
  saveAt = t + 1500;  // в память — когда нажатия стихнут
  if (count % 100 == 0) { flashT = t; launchSalute(count % 1000 == 0); }
  dirtyNum = dirtyBtn = dirtyRow = true;
}

void resetCount() {
  count = 0;
  session = 0;
  pressN = 0;
  saveAt = nowMs();
  dirtyAll = true;
}

// ===================== Экран =====================
void drawHeader(Surface& s, int o) {
  drawCentered(s, *FONTS[FN_TITLE], SCREEN_W / 2, o + 48, "Счётчик нажатий", C_WHITE);
  bool hint = hintT && nowMs() - hintT < 2500;
  drawCentered(s, *FONTS[FN_SMALL], SCREEN_W / 2, o + 72, hint ? "Чтобы сбросить, удерживайте 2 секунды" : "Число сохранится и после выключения", hint ? C_GOLD : C_TXT2);
}

void drawCard(Surface& s, int o) {
  uint32_t t = nowMs();
  float fl = flashT && t - flashT < 900 ? 1 - (t - flashT) / 900.0f : 0;
  glass(s, 16, o + CARD_Y, 288, CARD_H, 28, 26);
  if (fl > 0) rrectX(s, 16, o + CARD_Y, 288, CARD_H, 28, C_GOLD, C_GOLD, (int)(40 * fl), (int)(40 * fl), C_GOLD, (int)(255 * fl));
  std::string num = groupDigits(count);
  int fi = numberW(*FONTS[FN_HUGE], num) <= 264 ? FN_HUGE : numberW(*FONTS[FN_BIG], num) <= 268 ? FN_BIG : FN_MID;  // крупнее, пока помещается
  const AAFont& f = *FONTS[fi];
  int base = o + CARD_Y + (fi == FN_HUGE ? 102 : fi == FN_BIG ? 88 : 78);
  drawNumber(s, f, SCREEN_W / 2, base, num, fl > 0 ? mix565(C_WHITE, C_GOLD, (int)(255 * fl)) : C_WHITE);
  drawCentered(s, *FONTS[FN_SEMI], SCREEN_W / 2, o + CARD_Y + CARD_H - 14, pluralPress(count), C_TXT2);
}

void drawButton(Surface& s, int o) {
  uint32_t t = nowMs();
  float cy = o + BTN_Y;
  float r = btnDown ? BTN_R - 5 : BTN_R;
  // свечение
  disc(s, BTN_X, cy, BTN_R + 22, C_GLOW, btnDown ? 34 : 18);
  disc(s, BTN_X, cy, BTN_R + 11, C_GLOW, btnDown ? 46 : 26);
  // волна от нажатия
  if (rippleT && t - rippleT < 450) {
    float k = (t - rippleT) / 450.0f;
    ring(s, BTN_X, cy, BTN_R + 4 + 30 * k, C_WHITE, (int)(200 * (1 - k)));
    ring(s, BTN_X, cy, BTN_R + 5 + 30 * k, C_WHITE, (int)(120 * (1 - k)));
  }
  // сама кнопка
  uint16_t c0 = btnDown ? mix565(C_BTN0, C_BLACK, 50) : C_BTN0, c1 = btnDown ? mix565(C_BTN1, C_BLACK, 50) : C_BTN1;
  rrectX(s, BTN_X - r, cy - r, 2 * r, 2 * r, r, c0, c1, 255, 255, C_WHITE, 90);
  // блик сверху
  rrectX(s, BTN_X - r * 0.72f, cy - r * 0.9f, r * 1.44f, r * 0.9f, r * 0.45f, C_WHITE, C_WHITE, btnDown ? 26 : 50, 0, 0, 0);
  const AAFont& tf = *FONTS[FN_TITLE];
  drawCentered(s, tf, BTN_X, capBase(tf, cy - 20, 40) - (btnDown ? 0 : 1), "НАЖМИ", C_WHITE);
  drawCentered(s, *FONTS[FN_TINY], BTN_X, (int)cy + 30, "+1", mix565(C_WHITE, c1, 90));
}

void drawRow(Surface& s, int o) {
  const AAFont& tiny = *FONTS[FN_TINY];
  int y = o + ROW_Y;
  glass(s, 16, y, 188, ROW_H, ROW_H / 2, 22);
  // молния
  float zx[] = { 34, 28, 33, 31, 38, 33 }, zy[] = { (float)y + 7, (float)y + 17, (float)y + 17, (float)y + 25, (float)y + 14, (float)y + 14 };
  polyS(s, zx, zy, 6, C_GOLD);
  std::string t = fmtRate(rateNow()) + "/с · рекорд " + fmtRate(bestRate) + "/с";
  drawText(s, tiny, 46, capBase(tiny, y, ROW_H), t.c_str(), C_TXT2);
  // сброс (удерживать)
  float k = holdT ? clamp01((nowMs() - holdT) / (float)HOLD_MS) : 0;
  glass(s, RESET_X, y, RESET_W, ROW_H, ROW_H / 2, holdT ? 36 : 22);
  if (k > 0) rrectX(s, RESET_X, y, std::max((float)ROW_H, RESET_W * k), ROW_H, ROW_H / 2, C_RED, C_RED, 150, 150, 0, 0);
  drawCentered(s, tiny, RESET_X + RESET_W / 2, capBase(tiny, y, ROW_H), holdT ? "Держите…" : "Сбросить", holdT ? C_WHITE : C_TXT2);
}

void drawSalute(Surface& s, int top) {
  if (parts.empty()) return;
  for (auto& p : parts) {
    float y = p.y - top;
    if (y < -8 || y > s.h + 8) continue;
    capsuleS(s, p.x, y, p.x - p.vx * 0.9f, y - p.vy * 0.9f, 2.2f, p.c);
  }
}

void drawStrip(Surface& s, int top) {
  int o = -top;
  if (top < CARD_Y) drawHeader(s, o);
  if (top + s.h > CARD_Y && top < CARD_Y + CARD_H) drawCard(s, o);
  if (top + s.h > BTN_Y - BTN_R - 40 && top < BTN_Y + BTN_R + 40) drawButton(s, o);
  if (top + s.h > ROW_Y) drawRow(s, o);
  drawSalute(s, top);
}

void renderRegion(int y0, int y1) {
  for (int y = std::max(0, y0); y < std::min(SCREEN_H, y1); y += STRIP_H) {
    int h = std::min(STRIP_H, SCREEN_H - y);
    surfSize(sStrip, SCREEN_W, h);
    memcpy(sStrip.px, bgPx + y * SCREEN_W, (size_t)SCREEN_W * h * 2);
    drawStrip(sStrip, y);
    pushPixels(0, y, SCREEN_W, h, sStrip.px);
  }
}
// Полосы выровнены по STRIP_H, чтобы соседние области совпадали
void renderRows(int y0, int y1) { renderRegion(y0 / STRIP_H * STRIP_H, y1); }

void stepSalute() {
  for (auto& p : parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.45f; p.vx *= 0.985f; }
  parts.erase(std::remove_if(parts.begin(), parts.end(), [](const Particle& p) { return p.y > SCREEN_H + 20; }), parts.end());
  if (nowMs() - partsT > 2500) parts.clear();
}

// Один шаг интерфейса: перерисовывает то, что изменилось или анимируется
void uiFrame() {
  uint32_t t = nowMs();
  bool anim = !parts.empty();
  if (anim) stepSalute();
  if (dirtyAll || anim || !parts.empty() || (flashT && t - flashT < 1000)) {
    renderRegion(0, SCREEN_H);
    if (flashT && t - flashT >= 1000) flashT = 0;
    dirtyAll = dirtyNum = dirtyBtn = dirtyRow = false;
    return;
  }
  bool ripple = rippleT && t - rippleT < 520;
  if (!ripple && rippleT) { rippleT = 0; dirtyBtn = true; }
  if (dirtyNum) renderRows(CARD_Y, CARD_Y + CARD_H);
  if (dirtyBtn || ripple) renderRows(BTN_Y - BTN_R - 36, BTN_Y + BTN_R + 36);
  static uint32_t lastRow = 0;
  if (dirtyRow || holdT || t - lastRow > 400) { renderRows(ROW_Y, SCREEN_H); lastRow = t; }
  static bool hintShown = false;
  bool hint = hintT && t - hintT < 2500;
  if (hint != hintShown) { hintShown = hint; renderRows(0, CARD_Y); }
  dirtyNum = dirtyBtn = dirtyRow = false;
}

bool uiInit() {
  for (int i = 0; i < FN_COUNT; i++) if (!decodeFont(*FONTS[i])) return false;
  if (!surfAlloc(sStrip, SCREEN_W, STRIP_H)) return false;
  return makeBackdrop();
}

// Касание: x, y; down — палец на экране
bool inButton(int x, int y) { float dx = x - BTN_X, dy = y - BTN_Y; return dx * dx + dy * dy <= (BTN_R + 14) * (BTN_R + 14); }
bool inReset(int x, int y) { return x >= RESET_X - 6 && x < RESET_X + RESET_W + 6 && y >= ROW_Y - 8; }

bool wasDown = false;
int16_t downX, downY;
void onTouch(bool down, int x, int y) {
  uint32_t t = nowMs();
  if (down && !wasDown) {  // палец коснулся
    downX = x; downY = y;
    if (inButton(x, y)) { btnDown = true; addPress(); }
    else if (inReset(x, y)) { holdT = t; dirtyRow = true; }
  } else if (down && holdT) {
    if (!inReset(x, y)) { holdT = 0; dirtyRow = true; }
    else if (t - holdT >= HOLD_MS) { holdT = 0; resetCount(); }
  } else if (!down && wasDown) {  // палец убран
    if (btnDown) { btnDown = false; dirtyBtn = true; }
    if (holdT) { holdT = 0; hintT = t; dirtyRow = true; }
  }
  wasDown = down;
}

// ===================== Железо =====================
#ifndef HOST_SIM
#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_BL 25
#define PIN_BOOT 0
#define TCA9554_ADDR 0x20
#define FT6336_ADDR 0x38

Arduino_DataBus* bus = new Arduino_HWSPI(27 /* DC */, 5 /* CS */, 18 /* SCK */, 23 /* MOSI */, 19 /* MISO */, &SPI, true);
Arduino_GFX* gfx = new Arduino_ST7796(bus, GFX_NOT_DEFINED, 0, true);
Preferences prefs;

uint32_t nowMs() { return millis(); }
void pushPixels(int x, int y, int w, int h, const uint16_t* px) { gfx->draw16bitRGBBitmap(x, y, (uint16_t*)px, w, h); }

void tcaWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void initExpander() {
  tcaWrite(0x01, 0xFF);
  tcaWrite(0x03, 0b11111000);   // P0 — сброс LCD, P1 — сброс тача, P2 — усилитель
  tcaWrite(0x01, 0b11111000);
  delay(10);
  tcaWrite(0x01, 0b11111011);   // отпускаем сброс, усилитель выключен
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

void saveState() {
  prefs.begin("counter", false);
  prefs.putUInt("n", count);
  prefs.putFloat("best", bestRate);
  prefs.end();
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
  srand(esp_random());
  prefs.begin("counter", true);
  count = prefs.getUInt("n", 0);
  bestRate = prefs.getFloat("best", 0);
  prefs.end();
  renderRegion(0, SCREEN_H);
  dirtyAll = false;
}

void loop() {
  static int lastBoot = 1;
  int boot = digitalRead(PIN_BOOT);
  if (lastBoot && !boot) { btnDown = true; addPress(); }
  if (!lastBoot && boot) { btnDown = false; dirtyBtn = true; }
  lastBoot = boot;

  TouchPt t;
  bool down = readTouch(t);
  static int miss = 0;  // тач иногда пропускает опрос — отпускание засчитываем со второго раза
  if (down) miss = 0;
  if (down || ++miss >= 2) onTouch(down, t.x, t.y);

  if (saveAt && millis() >= saveAt) { saveAt = 0; saveState(); }
  uiFrame();
  delay(8);
}
#endif
