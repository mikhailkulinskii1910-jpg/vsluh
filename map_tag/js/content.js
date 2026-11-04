// Бонусы, шаги обучения, список изменений
import { getLang } from './i18n.js';

const L = (o) => o[getLang()] ?? o.ru;

export const POWERUPS = [
  { id: 'revealBoost', icon: 'revealBoost', cls: 'h', side: 'hunter',
    n: { ru: 'Ускоритель раскрытия', en: 'Reveal boost' },
    d: { ru: 'Снимает половину полной перезарядки «Раскрытия» с оставшегося ожидания.', en: 'Takes half of the full Reveal cooldown off the remaining wait.' } },
  { id: 'freezeBoost', icon: 'freezeBoost', cls: 'h', side: 'hunter',
    n: { ru: 'Ускоритель заморозки', en: 'Freeze boost' },
    d: { ru: 'Снимает половину полной перезарядки «Заморозки» с оставшегося ожидания.', en: 'Takes half of the full Freeze cooldown off the remaining wait.' } },
  { id: 'ghost', icon: 'ghost', cls: 'd', side: 'hider',
    n: { ru: 'Призрак', en: 'Ghost' },
    d: { ru: '60 секунд бег не оставляет следов.', en: 'Running leaves no footprints for 60 seconds.' } },
  { id: 'ward', icon: 'shield', cls: 'd', side: 'hider',
    n: { ru: 'Оберег', en: 'Ward' },
    d: { ru: 'Один раз защищает от заморозки. Несколько оберегов складываются.', en: 'Blocks one freeze aimed at you. Several wards stack.' } },
  { id: 'sonar', icon: 'scan', cls: 'h', side: 'hunter',
    n: { ru: 'Сонар', en: 'Sonar' },
    d: { ru: 'Все прячущиеся в 80 м видны 6 секунд.', en: 'Every Hider within 80 m is visible for 6 seconds.' } },
  { id: 'lookout', icon: 'eye', cls: 'b', side: 'hider',
    n: { ru: 'Дозор', en: 'Lookout' },
    d: { ru: 'Показывает всех охотников на 20 секунд.', en: 'Shows every Hunter for 20 seconds.' } },
  { id: 'decoy', icon: 'copy', cls: 'd', side: 'hider',
    n: { ru: 'Приманка', en: 'Decoy' },
    d: { ru: 'Прокладывает ложную цепочку следов в другом месте зоны.', en: 'Lays a fake trail of footprints elsewhere in the zone.' } },
  { id: 'smoke', icon: 'cloud', cls: 'd', side: 'hider',
    n: { ru: 'Дымовая завеса', en: 'Smoke screen' },
    d: { ru: '60 секунд «Раскрытие» вас не находит.', en: 'Reveals cannot find you for 60 seconds.' } },
  { id: 'silence', icon: 'mute', cls: 'd', side: 'hider',
    n: { ru: 'Тишина', en: 'Hush' },
    d: { ru: '90 секунд «Раскрытие» проходит мимо, пока вы стоите на месте.', en: 'For 90 seconds reveals miss you while you stand still.' } },
  { id: 'jam', icon: 'jam', cls: 'd', side: 'hider',
    n: { ru: 'Помехи', en: 'Static' },
    d: { ru: 'Одно следующее «Раскрытие» проходит мимо. Несколько складываются.', en: 'The next reveal misses you. Several stack.' } },
  { id: 'misdirect', icon: 'swap', cls: 'd', side: 'hider',
    n: { ru: 'Обманка', en: 'Mislead' },
    d: { ru: 'Следующее «Раскрытие» рисует круг в 150 м от вас.', en: 'The next reveal draws its circle 150 m away from you.' } },
  { id: 'shield', icon: 'shield', cls: 'b', side: 'hider',
    n: { ru: 'Щит', en: 'Shield' },
    d: { ru: 'Спасает от одной поимки: охотник отлетает и 3 секунды не может ловить.', en: 'Blocks one catch: the Hunter bounces off and cannot catch for 3 seconds.' } },
  { id: 'stun', icon: 'bolt', cls: 'h', side: 'hider',
    n: { ru: 'Оглушение', en: 'Stun' },
    d: { ru: 'Охотники в 40 м оглушены на 8 секунд: не двигаются и не ловят.', en: 'Hunters within 40 m are stunned for 8 seconds: no moving, no catching.' } },
  { id: 'trap', icon: 'lock', cls: 'd', side: 'hider',
    n: { ru: 'Ловушка', en: 'Trap' },
    d: { ru: 'Ставит невидимую для охотников ловушку: первый, кто наступит, оглушён на 6 секунд.', en: 'Places a trap Hunters cannot see: the first to step on it is stunned for 6 seconds.' } },
  { id: 'flare', icon: 'flare', cls: 'b', side: 'both',
    n: { ru: 'Сигнальная ракета', en: 'Flare' },
    d: { ru: 'Запоминает позиции всех игроков и через 10 секунд показывает их всем.', en: 'Captures every player’s position and shows it to everyone 10 seconds later.' } },
  { id: 'scan', icon: 'scan', cls: 'b', side: 'both',
    n: { ru: 'Сканер', en: 'Scanner' },
    d: { ru: 'Считает игроков другой команды в выбранном радиусе.', en: 'Counts the other team within the radius you choose.' } },
];
export const pwName = (p) => L(p.n);
export const pwDesc = (p) => L(p.d);
export const pwById = (id) => POWERUPS.find((p) => p.id === id);

// ---------- иллюстрации обучения (своя «карта» на SVG) ----------
function base(extra = '') {
  return `<svg viewBox="0 0 360 380" xmlns="http://www.w3.org/2000/svg">
  <rect width="360" height="380" fill="#e4ebe1"/>
  <path d="M300 0h60v380h-90c10-60 40-90 20-160S290 60 300 0z" fill="#a9c4f0"/>
  <rect x="20" y="40" width="70" height="50" rx="4" fill="#d5d9d3"/><rect x="110" y="30" width="60" height="70" rx="4" fill="#d5d9d3"/>
  <rect x="30" y="250" width="80" height="60" rx="4" fill="#d5d9d3"/><rect x="190" y="270" width="60" height="70" rx="4" fill="#d5d9d3"/>
  <ellipse cx="200" cy="150" rx="60" ry="40" fill="#c8e0bc"/><ellipse cx="80" cy="170" rx="40" ry="30" fill="#c8e0bc"/>
  <path d="M0 210C80 200 140 230 200 210S290 180 320 190" stroke="#f3d27b" stroke-width="10" fill="none"/>
  <path d="M140 0c10 80-20 160 0 240s-10 100 0 140" stroke="#f3d27b" stroke-width="9" fill="none"/>
  <path d="M0 120h300M60 0v380" stroke="#fff" stroke-width="4" stroke-dasharray="2 6" fill="none" opacity=".9"/>
  ${extra}</svg>`;
}
const zone = (cx = 170, cy = 200, r = 160) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2c7a4b" stroke-width="4" stroke-dasharray="12 9"/>`;
const me = (x, y, c = '#5fd38d') => `<circle cx="${x}" cy="${y}" r="10" fill="${c}" stroke="#0d1a14" stroke-width="4"/>`;
const dia = (x, y, f = '#b9a3ff', s = '#1d1240') => `<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" transform="rotate(45 ${x} ${y})" fill="${f}" stroke="${s}" stroke-width="3"/>`;
const red = (x, y, r = 60) => `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(220,80,90,.22)" stroke="#b8323f" stroke-width="3"/>`;
const yel = (x, y, r = 55) => `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(243,193,58,.18)" stroke="#e8b52a" stroke-width="4"/>`;
const feet = (pts) => pts.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="7" transform="rotate(${a} ${x} ${y})" fill="#111"/>`).join('');
const num = (x, y, n) => `<circle cx="${x}" cy="${y}" r="16" fill="#111" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 6}" fill="#fff" font-size="17" font-weight="700" text-anchor="middle" font-family="sans-serif">${n}</text>`;
const hold = (x, y, n) => `<circle cx="${x}" cy="${y}" r="22" fill="#111" stroke="rgba(243,193,58,.6)" stroke-width="8"/><text x="${x}" y="${y + 6}" fill="#fff" font-size="16" font-weight="700" text-anchor="middle" font-family="sans-serif">${n}</text>`;
const hunterDot = (x, y) => `<circle cx="${x}" cy="${y}" r="10" fill="#f26d7d" stroke="#fff" stroke-width="3"/>`;
const banner = (txt, col = '#f26d7d') => `<rect x="12" y="12" width="336" height="44" rx="10" fill="rgba(20,20,24,.92)"/><rect x="22" y="20" width="28" height="28" rx="7" fill="${col}"/><text x="62" y="40" fill="#fff" font-size="14" font-family="sans-serif">${txt}</text>`;
const trail = feet([[232, 300, 20], [226, 285, 10], [222, 268, 15], [216, 252, 5], [214, 236, 10], [208, 220, 0]]);

export function tutorialSteps() {
  const ru = getLang() === 'ru';
  return [
    { t: ru ? 'Прятки. В реальной жизни.' : 'Hide-and-seek. For real.',
      html: ru
        ? `<p>Вы играете на улице. Телефон показывает зону, подсказки и таймеры.</p><p><b>Поймать — значит легко коснуться другого игрока, как в салках. Затем отметьте поимку в приложении.</b></p><p>Прячущиеся уходят первыми. Охотники ждут начала охоты.</p>`
        : `<p>You play outdoors. Your phone shows the zone, clues and timers.</p><p><b>A catch is a light touch, like in tag. Then record it in the app.</b></p><p>Hiders get a head start. Hunters wait for the hunt to begin.</p>`,
      cards: true },
    { t: ru ? 'Прячущимся: не попадитесь.' : 'Hiders: stay free.',
      html: ru
        ? `<ol><li>Ваш маркер показывает, где вы. Охотников на карте обычно не видно.</li><li>Оставайтесь внутри пунктира. Зона сужается по ходу раунда.</li><li>Приложение подскажет, когда остановиться или уйти.</li></ol>`
        : `<ol><li>Your marker shows where you are. Hunters are usually hidden on your map.</li><li>Stay inside the dashed line. The zone shrinks during the round.</li><li>The app tells you when to stop or move on.</li></ol>`,
      art: base(zone() + yel(90, 150) + dia(90, 150, '#ffd66b', '#3a2a00') + dia(70, 200) + me(110, 330) + num(150, 330, 1) + num(240, 360, 2) + num(300, 90, 3) + banner(ru ? 'Вас засекли — у охотников есть круг.' : 'You were revealed — Hunters have a circle.')),
      cap: ru ? '1 Вы · 2 Зона · 3 Оповещения' : '1 You · 2 Zone · 3 Alerts' },
    { t: ru ? 'Охотникам: найдите прячущихся.' : 'Hunters: find the Hiders.',
      html: ru
        ? `<ul><li>Других охотников видно. Прячущихся — нет: ищите по подсказкам.</li><li>Коснитесь прячущегося, затем нажмите «Поймал» и выберите игрока.</li><li>Пойманный становится охотником и играет дальше.</li><li><b>Водящим можно транспорт:</b> самокат, велосипед, автобус или метро, чтобы быстрее добраться до подсказки. Прячущиеся — только пешком.</li></ul>`
        : `<ul><li>You see the other Hunters. Hiders are hidden: use the clues.</li><li>Touch the Hider, then tap Catch and pick them.</li><li>A caught Hider joins the Hunters and keeps playing.</li><li><b>Hunters may use transport:</b> a scooter, bike, bus or metro to reach a clue faster. Hiders go on foot only.</li></ul>`,
      art: base(zone(120, 190, 190) + red(230, 80) + red(250, 220) + red(110, 300) + hunterDot(200, 70) + dia(160, 60) + trail),
      cap: ru ? '«Раскрытие», «Заморозка» и «Поймал» — внизу экрана.' : 'Reveal, Freeze and Catch sit at the bottom.' },
    { t: ru ? 'Охотникам: «Раскрытие»' : 'Hunter power: Reveal',
      html: ru
        ? `<ul><li>«Раскрытие» показывает охотникам красные круги. Прячущийся был где-то внутри — центр круга не его точка.</li><li>Круг остаётся на месте, а прячущийся уходит. Обыщите круг и ищите свежие следы.</li><li>Перезарядка общая на всех охотников.</li></ul>`
        : `<ul><li>Reveal shows red circles to the Hunters. A Hider was somewhere inside — the centre is not their spot.</li><li>The circle stays put while the Hider moves. Search it and look for fresh trails.</li><li>All Hunters share the cooldown.</li></ul>`,
      art: base(red(190, 220, 90) + hunterDot(320, 150) + feet([[80, 160, 10], [84, 178, 15], [86, 196, 5], [90, 214, 10], [92, 232, 0]]) + banner(ru ? 'Раскрытие отправлено — круги на карте.' : 'Reveal sent — circles are on your map.', '#8fd0ff')),
      cap: ru ? 'Прячущийся был где-то в красном круге.' : 'The Hider was somewhere in the red circle.' },
    { t: ru ? 'Охотникам: «Заморозка»' : 'Hunter power: Freeze',
      html: ru
        ? `<p>Действует на прячущихся рядом с любым охотником.</p><ol><li>Предупреждение: ещё можно двигаться — найдите укрытие.</li><li>Заморозка: стойте, пока таймер не закончится.</li><li>Свобода: снова можно двигаться.</li></ol>`
        : `<p>Hits Hiders near any Hunter.</p><ol><li>Warning: you can still move — find cover.</li><li>Frozen: hold still until the timer ends.</li><li>Free: you can move again.</li></ol>`,
      art: base(zone() + `<rect x="12" y="12" width="336" height="60" rx="12" fill="rgba(42,54,74,.95)"/><text x="26" y="38" fill="#fff" font-size="14" font-weight="700" font-family="sans-serif">${ru ? 'ВЫ ЗАМОРОЖЕНЫ — НЕ ДВИГАЙТЕСЬ' : 'FROZEN — HOLD STILL'}</text><text x="26" y="58" fill="#c8d1e0" font-size="12" font-family="sans-serif">${ru ? 'Стойте до нуля.' : 'Stay still until zero.'}</text><text x="335" y="56" fill="#fff" font-size="34" font-weight="700" text-anchor="end" font-family="sans-serif">21</text>` + me(170, 230) + `<circle cx="170" cy="230" r="70" fill="rgba(160,200,255,.18)" stroke="#8fb6ff" stroke-width="3" stroke-dasharray="6 6"/>` + hunterDot(220, 260)),
      cap: ru ? 'Заморозка — осталась 21 секунда.' : 'Frozen — 21 seconds left.' },
    { t: ru ? 'Как двигаться прячущимся' : 'How Hiders move',
      html: ru
        ? `<ul><li>Бег тратит выносливость и оставляет следы, по которым идут охотники.</li><li>Шаг восстанавливает выносливость. Когда приложение просит перестать бежать — переходите на шаг.</li></ul>`
        : `<ul><li>Running drains stamina and leaves footprints Hunters can follow.</li><li>Walking restores stamina. When the app says stop running, walk.</li></ul>`,
      art: base(red(330, 60, 200) + feet([[150, 360, 15], [146, 330, 10], [150, 300, 5], [146, 270, 0], [150, 240, 10], [146, 210, 5], [150, 180, 0], [146, 150, 10]]) + dia(70, 120)),
      cap: ru ? 'Охотники видят ваши беговые следы.' : 'Hunters can follow your running trail.' },
    { t: ru ? 'Прячущимся: задания' : 'Hiders: missions', sub: ru ? 'Если включено' : 'When enabled',
      html: ru
        ? `<ul><li>Хотя бы один прячущийся должен начать задание до срока и оставаться в жёлтом круге до конца.</li><li>За задание даются бонусы. Охотники видят, что задание выполняется, — осторожно.</li><li>Если никто не успел или последний ушёл раньше времени, все прячущиеся видны охотникам 1 минуту.</li></ul>`
        : `<ul><li>At least one Hider must start the mission before the deadline and stay in the yellow circle until it ends.</li><li>Missions earn power-ups. Hunters can see a mission in progress — careful.</li><li>If nobody makes it, or the last holder leaves early, every Hider is shown to Hunters for 1 minute.</li></ul>`,
      art: base(zone() + yel(90, 150) + dia(90, 150, '#ffd66b', '#3a2a00') + `<rect x="78" y="172" width="26" height="18" rx="4" fill="#111"/><text x="91" y="185" fill="#fff" font-size="11" text-anchor="middle" font-family="sans-serif">×2</text>` + yel(280, 260) + hold(280, 260, 101) + me(110, 340)),
      cap: ru ? 'Справа задание уже выполняется.' : 'A mission is in progress on the right.' },
    { t: ru ? 'Бонусы' : 'Power-ups', sub: ru ? 'Если включено' : 'When enabled',
      html: ru
        ? `<ul><li>Фиолетовый ромб — тайник. Дойдите до него после начала охоты, чтобы получить бонус.</li><li>Нажмите бонус внизу, прочитайте описание и выберите «Использовать», когда придёт время.</li></ul><p>Запоминать все бонусы не нужно.</p>`
        : `<ul><li>A purple diamond is a cache. Walk to it once the hunt starts to get a power-up.</li><li>Tap a power-up at the bottom, read it and choose Use when the time is right.</li></ul><p>No need to memorise them all.</p>`,
      art: base(dia(200, 120) + dia(40, 140) + red(150, 300, 70) + me(205, 125) + banner(ru ? 'Подобрано: Дозор · тайник' : 'Picked up: Lookout · cache', '#5fd38d')),
      cap: ru ? 'Зелёное оповещение подтверждает находку.' : 'The green alert confirms the pickup.' },
    { t: ru ? 'Режимы и свои карты' : 'Modes and custom maps',
      html: ru
        ? `<ul><li><b>Тюрьма</b> — пойманные ждут у ⛓, свободный прячущийся выручает всех, простояв там 8 секунд.</li><li><b>Кладоискатели</b> — прячущиеся собирают все 🪙 до конца времени.</li><li><b>Сардинки</b> — прячется один, нашедшие прячутся вместе с ним; последний ищущий проигрывает.</li><li><b>Блиц</b> — 5 минут, всё быстрее.</li><li>В <b>редакторе карт</b> организатор рисует границу и запретные зоны (красные — туда нельзя) и ставит свои точки тайников, заданий, тюрьмы и сокровищ.</li></ul>`
        : `<ul><li><b>Jail</b> — the caught wait at ⛓; a free Hider standing there for 8 seconds frees everyone.</li><li><b>Treasure hunt</b> — Hiders collect every 🪙 before time runs out.</li><li><b>Sardines</b> — one hides, finders hide with them; the last seeker loses.</li><li><b>Blitz</b> — 5 minutes, everything faster.</li><li>In the <b>map editor</b> the host draws the border and no-go zones (red — keep out) and places cache, mission, jail and treasure points.</li></ul>`,
      art: base(zone() + `<polygon points="230,120 300,130 290,190 225,180" fill="rgba(214,58,74,.25)" stroke="#d63a4a" stroke-width="3" stroke-dasharray="6 6"/>` + `<rect x="60" y="80" width="40" height="36" rx="8" fill="#2b3346" stroke="#8fa0c0" stroke-width="3"/><text x="80" y="105" fill="#fff" font-size="18" text-anchor="middle">⛓</text>` + `<text x="150" y="290" font-size="26">🪙</text><text x="250" y="260" font-size="26">🪙</text><text x="110" y="200" font-size="26">🪙</text>` + me(170, 230)),
      cap: ru ? 'Тюрьма, сокровища и запретная зона на своей карте.' : 'Jail, treasures and a no-go zone on a custom map.' },
    { t: ru ? 'Честно и безопасно.' : 'Play fair. Stay safe.',
      html: ru
        ? `<ul><li>Играйте на улице. Не заходите на частную территорию.</li><li>Прячущиеся — только пешком и не прячутся в транспорте. Водящие могут ехать на самокате, велосипеде или общественном транспорте — по ПДД и без спешки на дороге.</li><li>Не заходите в здания. Никогда не лезьте на крыши.</li><li>Не толкайтесь, не хватайте и не сбивайте с ног.</li><li>Обходите опасные места и соблюдайте ПДД.</li><li>Честно отмечайте поимки и соблюдайте договорённости.</li></ul><h3>Что взять с собой</h3><ul><li>Заряженный телефон</li><li>Удобную одежду и обувь</li></ul><p>Хорошей игры!</p>`
        : `<ul><li>Play outdoors. Keep off private property.</li><li>Hiders go on foot only and never hide in vehicles. Hunters may ride a scooter, bike or public transport — following traffic rules, no rushing on the road.</li><li>Stay out of buildings. Never climb onto roofs.</li><li>No tackling, pushing or grabbing.</li><li>Avoid dangerous spots and follow traffic rules.</li><li>Be honest about catches and stick to what you agreed.</li></ul><h3>Bring</h3><ul><li>A charged phone</li><li>Comfortable clothes and shoes</li></ul><p>Have fun!</p>` },
  ];
}

export const PATCH_NOTES = {
  ru: [
    ['2.6', ['5 новых зон в редакторе: Болото 🟫 (вдвое медленнее), Тень 🌑 (не видно издалека), Прожектор 🔦 (прячущихся видно), Глушилка 📵 (способности не действуют), Сокровищница 💰 (бонус за 8 секунд).', 'Зоны в редакторе замыкаются касанием первой точки, смена инструмента больше не склеивает зоны.']],
    ['2.5', ['Режимы: Захват флага 🚩, Инфекция 💉, Охота за головами 🎯, Чекпоинты 🏴 — всего 22. Кнопка «🎲 Случайный» режим.', 'Награды в итогах: лучший охотник, выжившие, первый пойманный, пройденное расстояние.', 'Бонус охотника «Сонар», вибрация-«сердцебиение», когда охотник ближе 35 м, события хаоса «Туман» и «Ярость».', 'Настройка «Выбывание за зоной»: 15 / 30 / 60 с или выкл.', 'Исправлено: огромная кнопка «Продолжить» на паузе.']],
    ['2.4', ['Граница зоны строже: вне зоны дольше 30 секунд — выбывание, ушли слишком далеко — сразу. Телефон вибрирует, на экране красный таймер и красная рамка.', 'Объекты на карте: куст 🌳, радар 📡, сундук 🎁, камера 📹, ускоритель ⚡, портал 🌀, колокол 🔔. Не появляются в зданиях и рядом с ними.', 'Редактор: безопасные 🛡, смертельные ☠ зоны и зона выбывших 🪦, расстановка объектов.', '«В помещении»: здание под вами автоматически становится картой игры.', 'Читы: смена роли в любом режиме, спавн предметов, способности себе. Мимик пишет в чат чужим именем. Легенда карты в меню ⌄.']],
    ['2.3', ['Режимы: Вслепую 🙈, В помещении 🏠 (без GPS, «Звук» на телефонах прячущихся), Тайный охотник 🔪, Мимик 🎭, Фантом 🫥 — туман, неизвестный охотник, собрания и голосование, точка эвакуации 🚁; выбывшие не пишут и не говорят.', 'Барьеры: здания и стены, сквозь которые не пройти ни игрокам, ни ботам. В редакторе — инструмент 🧱 и загрузка всех зданий из карты.', 'Дрон охотника 🛸: медленный, управляется касаниями, сканирует под собой каждые 2 с. Блуждающая зона 🌀.', 'Бонусы прячущихся: Щит, Оглушение, Ловушка.', 'Трек раунда: графики высоты, скорости и заряда батареи в итогах.']],
    ['2.2', ['Поимка по коду: у пойманного на экране код, охотник вводит его для подтверждения (онлайн, отключается в настройках).', 'Режимы: Хищник 🦖 и Королевская битва 🎯 — всего 13.', 'Читы в раунде: кнопка в меню ⌄ всегда (спросит пароль), долгое нажатие на таймер. Новые читы: стелс, рентген, бесконечные бонусы, автопоимка, замедление; действия: заморозить ботов, к ближайшему, +60 с, победить сейчас.', 'Кнопка 🆘 SOS и голосовые объявления.']],
    ['2.1', ['Режимы: VIP 👑, Бомба 💣, Салки 🏷 — всего 11 режимов.', 'Пауза игры у организатора (онлайн у всех).', 'Стрелка и расстояние до зоны, если вышли за границу.', '«Поделиться результатом» и личные рекорды в профиле.']],
    ['2.0', ['Режимы: Царь горы ⛰, Невидимки 👻, Зомби 🧟.', 'Метка «Сюда!» долгим нажатием на карту — для своей команды.', '«Реванш» в один клик после онлайн-игры, рейтинг друзей в профиле, тёмная карта.', 'Исправлено: в «Кладоискателях» по истечении времени теперь побеждают охотники.']],
    ['1.9', ['Режимы игры: Классика, Тюрьма (пойманных можно выручить у ⛓), Кладоискатели (соберите все 🪙), Сардинки (прятки наоборот), Блиц (5 минут).', 'Редактор карт: граница, запретные зоны, свои точки тайников, заданий, тюрьмы и сокровищ; сохранение карт и передача кодом.', 'Приколы: звуковая панель в чате (гудок, кря, ба-дум-тсс…), а в секретных читах — розыгрыши друзей: ложная тревога, переворот экрана, тряска, фейк-поимка, туман.', 'Помощник «Туман войны»: карта видна только рядом с вами.', 'Зритель в онлайн-игре: видит всех и все события, но не играет.', 'Аватары-эмодзи на карте и в команде; сложность ботов (лёгкие / обычные / хитрые).', 'Настройки «Крупный текст» и «Экономия батареи».', 'Случайные события: ослепление охотников, сирена, дождь тайников, прилив сил.', 'Достижения в профиле, конфетти при победе, «Быстрая игра» на главной.']],
    ['1.8', ['Голосовой чат в реальном времени (Чат → «Войти в голосовой чат»): каналы «Все» и «Команда», индикатор говорящего, кнопка микрофона прямо в игре.', 'Связь напрямую (WebRTC), а если сеть не пускает — автоматически через сервер с задержкой около секунды.']],
    ['1.7', ['Чат в онлайн-игре: каналы «Все» и «Команда», быстрые фразы, «📍 Где я» — точка на карте у вашей команды.', 'Рация: групповые голосовые сообщения — держите кнопку и говорите, у остальных проигрывается сразу.']],
    ['1.6', ['Помощники поиска (лобби → шаг 1): компас на ближайшего соперника и детектор расстояния «холодно — горячо», для охотников или для всех.', 'Чит «Точный радар»: точные метры и живая стрелка.']],
    ['1.5', ['Онлайн-игра с друзьями: создайте лобби — друзья входят по коду или QR и появляются в «Вашей команде». Организатор назначает роли и начинает игру, у всех общий таймер, раскрытия, заморозки, поимки, тайники, задания и итоги.', 'Связь через публичный сервер без регистрации; всё зашифровано ключом из кода лобби.']],
    ['1.4', ['Быстрое добавление игроков: имена через запятую, кнопки +1/+3/+5 и −1; роли распределяются сами.', 'Водящим можно транспорт (самокат, велосипед, автобус), прячущимся — только пешком; переключатель в расширенных настройках.', 'Читы: подмена гео и телепорт; вход в читы прямо из игры (5 касаний по таймеру или кнопка в меню ⌄).']],
    ['1.3', ['Исправлен запуск APK (страница не открывалась: ERR_INVALID_RESPONSE).', 'Экран конца раунда: кто победил, уцелевшие, пойманные (кем и когда), лучший охотник, ваша статистика.', 'Повтор всех игроков: следы, раскрытия, поимки, задания и сужение зоны на шкале времени, скорость до ×32, слежение за игроком.']],
    ['1.2', ['Лобби как в настоящей игре: сводка настроек, карта-площадка, «Ваша команда» с ручным выбором ролей, расширенные настройки (радиус, итоговый радиус, длительность, фора), QR прямо в лобби, кнопка «Начать» всегда внизу.', 'Онбординг из 6 шагов с проверкой разрешений (геолокация «всегда», точность, громкость, уведомления).', 'APK: GPS работает в фоне — можно играть с телефоном в кармане.', 'Звуковые сигналы, сохранённые пресеты в расширенном режиме.']],
    ['1.1', ['Темы из krisa: Терминал (цвет, RGB-перелив, «Матрица»), Призма, Тепловизор (10 палитр), Чертёж — интерфейс и карта перекрашиваются.', 'Своя территория: нарисуйте зону многоугольником прямо на карте.', 'Колесо рандома «Кто водит?» в лобби.']],
    ['1.0', ['Первая версия: создание игры, лобби с кодом и QR, настройка формы игры.', 'Карта с сужающейся зоной, «Раскрытие», «Заморозка», «Поймал».', 'Выносливость и следы, задания, тайники и 12 бонусов.', 'Боты за остальных игроков, демо-режим перемещения касанием.', 'Профиль со статистикой и повторами, русский и английский язык.']],
  ],
  en: [
    ['2.6', ['5 new editor zones: Swamp 🟫 (half speed), Shadow 🌑 (unseen from afar), Spotlight 🔦 (Hiders visible), Jammer 📵 (abilities blocked), Treasury 💰 (power-up after 8 seconds).', 'Editor zones close by tapping the first point; switching tools no longer merges zones.']],
    ['2.5', ['Modes: Capture the flag 🚩, Infection 💉, Bounty hunt 🎯, Checkpoints 🏴 — 22 in total. A “🎲 Random” mode button.', 'Awards in the results: best hunter, survivors, first caught, distance walked.', 'Hunter Sonar power-up, heartbeat vibration when a Hunter is within 35 m, Fog and Frenzy chaos events.', 'Out-of-zone elimination setting: 15 / 30 / 60 s or off.', 'Fixed: huge Resume button on the pause screen.']],
    ['2.4', ['Stricter zone border: outside for over 30 seconds — you are out; too far — out at once. Your phone vibrates, a red timer and red frame show.', 'Map objects: bush 🌳, radar 📡, chest 🎁, camera 📹, booster ⚡, portal 🌀, bell 🔔. They never spawn in or next to buildings.', 'Editor: safe 🛡 and deadly ☠ zones, a zone for players who are out 🪦, object placement.', 'Indoors: the building you are in becomes the game map automatically.', 'Cheats: switch role in any mode, spawn items, give yourself abilities. The Mimic writes in chat under someone else’s name. Map legend in the ⌄ menu.']],
    ['2.3', ['Modes: Blind 🙈, Indoors 🏠 (no GPS, a Sound button for Hiders’ phones), Secret hunter 🔪, Mimic 🎭, Phantom 🫥 — fog, an unknown Hunter, meetings and voting, an evacuation point 🚁; players who are out can’t chat or talk.', 'Barriers: buildings and walls that neither players nor bots can pass. In the editor — the 🧱 tool and loading all buildings from the map.', 'Hunter drone 🛸: slow, steered by taps, scans below every 2 s. Drifting zone 🌀.', 'Hider power-ups: Shield, Stun, Trap.', 'Round track: altitude, speed and battery charts in the results.']],
    ['2.2', ['Catch by code: the caught player sees a code, the Hunter types it to confirm (online, can be turned off).', 'Modes: Predator 🦖 and Battle royale 🎯 — 13 in total.', 'Cheats mid-round: the ⌄ menu button is always there (asks for the password), long-press the timer. New cheats: stealth, x-ray, endless power-ups, auto-catch, slow motion; actions: freeze bots, to nearest, +60 s, win now.', '🆘 SOS button and voice announcements.']],
    ['2.1', ['Modes: VIP 👑, Bomb 💣, Tag 🏷 — 11 modes in total.', 'Pause for the host (for everyone online).', 'Arrow and distance back to the zone when you step outside.', 'Share result and personal records in the profile.']],
    ['2.0', ['Modes: King of the hill ⛰, Ghosts 👻, Zombies 🧟.', '“Here!” marker by long-pressing the map — for your team.', 'One-tap Rematch after online games, friends leaderboard in the profile, dark map.', 'Fixed: in Treasure hunt the Hunters now win when time runs out.']],
    ['1.9', ['Game modes: Classic, Jail (free the caught at ⛓), Treasure hunt (collect every 🪙), Sardines (reverse hide-and-seek), Blitz (5 minutes).', 'Map editor: border, no-go zones, your own cache, mission, jail and treasure points; save maps and share them by code.', 'Fun: a soundboard in chat (horn, quack, ba-dum-tss…), and in the secret cheats — pranks: fake alarm, flipped screen, shake, fake catch, fog.', 'Fog of war helper: the map is visible only near you.', 'Spectators in online games: see everyone and everything, without playing.', 'Emoji avatars on the map and in the crew; bot difficulty (easy / normal / sneaky).', 'Large text and Battery saver settings.', 'Random events: blinded Hunters, siren, cache rain, second wind.', 'Achievements in the profile, confetti on a win, Quick game on the home screen.']],
    ['1.8', ['Real-time voice chat (Chat → “Join voice chat”): Everyone and Team channels, speaking indicator, mic button right in the game.', 'Direct connection (WebRTC), and automatically via the server with about a second of delay when the network blocks it.']],
    ['1.7', ['Online chat: Everyone and Team channels, quick phrases, “📍 Where I am” shows your spot to your team.', 'Radio: group voice messages — hold the button and talk, the others hear it right away.']],
    ['1.6', ['Search helpers (lobby → step 1): a compass to the nearest opponent and a cold-to-hot distance detector, for Hunters or everyone.', 'Exact radar cheat: exact metres and a live arrow.']],
    ['1.5', ['Online play with friends: create a lobby — friends join with the code or QR and appear in “Your crew”. The host assigns roles and starts; everyone shares the timer, reveals, freezes, catches, caches, missions and results.', 'Runs through a public server, no sign-up; everything is encrypted with a key from the lobby code.']],
    ['1.4', ['Quick player adding: comma-separated names, +1/+3/+5 and −1; roles balance themselves.', 'Hunters may use transport (scooter, bike, bus), Hiders walk; toggle in advanced settings.', 'Cheats: fake location and teleport; open cheats right in the game (5 taps on the timer or the button in the ⌄ menu).']],
    ['1.3', ['Fixed APK launch (page failed with ERR_INVALID_RESPONSE).', 'End-of-round screen: winner, survivors, who caught whom and when, top hunter, your stats.', 'Replay of every player: trails, reveals, catches, missions and the shrinking zone on a timeline, up to ×32, follow a player.']],
    ['1.2', ['Lobby like the real thing: settings summary, playground map, “Your crew” with manual roles, advanced settings (radius, final radius, length, head start), inline QR, sticky Start button.', '6-step onboarding with a permission checklist (always-on location, precision, volume, notifications).', 'APK: GPS keeps working in the background — play with the phone in your pocket.', 'Sound alerts; saved presets in advanced mode.']],
    ['1.1', ['Themes from krisa: Terminal (colour, RGB flow, Matrix), Prism, Thermal (10 palettes), Blueprint — UI and map are recoloured.', 'Custom area: draw the zone as a polygon on the map.', '“Who is it?” random wheel in the lobby.']],
    ['1.0', ['First release: hosting, lobby code and QR, game shaping.', 'Map with a shrinking zone, Reveal, Freeze and Catch.', 'Stamina and footprints, missions, caches and 12 power-ups.', 'Bots fill in for other players; tap-to-walk demo mode.', 'Profile with stats and replays, Russian and English.']],
  ],
};
