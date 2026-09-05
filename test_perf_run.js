require("fake-indexeddb/auto");
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = { getItem: () => null, setItem: () => {} };
}

async function run() {
  const Storage = require('./storage_mod.js');
  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test" });

  const SAMPLES = 20000;
  for (let i = 0; i < SAMPLES; i++) {
    await Storage.addSample(runId, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }

  let startTime = performance.now();
  await Storage.flushWrites();
  console.log(`Baseline flushWrites (20000 items): ${(performance.now() - startTime).toFixed(2)} ms`);

  // Now test optimized
  const StorageOpt = require('./storage_opt.js');
  const runId2 = StorageOpt.uuid();
  await StorageOpt.createRun({ channel: "test2" });

  for (let i = 0; i < SAMPLES; i++) {
    await StorageOpt.addSample(runId2, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }

  startTime = performance.now();
  await StorageOpt.flushWrites();
  console.log(`Optimized flushWrites (20000 items): ${(performance.now() - startTime).toFixed(2)} ms`);
}
run();
