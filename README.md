# Вслух

Чтение русского текста с фото вслух. Веб-приложение: откройте в Safari на iPhone → «Поделиться» → «На экран „Домой“».

## krisa — пульт IRBIS (`irbis/`)

Веб-пульт для IRBIS #500202 (интерактивная панель, коды NEC из базы IrCode Finder). Открыть: `…/irbis/`.
Браузер не умеет работать со встроенным ИК-портом телефона, поэтому сигнал идёт либо через ИК-излучатель в разъёме наушников (два ИК-светодиода встречно-параллельно, громкость на максимум), либо на Wi-Fi модуль ESP с Tasmota.

### Android-приложение (`android/`)

Тот же пульт как приложение: работает со встроенным ИК-портом телефона (Xiaomi, Redmi, POCO…) и с USB-C ИК-передатчиком (VID 045E/10C4, PID 8468). Готовый APK: `irbis/irbis-remote.apk`. Сборка: `cd android && ./gradlew assembleRelease`.

### iOS (`ios/`)

SwiftUI-версия krisa. У iPhone нет ИК-порта, поэтому сигнал идёт через звуковой ИК-адаптер (разъём наушников / USB-C) или Wi-Fi модуль с Tasmota. Проект описан в `ios/project.yml` (XcodeGen); GitHub Actions (`.github/workflows/ios.yml`) собирает неподписанный `krisa.ipa` (копия: `irbis/krisa.ipa`) — его можно поставить через Sideloadly/AltStore со своим Apple ID, или собрать на Mac: `brew install xcodegen && cd ios && xcodegen && open Krisa.xcodeproj`.
