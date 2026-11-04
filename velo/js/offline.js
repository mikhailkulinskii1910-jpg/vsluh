/* Офлайн-пакеты карт: тайлы складываются в Cache API (кэш «velo-tiles»), который читает service worker. */
(function (root) {
  const G = root.VeloGeo;
  const S = root.VeloStore;
  const CACHE = 'velo-tiles';
  const CONCURRENCY = 4;        // не нагружаем сервер тайлов
  const MAX_TILES = 6000;       // жёсткий лимит одного пакета
  const APPROX_TILE_KB = 25;    // грубая оценка размера одного PNG-тайла

  const AREAS = {
    moscow: { title: 'Москва и область', bounds: { south: 55.2, north: 56.1, west: 36.9, east: 38.2 }, zmin: 10, zmax: 13 },
    spb: { title: 'Санкт-Петербург и область', bounds: { south: 59.7, north: 60.2, west: 29.9, east: 30.8 }, zmin: 10, zmax: 13 },
    russia: { title: 'Вся Россия (обзор)', bounds: { south: 41.2, north: 81.9, west: 19.6, east: 180 }, zmin: 3, zmax: 7 },
  };

  function tileUrl(template, t) {
    return template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
  }

  /** МБ для показа: «<1 МБ», «12 МБ». */
  function fmtMb(mb) { return mb < 1 ? '<1 МБ' : Math.round(mb) + ' МБ'; }

  function estimate(bounds, zmin, zmax) {
    const count = G.tilesForBounds(bounds, zmin, zmax).length;
    return { count, sizeMb: (count * APPROX_TILE_KB) / 1024 };
  }

  /** Скачивает тайлы в кэш. onProgress(done, total). Возвращает запись пакета. */
  async function download({ name, bounds, zmin, zmax, onProgress, signal }) {
    const tileTpl = S.settings.get().tileUrl;
    const tiles = G.tilesForBounds(bounds, zmin, zmax);
    if (tiles.length > MAX_TILES) throw new Error(`Слишком большой участок: ${tiles.length} тайлов (максимум ${MAX_TILES}). Уменьшите зум или область.`);
    const cache = await caches.open(CACHE);
    let done = 0, failed = 0, index = 0;

    async function worker() {
      while (index < tiles.length) {
        if (signal && signal.aborted) throw new DOMException('Отменено', 'AbortError');
        const url = tileUrl(tileTpl, tiles[index++]);
        try {
          if (!(await cache.match(url))) {
            const res = await fetch(url, { mode: 'cors', cache: 'no-store', signal });
            if (res.ok) await cache.put(url, res.clone()); else failed++;
          }
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          failed++;
        }
        onProgress && onProgress(++done, tiles.length);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const pack = {
      id: 'pack-' + Date.now(), name, bounds, zmin, zmax,
      tiles: tiles.length, failed, tileUrl: tileTpl, createdAt: Date.now(),
    };
    await S.put('packs', pack);
    return pack;
  }

  /** Удаляет тайлы пакета из кэша и запись о нём. */
  async function removePack(pack) {
    const cache = await caches.open(CACHE);
    for (const t of G.tilesForBounds(pack.bounds, pack.zmin, pack.zmax)) {
      await cache.delete(tileUrl(pack.tileUrl, t));
    }
    await S.del('packs', pack.id);
  }

  async function storageInfo() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usedMb: (e.usage || 0) / 1048576, quotaMb: (e.quota || 0) / 1048576 };
  }

  root.VeloOffline = { AREAS, MAX_TILES, estimate, fmtMb, download, removePack, storageInfo, tileUrl };
})(window);
