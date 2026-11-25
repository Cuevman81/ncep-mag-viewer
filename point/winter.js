// Copied from FX-Net NextGen (app.js). Top-level names match so the two copies
// can be compared; tests/_load.js finds declarations by name at column 0.

// ═══ Winter Precip Meteogram: snow / sleet / ice by model ═══
//
// Modelled on Iowa State's BUFKIT Meteogram Generator, from the same data. IEM
// parses the BUFKIT archive into JSON (CORS-open, nearest site to a lat/lon):
// hourly precip, the model's own snow/sleet/freezing-rain/rain flags and the
// full profile. ECMWF comes from Open-Meteo, the official forecast from the NWS
// grid, and the snow odds from Open-Meteo's ensembles. Loads only when opened.
//
// Facts measured 2026-11-25, all of which shape the code below:
// - P01M is the amount over the STEP, also where GFS goes 3-hourly after F120.
// - SNFL (HRRR/RAP/RRFS snowfall) is unusable: 342 mm of snow from 0.41 mm of
//   liquid. Snow is computed here from precip, type and profile.
// - HRRR and RAP reach 48-51 h only on the 00/06/12/18Z and 03/09/15/21Z runs.
// - Open-Meteo interpolates ECMWF's precip-type CODES linearly between steps, so
//   hourly output invents freezing rain (code 3) at 40 F. Native steps only.
// - AIGEFS "snowfall" is a 0 C cutoff added by Open-Meteo, so it is left out.

const IEM_BUFKIT = 'https://mesonet.agron.iastate.edu/api/1/nws/bufkit.json';
const WINTER_MODELS = [
    { id: 'RRFS',  label: 'RRFS',  color: '#ff4f6d', every: 6, off: 0, lag: 2 },
    { id: 'HRRR',  label: 'HRRR',  color: '#ff8a3c', every: 6, off: 0, lag: 1 },
    { id: 'RAP',   label: 'RAP',   color: '#7cff6b', every: 6, off: 3, lag: 1 },
    { id: 'GFS',   label: 'GFS',   color: '#00e5ff', every: 6, off: 0, lag: 4.5 },
    { id: 'ECMWF', label: 'ECMWF', color: '#ff5ad1' }
];
const WINTER_NWS = { id: 'NWS', label: 'NWS official', color: '#ffffff' };
const WINTER_ENS = [
    { id: 'ecmwf_ifs025_ensemble', label: 'ECMWF ENS', n: 51 },
    { id: 'ecmwf_aifs025_ensemble', label: 'AIFS-ENS', n: 51, ai: true },
    { id: 'ncep_gefs025', label: 'GEFS', n: 31 }
];
const WINTER_TYPES = {
    snow:  { label: 'Snow',          color: '#4aa3ff' },
    sleet: { label: 'Sleet',         color: '#b15cff' },
    zr:    { label: 'Freezing rain', color: '#ff4fa3' },
    rain:  { label: 'Rain',          color: '#2fae5b' }
};
const WINTER_SLEET_RATIO = 2;
const WINTER_MAX_MI = 100;
const WINTER_MIN_RATE = 0.05;
const MM_IN = 1 / 25.4;

let winterData = null;
let winterPoint = null;
let winterSeq = 0;
const winterHidden = new Set((() => {
    try { return JSON.parse(localStorage.getItem('ncep_winter_hidden') || '[]'); } catch (_) { return []; }
})());

// Kuchera snow-to-liquid ratio from the warmest temperature (K) between the
// surface and 500 mb. Steeper above 271.16 K (-2 C); never below zero.
function kucheraRatio(tmaxK) {
    if (tmaxK == null || isNaN(tmaxK)) return null;
    const d = 271.16 - tmaxK;
    return Math.max(0, 12 + (d < 0 ? 2 * d : d));
}

// FRAM ice-to-liquid ratio (Sanders & Barjenbruch 2016, Eqs. 2-7): rate in
// in/h, wet bulb in C, wind in kt. The paper sets Tw below -7 C to -7 C, and its
// data start at 0.02 in/h, so lighter rates use that rate's ratio (the power law
// otherwise runs away for drizzle). Never negative.
function framRatio(rateInHr, twC, windKt) {
    const p = Math.max(0.02, rateInHr), tw = Math.max(-7, twC), v = Math.max(0, windKt);
    const ip = 0.1395 * Math.pow(p, -0.541);
    const it = -0.0071 * tw * tw * tw - 0.1039 * tw * tw - 0.3904 * tw + 0.5545;
    const iv = 0.0014 * v * v + 0.0027 * v + 0.7574;
    const w = tw > -0.35 ? [0.70, 0.29, 0.01] : v > 12 ? [0.73, 0.01, 0.26] : [0.79, 0.20, 0.01];
    return Math.max(0, w[0] * ip + w[1] * it + w[2] * iv);
}

// Flat (elevated horizontal) ice in inches from freezing-rain liquid in mm.
function framIce(zrMm, hrs, twC, windKt) {
    if (!(zrMm > 0) || twC == null || windKt == null) return 0;
    const inch = zrMm * MM_IN;
    return inch * framRatio(inch / hrs, twC, windKt);
}

// How a step's liquid divides among types from the model's own flags. Several
// flags at once share it equally; wet with no flag counts as rain.
function winterShares(q) {
    const f = { snow: q.WXTS === 1, sleet: q.WXTP === 1, zr: q.WXTZ === 1, rain: q.WXTR === 1 };
    const on = Object.keys(f).filter(k => f[k]);
    const out = { snow: 0, sleet: 0, zr: 0, rain: 0 };
    if (!on.length) { out.rain = 1; return out; }
    on.forEach(k => { out[k] = 1 / on.length; });
    return out;
}

// One precip step (all liquid in mm) with everything the panel plots.
function winterStep(ms, hrs, liq, shares, ratio, t2, tw, wind) {
    const zr = liq * shares.zr;
    return { ms, hrs, liq, snow: liq * shares.snow, sleet: liq * shares.sleet, zr, rain: liq * shares.rain,
        kuch: liq * shares.snow * MM_IN * (ratio == null ? 10 : ratio), ice: framIce(zr, hrs, tw, wind), t2, tw };
}

// IEM BUFKIT JSON -> steps. The analysis hour has no precip of its own.
function winterFromBufkit(j) {
    const P = (j && j.profiles) || [];
    const steps = [];
    for (let i = 1; i < P.length; i++) {
        const q = P[i].parameters || {};
        const hrs = P[i].forecast_hour - P[i - 1].forecast_hour;
        if (!(hrs > 0) || q.P01M == null) continue;
        let tmax = q.T2MS == null ? -999 : q.T2MS;
        (P[i].levels || []).forEach(l => { if (l.PRES >= 500 && l.TMPC != null && l.TMPC > tmax) tmax = l.TMPC; });
        const l0 = (P[i].levels || [])[0] || {};
        const tw = l0.TMWC != null ? l0.TMWC : q.T2MS;
        const wind = q.UWND == null || q.VWND == null ? null : Math.hypot(q.UWND, q.VWND) * 1.943844;
        steps.push(winterStep(Date.parse(P[i].time), hrs, Math.max(0, q.P01M), winterShares(q),
            tmax > -999 ? kucheraRatio(tmax + 273.15) : null, q.T2MS == null ? null : q.T2MS, tw, wind));
    }
    const src = j.source || {};
    return { run: Date.parse(src.run_time), station: src.station, lat: j.lat, lon: j.lon, steps };
}

// ECMWF at native steps. Snow is the model's own snowfall water equivalent; the
// type code only splits what is left, and only as ice where the wet bulb allows
// it. After F144 the model is 6-hourly and Open-Meteo's in-between codes are
// interpolated, so those steps take the code of the 6-hour step they end in.
function winterFromEcmwf(h, runMs) {
    const t = (h && h.time || []).map(x => Date.parse(x + 'Z'));
    const steps = [];
    for (let i = 1; i < t.length; i++) {
        const hrs = (t[i] - t[i - 1]) / 3600000, liq = h.precipitation[i];
        if (liq == null || !(hrs > 0)) continue;
        let k = i;
        if (runMs && t[i] - runMs > 144 * 3600000) {
            while (k < t.length - 1 && new Date(t[k]).getUTCHours() % 6 !== 0) k++;
        }
        const code = h.precipitation_type[k], tw = h.wet_bulb_temperature_2m[i], t2 = h.temperature_2m[i];
        const snow = Math.min(liq, Math.max(0, h.snowfall_water_equivalent[i] || 0));
        const rest = liq > 0 ? (liq - snow) / liq : 0;
        const kind = code === 8 && tw <= 2 ? 'sleet' : (code === 3 || code === 12) && tw <= 0.5 ? 'zr' : 'rain';
        const sh = { snow: liq > 0 ? snow / liq : 0, sleet: 0, zr: 0, rain: 0 };
        sh[kind] = rest;
        const ts = [t2].concat(['925', '850', '700', '500'].map(p => (h[`temperature_${p}hPa`] || [])[i])).filter(v => v != null);
        steps.push(winterStep(t[i], hrs, liq, sh, ts.length ? kucheraRatio(Math.max(...ts) + 273.15) : null, t2, tw, h.wind_speed_10m[i]));
    }
    return { run: runMs || null, steps };
}

// "PT6H", "P1DT2H" -> hours.
function isoDurHours(s) {
    const m = /^P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?)?/.exec(s || '');
    return m ? (+m[1] || 0) * 24 + (+m[2] || 0) : 0;
}

// NWS grid: snow and ice are already accumulations (mm) over each interval.
function winterFromNws(p) {
    const read = k => (((p || {})[k] || {}).values || []).map(v => {
        const [a, d] = String(v.validTime).split('/');
        return { ms: Date.parse(a), hrs: isoDurHours(d), v: v.value };
    }).filter(v => v.hrs > 0 && v.v != null);
    return { run: Date.parse((p || {}).updateTime) || null, snow: read('snowfallAmount'), ice: read('iceAccumulation'),
        liq: read('quantitativePrecipitation'), t2: read('temperature') };
}

// Hourly bins over the window [t0, t0 + n h). Multi-hour amounts spread evenly.
// Bins a run never reaches stay null, so a short run ends instead of flatlining.
const WINTER_KEYS = ['liq', 'snow', 'sleet', 'zr', 'rain', 'kuch', 'ice'];
function winterBins(steps, t0, n) {
    const out = { t2: new Array(n).fill(null), tw: new Array(n).fill(null) };
    WINTER_KEYS.forEach(k => { out[k] = new Array(n).fill(null); });
    (steps || []).forEach((s, j) => {
        const prev = j > 0 ? steps[j - 1] : s;
        const mid = (k, f) => s[k] == null || prev[k] == null ? s[k] : prev[k] + (s[k] - prev[k]) * f;
        for (let h = 0; h < s.hrs; h++) {
            const i = Math.round((s.ms - (s.hrs - h) * 3600000 - t0) / 3600000);
            if (i < 0 || i >= n) continue;
            WINTER_KEYS.forEach(k => { out[k][i] = (out[k][i] || 0) + s[k] / s.hrs; });
            out.t2[i] = mid('t2', (h + 1) / s.hrs);   // valid at the end of the hour
            out.tw[i] = mid('tw', (h + 1) / s.hrs);
        }
    });
    return out;
}
function winterBinNws(list, t0, n, scale) {
    const out = new Array(n).fill(null);
    list.forEach(s => {
        for (let h = 0; h < s.hrs; h++) {
            const i = Math.round((s.ms + h * 3600000 - t0) / 3600000);
            if (i >= 0 && i < n) out[i] = (out[i] || 0) + s.v * scale / s.hrs;
        }
    });
    return out;
}

// Running total; null where the source has no data, so lines stop there.
function winterCum(a) {
    let sum = 0;
    return a.map(v => v == null ? null : (sum += v));
}
// Hour-by-hour average of whichever models cover that hour, accumulated. An
// average of the running totals would drop each time a short run ended.
function winterMeanCum(list) {
    if (!list.length) return [];
    let sum = 0;
    return list[0].map((_, i) => {
        const v = list.map(a => a[i]).filter(x => x != null);
        if (!v.length) return null;
        sum += v.reduce((p, c) => p + c, 0) / v.length;
        return sum;
    });
}
function winterLast(a) {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i];
    return null;
}

// Snow depth series (inches per hour bin) at the chosen ratio.
function winterSnow(b, ratio) {
    return ratio === 'kuchera' ? b.kuch : b.snow.map(v => v == null ? null : v * MM_IN * Number(ratio));
}
function winterSleet(b) { return b.sleet.map(v => v == null ? null : v * MM_IN * WINTER_SLEET_RATIO); }

// Which wintry hours a model has: first and last bin with at least a light rate.
function winterSpan(b) {
    let first = -1, last = -1;
    b.liq.forEach((v, i) => {
        if (v != null && (b.snow[i] + b.sleet[i] + b.zr[i]) >= WINTER_MIN_RATE) { if (first < 0) first = i; last = i; }
    });
    return { first, last };
}

// Share of ensemble members whose 10:1 snow over the window reaches each amount.
function winterOdds(h, modelId, t0, n, limits) {
    const v = 'snowfall_water_equivalent';
    const keys = Object.keys(h || {}).filter(k => k === `${v}_${modelId}` || (k.startsWith(`${v}_member`) && k.endsWith(`_${modelId}`)));
    const t = (h && h.time || []).map(x => Date.parse(x + 'Z'));
    const tot = [];
    keys.forEach(k => {
        let sum = 0, got = 0;
        t.forEach((ms, i) => {
            if (ms <= t0 || ms > t0 + n * 3600000 || h[k][i] == null) return;
            sum += h[k][i]; got++;
        });
        if (got) tot.push(sum * MM_IN * 10);
    });
    if (!tot.length) return null;
    tot.sort((a, b) => a - b);
    return { members: tot.length, odds: limits.map(x => tot.filter(s => s >= x).length / tot.length),
        med: quantileSorted(tot, 0.5), lo: quantileSorted(tot, 0.1), hi: quantileSorted(tot, 0.9) };
}

// Newest run on a model's long-run cycle that could be at IEM by now (`lag` hours
// after its nominal time), less `back` cycles.
function winterRunMs(m, nowMs, back) {
    const H = 3600000, step = m.every * H, off = m.off * H;
    return Math.floor((nowMs - m.lag * H - off) / step) * step + off - back * step;
}

async function fetchWinterBufkit(m, lat, lon, skipFrom) {
    // Walk back until IEM has the run: a cycle takes 1-5 h to arrive.
    for (let back = 0; back < 4; back++) {
        const run = (skipFrom || winterRunMs(m, Date.now(), 0)) - back * m.every * 3600000;
        const r = await fetch(`${IEM_BUFKIT}?lat=${lat}&lon=${lon}&model=${m.id}&fall=1&runtime=${new Date(run).toISOString().substring(0, 16)}Z`);
        if (r.ok) {
            const w = winterFromBufkit(await r.json());
            // IEM answers any point with its nearest site, however distant.
            const mi = Math.round(fcstMiles({ lat: w.lat, lon: w.lon }, { lat: +lat, lon: +lon }));
            if (mi > WINTER_MAX_MI) throw new Error(`nearest site ${mi} mi away`);
            if (w.steps.length) return w;
        } else if (r.status >= 500 && r.status !== 504 && back === 0) throw new Error(`IEM HTTP ${r.status}`);
    }
    throw new Error('no recent run at IEM');
}
async function fetchWinterEcmwf(lat, lon) {
    const vars = 'temperature_2m,wet_bulb_temperature_2m,wind_speed_10m,precipitation,snowfall_water_equivalent,precipitation_type,'
        + 'temperature_925hPa,temperature_850hPa,temperature_700hPa,temperature_500hPa';
    const [r, meta] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${vars}&models=ecmwf_ifs025`
            + '&forecast_days=9&timezone=UTC&wind_speed_unit=kn&temporal_resolution=native'),
        fetch(cacheBust('https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json')).then(x => x.json()).catch(() => null)
    ]);
    if (!r.ok) throw new Error(r.status === 429 ? 'Open-Meteo rate limit' : `Open-Meteo HTTP ${r.status}`);
    const run = _modelRunUsable(meta) ? meta.last_run_initialisation_time * 1000 : null;
    return winterFromEcmwf((await r.json()).hourly, run);
}
async function fetchWinterNws(lat, lon) {
    const opt = { headers: { 'Accept': 'application/geo+json' } };
    const p = await fetch(`https://api.weather.gov/points/${lat},${lon}`, opt);
    if (!p.ok) throw new Error(p.status === 404 ? 'U.S. only' : `NWS HTTP ${p.status}`);
    const pj = (await p.json()).properties;
    const g = await fetch(pj.forecastGridData, opt);
    if (!g.ok) throw new Error(`NWS HTTP ${g.status}`);
    const w = winterFromNws((await g.json()).properties);
    w.office = pj.gridId;
    return w;
}
async function fetchWinterEns(lat, lon) {
    const r = await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}`
        + `&hourly=snowfall_water_equivalent&models=${WINTER_ENS.map(m => m.id).join(',')}&forecast_days=9&timezone=UTC`);
    if (!r.ok) throw new Error(r.status === 429 ? 'Open-Meteo rate limit' : `Open-Meteo HTTP ${r.status}`);
    return (await r.json()).hourly;
}

async function loadWinterAt(latNum, lonNum, label) {
    const body = document.getElementById('winter-body'), locEl = document.getElementById('winter-loc');
    if (!body) return;
    const lat = (+latNum).toFixed(2), lon = (+lonNum).toFixed(2);
    const seq = ++winterSeq;
    winterData = null;
    winterPoint = { lat: +lat, lon: +lon, label: label || `${lat}, ${lon}` };
    if (locEl) locEl.textContent = `Loading ${winterPoint.label}…`;
    body.innerHTML = `<div class="pt-msg">Pulling model profiles, the NWS forecast and snow odds for ${esc(winterPoint.label)}…</div>`;
    const wantPrev = !!document.getElementById('winter-prev')?.checked;
    const res = { models: {}, prev: {}, errs: {} };
    const job = (key, p, put) => p.then(put).catch(e => { res.errs[key] = e.message; });
    await Promise.all([
        ...WINTER_MODELS.filter(m => m.every).map(m => job(m.label, fetchWinterBufkit(m, lat, lon), async w => {
            res.models[m.id] = w;
            if (wantPrev) res.prev[m.id] = await fetchWinterBufkit(m, lat, lon, w.run - m.every * 3600000).catch(() => null);
        })),
        job('ECMWF', fetchWinterEcmwf(lat, lon), w => { res.models.ECMWF = w; }),
        job('NWS', fetchWinterNws(lat, lon), w => { res.nws = w; }),
        job('Ensembles', fetchWinterEns(lat, lon), h => { res.ens = h; })
    ]);
    if (seq !== winterSeq) return;   // a newer place was requested meanwhile
    if (!Object.keys(res.models).length) {
        winterData = null;
        if (locEl) locEl.textContent = '—';
        body.innerHTML = `<div class="pt-msg warn">No model data for this point.<br><span class="c-mut">${esc(Object.entries(res.errs).map(([k, v]) => `${k}: ${v}`).join(' · '))}</span></div>`;
        return false;
    }
    winterData = { ...res, fetched: Date.now() };
    renderWinter();
}

const winterUtc = ms => {
    const d = new Date(ms);
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
};
const winterAmt = (v, dec) => v == null ? '—' : v <= 0 ? '0' : v < Math.pow(10, -dec) / 2 ? 'T' : v.toFixed(dec);

// Everything the table, charts and readout share, for the window on screen.
function winterView(data, nowMs, hours, ratio, hidden) {
    const t0 = Math.floor(nowMs / 3600000) * 3600000;
    const rows = [];
    WINTER_MODELS.forEach(m => {
        const w = data.models[m.id];
        if (!w) return;
        rows.push({ m, w, b: winterBins(w.steps, t0, hours), off: hidden.has(m.id) });
        const pw = data.prev && data.prev[m.id];
        if (pw) rows.push({ m, w: pw, b: winterBins(pw.steps, t0, hours), prev: true, off: hidden.has(m.id) });
    });
    rows.forEach(r => {
        r.snow = winterCum(winterSnow(r.b, ratio));
        r.snow10 = winterCum(winterSnow(r.b, 10));
        r.snowK = winterCum(r.b.kuch);
        r.sleet = winterCum(winterSleet(r.b));
        r.ice = winterCum(r.b.ice);
        r.liq = winterCum(r.b.liq.map(v => v == null ? null : v * MM_IN));
        r.span = winterSpan(r.b);
        const n = r.b.liq.reduce((k, v, i) => v != null ? i + 1 : k, 0);
        r.endMs = t0 + n * 3600000;
        r.covers = n >= hours;
        // Bins start at the window's first hour, so a run issued after it has a gap.
        r.startMs = t0 + Math.max(0, r.b.liq.findIndex(v => v != null)) * 3600000;
    });
    const main = rows.filter(r => !r.prev && !r.off && r.b.liq.some(v => v != null));
    const mean = main.length > 1 ? {
        snow: winterMeanCum(main.map(r => winterSnow(r.b, ratio))), sleet: winterMeanCum(main.map(r => winterSleet(r.b))),
        ice: winterMeanCum(main.map(r => r.b.ice)), liq: winterMeanCum(main.map(r => r.b.liq.map(v => v == null ? null : v * MM_IN))) } : null;
    let nws = null;
    if (data.nws) {
        const w = data.nws, off = hidden.has('NWS');
        nws = { off, snow: winterCum(winterBinNws(w.snow, t0, hours, MM_IN)), ice: winterCum(winterBinNws(w.ice, t0, hours, MM_IN)),
            liq: winterCum(winterBinNws(w.liq, t0, hours, MM_IN)), t2: new Array(hours).fill(null), run: w.run, office: w.office };
        w.t2.forEach(s => { for (let h = 0; h < s.hrs; h++) { const i = Math.round((s.ms + h * 3600000 - t0) / 3600000) - 1; if (i >= 0 && i < hours) nws.t2[i] = s.v; } });
        nws.endMs = t0 + nws.snow.reduce((k, v, i) => v != null ? i + 1 : k, 0) * 3600000;
    }
    return { t0, hours, rows, main, mean, nws };
}

// One plain sentence: who has wintry precip, how much, and when it starts.
function winterHeadline(v) {
    const wet = v.main.filter(r => r.span.first >= 0);
    if (!v.main.length) return 'All models are hidden. Click one in the table to show it.';
    if (!wet.length) return `No snow, sleet or freezing rain in any of the ${v.main.length} models shown through ${winterUtc(v.t0 + v.hours * 3600000)} (or the end of each run).`;
    const range = (key, dec, unit) => {
        const a = wet.map(r => winterLast(r[key])).filter(x => x != null && x >= Math.pow(10, -dec) / 2);
        if (!a.length) return null;
        const lo = a.length < wet.length ? 0 : Math.min(...a), hi = Math.max(...a);
        return `${lo.toFixed(dec) === hi.toFixed(dec) ? hi.toFixed(dec) : `${lo.toFixed(lo === 0 ? 0 : dec)}–${hi.toFixed(dec)}`}${unit}`;
    };
    const starts = wet.map(r => v.t0 + r.span.first * 3600000).sort((a, b) => a - b);
    const early = winterUtc(starts[0]), late = winterUtc(starts[starts.length - 1]);
    const bits = [['snow', 1, '" snow'], ['sleet', 2, '" sleet'], ['ice', 2, '" ice']].map(([k, d, u]) => range(k, d, u)).filter(Boolean);
    return `${wet.length} of ${v.main.length} models ${wet.length === 1 ? 'brings' : 'bring'} wintry precip, starting ${early === late ? early : `between ${early} and ${late}`}: ${bits.length ? bits.join(', ') : 'trace amounts'}.`;
}

function winterTableHtml(v, data) {
    const th = (t, tip) => `<th title="${esc(tip || '')}">${t}</th>`;
    const when = r => r.span.first < 0 ? '<span class="wx-dim">none</span>'
        : `${winterUtc(v.t0 + r.span.first * 3600000)} → ${winterUtc(v.t0 + (r.span.last + 1) * 3600000)}`;
    const tag = (id, label, color, off, sub) => `<th><button type="button" class="wx-row${off ? ' off' : ''}" data-wx="${esc(id)}" aria-pressed="${!off}" title="${off ? 'Show' : 'Hide'} ${esc(label)}">`
        + `<span class="swatch" data-bg="${color}"></span><span class="name">${esc(label)}</span>`
        + `<span class="wx-dim">${esc(sub || '')}</span></button></th>`;
    const amt = (x, d) => { const s = winterAmt(x, d); return x > 0 ? `<b>${s}</b>` : s; };
    let h = '<table class="wx-table"><thead><tr><th>Model</th>'
        + th('Snow Kuchera', 'Inches; ratio from the warmest temperature below 500 mb') + th('Snow 10:1', 'Inches at a flat 10:1 ratio')
        + th('Sleet', 'Inches at 2:1') + th('Ice flat', 'FRAM ice on a flat surface, inches') + th('Ice radial', 'On branches and wires: 0.394 x flat')
        + th('Liquid', 'Total precipitation, inches') + th('Wintry window (UTC)') + th('Data through') + '</tr></thead><tbody>';
    v.rows.forEach(r => {
        const ice = winterLast(r.ice);
        h += `<tr class="${r.off ? 'wx-off' : r.prev ? 'wx-old' : ''}">`
            + (r.prev ? `<th class="wx-prev">previous ${winterUtc(r.w.run)}</th>` : tag(r.m.id, r.m.label, r.m.color, r.off, r.w.run ? winterUtc(r.w.run) : ''))
            + `<td>${amt(winterLast(r.snowK), 1)}</td><td>${amt(winterLast(r.snow10), 1)}</td><td>${amt(winterLast(r.sleet), 2)}</td>`
            + `<td>${amt(ice, 2)}</td><td>${amt(ice == null ? null : ice * 0.394, 2)}</td><td>${winterAmt(winterLast(r.liq), 2)}</td>`
            + `<td>${when(r)}</td><td class="${r.covers ? '' : 'wx-short'}">${winterUtc(r.endMs)}</td></tr>`;
    });
    if (v.nws) {
        const ice = winterLast(v.nws.ice), snow = winterLast(v.nws.snow);
        h += `<tr class="${v.nws.off ? 'wx-off' : ''}">${tag('NWS', 'NWS official', '#fff', v.nws.off, v.nws.office || '')}`
            + `<td colspan="2">${amt(snow, 1)}</td><td class="wx-dim">in snow</td><td>${amt(ice, 2)}</td><td class="wx-dim">—</td><td>${winterAmt(winterLast(v.nws.liq), 2)}</td><td class="wx-dim">—</td>`
            + `<td class="${v.nws.endMs < v.t0 + v.hours * 3600000 ? 'wx-short' : ''}">${winterUtc(v.nws.endMs)}</td></tr>`;
    }
    return h + '</tbody></table>';
}

function winterOddsHtml(data, t0, hours) {
    if (!data.ens) return '';
    const lim = [0.1, 1, 3, 6, 12];
    const pct = p => p <= 0 ? '<span class="wx-dim">0</span>' : `<b data-fg="${p >= 0.6 ? '#ff7a7a' : p >= 0.3 ? '#ffd166' : '#8fc7ff'}">${Math.round(p * 100) || '&lt;1'}%</b>`;
    const rows = WINTER_ENS.map(m => ({ m, o: winterOdds(data.ens, m.id, t0, hours, lim) })).filter(r => r.o);
    if (!rows.length) return '';
    return `<div class="wx-h">Chance of snow in this window <span class="wx-dim">— share of ensemble members, 10:1 ratio; model snow water can include some sleet</span></div><div class="pt-scroll"><table class="wx-table"><thead><tr><th>Ensemble</th>`
        + lim.map(x => `<th>≥ ${x}"</th>`).join('') + '<th>Median</th><th>10–90%</th></tr></thead><tbody>'
        + rows.map(({ m, o }) => `<tr><th>${esc(m.label)} <span class="wx-dim">${o.members} members${m.ai ? ' · AI' : ''}</span></th>`
            + o.odds.map(p => `<td>${pct(p)}</td>`).join('') + `<td>${winterAmt(o.med, 1)}"</td><td>${winterAmt(o.lo, 1)}–${winterAmt(o.hi, 1)}"</td></tr>`).join('')
        + '</tbody></table></div>';
}

// ─── Charts ───
const WX_W = 1000, WX_L = 70, WX_R = 14;
function winterNiceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 4, 5, 10].map(k => k * p).find(x => x >= v - 1e-9);
}
function winterChartsSvg(v) {
    const pw = WX_W - WX_L - WX_R, n = v.hours;
    const X = i => WX_L + i / n * pw;
    const out = [], strips = v.rows.filter(r => !r.off);
    const shown = v.main, prevs = v.rows.filter(r => r.prev && !r.off);
    const nws = v.nws && !v.nws.off ? v.nws : null;
    let y = 18;
    out.push(`<text x="${WX_L}" y="${y - 5}" class="wx-t">PRECIP TYPE</text>`);
    let lx = WX_L + 100;
    Object.values(WINTER_TYPES).forEach(t => {
        out.push(`<rect x="${lx}" y="${y - 13}" width="10" height="9" fill="${t.color}"/><text x="${lx + 14}" y="${y - 5}" class="wx-a">${t.label}</text>`);
        lx += 24 + t.label.length * 6.4;
    });
    out.push(`<text x="${lx + 4}" y="${y - 5}" class="wx-a">brighter = heavier; split cell = mix; hatched = past the end of the run</text>`);
    const rowH = 18, cw = pw / n;
    strips.forEach(r => {
        const h = r.prev ? rowH - 8 : rowH - 3;
        out.push(`<text x="${WX_L - 6}" y="${y + h / 2 + 4}" text-anchor="end" class="wx-a${r.prev ? ' wx-a-prev' : ''}" data-fill="${r.m.color}">${r.prev ? 'prev' : esc(r.m.label)}</text>`);
        out.push(`<rect x="${WX_L}" y="${y}" width="${pw}" height="${h}" fill="#0b1118"/>`);
        for (let i = 0; i < n; i++) {
            const liq = r.b.liq[i];
            if (liq == null) { out.push(`<rect x="${X(i).toFixed(2)}" y="${y}" width="${(cw + 0.4).toFixed(2)}" height="${h}" fill="url(#wx-hatch)"/>`); continue; }
            if (liq < WINTER_MIN_RATE) continue;
            const op = (liq < 0.5 ? 0.5 : liq < 2 ? 0.75 : 1) * (r.prev ? 0.7 : 1);
            let yy = y;
            ['snow', 'sleet', 'zr', 'rain'].forEach(k => {
                const f = r.b[k][i] / liq;
                if (f < 0.02) return;
                out.push(`<rect x="${X(i).toFixed(2)}" y="${yy.toFixed(2)}" width="${(cw + 0.4).toFixed(2)}" height="${(h * f).toFixed(2)}" fill="${WINTER_TYPES[k].color}" opacity="${op}"/>`);
                yy += h * f;
            });
        }
        y += h + 3;
    });
    const stripBot = y;
    const line = (a, Y, col, w, dash, op) => {
        let d = '', on = false;
        a.forEach((val, i) => { if (val == null) { on = false; return; } d += `${on ? 'L' : 'M'}${X(i + 1).toFixed(1)} ${Y(val).toFixed(1)}`; on = true; });
        return d ? `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${op || 1}" stroke-linejoin="round"/>` : '';
    };
    const charts = [];
    const accum = (key, title, dec, floor, ref) => {
        const vals = shown.concat(prevs).flatMap(r => r[key]).concat(nws && nws[key] ? nws[key] : []).filter(x => x != null);
        const hi = vals.length ? Math.max(...vals) : 0;
        y += 30;
        if (hi < Math.pow(10, -dec) / 2) {
            out.push(`<text x="${WX_L}" y="${y - 8}" class="wx-t">${title}</text><text x="${WX_L + 250}" y="${y - 8}" class="wx-a">none in any model shown</text>`);
            y -= 6;
            return;
        }
        const top = winterNiceMax(Math.max(floor, hi * 1.05)), H = 120, yt = y;
        const Y = q => yt + H - q / top * H;
        out.push(`<text x="${WX_L}" y="${yt - 8}" class="wx-t">${title}</text>`);
        for (let k = 0; k <= 4; k++) {
            const q = top * k / 4;
            out.push(`<line x1="${WX_L}" x2="${WX_W - WX_R}" y1="${Y(q)}" y2="${Y(q)}" class="wx-g"/><text x="${WX_L - 6}" y="${Y(q) + 4}" text-anchor="end" class="wx-a">${top < 1 ? q.toFixed(3).replace(/0$/, '') : +q.toFixed(2)}</text>`);
        }
        if (ref && ref.v <= top) out.push(`<line x1="${WX_L}" x2="${WX_W - WX_R}" y1="${Y(ref.v)}" y2="${Y(ref.v)}" stroke="#ff4fa3" stroke-dasharray="3 4" opacity=".8"/><text x="${WX_W - WX_R - 4}" y="${Y(ref.v) - 4}" text-anchor="end" class="wx-a" data-fill="#ff8cc4">${ref.t}</text>`);
        prevs.forEach(r => out.push(line(r[key], Y, r.m.color, 1.2, '2 4', 0.55)));
        shown.forEach(r => out.push(line(r[key], Y, r.m.color, 2)));
        if (v.mean) out.push(line(v.mean[key], Y, '#cdd6df', 2.4, '7 4', 0.9));
        if (nws && nws[key]) {
            out.push(line(nws[key], Y, '#ffffff', 1.4));
            nws[key].forEach((q, i) => { if (q != null && i % 6 === 5) out.push(`<rect x="${(X(i + 1) - 2.5).toFixed(1)}" y="${(Y(q) - 2.5).toFixed(1)}" width="5" height="5" fill="#fff" stroke="#000"/>`); });
        }
        charts.push([yt, yt + H]);
        y = yt + H;
    };
    accum('snow', `ACCUMULATED SNOW (in) — ${v.ratio === 'kuchera' ? 'Kuchera ratio' : v.ratio + ':1'}`, 1, 0.5);
    accum('sleet', 'ACCUMULATED SLEET (in) — 2:1', 2, 0.1);
    accum('ice', 'ACCUMULATED ICE, FLAT (in) — FRAM', 2, 0.1, { v: 0.25, t: '0.25" — typical ice storm warning' });
    accum('liq', 'TOTAL LIQUID (in), all types', 2, 0.1);
    // 2 m temperature
    const F = c => c == null ? null : c * 9 / 5 + 32;
    const tv = shown.flatMap(r => r.b.t2).concat(nws ? nws.t2 : []).filter(x => x != null).map(F);
    if (tv.length) {
        y += 30;
        const H = 110, yt = y, lo = Math.min(28, Math.floor(Math.min(...tv) / 5) * 5), hi = Math.max(36, Math.ceil(Math.max(...tv) / 5) * 5);
        const Y = q => yt + H - (q - lo) / (hi - lo) * H, st = hi - lo > 50 ? 20 : hi - lo > 25 ? 10 : 5;
        out.push(`<text x="${WX_L}" y="${yt - 8}" class="wx-t">2 M TEMPERATURE (°F)</text>`);
        for (let q = Math.ceil(lo / st) * st; q <= hi; q += st) out.push(`<line x1="${WX_L}" x2="${WX_W - WX_R}" y1="${Y(q)}" y2="${Y(q)}" class="wx-g"/><text x="${WX_L - 6}" y="${Y(q) + 4}" text-anchor="end" class="wx-a">${q}</text>`);
        out.push(`<line x1="${WX_L}" x2="${WX_W - WX_R}" y1="${Y(32)}" y2="${Y(32)}" stroke="#7fd3ff" stroke-width="1.4" stroke-dasharray="5 4"/><text x="${WX_W - WX_R - 4}" y="${Y(32) - 4}" text-anchor="end" class="wx-a" data-fill="#7fd3ff">32°</text>`);
        shown.forEach(r => out.push(line(r.b.t2.map(F), Y, r.m.color, 1.8)));
        if (nws) out.push(line(nws.t2.map(F), Y, '#ffffff', 1.4, '1 3'));
        charts.push([yt, yt + H]);
        y = yt + H;
    }
    // shared time axis, drawn behind
    const every = n <= 48 ? 3 : n <= 84 ? 6 : n <= 120 ? 12 : 24, grid = [], bands = [[18, stripBot - 3]].concat(charts);
    for (let i = 0; i <= n; i++) {
        const d = new Date(v.t0 + i * 3600000), hh = d.getUTCHours();
        if (hh % every) continue;
        bands.forEach(([a, b]) => grid.push(`<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${a}" y2="${b}" class="${hh ? 'wx-g' : 'wx-d'}"/>`));
        grid.push(`<text x="${X(i).toFixed(1)}" y="${y + 15}" text-anchor="middle" class="wx-a">${String(hh).padStart(2, '0')}Z</text>`);
        if (!hh) grid.push(`<text x="${X(i).toFixed(1)}" y="${y + 29}" text-anchor="middle" class="wx-t">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}</text>`);
    }
    const Ht = y + 38;
    return `<svg id="winter-svg" viewBox="0 0 ${WX_W} ${Ht}" role="img" aria-label="Winter precipitation charts">`
        + '<defs><pattern id="wx-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#2a343e" stroke-width="2"/></pattern></defs>'
        + out[0] + grid.join('') + out.slice(1).join('')
        + `<line id="winter-cross" y1="18" y2="${y}" stroke="#fff" stroke-opacity=".5" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
}

function renderWinter() {
    const body = document.getElementById('winter-body'), locEl = document.getElementById('winter-loc');
    if (!body || !winterData) return;
    const hours = parseInt(document.getElementById('winter-hours')?.value, 10) || 84;
    const ratio = document.getElementById('winter-ratio')?.value || 'kuchera';
    const v = winterView(winterData, winterData.fetched, hours, ratio, winterHidden);
    v.ratio = ratio;
    const site = Object.values(winterData.models).find(w => w.station);
    const mi = site ? Math.round(fcstMiles({ lat: site.lat, lon: site.lon }, winterPoint)) : null;
    const far = mi != null && mi > 40;
    if (locEl) {
        locEl.innerHTML = `${esc(winterPoint.label)}${site ? ` · <span class="${far ? 'c-warn' : ''}">model profiles from ${esc(site.station)}, ${mi} mi away${far ? ' — may not represent this point' : ''}</span>` : ''}`
            + ` · fetched ${new Date(winterData.fetched).toISOString().substring(11, 16)}Z`;
    }
    const errs = Object.entries(winterData.errs);
    const keepScroll = body.scrollTop;
    body.innerHTML = `<div class="wx-headline">${esc(winterHeadline(v))}</div>`
        + `<div class="pt-scroll">${winterTableHtml(v, winterData)}</div>`
        + (errs.length ? `<div class="pt-foot c-warn">Unavailable: ${esc(errs.map(([k, e]) => `${k} (${e})`).join(', '))}</div>` : '')
        + winterOddsHtml(winterData, v.t0, hours)
        + '<div id="winter-readout" class="wx-readout">Hover or tap the charts for values</div>'
        + `<div class="pt-scroll">${winterChartsSvg(v)}</div>`
        + `<div class="wx-foot">Totals run from ${winterUtc(v.t0)} to ${winterUtc(v.t0 + hours * 3600000)} (${hours} h) or the end of each run, whichever is first (amber = run ends early). Precip type is each model's own. `
        + `<b>Snow</b>: Kuchera ratio from the warmest level below 500 mb, or a fixed ratio. No melting, compaction or ground-temperature effect is included, so these run high on warm ground. <b>Sleet</b>: 2:1. `
        + `<b>Ice</b>: FRAM (Sanders &amp; Barjenbruch 2016) on a flat surface; radial is 0.394 × flat. FRAM is less certain above freezing, over 20 kt of wind or over 0.25 in/h. `
        + `The dashed gray line averages the models hour by hour; runs end at different times, so it uses fewer models later. NWS official: white squares; NWS counts sleet in its snow. `
        + `<br>BUFKIT via Iowa Environmental Mesonet · ECMWF and ensembles by Open-Meteo.com (CC BY 4.0) · NWS gridded forecast.</div>`;
    paint(body);
    body.scrollTop = keepScroll;
    body.querySelectorAll('.wx-row').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.wx;
        winterHidden.has(id) ? winterHidden.delete(id) : winterHidden.add(id);
        try { localStorage.setItem('ncep_winter_hidden', JSON.stringify([...winterHidden])); } catch (_) {}
        renderWinter();
    }));
    attachWinterHover(v);
}

function attachWinterHover(v) {
    const svg = document.getElementById('winter-svg'), cross = document.getElementById('winter-cross'), out = document.getElementById('winter-readout');
    if (!svg || !cross || !out) return;
    const idle = out.innerHTML;
    const read = e => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const x = (e.clientX - ctm.e) / ctm.a, i = Math.floor((x - WX_L) / (WX_W - WX_L - WX_R) * v.hours);
        if (i < 0 || i >= v.hours) return;
        const px = WX_L + (i + 1) / v.hours * (WX_W - WX_L - WX_R);
        cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
        const end = v.t0 + (i + 1) * 3600000;
        const cell = r => {
            const liq = r.b.liq[i];
            if (liq == null) return `<span class="wx-cell"><b data-fg="${r.m.color}">${esc(r.m.label)}</b> <span class="wx-dim">no data</span></span>`;
            const kinds = liq < WINTER_MIN_RATE ? ['dry'] : ['snow', 'sleet', 'zr', 'rain'].filter(k => r.b[k][i] / liq >= 0.02).map(k => WINTER_TYPES[k].label.toLowerCase());
            return `<span class="wx-cell"><b data-fg="${r.m.color}">${esc(r.m.label)}</b> ${kinds.join('/')} · ${r.b.t2[i] == null ? '—' : Math.round(r.b.t2[i] * 9 / 5 + 32) + '°'}`
                + ` · sn ${winterAmt(r.snow[i], 1)}" sl ${winterAmt(r.sleet[i], 2)}" ice ${winterAmt(r.ice[i], 2)}"</span>`;
        };
        const loc = new Date(end).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
        out.innerHTML = `<b class="c-acc">${winterUtc(end)}</b> <span class="wx-dim">(${esc(loc)} local)</span> ${v.main.map(cell).join('')}`
            + (v.nws && !v.nws.off ? `<span class="wx-cell"><b>NWS</b> sn ${winterAmt(v.nws.snow[i], 1)}" ice ${winterAmt(v.nws.ice[i], 2)}"</span>` : '');
        paint(out);
    };
    // Pointer events so a tap reads values on a phone too.
    ['pointerdown', 'pointermove'].forEach(t => svg.addEventListener(t, read));
    svg.addEventListener('pointerleave', e => {
        if (e.pointerType !== 'mouse') return;
        cross.setAttribute('visibility', 'hidden');
        out.innerHTML = idle;
    });
}

function initWinterTab() {
    ['winter-hours', 'winter-ratio'].forEach(id => document.getElementById(id).addEventListener('change', () => { if (winterData) renderWinter(); }));
    document.getElementById('winter-prev').addEventListener('change', () => reloadView('winter'));
}
