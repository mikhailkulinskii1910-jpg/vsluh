#pragma once
#include <stdint.h>

/* Типы вынесены в заголовок: Arduino вставляет прототипы функций в начало скетча, раньше объявлений в .ino. */
enum AuthState { AUTH_NEED, AUTH_OK, AUTH_DENIED };
struct KeyStroke { uint8_t mods, key; };
struct Packet { uint8_t len; uint8_t data[24]; };
