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

  // What if we don't return anything from the tx function?
  // Let's implement chunking with setTimeout ? No, setTimeout breaks tx.
  // Wait, chunking with onsuccess is the only way to avoid blocking the event loop.
  // The issue is: "Instead of individual s.put(r) calls in a tight loop, consider a more efficient way to insert multiple rows or just acknowledge it as a common pattern that can still cause performance lag on large batches."

  // So chunking via onsuccess is exactly what they want!
}
benchmark();
