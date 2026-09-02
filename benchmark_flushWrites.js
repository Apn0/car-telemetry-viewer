require("fake-indexeddb/auto");

// mock localStorage
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {}
  };
}

const Storage = require('./storage.js');

async function benchmark() {
  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test", source: "benchmark" });

  const SAMPLES = 20000;

  // Fill the buffer manually to avoid `addSample` auto-flushing
  // Actually addSample auto-flushes at WRITE_FLUSH_MAX (500).
  // The issue mentions N+1 query in flushWrites. If we put 20,000 items in one flushWrites,
  // we need to mock it or change the max.
  // We can just override WRITE_FLUSH_MAX for the test if it's exported, but it isn't.
  // Instead, let's just time 20000 items with the current auto-flush mechanism, which is 40 flushes of 500 items.
  // Wait, if it's 40 flushes, it still takes time.
  // Let's time how long it takes to insert 20,000 items.

  const startTime = performance.now();
  for (let i = 0; i < SAMPLES; i++) {
    await Storage.addSample(runId, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }
  await Storage.flushWrites(); // Ensure any remaining are flushed
  const endTime = performance.now();
  console.log(`Baseline time for 20000 items: ${(endTime - startTime).toFixed(2)} ms`);
}

benchmark().catch(console.error);
