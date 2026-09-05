const fs = require('fs');

let code = fs.readFileSync('storage.js', 'utf8');

const originalFlush = `
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

const optFlush = `
  async function flushWrites() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (!writeBuf.size) return 0;

    // Flatten the pending samples into a single array
    const pending = [];
    for (const rows of writeBuf.values()) {
      for (const r of rows) pending.push(r);
    }
    writeBuf.clear();

    if (!pending.length) return 0;

    let n = 0;
    await tx(STORE_SAMPLES, "readwrite", s => {
      // IndexedDB limits and main thread blocking:
      // Insert in chunks to avoid blocking the event loop for too long on massive batches.
      const CHUNK_SIZE = 500;
      let i = 0;
      function nextChunk() {
        const limit = Math.min(i + CHUNK_SIZE, pending.length);
        let lastReq = null;
        for (; i < limit; i++) {
          lastReq = s.put(pending[i]);
          n++;
        }
        if (i < pending.length && lastReq) {
          lastReq.onsuccess = nextChunk;
        }
      }
      nextChunk();
    });
    return n;
  }
`.trim();

code = code.replace(originalFlush, optFlush);
code = code.replace('const WRITE_FLUSH_MAX = 25;', 'const WRITE_FLUSH_MAX = 50000;');

fs.writeFileSync('storage_opt.js', code);
