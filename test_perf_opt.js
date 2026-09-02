require("fake-indexeddb/auto");
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = { getItem: () => null, setItem: () => {} };
}
const fs = require('fs');

let code = fs.readFileSync('storage.js', 'utf8');
code = code.replace('const WRITE_FLUSH_MAX = 25;', 'const WRITE_FLUSH_MAX = 50000;');

// Let's implement chunking with request chaining for large arrays
code = code.replace(`
    await tx(STORE_SAMPLES, "readwrite", s => {
      for (const [, rows] of pending) for (const r of rows) { s.put(r); n++; }
    });
`, `
    const allRows = [];
    for (const [, rows] of pending) {
        for (const r of rows) {
            allRows.push(r);
        }
    }

    await tx(STORE_SAMPLES, "readwrite", s => {
      // Is there putAll? Chrome has a putAll proposal but it might not be standard.
      // Wait, there's a trick to not block the event loop? Or we can just chunk it.
      // Or maybe the prompt wants us to chunk?
      // "acknowledge it as a common pattern that can still cause performance lag on large batches."
      // Actually, if we just do chunked insertions we can avoid blocking the main thread.
      // But we are in async flushWrites, we can just await smaller transactions!
      // But the comment says: "Writes are buffered and flushed as one transaction rather than one transaction per sample: on a phone, a per-tick transaction plus the per-second full-range recount this used to do made the UI visibly lag once a run had a few thousand rows."
      // So they WANT one transaction.
      // Maybe we can check if \`s.put\` supports multiple arguments? No it doesn't.

      // Let's try to just do standard s.put but chunked via onsuccess chaining, or maybe just chunk the whole writes?
      for (const r of allRows) {
        s.put(r);
        n++;
      }
    });
`);

fs.writeFileSync('storage_opt.js', code);

const Storage = require('./storage_opt.js');

async function run() {
  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test" });

  const SAMPLES = 20000;
  for (let i = 0; i < SAMPLES; i++) {
    await Storage.addSample(runId, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }

  const startTime = performance.now();
  await Storage.flushWrites();
  console.log(`Optimized flushWrites (20000 items): ${(performance.now() - startTime).toFixed(2)} ms`);
}
run();
