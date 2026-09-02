// Corner callouts for a reference route.
//
// The 42 Nordschleife corner names and their lap positions come from the same
// OpenStreetMap relation (38566) as the route geometry itself -- each member
// way carries a `name` tag (Flugplatz, Bergwerk, Karussell, ...), so the
// callouts are real circuit data rather than anything hand-placed.
"use strict";

const CTCorners = (() => {

  const DEFAULT_URL = "routes/nordschleife-corners.json";

  let corners = [];     // [{name, distM, lat, lon}] sorted by distM
  let totalDistM = 0;
  let loaded = false;

  async function load(url = DEFAULT_URL) {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const d = await res.json();
      corners = (d.corners || []).slice().sort((a, b) => a.distM - b.distM);
      totalDistM = d.totalDistM || 0;
      loaded = corners.length > 0;
      return loaded;
    } catch (e) { return false; }
  }

  // How far ahead to call a corner: far enough to be useful at speed, but not
  // so far that it's meaningless when crawling. ~6 s of travel, clamped.
  function lookaheadM(speedKmh) {
    const v = Math.max(speedKmh || 0, 0) / 3.6;
    return Math.min(Math.max(v * 6, 120), 450);
  }

  // Given how far along the lap we are, return the next corner and the
  // distance to it (wrapping around the loop).
  function next(distAlongM) {
    if (!loaded || !totalDistM) return null;
    const d = ((distAlongM % totalDistM) + totalDistM) % totalDistM;
    for (const c of corners) if (c.distM > d) return { corner: c, aheadM: c.distM - d };
    // past the last named corner -> wrap to the first
    const first = corners[0];
    return { corner: first, aheadM: totalDistM - d + first.distM };
  }

  // Corner immediately behind us, i.e. the one we're in / just left.
  function current(distAlongM) {
    if (!loaded || !totalDistM) return null;
    const d = ((distAlongM % totalDistM) + totalDistM) % totalDistM;
    let cur = corners[corners.length - 1];
    for (const c of corners) { if (c.distM <= d) cur = c; else break; }
    return cur;
  }

  // Corners falling inside [distAlongM, distAlongM + windowM], for drawing
  // labels onto the forward view.
  function within(distAlongM, windowM) {
    if (!loaded || !totalDistM) return [];
    const d = ((distAlongM % totalDistM) + totalDistM) % totalDistM;
    const out = [];
    for (let lap = 0; lap < 2; lap++) {
      for (const c of corners) {
        const ahead = c.distM + lap * totalDistM - d;
        if (ahead >= -30 && ahead <= windowM) out.push({ ...c, aheadM: ahead });
      }
    }
    return out.sort((a, b) => a.aheadM - b.aheadM);
  }

  // ---------- speech ----------
  // Announces each corner once, when it comes inside the lookahead window.
  // Deliberately silent below a walking-pace threshold so a parked phone
  // doesn't chatter, and it never repeats the same corner twice in a row.
  let speechOn = false;
  let lastSpoken = null;
  let voice = null;
  let minSpeakKmh = 25;

  function speechSupported() { return typeof speechSynthesis !== "undefined"; }

  function setSpeech(on) {
    speechOn = !!on && speechSupported();
    if (!speechOn) { try { speechSynthesis.cancel(); } catch (e) {} }
    return speechOn;
  }
  function isSpeechOn() { return speechOn; }

  function pickVoice() {
    if (!speechSupported()) return null;
    const vs = speechSynthesis.getVoices() || [];
    // German voice pronounces the corner names far better than an English one
    voice = vs.find(v => /^de(-|_|$)/i.test(v.lang)) || vs[0] || null;
    return voice;
  }

  // Say something immediately -- also used to "prime" speech inside a user
  // gesture, since mobile browsers block speech that wasn't user-initiated.
  function say(text) {
    if (!speechSupported()) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (!voice) pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = 1.05;
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function resetSpoken() { lastSpoken = null; }

  // Call every tick with the current lap position and speed.
  function maybeAnnounce(distAlongM, speedKmh) {
    if (!speechOn || !loaded) return null;
    if ((speedKmh || 0) < minSpeakKmh) return null;
    const n = next(distAlongM);
    if (!n) return null;
    if (n.aheadM > lookaheadM(speedKmh)) return null;
    const key = n.corner.name + "@" + n.corner.distM;
    if (key === lastSpoken) return null;
    lastSpoken = key;
    say(n.corner.name);
    return n.corner.name;
  }

  if (typeof speechSynthesis !== "undefined") {
    try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {}
  }

  return {
    load, next, current, within, lookaheadM,
    setSpeech, isSpeechOn, speechSupported, say, maybeAnnounce, resetSpoken, pickVoice,
    get count() { return corners.length; },
    get totalDistM() { return totalDistM; },
    get loaded() { return loaded; },
    get all() { return corners.slice(); }
  };
})();

if (typeof module !== "undefined") module.exports = CTCorners;
