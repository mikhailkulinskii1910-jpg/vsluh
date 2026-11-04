/* Хранилище «Велокарты»: IndexedDB для поездок, маршрутов и пакетов карт; localStorage для настроек. */
(function (root) {
  const DB_NAME = 'velo', DB_VERSION = 1;
  const STORES = ['tracks', 'routes', 'packs'];
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          STORES.forEach(name => { if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' }); });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let result;
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const put = (store, obj) => run(store, 'readwrite', s => s.put(obj));
  const get = (store, id) => run(store, 'readonly', s => s.get(id));
  const del = (store, id) => run(store, 'readwrite', s => s.delete(id));
  const all = (store) => run(store, 'readonly', s => s.getAll());

  const DEFAULTS = {
    name: '',
    serverUrl: '',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    routerUrl: 'https://brouter.de/brouter',
    profile: 'trekking',
    base: 'osm',       // osm | sat
    theme: 'light',    // light | dark
    elev: false,       // слой перепадов высот
    skin: 'car',       // курсор игрока
  };

  const settings = {
    get() {
      try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('velo-settings') || '{}') }; }
      catch { return { ...DEFAULTS }; }
    },
    set(patch) {
      try { localStorage.setItem('velo-settings', JSON.stringify({ ...settings.get(), ...patch })); } catch { /* приватный режим */ }
    },
  };

  root.VeloStore = { put, get, del, all, settings, DEFAULTS };
})(window);
