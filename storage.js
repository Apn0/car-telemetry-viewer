// Shared telemetry storage layer: IndexedDB first, Supabase second.
//
// Design rule: a sample is considered safe once it is in IndexedDB. Network
// upload is a background best-effort process that catches up whenever a
// connection exists. This matters because the Nordschleife has patchy mobile
// coverage -- a cloud-only writer would silently lose whole sections of a lap.
"use strict";

const CT = (() => {

  const SUPABASE_URL  = "https://leamkupcgagwpjgarfcx.supabase.co";
  // Publishable (anon) key. Safe to ship in a public page: it grants no direct
  // table access to the telemetry tables at all -- every read and write goes
  // through SECURITY DEFINER RPCs, and the tables themselves have RLS enabled
  // with zero policies plus revoked grants.
  const SUPABASE_KEY  = "sb_publishable_uCXupK8fFjy7Va0bLP7vlg_AvASX845";

  const DB_NAME = "cartelemetry";
  const DB_VER  = 1;
  const STORE_SAMPLES = "samples";
  const STORE_RUNS    = "runs";

  const DEVICE_KEY = "cartelemetry_device_id_v1";
  const LABEL_KEY  = "cartelemetry_device_label_v1";

  const UPLOAD_BATCH   = 500;   // rows per RPC call (server cap is 2000)
  const WRITE_FLUSH_MS  = 4000; // buffer window before hitting IndexedDB
  const WRITE_FLUSH_MAX = 25;   // ...or this many samples, whichever first
  const CSV_HEADER = "epoch_ms,iso_time,lat,lon,alt_m,speed_kmh,bearing_deg,gps_accuracy_m,ax_ms2,ay_ms2,az_ms2,g_total";

  // ---------- ids ----------
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // RFC4122 v4 fallback for older WebViews
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = uuid(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  }
  function deviceLabel() {
    let l = localStorage.getItem(LABEL_KEY);
    if (!l) { l = guessDeviceLabel(); localStorage.setItem(LABEL_KEY, l); }
    return l;
  }
  function setDeviceLabel(l) {
    l = (l || "").trim().slice(0, 60);
    if (l) localStorage.setItem(LABEL_KEY, l);
    return l;
  }
  function guessDeviceLabel() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) {
      const m = ua.match(/Android[^;]*;\s*([^)]+?)(?:\s+Build|\))/);
      return m ? m[1].trim().slice(0, 40) : "Android phone";
    }
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows PC";
    return "Device";
  }

  // ---------- IndexedDB ----------
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_SAMPLES)) {
          // key [runId, t] gives natural dedupe and ordered range scans
          const s = d.createObjectStore(STORE_SAMPLES, { keyPath: ["runId", "t"] });
          s.createIndex("byRunUploaded", ["runId", "uploaded"]);
        }
        if (!d.objectStoreNames.contains(STORE_RUNS)) {
          d.createObjectStore(STORE_RUNS, { keyPath: "runId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  // ---------- run lifecycle ----------
  async function createRun({ channel, source = "browser" }) {
    const run = {
      runId: uuid(),
      deviceId: deviceId(),
      deviceLabel: deviceLabel(),
      channel,
      source,
      startedAt: Date.now(),
      endedAt: null,
      startedRemote: false
    };
    await tx(STORE_RUNS, "readwrite", s => s.put(run));
    return run;
  }
  async function getRun(runId)   { return tx(STORE_RUNS, "readonly", s => reqP(s.get(runId))); }
  async function putRun(run)     { return tx(STORE_RUNS, "readwrite", s => s.put(run)); }
  async function allRuns() {
    const rows = await tx(STORE_RUNS, "readonly", s => reqP(s.getAll()));
    return (rows || []).sort((a, b) => b.startedAt - a.startedAt);
  }
  async function endRun(runId) {
    const r = await getRun(runId);
    if (r && !r.endedAt) { r.endedAt = Date.now(); await putRun(r); }
    return r;
  }

  // ---------- samples ----------
  // `uploaded` is 0/1 (IndexedDB indexes can't key on booleans in all engines).
  //
  // Writes are buffered and flushed as one transaction rather than one
  // transaction per sample: on a phone, a per-tick transaction plus the
  // per-second full-range recount this used to do made the UI visibly lag
  // once a run had a few thousand rows.
  const writeBuf = new Map();          // runId -> [samples]
  let writeTimer = null;

  function addSample(runId, sample) {
    if (!writeBuf.has(runId)) writeBuf.set(runId, []);
    writeBuf.get(runId).push({ ...sample, runId, uploaded: 0 });
    if (!writeTimer) writeTimer = setTimeout(flushWrites, WRITE_FLUSH_MS);
    if (writeBuf.get(runId).length >= WRITE_FLUSH_MAX) return flushWrites();
    return Promise.resolve();
  }

  // Persist everything buffered so far. Called on a timer, when the buffer
  // fills, and unconditionally before a run ends or the page goes away.
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
  function bufferedCount() {
    let n = 0; for (const rows of writeBuf.values()) n += rows.length; return n;
  }
  async function countSamples(runId) {
    return tx(STORE_SAMPLES, "readonly", s =>
      reqP(s.count(IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]))));
  }
  async function pendingSamples(runId, limit = UPLOAD_BATCH) {
    return tx(STORE_SAMPLES, "readonly", s => {
      const idx = s.index("byRunUploaded");
      return reqP(idx.getAll(IDBKeyRange.only([runId, 0]), limit));
    });
  }
  async function countPending(runId) {
    return tx(STORE_SAMPLES, "readonly", s =>
      reqP(s.index("byRunUploaded").count(IDBKeyRange.only([runId, 0]))));
  }
  async function countPendingMany(runIds) {
    return tx(STORE_SAMPLES, "readonly", s => {
      const idx = s.index("byRunUploaded");
      const reqs = [];
      for (const runId of runIds) {
        reqs.push(reqP(idx.count(IDBKeyRange.only([runId, 0]))));
      }
      return Promise.all(reqs);
    });
  }
  async function markUploaded(items) {
    return tx(STORE_SAMPLES, "readwrite", s => {
      for (const item of items) {
        item.uploaded = 1;
        s.put(item);
      }
    });
  }
  async function getAllSamples(runId) {
    await flushWrites();
    const rows = await tx(STORE_SAMPLES, "readonly", s =>
      reqP(s.getAll(IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]))));
    return (rows || []).sort((a, b) => a.t - b.t);
  }
  async function deleteRun(runId) {
    await tx(STORE_SAMPLES, "readwrite", s => {
      const r = s.delete(IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]));
      return r;
    });
    await tx(STORE_RUNS, "readwrite", s => s.delete(runId));
  }

  // ---------- Supabase ----------
  async function rpc(fn, body, { timeoutMs = 15000 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${fn} ${res.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    } finally { clearTimeout(timer); }
  }

  async function ensureRemoteRun(run) {
    if (run.startedRemote) return true;
    await rpc("ct_start_run", {
      p_run_id: run.runId,
      p_device_id: run.deviceId,
      p_channel: run.channel,
      p_device_label: run.deviceLabel,
      p_source: run.source,
      p_user_agent: navigator.userAgent.slice(0, 400)
    });
    run.startedRemote = true;
    await putRun(run);
    return true;
  }

  function toRemoteRow(s) {
    return {
      t: s.t, fix: !!s.fix,
      lat: s.lat ?? null, lon: s.lon ?? null, alt_m: s.alt ?? null,
      speed_kmh: s.spd ?? null, bearing_deg: s.brg ?? null, hacc_m: s.hacc ?? null,
      ax_ms2: s.ax ?? null, ay_ms2: s.ay ?? null, az_ms2: s.az ?? null, g_total: s.g ?? null
    };
  }

  // Pushes one batch of pending rows for a run. Returns {sent, remaining}.
  // Safe to call repeatedly and concurrently-ish; server-side upsert makes
  // re-sending harmless, so a failed/duplicated attempt costs nothing.
  async function flushOnce(run) {
    await flushWrites();                 // never upload behind the write buffer
    const pend = await pendingSamples(run.runId, UPLOAD_BATCH);
    if (!pend.length) return { sent: 0, remaining: 0 };
    await ensureRemoteRun(run);
    await rpc("ct_push_samples", {
      p_run_id: run.runId,
      p_samples: pend.map(toRemoteRow)
    });
    await markUploaded(pend);
    const remaining = await countPending(run.runId);
    return { sent: pend.length, remaining };
  }

  async function finishRemote(runId) { await rpc("ct_end_run", { p_run_id: runId }); }

  async function listRunsByChannel(channel, limit = 50) {
    return rpc("ct_list_runs", { p_channel: channel, p_limit: limit });
  }
  async function listRunsByDevice(id = deviceId(), limit = 50) {
    return rpc("ct_list_device_runs", { p_device_id: id, p_limit: limit });
  }
  // PostgREST caps any single result set (1000 rows here) and truncates
  // silently, so page through with a keyset cursor on t until a short page
  // comes back. Without this a run longer than ~16 min at 1 Hz would load
  // only its first 1000 samples and look complete.
  async function fetchSamples(runId, onProgress) {
    const PAGE = 1000;
    const out = [];
    let after = null;
    for (let guard = 0; guard < 500; guard++) {
      const page = await rpc("ct_get_samples",
        { p_run_id: runId, p_after_t: after, p_limit: PAGE },
        { timeoutMs: 45000 });
      if (!page || !page.length) break;
      out.push(...page);
      if (onProgress) onProgress(out.length);
      if (page.length < PAGE) break;
      after = Number(page[page.length - 1].t);
    }
    return out;
  }

  // ---------- CSV ----------
  function samplesToCsv(rows) {
    const line = s => [
      s.t, new Date(s.t).toISOString(),
      s.lat ?? "", s.lon ?? "",
      s.alt != null ? s.alt.toFixed(1) : "",
      s.spd != null ? s.spd.toFixed(2) : "",
      s.brg != null ? s.brg.toFixed(1) : "",
      s.hacc != null ? s.hacc.toFixed(1) : "",
      s.ax != null ? s.ax.toFixed(3) : "",
      s.ay != null ? s.ay.toFixed(3) : "",
      s.az != null ? s.az.toFixed(3) : "",
      s.g  != null ? s.g.toFixed(3)  : ""
    ].join(",");
    return CSV_HEADER + "\n" + rows.map(line).join("\n") + "\n";
  }
  function downloadCsv(text, name) {
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Ask the browser not to evict our IndexedDB data under storage pressure.
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) {}
    return false;
  }

  return {
    uuid, deviceId, deviceLabel, setDeviceLabel, guessDeviceLabel,
    createRun, getRun, putRun, allRuns, endRun, deleteRun,
    addSample, flushWrites, bufferedCount, countSamples, countPending, countPendingMany, getAllSamples,
    flushOnce, finishRemote, ensureRemoteRun,
    listRunsByChannel, listRunsByDevice, fetchSamples,
    samplesToCsv, downloadCsv, requestPersistence,
    CSV_HEADER, SUPABASE_URL
  };
})();

if (typeof module !== 'undefined') module.exports = CT;
