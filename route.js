// Reference-route matching + forward-view drawing, shared by the logger HUD
// and the viewer. Keeps one implementation of "where am I on the lap and
// what's coming up", so the two pages can't drift apart.
"use strict";

const CTRoute = (() => {

  const DEFAULT_URL = "routes/nordschleife.gpx";

  let points = [];      // [{lat, lon, ele, distM}]
  let totalDistM = 0;
  let loop = false;
  let matchIdx = 0;
  let name = "";

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function parseGpx(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return Array.from(doc.getElementsByTagName("trkpt")).map(el => {
      const ele = el.getElementsByTagName("ele")[0];
      return {
        lat: parseFloat(el.getAttribute("lat")),
        lon: parseFloat(el.getAttribute("lon")),
        ele: ele ? parseFloat(ele.textContent) : null
      };
    });
  }

  function build(rawPoints, label) {
    const pts = rawPoints.filter(p => p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
    if (pts.length < 2) return false;
    let d = 0;
    pts[0].distM = 0;
    for (let i = 1; i < pts.length; i++) {
      d += haversineM(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
      pts[i].distM = d;
    }
    points = pts;
    totalDistM = d;
    loop = haversineM(pts[0].lat, pts[0].lon, pts[pts.length-1].lat, pts[pts.length-1].lon) < 200;
    name = label || "route";
    matchIdx = 0;
    return true;
  }

  async function load(url = DEFAULT_URL, label = "Nürburgring Nordschleife") {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      return build(parseGpx(await res.text()), label);
    } catch (e) { return false; }
  }

  // Nearest route point, searching a window around the previous match first
  // (cheap while actually driving the lap) and falling back to a full scan.
  function nearestIdx(lat, lon) {
    if (!points.length) return -1;
    const scan = (from, to) => {
      let bi = -1, bd = Infinity;
      for (let i = Math.max(0, from); i < Math.min(points.length, to); i++) {
        const d = haversineM(lat, lon, points[i].lat, points[i].lon);
        if (d < bd) { bd = d; bi = i; }
      }
      return { bi, bd };
    };
    let { bi, bd } = scan(matchIdx - 40, matchIdx + 120);
    if (bi === -1 || bd > 150) ({ bi, bd } = scan(0, points.length));
    if (bi >= 0) matchIdx = bi;
    return bi;
  }

  // How far along the lap the given position is, plus how far off-route it is.
  function locate(lat, lon) {
    const i = nearestIdx(lat, lon);
    if (i < 0) return null;
    return {
      idx: i,
      distAlongM: points[i].distM,
      offRouteM: haversineM(lat, lon, points[i].lat, points[i].lon)
    };
  }

  // Route points from the current position out to `aheadM` further along.
  function forwardWindow(lat, lon, aheadM) {
    if (!points.length) return [];
    const idx = nearestIdx(lat, lon);
    if (idx < 0) return [];
    const start = points[idx].distM;
    const out = [];
    let i = idx;
    while (out.length < 4000) {
      const p = points[i];
      const d = p.distM - start + (p.distM < start ? totalDistM : 0);
      out.push({ lat: p.lat, lon: p.lon, ele: p.ele, aheadM: d });
      if (d >= aheadM) break;
      i++;
      if (i >= points.length) { if (!loop) break; i = 0; }
    }
    return out;
  }

  // Draws the upcoming track rotated so "forward" is up. `opts.corners` is an
  // optional [{name, aheadM}] list from CTCorners, drawn as labels on the path.
  function drawForward(canvas, win, carBearing, opts = {}) {
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 900, h = canvas.clientHeight || 260;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!win || win.length < 2) {
      ctx.fillStyle = css("--muted");
      ctx.font = "13px system-ui";
      ctx.fillText(opts.emptyText || "waiting for a GPS fix…", 12, h / 2);
      return;
    }

    const oLat = win[0].lat, oLon = win[0].lon;
    const brg = ((carBearing || 0) * Math.PI) / 180;
    const cosLat = Math.cos((oLat * Math.PI) / 180);
    const proj = p => {
      const ex = (p.lon - oLon) * 111320 * cosLat;
      const ny = (p.lat - oLat) * 110574;
      return { fx: ex * Math.cos(brg) - ny * Math.sin(brg),
               fy: ex * Math.sin(brg) + ny * Math.cos(brg) };
    };
    const pr = win.map(proj);
    const maxAhead = Math.max(...pr.map(p => p.fy), 1);
    const maxSide  = Math.max(...pr.map(p => Math.abs(p.fx)), 1);

    const mB = 26, mT = 14, mS = 24;
    const scale = Math.min((h - mT - mB) / maxAhead, (w - mS * 2) / (2 * maxSide));
    const cx = w / 2, cy = h - mB;
    const toC = p => ({ x: cx + p.fx * scale, y: cy - p.fy * scale });

    ctx.strokeStyle = css("--grid");
    ctx.fillStyle = css("--muted");
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    for (let d = 100; d <= maxAhead; d += 100) {
      const y = cy - d * scale;
      ctx.beginPath(); ctx.moveTo(mS, y); ctx.lineTo(w - mS, y); ctx.stroke();
      ctx.fillText(d + "m", w - 6, y - 3);
    }
    ctx.textAlign = "left";

    ctx.strokeStyle = css("--series-1");
    ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    pr.forEach((p, i) => { const c = toC(p); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); });
    ctx.stroke();

    // corner labels pinned to their point on the drawn path
    if (opts.corners && opts.corners.length) {
      ctx.font = "600 12px system-ui";
      for (const c of opts.corners) {
        if (c.aheadM < 0 || c.aheadM > maxAhead) continue;
        let bi = 0, bd = Infinity;
        win.forEach((p, i) => { const d = Math.abs(p.aheadM - c.aheadM); if (d < bd) { bd = d; bi = i; } });
        const pt = toC(pr[bi]);
        ctx.fillStyle = css("--series-2");
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
        const label = c.name;
        const tw = ctx.measureText(label).width;
        let lx = pt.x + 8;
        if (lx + tw > w - 4) lx = pt.x - 8 - tw;
        ctx.fillStyle = css("--surface-1");
        ctx.fillRect(lx - 3, pt.y - 15, tw + 6, 14);
        ctx.fillStyle = css("--text-primary");
        ctx.fillText(label, lx, pt.y - 4);
      }
    }

    const withEle = win.filter(p => p.ele != null);
    if (withEle.length >= 2) {
      const rise = withEle[withEle.length - 1].ele - withEle[0].ele;
      ctx.fillStyle = css("--text-secondary");
      ctx.font = "12px system-ui";
      ctx.fillText((rise >= 0 ? "▲ +" : "▼ ") + rise.toFixed(0) + "m over next " + Math.round(maxAhead) + "m", 12, 16);
    }

    ctx.fillStyle = css("--series-2");
    ctx.strokeStyle = css("--surface-1");
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx - 7, cy + 7); ctx.lineTo(cx + 7, cy + 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  return {
    load, build, parseGpx, locate, forwardWindow, drawForward, haversineM,
    get points()     { return points; },
    get totalDistM() { return totalDistM; },
    get loop()       { return loop; },
    get name()       { return name; },
    get loaded()     { return points.length > 1; }
  };
})();

if (typeof module !== "undefined") module.exports = CTRoute;
