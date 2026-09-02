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
    const pending = [...writeBuf.entries()];
    writeBuf.clear();

    // Flatten arrays to avoid nesting overhead and prepare for potential chunking
    const allSamples = [];
    for (const [, rows] of pending) {
      for (const r of rows) {
        allSamples.push(r);
      }
    }

    let n = allSamples.length;

    await tx(STORE_SAMPLES, "readwrite", s => {
      // Chunking put operations prevents blocking the main thread for too long
      // on massive arrays, which resolves UI lag (the N+1 tight loop issue)
      let i = 0;
      function nextChunk() {
        const end = Math.min(i + 250, n);
        let req;
        for (; i < end; i++) {
          req = s.put(allSamples[i]);
        }
        if (i < n && req) {
          req.onsuccess = nextChunk;
        }
      }
      nextChunk();
    });
    return n;
  }
`.trim();

code = code.replace(originalFlush, optFlush);
fs.writeFileSync('storage.js', code);
