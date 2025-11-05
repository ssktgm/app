// --- データベース定義 ---
const DB_NAME = 'CarAssignmentDB';
const DB_VERSION = 3; // ★ 駐車場(グラウンド)保存追加のためバージョンアップ

const STORE_FAMILIES = 'families';
const STORE_CARS = 'cars';
const STORE_SAVED_STATES = 'savedStates';
const STORE_SAVED_PARKING = 'savedParking'; // ★ 新規: 駐車場(グラウンド)

let dbPromise = null;

// --- DB接続 ---
function getDB() {
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject('IndexedDB error: ' + event.target.error.message);
        };

        request.onsuccess = (event) => {
            console.log('IndexedDB opened successfully.');
            resolve(event.target.result);
        };

        request.onupgradeneeded = (event) => {
            console.log('IndexedDB upgrade needed.');
            const db = event.target.result;

            // --- families ストア ---
            if (!db.objectStoreNames.contains(STORE_FAMILIES)) {
                db.createObjectStore(STORE_FAMILIES, { keyPath: 'familyName' });
            }

            // --- cars ストア ---
            if (!db.objectStoreNames.contains(STORE_CARS)) {
                db.createObjectStore(STORE_CARS, { keyPath: 'id' });
            }

            // --- savedStates ストア ---
            if (!db.objectStoreNames.contains(STORE_SAVED_STATES)) {
                // keyPath: 'id', autoIncrement: true を使用
                const statesStore = db.createObjectStore(STORE_SAVED_STATES, { keyPath: 'id', autoIncrement: true });
                // タイムスタンプで検索できるようにインデックスを作成
                statesStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // --- savedParking ストア (★ バージョン3で追加) ---
            if (!db.objectStoreNames.contains(STORE_SAVED_PARKING)) {
                const parkingStore = db.createObjectStore(STORE_SAVED_PARKING, { keyPath: 'id', autoIncrement: true });
                parkingStore.createIndex('timestamp', 'timestamp', { unique: false });
                parkingStore.createIndex('name', 'name', { unique: false }); // 名称での検索用
            }
        };

        // ★ 新規: ブロックされた場合の処理
        request.onblocked = (event) => {
            console.warn('IndexedDB open blocked:', event);
            reject(new Error('データベースのオープンがブロックされました。他のタブを閉じてリロードしてください。'));
        };
    });
    return dbPromise;
}

// --- トランザクションヘルパー ---
async function performTransaction(storeName, mode, action) {
    const db = await getDB();
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    
    return new Promise((resolve, reject) => {
        const request = action(store);

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            console.error('Transaction error:', event.target.error);
            reject(event.target.error);
        };
        
        // トランザクション完了（特に 'readwrite' で重要）
        transaction.oncomplete = () => {
            // console.log(`Transaction complete: ${storeName} (${mode})`);
        };
        transaction.onerror = (event) => {
            console.error('Transaction failed:', event.target.error);
            reject(event.target.error);
        };
    });
}

// --- 共通 CRUD ---
async function getAll(storeName) {
    return performTransaction(storeName, 'readonly', store => store.getAll());
}
async function get(storeName, key) {
    return performTransaction(storeName, 'readonly', store => store.get(key));
}
async function add(storeName, item) {
    return performTransaction(storeName, 'readwrite', store => store.add(item));
}
async function update(storeName, item) {
    return performTransaction(storeName, 'readwrite', store => store.put(item));
}
async function remove(storeName, key) {
    return performTransaction(storeName, 'readwrite', store => store.delete(key));
}
async function clearStore(storeName) {
    return performTransaction(storeName, 'readwrite', store => store.clear());
}
async function bulkAdd(storeName, items) {
    const db = await getDB();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    
    return new Promise((resolve, reject) => {
        let promises = items.map(item => {
            return new Promise((res, rej) => {
                const request = store.add(item);
                request.onsuccess = () => res();
                request.onerror = (e) => rej(e.target.error);
            });
        });
        
        Promise.all(promises)
            .then(() => resolve())
            .catch(err => reject(err));

        transaction.oncomplete = () => {
            // console.log(`Bulk add complete: ${storeName}`);
            resolve();
        };
        transaction.onerror = (event) => {
            console.error('Bulk add transaction failed:', event.target.error);
            reject(event.target.error);
        };
    });
}

// --- 家族 (Families) ---
export const getAllFamilies = () => getAll(STORE_FAMILIES);
export const getFamily = (familyName) => get(STORE_FAMILIES, familyName);
export const addFamily = (family) => add(STORE_FAMILIES, family);
export const updateFamily = (family) => update(STORE_FAMILIES, family);
export const deleteFamily = (familyName) => remove(STORE_FAMILIES, familyName);
export const bulkAddFamilies = (families) => bulkAdd(STORE_FAMILIES, families);

// --- 車 (Cars) ---
export const getAllCars = () => getAll(STORE_CARS);
export const getCar = (carId) => get(STORE_CARS, carId);
export const addCar = (car) => add(STORE_CARS, car);
export const updateCar = (car) => update(STORE_CARS, car);
export const deleteCar = (carId) => remove(STORE_CARS, carId);
export const bulkAddCars = (cars) => bulkAdd(STORE_CARS, cars);

// --- 保存済み状態 (Saved States) ---
// ★ 修正: 保存時に name を受け取る
export async function saveState(state, name, limit = 5) {
    const savedState = {
        name: name, // ★ name を保存
        state: state,
        timestamp: Date.now()
    };
    
    // 1. 新しい状態を追加
    await add(STORE_SAVED_STATES, savedState);
    
    // 2. 制限を超える古い状態を削除
    const db = await getDB();
    const transaction = db.transaction(STORE_SAVED_STATES, 'readwrite');
    const store = transaction.objectStore(STORE_SAVED_STATES);
    const index = store.index('timestamp'); // タイムスタンプインデックスを使用

    return new Promise((resolve, reject) => {
        const cursorRequest = index.openCursor(null, 'prev'); // 降順でカーソルを開く
        let count = 0;
        
        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                count++;
                if (count > limit) {
                    // 制限を超えた古いデータを削除
                    store.delete(cursor.primaryKey);
                }
                cursor.continue();
            } else {
                // カーソル終了
                resolve();
            }
        };
        cursorRequest.onerror = (event) => {
            reject(event.target.error);
        };

        transaction.onerror = (event) => {
            console.error('Save/Trim state transaction failed:', event.target.error);
            reject(event.target.error);
        };
        transaction.oncomplete = () => {
            // console.log('Save/Trim state complete');
            resolve();
        };
    });
}

export const getState = (id) => get(STORE_SAVED_STATES, id);
export const deleteState = (id) => remove(STORE_SAVED_STATES, id);

export async function getAllSavedStates() {
    // タイムスタンプでソートして返す
    const states = await getAll(STORE_SAVED_STATES);
    return states.sort((a, b) => b.timestamp - a.timestamp); // JS側で降順ソート
}

// --- ★ 新規: 保存済み駐車場 (Saved Parking) ---
// ★ 修正: 保存時に name を受け取る
export async function saveParking(parkingData, name, limit = 20) {
    const savedParking = {
        name: name, // ★ name を保存
        parking: parkingData,
        timestamp: Date.now()
    };

    // 1. 新しい駐車場データを追加
    await add(STORE_SAVED_PARKING, savedParking);

    // 2. 制限を超える古いデータを削除
    const db = await getDB();
    const transaction = db.transaction(STORE_SAVED_PARKING, 'readwrite');
    const store = transaction.objectStore(STORE_SAVED_PARKING);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
        const cursorRequest = index.openCursor(null, 'prev'); // 降順
        let count = 0;
        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                count++;
                if (count > limit) {
                    store.delete(cursor.primaryKey);
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        cursorRequest.onerror = (event) => reject(event.target.error);
        transaction.onerror = (event) => reject(event.target.error);
        transaction.oncomplete = () => resolve();
    });
}

// ★ 新規: addParking (インポート用)
export const addParking = (parking) => add(STORE_SAVED_PARKING, parking);
export const getParking = (id) => get(STORE_SAVED_PARKING, id);
export const deleteParking = (id) => remove(STORE_SAVED_PARKING, id);

export async function getAllSavedParking() {
    // タイムスタンプでソートして返す
    const parkingList = await getAll(STORE_SAVED_PARKING);
    return parkingList.sort((a, b) => b.timestamp - a.timestamp); // JS側で降順ソート
}

// --- ★ 新規: データベース全体のクリア ---
export async function clearDatabase() {
    // 1. DB接続をいったん閉じる (開いている場合)
    if (dbPromise) {
        try {
            const db = await dbPromise;
            db.close();
            console.log('Database closed for deletion.');
        } catch (err) {
            // DBが開けなかった場合は無視
            console.warn('DB close error before deletion (ignoring):', err.message);
        }
        dbPromise = null;
    }

    // 2. データベースの削除をリクエスト
    return new Promise((resolve, reject) => {
        console.log(`Attempting to delete database: ${DB_NAME}`);
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        
        deleteRequest.onsuccess = (event) => {
            console.log('Database deleted successfully.');
            resolve();
        };
        
        deleteRequest.onerror = (event) => {
            console.error('Error deleting database:', event.target.error);
            reject(event.target.error);
        };
        
        // ★ 修正: ブロックされた場合のハンドリング
        deleteRequest.onblocked = (event) => {
            console.warn('Database deletion blocked.');
            // エラーをrejectし、呼び出し元(index.html)でメッセージを表示させる
            const err = new Error('DBの削除がブロックされました。このアプリを開いている他のタブをすべて閉じてください。');
            err.name = 'BlockedError';
            reject(err);
        };
    });
}