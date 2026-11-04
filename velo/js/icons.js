/* Минимальный набор иконок (line art). Всё остальное — текстом. */
(function (root) {
  const P = {
    arrow: '<path d="M12 2.5 19.5 20 12 16l-7.5 4z"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="1.8"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4 2.5 4H5"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    mountain: '<path d="M2 20 9 7l4 6 2.5-3L22 20z"/><path d="M7 13.5l1.5 1.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    straight: '<path d="M12 21V4"/><path d="m6 10 6-6 6 6"/>',
    turnLeft: '<path d="M9 19v-6a4 4 0 0 0-4-4H4"/><path d="m7.5 6.5-3.5 3.5 3.5 3.5"/>',
    turnRight: '<path d="M15 19v-6a4 4 0 0 1 4-4h1"/><path d="m16.5 6.5 3.5 3.5-3.5 3.5"/>',
    slightLeft: '<path d="M14 20 9 4"/><path d="m5 8 4-4 1 5"/>',
    slightRight: '<path d="M10 20 15 4"/><path d="m19 8-4-4-1 5"/>',
    uturn: '<path d="M8 20V9a4 4 0 0 1 8 0v3"/><path d="m12.5 9.5 3.5 3.5 3.5-3.5"/>',
  };

  /** SVG-строка иконки. Заливка и обводка — currentColor. */
  function icon(name, size = 20, cls = '') {
    const body = P[name] || P.arrow;
    return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /** Подставляет иконки в элементы с атрибутом data-icon="name". */
  function hydrate(root2 = document) {
    root2.querySelectorAll('[data-icon]').forEach(el => {
      if (el.dataset.iconDone) return;
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, +el.dataset.size || 20));
      el.dataset.iconDone = '1';
    });
  }

  root.VeloIcons = { icon, hydrate, names: Object.keys(P) };
})(window);
