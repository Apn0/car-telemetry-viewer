require("fake-indexeddb/auto");

async function benchmark() {
  const SAMPLES = 20000;
  let rows = [];
  for (let i=0; i<SAMPLES; i++) rows.push({runId:"1", t:i, a:1});

  const db = await new Promise((res) => {
      const r = indexedDB.open("test", 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore("s", {keyPath: ["runId", "t"]});
      r.onsuccess = e => res(e.target.result);
  });

  // Try recursive vs loop vs flat chunked

  let t0 = performance.now();
  await new Promise(res => {
      const tx = db.transaction("s", "readwrite");
      tx.oncomplete = () => res();
      const store = tx.objectStore("s");
      let i = 0;
      function next() {
          const end = Math.min(i + 250, rows.length);
          let req;
          for (; i < end; i++) {
              req = store.put(rows[i]);
          }
          if (i < rows.length && req) {
              req.onsuccess = next;
          }
      }
      next();
  });
  console.log("Chunked loop 250:", performance.now() - t0);

  t0 = performance.now();
  await new Promise(res => {
      const tx = db.transaction("s", "readwrite");
      tx.oncomplete = () => res();
      const store = tx.objectStore("s");
      let i = 0;
      function next() {
          const end = Math.min(i + 1000, rows.length);
          let req;
          for (; i < end; i++) {
              req = store.put(rows[i]);
          }
          if (i < rows.length && req) {
              req.onsuccess = next;
          }
      }
      next();
  });
  console.log("Chunked loop 1000:", performance.now() - t0);

  t0 = performance.now();
  await new Promise(res => {
      const tx = db.transaction("s", "readwrite");
      tx.oncomplete = () => res();
      const store = tx.objectStore("s");
      let i = 0;
      function next() {
          const end = Math.min(i + 4000, rows.length);
          let req;
          for (; i < end; i++) {
              req = store.put(rows[i]);
          }
          if (i < rows.length && req) {
              req.onsuccess = next;
          }
      }
      next();
  });
  console.log("Chunked loop 4000:", performance.now() - t0);
}

benchmark();
