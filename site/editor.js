/* Редактор-загрузчик для страниц сайта.
   1. Берёт сохранённую версию содержимого #page из localStorage и подставляет её.
   2. Сохраняет любые изменения #page (в том числе сделанные через DevTools → Elements).
   3. Alt (нажать и отпустить) открывает меню: на главную, сбросить правки.
   Правки хранятся только в этом браузере на этом устройстве. */
(function () {
  'use strict';

  var PAGE_ID = 'page';
  var KEY = 'site-edits:' + location.pathname;
  var HOME = new URL('./index.html', document.currentScript.src).href;

  var page = document.getElementById(PAGE_ID);
  if (!page) {
    console.warn('editor.js: нет элемента #' + PAGE_ID);
    return;
  }

  // 1. Восстановление правок
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* localStorage недоступен */ }
  if (saved !== null) page.innerHTML = saved;

  // 2. Сохранение правок
  var observing = true;
  var observer = new MutationObserver(function () {
    if (!observing) return;
    try { localStorage.setItem(KEY, page.innerHTML); }
    catch (e) { console.warn('editor.js: не удалось сохранить правки', e); }
  });
  observer.observe(page, { subtree: true, childList: true, attributes: true, characterData: true });

  // 3. Меню по Alt
  var style = document.createElement('style');
  style.textContent =
    '#editor-menu{position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,.45);z-index:2147483647;font:16px system-ui,sans-serif}' +
    '#editor-menu.open{display:flex}' +
    '#editor-menu .box{background:#fff;color:#1d1d1b;border-radius:12px;padding:20px;min-width:260px;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.3)}' +
    '#editor-menu h2{font-size:1.1rem;margin:0 0 12px}' +
    '#editor-menu button{display:block;width:100%;margin:8px 0;padding:10px 12px;border-radius:8px;' +
    'border:1px solid #d6d3ca;background:#f5f4f0;color:#1d1d1b;font:inherit;text-align:left;cursor:pointer}' +
    '#editor-menu button:hover{border-color:#2d6a4f}' +
    '#editor-menu button.danger{color:#a4262c}' +
    '@media (prefers-color-scheme:dark){#editor-menu .box{background:#1f1f1c;color:#ecebe6}' +
    '#editor-menu button{background:#2a2a26;color:#ecebe6;border-color:#4a4944}}';
  document.head.appendChild(style);

  var menu = document.createElement('div');
  menu.id = 'editor-menu';
  menu.innerHTML =
    '<div class="box" role="dialog" aria-label="Меню">' +
    '<h2>Меню</h2>' +
    '<button type="button" data-act="home">← К выбору сайтов</button>' +
    '<button type="button" data-act="reset" class="danger">Сбросить правки этой страницы</button>' +
    '<button type="button" data-act="close">Закрыть (Esc)</button>' +
    '</div>';
  document.body.appendChild(menu);

  function openMenu() { menu.classList.add('open'); }
  function closeMenu() { menu.classList.remove('open'); }
  function toggleMenu() { menu.classList.contains('open') ? closeMenu() : openMenu(); }

  menu.addEventListener('click', function (e) {
    if (e.target === menu) return closeMenu();
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (act === 'home') location.href = HOME;
    if (act === 'reset') {
      if (!confirm('Сбросить все правки этой страницы?')) return;
      try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
      location.reload();
    }
    if (act === 'close') closeMenu();
  });

  // Alt считается, только если между нажатием и отпусканием не нажата другая клавиша
  var altAlone = false;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Alt') {
      e.preventDefault();
      if (!e.repeat) altAlone = true;
      return;
    }
    altAlone = false;
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'Alt' && altAlone) {
      altAlone = false;
      toggleMenu();
    }
  });
  window.addEventListener('blur', function () { altAlone = false; });
})();
