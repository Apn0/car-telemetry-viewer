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
    let n = 0;
    await tx(STORE_SAMPLES, "readwrite", s => {
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

// The above won't give a performance difference since it's the exact same loop but unrolled.
// What about preventing N+1 array creations and iterating directly?
// Actually "Instead of individual s.put(r) calls in a tight loop, consider a more efficient way to insert multiple rows or just acknowledge it as a common pattern that can still cause performance lag on large batches."
// What if there is no other way, and we just chunk it?
// No, the task specifically mentions "acknowledge it as a common pattern that can still cause performance lag on large batches".
// And the requirement asks me to document it if I cannot measure a meaningful improvement, or establish a baseline and optimize.
