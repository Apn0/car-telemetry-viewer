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

        // Scenario 1: synchronous loop
        let pending = [];
        for (let i = 0; i < SAMPLES; i++) pending.push({ runId: "run1", t: i, a: 1 });
        let start = performance.now();
        await tx("samples", "readwrite", s => {
            let n = 0;
            for (const r of pending) { s.put(r); n++; }
            return n;
        });
        console.log(`Synchronous loop: ${(performance.now() - start).toFixed(2)} ms`);

        // Scenario 2: chunking with request.onsuccess keeping the transaction open
        let pending2 = [];
        for (let i = 0; i < SAMPLES; i++) pending2.push({ runId: "run2", t: i, a: 1 });

        start = performance.now();
        await new Promise((resolve, reject) => {
            const t = db.transaction("samples", "readwrite");
            const s = t.objectStore("samples");
            let i = 0;

            function nextChunk() {
                const limit = Math.min(i + 250, pending2.length);
                let lastReq = null;
                for (; i < limit; i++) {
                    lastReq = s.put(pending2[i]);
                }
                if (i < pending2.length && lastReq) {
                    lastReq.onsuccess = nextChunk;
                }
            }

            nextChunk();

            t.oncomplete = () => resolve();
            t.onerror = reject;
        });
        console.log(`Chunked loop with onsuccess: ${(performance.now() - start).toFixed(2)} ms`);
    }

    benchmark();
};
