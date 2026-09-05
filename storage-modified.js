const fs = require('fs');
let code = fs.readFileSync('storage.js', 'utf8');

const oldFlush = `
  async function flushWrites() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (!writeBuf.size) return 0;
    const pending = [...writeBuf.entries()];
    writeBuf.clear();
    let n = 0;
    await tx(STORE_SAMPLES, "readwrite", s => {
      for (const [, rows] of pending) for (const r of rows) { s.put(r); n++; }
    });
    return n;
  }
`.trim();

const newFlush = `
  async function flushWrites() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (!writeBuf.size) return 0;
    const pending = [...writeBuf.entries()];
    writeBuf.clear();
    let n = 0;

    await tx(STORE_SAMPLES, "readwrite", s => {
      // Not all browsers support putAll, so try it but fallback if needed. No wait, is there putAll?
      // let's just use regular put but maybe Promise.all or something?
      // IndexedDB transactions auto-commit when the event loop is empty.
      // Individual 'put' calls are fine, but in a loop they might be slow.
      // Wait, is there a faster way than s.put(r) in a loop?
      // Actually s.put doesn't block, but it returns an IDBRequest which adds overhead.
      // There's no standard s.putAll().
      // But maybe we don't need to wrap them in tx if we just do:
      for (const [, rows] of pending) {
        for (const r of rows) {
          s.put(r);
          n++;
        }
      }
    });
    return n;
  }
`.trim();
