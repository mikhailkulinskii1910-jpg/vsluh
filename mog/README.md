# mog — шаблон фотопрезентаций

Полноэкранные фото без текста, переходы-шторки, стрелки, выдвижная панель миниатюр,
заметки докладчика, полноэкранный режим, подпись автора и мгновенная подмена фото с телефона.

```
pip install pillow numpy opencv-contrib-python-headless   # opencv нужен только для "enhance": true
python3 mog/build.py config.json
```

Формат `config.json` описан в начале `build.py`. Результат: `artifact.html`, `index.html`
(для GitHub Pages) и `pult.html` (пульт подмены, если задан `swap`).

Пример: презентация «Захарово» — https://mikhailkulinskii1910-jpg.github.io/vsluh/zakharovo/
