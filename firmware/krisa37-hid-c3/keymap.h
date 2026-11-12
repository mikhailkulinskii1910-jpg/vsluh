#pragma once
/* Символ → клавиша (US для латиницы, ЙЦУКЕН для кириллицы) — то же, что в прошивке для S3. */
#include "types.h"

static const uint8_t SHIFT = 0x02;

// US-раскладка для печатных ASCII 0x20..0x7E
static KeyStroke ascii(char ch) {
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
static const char RU_KEYS[] = "f,dult;pbqrkvyjghcnea[wxio]sm'.z";   // а б в г д е ж з и й к л м н о п р с т у ф х ц ч ш щ ъ ы ь э ю я

static KeyStroke cyrillic(uint32_t cp) {
  if (cp == 0x0451) return {0, 0x35};          // ё
  if (cp == 0x0401) return {SHIFT, 0x35};      // Ё
  bool upper = cp >= 0x0410 && cp <= 0x042F;
  uint32_t lo = upper ? cp + 0x20 : cp;
  if (lo < 0x0430 || lo > 0x044F) return {0, 0};
  KeyStroke k = ascii(RU_KEYS[lo - 0x0430]);
  if (upper) k.mods |= SHIFT;
  return k;
}

