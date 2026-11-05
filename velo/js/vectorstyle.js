/* Векторный чёрный стиль карты (MapLibre) на тайлах OpenFreeMap (схема OpenMapTiles, данные OSM).
   Векторная карта рисуется под плотность экрана — линии и подписи чёткие, как в Яндекс Картах.
   Чёрный фон, белые магистрали, серые улицы, пунктирные тропы, серая вода, зелёные велодорожки. */
(function (root) {
  const SOURCE = 'https://tiles.openfreemap.org/planet';
  const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const FONT = ['Noto Sans Regular'];
  const NAME = ['coalesce', ['get', 'name:ru'], ['get', 'name']];
  const BIKE = '#4ade80';

  // ширина линии по зуму
  const w = (...stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
  const cls = (...c) => ['in', ['get', 'class'], ['literal', c]];
  // велодорожки: отдельные (subclass=cycleway) и совмещённые вело-пешеходные (bicycle=designated) — на любом типе пути
  const isCycleway = ['any', ['==', ['get', 'subclass'], 'cycleway'], ['==', ['get', 'bicycle'], 'designated']];
  // можно ехать на велосипеде: тропы, дворовые и служебные проезды с bicycle=yes (кроме «нельзя» и «спешиться»)
  const bikeAllowed = ['all', ['==', ['get', 'bicycle'], 'yes'], ['!', isCycleway]];
  const BIKE_ALLOWED = '#a7f3c0';

  function line(id, filter, color, width, extra = {}) {
    return {
      id, type: 'line', source: 'omt', 'source-layer': 'transportation', filter,
      layout: { 'line-cap': 'round', 'line-join': 'round', ...(extra.layout || {}) },
      paint: { 'line-color': color, 'line-width': width, ...(extra.paint || {}) },
      ...(extra.minzoom != null ? { minzoom: extra.minzoom } : {}),
    };
  }

  function label(id, layer, filter, size, color, extra = {}) {
    return {
      id, type: 'symbol', source: 'omt', 'source-layer': layer, filter,
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': size, 'text-max-width': 8, ...(extra.layout || {}) },
      paint: { 'text-color': color, 'text-halo-color': '#000', 'text-halo-width': 1.4, ...(extra.paint || {}) },
      ...(extra.minzoom != null ? { minzoom: extra.minzoom } : {}),
    };
  }

  /*
   * Заведения (слой poi схемы OpenMapTiles): цветная точка по типу и название.
   * Цвета: еда — янтарный, магазины — сиреневый, здоровье — красный, учёба — голубой,
   * досуг и спорт — зелёный, велосипедное (веломагазины, прокат, парковки) — ярко-зелёный, остальное — серый.
   */
  const POI_GROUPS = [
    ['Еда', '#e8b04a', ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bakery', 'confectionery', 'pub', 'food_court']],
    ['Магазины', '#b48cf0', ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'jewelry', 'florist', 'furniture', 'hairdresser', 'laundry', 'mobile_phone', 'shoe', 'car', 'hardware', 'books', 'gift', 'music', 'optician', 'pet', 'stationery', 'toys', 'electronics', 'butcher', 'beauty', 'convenience', 'supermarket', 'department_store', 'marketplace']],
    ['Здоровье', '#ff6b6b', ['hospital', 'pharmacy', 'doctors', 'dentist', 'clinic', 'veterinary']],
    ['Учёба', '#6fb4ff', ['school', 'college', 'university', 'kindergarten', 'library']],
    ['Досуг', '#5fd1a0', ['cinema', 'theatre', 'museum', 'art_gallery', 'attraction', 'castle', 'monument', 'zoo', 'stadium', 'sports_centre', 'swimming_pool', 'fitness_centre', 'pitch', 'playground', 'park', 'golf', 'ice_rink']],
    ['Велосипед', BIKE, ['bicycle', 'bicycle_rental', 'bicycle_parking']],
  ];
  const POI_COLOR = ['match', ['get', 'class'], ...POI_GROUPS.flatMap(([, c, cl]) => [cl, c]), '#9a9a9a'];
  const POI_COLOR_SUB = ['match', ['get', 'subclass'], ['bicycle', 'bicycle_rental', 'bicycle_parking'], BIKE, POI_COLOR];
  const POI_FILTER = ['all', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
    ['!', ['match', ['get', 'class'], ['bus', 'railway', 'rail', 'airport', 'ferry_terminal', 'entrance', 'aerialway'], true, false]]];
  // важные (rank меньше) видны раньше, мелкие — только при сильном увеличении
  const POI_MINRANK = ['step', ['zoom'], 6, 16, 14, 17, 30, 18, 999];
  const POI_LAYERS = ['poi-dot', 'poi-label'];
  function poiLayers(visible) {
    const vis = visible ? 'visible' : 'none';
    const f = ['all', POI_FILTER, ['<=', ['coalesce', ['get', 'rank'], 30], POI_MINRANK]];
    return [
      { id: 'poi-dot', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 15, filter: f, layout: { visibility: vis },
        paint: { 'circle-color': POI_COLOR_SUB, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3.5, 18, 6],
          'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } },
      { id: 'poi-label', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 16, filter: f,
        layout: { visibility: vis, 'text-field': NAME, 'text-font': FONT, 'text-size': 11, 'text-max-width': 9,
          'text-anchor': 'left', 'text-offset': [0.8, 0], 'text-optional': true },
        paint: { 'text-color': POI_COLOR_SUB, 'text-halo-color': '#000', 'text-halo-width': 1.4 } },
    ];
  }
  /** Только заведения на прозрачном фоне — поверх спутника. */
  function buildPoi() {
    return { version: 8, glyphs: GLYPHS, sources: { omt: { type: 'vector', url: SOURCE } }, layers: poiLayers(true) };
  }

  /** Стиль MapLibre. bike — показывать ли велодорожки зелёным, poi — заведения. */
  function build({ bike = true, poi = false } = {}) {
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: { omt: { type: 'vector', url: SOURCE } },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('park', 'cemetery'), paint: { 'fill-color': '#08110a' } },
        { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'grass'), paint: { 'fill-color': '#07100a' } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#333333' } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#333333', 'line-width': w(10, 0.5, 18, 4) } },
        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#121212', 'fill-outline-color': '#1e1e1e' } },

        // тропы и дорожки: пунктир, заметнее, чем в обычной схеме
        line('track', cls('track'), '#6f6f6f', w(13, 0.6, 18, 2.2), { minzoom: 12, paint: { 'line-dasharray': [2, 1.5] } }),
        line('path', ['all', cls('path'), ['!', isCycleway]], '#9a9a9a', w(13, 0.6, 18, 2.4), { minzoom: 13, paint: { 'line-dasharray': [1.2, 1.2] } }),
        line('rail', cls('rail', 'transit'), '#4a4a4a', w(10, 0.5, 18, 2), { paint: { 'line-dasharray': [3, 3] } }),

        // улицы и дороги: от серого к белому по важности
        line('service', cls('service', 'minor'), '#6b6b6b', w(12, 0.4, 14, 1.2, 18, 8), { minzoom: 12 }),
        line('tertiary', cls('tertiary'), '#a6a6a6', w(10, 0.4, 14, 2, 18, 11)),
        line('secondary', cls('secondary', 'primary'), '#d9d9d9', w(8, 0.5, 14, 3, 18, 14)),
        line('motorway', cls('motorway', 'trunk'), '#ffffff', w(6, 0.6, 14, 4, 18, 16)),

        // велодорожки — зелёные, поверх остальных линий
        // режим «Велодорожки»: подложка-свечение, разрешённые пути пунктиром, велодорожки сплошной зелёной
        line('cycleway-glow', isCycleway, BIKE, w(11, 3, 14, 6, 18, 14), {
          minzoom: 10, layout: { visibility: bike ? 'visible' : 'none' }, paint: { 'line-opacity': 0.18, 'line-blur': 2 },
        }),
        line('cycleway-allowed', bikeAllowed, BIKE_ALLOWED, w(13, 0.9, 18, 3.2), {
          minzoom: 13, layout: { visibility: bike ? 'visible' : 'none' }, paint: { 'line-dasharray': [2, 1.2], 'line-opacity': 0.9 },
        }),
        line('cycleway', isCycleway, BIKE, w(10, 1, 14, 2.6, 18, 6), {
          minzoom: 10, layout: { visibility: bike ? 'visible' : 'none' },
        }),

        // подписи
        label('road-name', 'transportation_name', cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'), 11, '#8f8f8f', {
          minzoom: 14, layout: { 'symbol-placement': 'line', 'text-max-angle': 30 },
        }),
        { id: 'housenumber', type: 'symbol', source: 'omt', 'source-layer': 'housenumber', minzoom: 17,
          layout: { 'text-field': ['get', 'housenumber'], 'text-font': FONT, 'text-size': 10 },
          paint: { 'text-color': '#6e6e6e', 'text-halo-color': '#000', 'text-halo-width': 1 } },
        label('place-small', 'place', cls('suburb', 'quarter', 'neighbourhood', 'village', 'hamlet'), 11, '#8a8a8a', { minzoom: 11 }),
        label('place-town', 'place', cls('town'), 13, '#d0d0d0'),
        label('place-city', 'place', cls('city'), ['interpolate', ['linear'], ['zoom'], 5, 12, 12, 17], '#f2f2f2'),
        ...poiLayers(poi),
      ],
    };
  }

  /** Есть ли WebGL (без него — растровая схема). */
  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(root.maplibregl && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch { return false; }
  }

  const BIKE_LAYERS = ['cycleway-glow', 'cycleway-allowed', 'cycleway'];
  root.VeloVectorStyle = { build, buildPoi, supported, BIKE, BIKE_ALLOWED, BIKE_LAYERS, POI_LAYERS, POI_GROUPS };
})(window);
