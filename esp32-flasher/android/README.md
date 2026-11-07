# ESP32 Flasher для Android

Приложение показывает тот же веб-прошивальщик (`../index.html`, esptool-js) в WebView,
а с платой общается через нативный USB-драйвер [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android)
(MIT, исходники в `src/com/hoho/android/usbserial`). Поддерживаются CH340/CH341, CH343/CH9102, CP210x, FTDI и CDC.

Мост: JS-обёртка в `index.html` изображает Web Serial API (`navigator.serial`) поверх объекта
`AndroidSerial` из `MainActivity.java` (open / baud / write / signals / close, данные платы — в `__androidSerial.onData`).

Сборка без Gradle — `build.sh` (aapt2 → javac → dx → zipalign → apksigner). Перед сборкой положите в `assets/`
файл `index.html` и папку `firmware/` из каталога выше.
