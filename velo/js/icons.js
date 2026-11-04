/* Иконки в стиле line art (тонкая обводка, currentColor). Вместо эмодзи по всему приложению. */
(function (root) {
  const P = {
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/>',
    tracks: '<path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/><path d="M3 21h18"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.6.2 4.5 2 5 4.9"/>',
    rec: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="1.8"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4 2.5 4H5"/>',
    battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M22 10.5v3"/><path d="M6.5 10v4M10 10v4M13.5 10v4" />',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>',
    speed: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    mountain: '<path d="M2 20 9 7l4 6 2.5-3L22 20z"/><path d="M7 13.5l1.5 1.5"/>',
    satellite: '<rect x="9" y="9" width="6" height="6" rx="1" transform="rotate(45 12 12)"/><path d="M4 20l4-4M16 8l4-4M4 4l3 3M17 17l3 3M5.5 14.5 9.5 10.5M14.5 13.5l4-4"/><path d="M3 8.5 8.5 3M15.5 21 21 15.5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
    turnLeft: '<path d="M9 19v-6a4 4 0 0 0-4-4H4"/><path d="m7.5 6.5-3.5 3.5 3.5 3.5"/>',
    turnRight: '<path d="M15 19v-6a4 4 0 0 1 4-4h1"/><path d="m16.5 6.5 3.5 3.5-3.5 3.5"/>',
    straight: '<path d="M12 21V4"/><path d="m6 10 6-6 6 6"/>',
    slightLeft: '<path d="M14 20 9 4"/><path d="m5 8 4-4 1 5"/>',
    slightRight: '<path d="M10 20 15 4"/><path d="m19 8-4-4-1 5"/>',
    uturn: '<path d="M8 20V9a4 4 0 0 1 8 0v3"/><path d="m12.5 9.5 3.5 3.5 3.5-3.5"/>',
    nav: '<path d="M12 2.5 19.5 20 12 16l-7.5 4z"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    clear: '<path d="M4 4l16 16M20 4 4 20"/>',
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
    run: '<circle cx="14" cy="4.5" r="2"/><path d="m9 21 2.5-6 3 2v4M7 9.5l3-2 2.5 3 3 .5M10.5 13.5 7 18"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3 3 0 0 0 7 10.5M17 6h3v1.5a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cloudOff: '<path d="M4 4l16 16"/><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 1 8.9"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.2l2.1 1.2M17.4 15.6l2.1 1.2M4.5 16.8l2.1-1.2M17.4 8.4l2.1-1.2"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7s-.6-1.4-.6-2.4.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4C21 6.2 17 3 12 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  };

  /** SVG-строка иконки. size — px; cls — доп. класс. */
  function icon(name, size = 20, cls = '') {
    const body = P[name] || P.pin;
    return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
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
