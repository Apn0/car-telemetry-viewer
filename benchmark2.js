require("fake-indexeddb/auto");
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = { getItem: () => null, setItem: () => {} };
}
const fs = require('fs');

let code = fs.readFileSync('storage.js', 'utf8');

// evaluate CT in this context
const uuid = require('crypto').randomUUID;

// We need to test the IDB transaction part. We can just use the fake-indexeddb
const FDB = require("fake-indexeddb");
const FDBKeyRange = require("fake-indexeddb/lib/FDBKeyRange");

const request = indexedDB.open("cartelemetry", 1);
request.onupgradeneeded = (e) => {
    const d = e.target.result;
    const s = d.createObjectStore("samples", { keyPath: ["runId", "t"] });
};

request.onsuccess = (e) => {
    const db = e.target.result;

    function tx(store, mode, fn) {
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let out;
        try { out = fn(s); } catch (err) { reject(err); return; }
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }

    async function benchmark() {
        const SAMPLES = 10000;
        let pending = [[ "run1", [] ]];
        for (let i = 0; i < SAMPLES; i++) pending[0][1].push({ runId: "run1", t: i, a: 1 });

        let start = performance.now();
        await tx("samples", "readwrite", s => {
            let n = 0;
            for (const [, rows] of pending) for (const r of rows) { s.put(r); n++; }
            return n;
        });
        console.log(`Individual puts: ${(performance.now() - start).toFixed(2)} ms`);

        pending = [[ "run2", [] ]];
        for (let i = 0; i < SAMPLES; i++) pending[0][1].push({ runId: "run2", t: i, a: 1 });

        start = performance.now();
        await tx("samples", "readwrite", s => {
            let n = 0;
            if (s.putAll) {
                // does not exist yet maybe? No, putAll is not standard.
                // Wait, some browsers have an issue with returning lots of request objects.
                // There is no putAll standard in IDBObjectStore right now, it's just proposed? Or maybe Dexie uses some trick.
                // Or maybe we just need to avoid calling IDBRequest returning methods in a massive synchronous block, or maybe just call them.
                // wait, is there an bulk API in IndexedDB? No, but maybe reusing the request object? No.
            }
            return n;
        });
    }

    benchmark();
};
