// db.js

(function() {
    // データベース名とバージョン
    // ★ バージョンを 3 に更新 (parking store 追加のため)
    const DB_NAME = 'CarAppDB';
    const DB_VERSION = 3; 

    // オブジェクトストア（テーブル）の名前
    const STORES = {
        FAMILIES: 'families', // 家族・参加者マスター
        CARS: 'cars',         // 車マスター
        SAVED_STATES: 'saved_states', // 保存した状態
        SAVED_PARKING: 'saved_parking' // ★新規: 保存した駐車場
    };

    let dbInstance = null;

    /**
     * データベースを開き、初期化する
     * @returns {Promise<IDBDatabase>} データベースインスタンス
     */
    function openDB() {
        if (dbInstance) {
            return Promise.resolve(dbInstance);
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject("IndexedDB のオープンに失敗しました。");
            };

            request.onsuccess = (event) => {
                dbInstance = event.target.result;
                resolve(dbInstance);
            };

            // バージョン変更時（新規作成・アップグレード）
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                
                console.log(`IndexedDB upgrading from version ${event.oldVersion} to ${event.newVersion}`);

                // --- 家族ストア (families) ---
                if (!db.objectStoreNames.contains(STORES.FAMILIES)) {
                    db.createObjectStore(STORES.FAMILIES, { keyPath: 'familyName' });
                    console.log(`Object store created: ${STORES.FAMILIES}`);
                }
                
                // --- 車ストア (cars) ---
                if (!db.objectStoreNames.contains(STORES.CARS)) {
                    // ★ 修正: keyPath を 'id' に変更
                    db.createObjectStore(STORES.CARS, { keyPath: 'id' });
                    console.log(`Object store created: ${STORES.CARS}`);
                }
                
                // --- 状態ストア (saved_states) ---
                // (v2で追加)
                if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORES.SAVED_STATES)) {
                    const stateStore = db.createObjectStore(STORES.SAVED_STATES, { keyPath: 'id' });
                    // タイムスタンプでソートするためにインデックスを作成
                    stateStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log(`Object store created: ${STORES.SAVED_STATES}`);
                }
                
                // --- 駐車場ストア (saved_parking) ---
                // (v3で追加)
                if (event.oldVersion < 3 && !db.objectStoreNames.contains(STORES.SAVED_PARKING)) {
                    const parkingStore = db.createObjectStore(STORES.SAVED_PARKING, { keyPath: 'id' });
                    // タイムスタンプでソートするためにインデックスを作成
                    parkingStore.createIndex('timestamp', 'timestamp', { unique: false });
                     console.log(`Object store created: ${STORES.SAVED_PARKING}`);
                }

                // 移行処理（もしあれば）
                if (event.oldVersion === 1) {
                    // v1 -> v2 (saved_states が追加されただけ)
                    console.log("Migrating DB from v1 to v2");
                }
                if (event.oldVersion < 3) {
                     // v1/v2 -> v3 (saved_parking が追加された)
                     console.log(`Migrating DB from v${event.oldVersion} to v3`);
                }
            };
        });
    }

    /**
     * オブジェクトストアのトランザクションを取得する
     * @param {string} storeName ストア名
     * @param {IDBTransactionMode} mode "readonly" | "readwrite"
     * @returns {Promise<IDBObjectStore>} オブジェクトストア
     */
    async function getStore(storeName, mode = 'readonly') {
        const db = await openDB();
        const transaction = db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    }

    // --- 汎用 CRUD ヘルパー ---

    /**
     * アイテムを1件取得
     * @param {string} storeName ストア名
     * @param {string} key キー
     * @returns {Promise<any>} データ
     */
    async function get(storeName, key) {
        const store = await getStore(storeName);
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onerror = (e) => reject(`Get error: ${e.target.error}`);
            request.onsuccess = (e) => resolve(e.target.result);
        });
    }

    /**
     * 全アイテムを取得 (ソート付き)
     * @param {string} storeName ストア名
     * @param {string | null} indexName (optional) ソートに使用するインデックス名
     * @param {IDBCursorDirection} direction (optional) ソート方向
     * @param {number | null} limit (optional) 取得件数
     * @returns {Promise<any[]>} データの配列
     */
    async function getAll(storeName, indexName = null, direction = 'next', limit = null) {
        const store = await getStore(storeName);
        const source = indexName ? store.index(indexName) : store;
        
        return new Promise((resolve, reject) => {
            const request = source.getAll(null, limit && direction === 'prev' ? undefined : limit);
            
            request.onerror = (e) => reject(`GetAll error: ${e.target.error}`);
            request.onsuccess = (e) => {
                let results = e.target.result;
                
                // ★ 修正: getAll() は limit を使うとソート方向を制御できない場合がある
                // JS側でソートし直す
                if (indexName) {
                    const keyPath = store.index(indexName).keyPath;
                    results.sort((a, b) => {
                         if (direction === 'prev') { // 降順
                             return b[keyPath] - a[keyPath];
                         } else { // 昇順
                             return a[keyPath] - b[keyPath];
                         }
                    });
                }
                
                // JS側で件数制限
                if (limit) {
                    results = results.slice(0, limit);
                }
                
                resolve(results);
            };
        });
    }

    /**
     * アイテムを1件追加（または上書き）
     * @param {string} storeName ストア名
     * @param {any} item 保存するアイテム
     * @returns {Promise<void>}
     */
    async function put(storeName, item) {
        const store = await getStore(storeName, 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put(item);
            request.onerror = (e) => reject(`Put error: ${e.target.error}`);
            request.onsuccess = () => resolve();
        });
    }
    
    /**
     * アイテムを1件追加 (キー重複で失敗)
     * @param {string} storeName ストア名
     * @param {any} item 保存するアイテム
     * @returns {Promise<void>}
     */
    async function add(storeName, item) {
        const store = await getStore(storeName, 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.add(item);
            request.onerror = (e) => reject(`Add error: ${e.target.error}`);
            request.onsuccess = () => resolve();
        });
    }


    /**
     * アイテムを1件削除
     * @param {string} storeName ストア名
     * @param {string} key キー
     * @returns {Promise<void>}
     */
    async function remove(storeName, key) {
        const store = await getStore(storeName, 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onerror = (e) => reject(`Delete error: ${e.target.error}`);
            request.onsuccess = () => resolve();
        });
    }
    
    /**
     * ストアの全アイテムを削除
     * @param {string} storeName ストア名
     * @returns {Promise<void>}
     */
    async function clear(storeName) {
        const store = await getStore(storeName, 'readwrite');
         return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onerror = (e) => reject(`Clear error: ${e.target.error}`);
            request.onsuccess = () => resolve();
        });
    }
    
    /**
     * 複数アイテムを一括追加 (put)
     * @param {string} storeName ストア名
     * @param {any[]} items アイテムの配列
     * @returns {Promise<void>}
     */
    async function bulkPut(storeName, items) {
        if (!items || items.length === 0) return Promise.resolve();
        const store = await getStore(storeName, 'readwrite');
        const transaction = store.transaction;
        
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(`BulkPut error: ${e.target.error}`);
            
            items.forEach(item => {
                store.put(item);
            });
        });
    }

    // --- データベース API ---

    const dbApi = {
        // --- 家族 (Families) ---
        getFamily: (familyName) => get(STORES.FAMILIES, familyName),
        getAllFamilies: () => getAll(STORES.FAMILIES),
        addFamily: (family) => add(STORES.FAMILIES, family),
        updateFamily: (family) => put(STORES.FAMILIES, family),
        deleteFamily: (familyName) => remove(STORES.FAMILIES, familyName),
        clearAllFamilies: () => clear(STORES.FAMILIES),
        bulkAddFamilies: (families) => bulkPut(STORES.FAMILIES, families),

        // --- 車 (Cars) ---
        // ★ 修正: getCar(carId)
        getCar: (carId) => get(STORES.CARS, carId),
        getAllCars: () => getAll(STORES.CARS),
        // ★ 修正: addCar(car)
        addCar: (car) => add(STORES.CARS, car),
        updateCar: (car) => put(STORES.CARS, car),
        // ★ 修正: deleteCar(carId)
        deleteCar: (carId) => remove(STORES.CARS, carId),
        clearAllCars: () => clear(STORES.CARS),
        bulkAddCars: (cars) => bulkPut(STORES.CARS, cars),
        
        // --- 保存した状態 (Saved States) ---
        getSavedState: (id) => get(STORES.SAVED_STATES, id),
        // ★ 修正: ソートと件数制限をgetAll側で処理
        getAllSavedStates: (limit) => getAll(STORES.SAVED_STATES, 'timestamp', 'prev', limit),
        addSavedState: (state) => put(STORES.SAVED_STATES, state), // putで上書き許可
        deleteSavedState: (id) => remove(STORES.SAVED_STATES, id),
        clearAllStates: () => clear(STORES.SAVED_STATES),

        // --- ★新規: 保存した駐車場 (Saved Parking) ---
        getSavedParking: (id) => get(STORES.SAVED_PARKING, id),
        // ★ 修正: ソートと件数制限をgetAll側で処理
        getAllSavedParking: (limit) => getAll(STORES.SAVED_PARKING, 'timestamp', 'prev', limit),
        addSavedParking: (parking) => put(STORES.SAVED_PARKING, parking), // putで上書き許可
        deleteSavedParking: (id) => remove(STORES.SAVED_PARKING, id),
        clearAllParking: () => clear(STORES.SAVED_PARKING),
        bulkAddParking: (parkingItems) => bulkPut(STORES.SAVED_PARKING, parkingItems),

        // --- 全データ操作 ---
        clearAllData: async () => {
            await clear(STORES.FAMILIES);
            await clear(STORES.CARS);
            await clear(STORES.SAVED_STATES);
            await clear(STORES.SAVED_PARKING);
        }
    };

    // グローバルオブジェクト (window.db) として公開
    window.db = dbApi;
})();

