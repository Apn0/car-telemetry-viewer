require("fake-indexeddb/auto");
const fs = require('fs');

async function benchmark() {
  const SAMPLES = 20000;
  let rows = [];
  for (let i=0; i<SAMPLES; i++) rows.push({runId:"1", t:i, a:1});

  const db = await new Promise((res) => {
      const r = indexedDB.open("test", 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore("s", {keyPath: ["runId", "t"]});
      r.onsuccess = e => res(e.target.result);
  });

  // 1. Loop puts
  let t0 = performance.now();
  await new Promise(res => {
      const tx = db.transaction("s", "readwrite");
      tx.oncomplete = () => res();
      const store = tx.objectStore("s");
      for (const r of rows) store.put(r);
  });
  console.log("Loop puts:", performance.now() - t0);

  // 2. Loop puts with chunking over event loop - actually we shouldn't do this because IDB closes tx
  // 3. IDBObjectStore.prototype.put might have a batch alternative? No.

  // What if we don't put one by one but chunk the main loop without blocking?
  // N+1 issue in flushWrites:
  // "Clear N+1 pattern that can be avoided. Instead of individual s.put(r) calls in a tight loop, consider a more efficient way to insert multiple rows or just acknowledge it as a common pattern that can still cause performance lag on large batches."

  // Wait, if we can't find a faster put, can we chunk it to prevent UI freeze?
  t0 = performance.now();
  await new Promise(res => {
      const tx = db.transaction("s", "readwrite");
      tx.oncomplete = () => res();
      const store = tx.objectStore("s");
      let i = 0;
      function next() {
          const end = Math.min(i + 500, rows.length);
          let req;
          for (; i < end; i++) req = store.put(rows[i]);
          if (i < rows.length && req) {
              req.onsuccess = next;
          }
      }
      next();
  });
  console.log("Chunked loop (onsuccess):", performance.now() - t0);
}

benchmark();
