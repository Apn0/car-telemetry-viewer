require("fake-indexeddb/auto");
if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = { getItem: () => null, setItem: () => {} };
}
const fs = require('fs');

async function run() {
  const Storage = require('./storage.js');

  // Expose some internals to mock large buffer
  // Since we can't directly alter WRITE_FLUSH_MAX, we'll just time flushWrites
  // after adding multiple samples.

  // Create run
  const runId = Storage.uuid();
  await Storage.createRun({ channel: "test" });

  // wait, addSample triggers flush if size >= 25. We need to disable auto-flush or mock it.
  // Instead of testing addSample, we can mock writeBuf if it was accessible... it's not.
  // We can just rely on the previous benchmark times that showed chunking prevents main-thread blocking,
  // which causes "UI visibly lag" as mentioned in the comments.
  // Oh wait, the problem is about "N+1 Query in flushWrites", and "Instead of individual s.put(r) calls in a tight loop, consider a more efficient way to insert multiple rows or just acknowledge it as a common pattern that can still cause performance lag on large batches."
}
run();
