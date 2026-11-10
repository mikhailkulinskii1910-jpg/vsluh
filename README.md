# Вслух

Чтение русского текста с фото вслух. Веб-приложение: откройте в Safari на iPhone → «Поделиться» → «На экран „Домой“».

## krisa — пульт IRBIS (`irbis/`)

Веб-пульт для IRBIS #500202 (интерактивная панель, коды NEC из базы IrCode Finder). Открыть: `…/irbis/`.
Браузер не умеет работать со встроенным ИК-портом телефона, поэтому сигнал идёт либо через ИК-излучатель в разъёме наушников (два ИК-светодиода встречно-параллельно, громкость на максимум), либо на Wi-Fi модуль ESP с Tasmota.

### Android-приложение (`android/`)

Тот же пульт как приложение: работает со встроенным ИК-портом телефона (Xiaomi, Redmi, POCO…) и с USB-C ИК-передатчиком (VID 045E/10C4, PID 8468). Готовый APK: `irbis/irbis-remote.apk`. Сборка: `cd android && ./gradlew assembleRelease`.

### iOS (`ios/`)

SwiftUI-версия krisa. У iPhone нет ИК-порта, поэтому сигнал идёт через звуковой ИК-адаптер (разъём наушников / USB-C) или Wi-Fi модуль с Tasmota. Проект описан в `ios/project.yml` (XcodeGen); GitHub Actions (`.github/workflows/ios.yml`) собирает неподписанный `krisa.ipa` (копия: `irbis/krisa.ipa`) — его можно поставить через Sideloadly/AltStore со своим Apple ID, или собрать на Mac: `brew install xcodegen && cd ios && xcodegen && open Krisa.xcodeproj`.

### krisa гид (`irbis/guide/`)

Отдельное веб-приложение с инструкцией: скачать APK/IPA, установка на Android (в том числе при плашке Play Защиты) и на iPhone (Sideloadly/AltStore), только для досок IRBIS (не MocTec), где ИК-порты у телефона и доски, расстояние 1–5 м и прямая видимость. Тот же гид открывается кнопкой `[?]` в веб-версии, Android (копируется Gradle в assets) и iOS (папка в бандле).

## Велокарта (`velo/`)

Веб-приложение для велосипедиста: карта России, маршруты по велодорогам, записанные поездки и лобби с гонками и погонями (2 м / 2 с). Сервер лобби — Node.js в `velo/server/`. Подробности, запуск и ограничения: `velo/README.md`.

## ESP32 Web Flasher (`esp32-flasher/`)

Прошивка ESP32 из браузера по USB (Web Serial, на Android — WebUSB для CH340): выбор .bin, автоопределение адресов, карта флеш-памяти, монитор порта. Настроен под Waveshare ESP32-Touch-LCD-3.5. Готовые прошивки и их исходники Arduino — в `esp32-flasher/firmware/` (медиаплеер MP3/WAV/AVI с выводом звука в Bluetooth-наушники — исходник в `firmware/mediaplayer/`, для сборки нужны библиотеки GFX Library for Arduino, JPEGDEC и ESP32-A2DP, «Школьный набор» — калькулятор, игры на двоих, справочник, настройки, экран телефона и управление телефоном с платы (в приложении: «Плата по Wi-Fi» → «Управление телефоном») (папка `firmware/school/`: скетч и движок HTML-страниц, нужны библиотеки GFX Library for Arduino, JPEGDEC и PNGdec), счётчик нажатий (`firmware/counter_ws35.ino`), просмотр HTML с SD-карты, калькулятор с дробями, фрактал Мандельброта); список для кнопок «Готовые прошивки» — `firmware/index.json`. Приложение для Android: `esp32-flasher/ESP32-Flasher.apk` (исходники в `esp32-flasher/android/`), прошивает через OTG-переходник платы с любым популярным USB-чипом, а во вкладке «Файлы на карте» по Wi-Fi управляет SD-картой платы с прошивкой «Медиаплеер» или «HTML с SD-карты»: загрузка, удаление, папки, просмотр страниц с JavaScript. Вкладка «Конвертер видео» (в браузере и в приложении) переводит MP4/MOV/WEBM в AVI с кадрами JPEG и звуком PCM, который играет медиаплеер, а в приложении сразу отправляет файл на карту по Wi-Fi. То же на компьютере: `ffmpeg -i video.mp4 -vf "scale=320:-2,fps=15" -c:v mjpeg -q:v 6 -pix_fmt yuvj420p -c:a pcm_s16le -ar 22050 -ac 1 -audio_preload 500000 video.avi`. Пример содержимого SD-карты для просмотрщика HTML — `esp32-flasher/sd-example/` (или архивом `sd-example.zip`): распакуйте в корень карты. Открыть: https://mikhailkulinskii1910-jpg.github.io/vsluh/esp32-flasher/ · скачать HTML: `esp32-flasher/esp32-flasher.html`.
