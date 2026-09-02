require("fake-indexeddb/auto");
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = { getItem: () => null, setItem: () => {} };
}
const fs = require('fs');
let code = fs.readFileSync('storage.js', 'utf8');

code = code.replace('const WRITE_FLUSH_MAX = 25;', 'const WRITE_FLUSH_MAX = 50000;');
fs.writeFileSync('storage_mod.js', code);

const Storage = require('./storage_mod.js');

async function run() {
  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test" });

  const SAMPLES = 20000;
  for (let i = 0; i < SAMPLES; i++) {
    await Storage.addSample(runId, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }

  const startTime = performance.now();
  await Storage.flushWrites();
  console.log(`Baseline flushWrites (20000 items): ${(performance.now() - startTime).toFixed(2)} ms`);
}
run();
