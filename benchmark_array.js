require("fake-indexeddb/auto");
const request = indexedDB.open("cartelemetry", 1);
request.onupgradeneeded = (e) => {
    e.target.result.createObjectStore("samples", { keyPath: ["runId", "t"] });
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

        let pending = [];
        for (let i = 0; i < SAMPLES; i++) pending.push({ runId: "run1", t: i, a: 1 });
        let start = performance.now();
        await tx("samples", "readwrite", s => {
            let n = 0;
            for (const r of pending) { s.put(r); n++; }
            return n;
        });
        console.log(`N+1 Synchronous loop: ${(performance.now() - start).toFixed(2)} ms`);

        // Array / Flattening
        let pending2 = [];
        for (let i = 0; i < SAMPLES; i++) pending2.push({ runId: "run2", t: i, a: 1 });

        start = performance.now();
        await tx("samples", "readwrite", s => {
            // Wait, does fake-indexeddb support batch/bulk insert? Or dexie trick?
            // Actually, maybe flattening pending from array of arrays is the optimization.
            // Oh, wait, in storage.js, the issue is: "N+1 Query in flushWrites... Instead of individual s.put(r) calls in a tight loop..."
            // But how do you insert multiple without s.put(r)?
            return 0;
        });
    }

    benchmark();
};
