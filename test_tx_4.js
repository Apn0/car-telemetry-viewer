require("fake-indexeddb/auto");
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = { getItem: () => null, setItem: () => {} };
}
const Storage = require('./storage.js');
async function run() {
  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test" });

  const SAMPLES = 20000;
  for (let i = 0; i < SAMPLES; i++) {
    await Storage.addSample(runId, { t: Date.now() + i, ax: 1, ay: 2, az: 3 });
  }

  // mock chunked flush
  Storage.flushWrites = async function() {
    // we need to access writeBuf, which is private inside the closure
    // so we can't test it directly unless we modify storage.js
  };
}
run();
