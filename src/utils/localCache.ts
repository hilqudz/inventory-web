// Local Cache Helper for Firestore Fallback & Quota Limit Management

const CACHE_PREFIX = 'gudang_app_cache_';

// IndexedDB Helper for large datasets like Catalog Photos (bypasses 5MB localStorage quota)
const DB_NAME = 'GudangAppDB';
const DB_VERSION = 1;
const PHOTO_STORE = 'katalog_foto';

function openPhotoDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e: any) => resolve(e.target.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveCatalogPhotosIndexedDB(photos: any[]): Promise<void> {
  try {
    const db = await openPhotoDB();
    if (!db) return;
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    store.clear();
    if (photos && photos.length > 0) {
      for (const item of photos) {
        if (item && item.id) {
          store.put(item);
        }
      }
    }
  } catch (err) {
    console.warn('IndexedDB save warning:', err);
  }
}

export async function clearCatalogPhotosIndexedDB(): Promise<void> {
  try {
    const db = await openPhotoDB();
    if (!db) return;
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    store.clear();
  } catch (err) {
    console.warn('IndexedDB clear warning:', err);
  }
}

export async function loadCatalogPhotosIndexedDB(): Promise<any[]> {
  try {
    const db = await openPhotoDB();
    if (!db) return [];
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const store = tx.objectStore(PHOTO_STORE);
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('IndexedDB load warning:', err);
    return [];
  }
}

export function saveLocalCache<T>(key: string, data: T[], allowEmpty: boolean = false): void {
  try {
    if (data.length === 0 && !allowEmpty) {
      const existing = loadLocalCache<T>(key);
      if (existing.length > 0) {
        return; // Don't wipe existing cache if new fetch returns empty
      }
    }

    if (key === 'katalog_foto') {
      saveCatalogPhotosIndexedDB(data);
      return; // Do not attempt to store base64 photos in localStorage to prevent quota errors
    }

    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(data));
  } catch (err) {
    console.warn(`Failed to save local cache for ${key}:`, err);
  }
}

export function loadLocalCache<T>(key: string): T[] {
  try {
    const item = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (item) {
      return JSON.parse(item) as T[];
    }
  } catch (err) {
    console.warn(`Failed to load local cache for ${key}:`, err);
  }
  return [];
}

export function clearAllLocalCache(): void {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    clearCatalogPhotosIndexedDB();
  } catch (err) {
    console.warn('Failed to clear local cache:', err);
  }
}
