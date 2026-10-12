#!/bin/sh
# Установка «Гуся» для текущего пользователя (root не нужен).
#   sh install.sh             — установить и добавить в меню
#   sh install.sh --autostart — ещё и запускать при входе в систему
#   sh install.sh --remove    — удалить
set -e
APP=desktop-goose
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/$APP"
BIN="$HOME/.local/bin/$APP"
MENU="$HOME/.local/share/applications/$APP.desktop"
AUTO="$HOME/.config/autostart/$APP.desktop"

if [ "$1" = "--remove" ]; then
    "$BIN" --quit 2>/dev/null || true
    rm -rf "$DEST" "$BIN" "$MENU" "$AUTO"
    echo "Гусь удалён."
    exit 0
fi

if ! python3 -c "import PyQt5.QtWidgets" 2>/dev/null; then
    echo "Нужен PyQt5. Пробую поставить…"
    if command -v dnf >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo dnf install -y python3-qt5 || true
    elif command -v apt-get >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo apt-get install -y python3-pyqt5 || true
    fi
    python3 -c "import PyQt5.QtWidgets" 2>/dev/null || python3 -m pip install --user PyQt5 \
        || python3 -m pip install --user --break-system-packages PyQt5
fi

mkdir -p "$DEST/memes" "$(dirname "$BIN")" "$(dirname "$MENU")"
cp "$SRC/desktop_goose.py" "$DEST/"
cp "$SRC"/memes/* "$DEST/memes/" 2>/dev/null || true
python3 "$DEST/desktop_goose.py" --icon "$DEST/goose.png" 2>/dev/null || true

cat > "$BIN" <<SH
#!/bin/sh
exec python3 "$DEST/desktop_goose.py" "\$@"
SH
chmod +x "$BIN"

cat > "$MENU" <<DESK
[Desktop Entry]
Type=Application
Name=Гусь
Name[en]=Desktop Goose
Comment=Настольный гусь: гуляет, гогочет, таскает заметки
Exec=$BIN
Icon=$DEST/goose.png
Terminal=false
Categories=Game;AmusementGame;
DESK

if [ "$1" = "--autostart" ]; then
    mkdir -p "$(dirname "$AUTO")"
    cp "$MENU" "$AUTO"
    echo "X-GNOME-Autostart-Delay=10" >> "$AUTO"
    echo "Гусь будет выходить при каждом входе в систему."
fi

echo "Готово. Запуск: меню → «Гусь» или команда $APP"
echo "Прогнать гуся: правая кнопка по гусю → «Прогнать гуся», или $APP --quit"
