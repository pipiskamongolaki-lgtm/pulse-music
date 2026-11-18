// Маленькая обёртка над IndexedDB: здесь лежат твои аудиофайлы, скачанные треки и обложки.
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('pulse', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const name of ['files', 'covers', 'local', 'offline']) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name);
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        // если откроется более новая версия приложения, уступаем ей базу
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
        };
        resolve(d);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      // старая вкладка Pulse держит базу: просим её закрыть или обновить
      req.onblocked = () => dispatchEvent(new CustomEvent('pulse:db-blocked'));
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция отменена'));
  }));
}

export const idbGet = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const idbPut = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));
export const idbDel = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const idbAll = (store) => run(store, 'readonly', (s) => s.getAll());
