require("fake-indexeddb/auto");

// mock localStorage
const { LocalStorage } = require("node-localstorage") || {};
// Fallback if not available
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {}
  };
}

const Storage = require('./storage.js');
const fs = require('fs');

async function benchmark() {
  console.log("Setting up benchmark...");

  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test", source: "benchmark" });

  const SAMPLES = 10000;
  console.log(`Generating ${SAMPLES} samples...`);

  const startTime = performance.now();

  for (let i = 0; i < SAMPLES; i++) {
    await Storage.addSample(runId, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }
  await Storage.flushWrites();

  const endTime = performance.now();
  console.log(`Time taken: ${(endTime - startTime).toFixed(2)} ms`);
}

benchmark().catch(console.error);
