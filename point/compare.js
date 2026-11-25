// Copied from FX-Net NextGen (app.js). Top-level names match so the two copies
// can be compared; tests/_load.js finds declarations by name at column 0.

// ═══ Model Comparison: the same point in every model ═══
//
// Point-based by design, never gridded: one point across all the models is a
// single Open-Meteo call, while a gridded overlay would exhaust the free quota
// in two renders. It answers the question that matters: do the models agree, and
// where does the spread blow up? Loads only when its tab is opened.

// Open-Meteo model IDs. `ai` marks a machine-learning model rather than a
// physics solver — ECMWF's AIFS is operational, and its disagreement with IFS is
// a genuinely useful signal. NOTE: there is no "AI MOS"; MDL station guidance is
// still classical regression and its successor is NBM, so the AI tag belongs to
// the model, not to the MOS panel.
// HRRR is short-range by design (3 km CONUS, hourly runs, ~48 h) so its trace
// simply ends partway across the chart — that truncation is honest, and where it
// disagrees with the globals inside 48 h is exactly where it earns its keep.
// RRFS replaced NAM on 2026-11-03 and will also replace HRRR (Open-Meteo marks
// HRRR "discontinues with RRFSv2"); both run ~2–4 days, so their traces end early.
// `runDir` is the Open-Meteo data directory whose static/meta.json publishes the
// cycle this model is currently serving. For the `_seamless` families — which
// splice a high-res domain onto a global one — it names the GLOBAL member, since
// that is the run covering the full length of the chart.
// GFS must be gfs_global, not gfs_seamless: over the U.S. the seamless blend IS
// HRRR for the first ~48 h, which hid the GFS line behind the HRRR one.
// `ens` models come from Open-Meteo's ensemble API instead: drawn as the member
// mean with a 10th–90th percentile band. `hybrid` is HGEFS, NOAA's blend of the
// physics GEFS and the AI GEFS, served as its ensemble mean.
// NOAA's AI models (AIGFS, AIGEFS, HGEFS) carry no humidity at all, so they have
// no dewpoint trace; that is the source, not a fetch failure. REFS (the RRFS
// ensemble) is listed by Open-Meteo but returned only nulls on 2026-11-23, and
// no other AI model (GraphCast, GenCast, FourCastNet, Pangu, Aurora) has a free
// point API.
const MODEL_SOURCES = [
    { id: 'gfs_global',           label: 'GFS',        org: 'NOAA NCEP', color: '#00e5ff', runDir: 'ncep_gfs013' },
    { id: 'gfs_hrrr',             label: 'HRRR',       org: 'NOAA 3 km', color: '#ff8a3c', shortRange: true, runDir: 'ncep_hrrr_conus' },
    { id: 'ncep_rrfs_conus',      label: 'RRFS',       org: 'NOAA 3 km', color: '#ff4f6d', shortRange: true, runDir: 'ncep_rrfs_conus' },
    { id: 'ecmwf_ifs025',         label: 'ECMWF IFS',  org: 'ECMWF',     color: '#ff5ad1', runDir: 'ecmwf_ifs025' },
    { id: 'gem_seamless',         label: 'CMC GEM',    org: 'ECCC',      color: '#ffd166', runDir: 'cmc_gem_gdps' },
    { id: 'icon_seamless',        label: 'ICON',       org: 'DWD',       color: '#7cff6b', runDir: 'dwd_icon' },
    { id: 'ecmwf_aifs025_single', label: 'ECMWF AIFS', org: 'ECMWF',     color: '#c08bff', ai: true, runDir: 'ecmwf_aifs025_single' },
    { id: 'ncep_aigfs025',        label: 'AIGFS',      org: 'NOAA',      color: '#4d9dff', ai: true, runDir: 'ncep_aigfs025' },
    { id: 'ncep_hgefs025_ensemble_mean', label: 'HGEFS mean', org: 'NOAA hybrid', color: '#2fd9b5', hybrid: true, runDir: 'ncep_hgefs025_ensemble_mean' },
    { id: 'ecmwf_aifs025_ensemble', label: 'AIFS-ENS', org: 'ECMWF 51 mem', color: '#e6c3ff', ai: true, ens: true, runDir: 'ecmwf_aifs025_ensemble' },
    { id: 'ncep_aigefs025',       label: 'AIGEFS',     org: 'NOAA 31 mem', color: '#a8c8ff', ai: true, ens: true, runDir: 'ncep_aigefs025' }
];

// Legend clicks hide a model; remembered per browser. Eleven traces is past
// what one chart reads well, so this is how a forecaster narrows it down.
const modelHidden = new Set((() => {
    // A GFS line hidden before the id changed stays hidden.
    try { return JSON.parse(localStorage.getItem('ncep_model_hidden') || '[]').map(id => id === 'gfs_seamless' ? 'gfs_global' : id); } catch (_) { return []; }
})());

// Mean and 10th–90th percentile of one ensemble field. Open-Meteo names the
// control `{var}_{model}` and the rest `{var}_memberNN_{model}`. An hour where
// fewer than half the members report is left empty rather than averaged over a
// few survivors, which would fake a confident mean at the tail of the run.
function ensembleStats(hourly, modelId, varName) {
    const keys = Object.keys(hourly).filter(k => k === `${varName}_${modelId}`
        || (k.startsWith(`${varName}_member`) && k.endsWith(`_${modelId}`)));
    const n = (hourly.time || []).length;
    const mean = new Array(n).fill(null), lo = new Array(n).fill(null), hi = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        const v = [];
        keys.forEach(k => { const x = hourly[k][i]; if (x != null) v.push(x); });
        if (!v.length || v.length < keys.length / 2) continue;
        v.sort((a, b) => a - b);
        mean[i] = v.reduce((s, x) => s + x, 0) / v.length;
        lo[i] = quantileSorted(v, 0.1);
        hi[i] = quantileSorted(v, 0.9);
    }
    return { mean, lo, hi, members: keys.length };
}

// Put a series onto the chart's time axis by valid time, not by index: the two
// Open-Meteo APIs are separate requests and need not start on the same hour.
function alignToTimes(srcTimes, vals, dstTimes) {
    const at = new Map(srcTimes.map((t, i) => [t, i]));
    return dstTimes.map(t => { const i = at.get(t); return i == null ? null : vals[i]; });
}

// ─── Model cycle (initialisation) times ───
// The /v1/forecast response carries no init time — only the valid times — so the
// cycle behind each trace is read from Open-Meteo's per-model meta.json, which is
// CORS-open and ~600 bytes. Cached for the session so re-rendering the chart
// (changing field, range or panel size) costs nothing.
const MODEL_RUNS_TTL = 10 * 60 * 1000;
let _modelRuns = null, _modelRunsAt = 0;

// Same UTC day → bare hour ("06Z"); otherwise carry the date ("11/18Z").
function _modelRunLabel(initSec) {
    const d = new Date(initSec * 1000), now = new Date();
    const hh = String(d.getUTCHours()).padStart(2, '0') + 'Z';
    return d.getUTCDate() === now.getUTCDate() && d.getUTCMonth() === now.getUTCMonth()
        ? hh : `${String(d.getUTCDate()).padStart(2, '0')}/${hh}`;
}

async function fetchModelRuns() {
    if (_modelRuns && Date.now() - _modelRunsAt < MODEL_RUNS_TTL) return _modelRuns;
    const out = {};
    await Promise.all(MODEL_SOURCES.map(async m => {
        try {
            // meta.json ships Last-Modified and ETag but NO Cache-Control, so
            // browsers apply heuristic freshness and will happily serve the
            // previous cycle for hours. A stale run time is worse than none —
            // it is the one number this feature exists to get right.
            const r = await fetch(cacheBust(`https://api.open-meteo.com/data/${m.runDir}/static/meta.json`));
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json();
            out[m.id] = _modelRunUsable(j)
                ? { ok: true, init: j.last_run_initialisation_time, avail: j.last_run_availability_time }
                : { ok: false, why: 'source has stopped publishing a current cycle time' };
        } catch (e) {
            out[m.id] = { ok: false, why: e.message };
        }
    }));
    _modelRuns = out; _modelRunsAt = Date.now();
    return out;
}

const MODEL_VARS = {
    temperature_2m: { label: 'Temperature', unit: '°F', dec: 0 },
    dewpoint_2m:    { label: 'Dewpoint',    unit: '°F', dec: 0 },
    wind_speed_10m: { label: 'Wind',        unit: 'kt', dec: 0 },
    precipitation:  { label: 'Precip',      unit: 'in', dec: 2 },
    pressure_msl:   { label: 'MSLP',        unit: 'mb', dec: 1 }
};

let modelSeq = 0;       // drop stale responses when the place or range changes quickly
let modelData = null;   // { times[], series{modelId:{var:[]}}, label, fetched }

async function loadModelCompareAt(latNum, lonNum, presetLabel) {
    const body = document.getElementById('model-body');
    const locEl = document.getElementById('model-loc');
    if (!body) return;
    const lat = (+latNum).toFixed(4), lon = (+lonNum).toFixed(4);
    const label = presetLabel || `${lat}, ${lon}`;
    const seq = ++modelSeq;
    modelData = null;
    if (locEl) locEl.textContent = `Loading ${label}…`;
    body.innerHTML = `<div class="pt-msg">Pulling ${MODEL_SOURCES.length} models for ${esc(label)}…</div>`;
    try {
        const days = parseInt(document.getElementById('model-days')?.value) || 7;
        const url = 'https://api.open-meteo.com/v1/forecast'
            + `?latitude=${lat}&longitude=${lon}`
            + `&hourly=${Object.keys(MODEL_VARS).join(',')}`
            + `&models=${MODEL_SOURCES.filter(m => !m.ens).map(m => m.id).join(',')}`
            + `&forecast_days=${days}`
            + '&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch';
        const ensUrl = 'https://ensemble-api.open-meteo.com/v1/ensemble'
            + `?latitude=${lat}&longitude=${lon}`
            + `&hourly=${Object.keys(MODEL_VARS).join(',')}`
            + `&models=${MODEL_SOURCES.filter(m => m.ens).map(m => m.id).join(',')}`
            + `&forecast_days=${days}`
            + '&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch';
        // Cycle times and the ensembles ride alongside the forecast rather than
        // after it. Either can fail without costing the chart: runs resolves to
        // {} at worst, and a failed ensemble request becomes a note.
        const [res, runs, ens] = await Promise.all([
            fetch(url),
            fetchModelRuns().catch(() => ({})),
            fetch(ensUrl).then(async r => {
                if (r.status === 429) throw new Error('rate limit reached');
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            }).catch(e => ({ error: e.message }))
        ]);
        if (seq !== modelSeq) return;   // a newer request superseded this one
        if (res.status === 429) throw new Error('Open-Meteo rate limit reached — wait a minute and try again.');
        if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
        const j = await res.json();
        if (seq !== modelSeq) return;
        const h = j.hourly || {};
        const times = (h.time || []).map(t => new Date(t + 'Z').getTime());
        if (!times.length) throw new Error('No forecast returned for this point.');
        // Open-Meteo suffixes every series with its model id when several models
        // are requested; a single-model request would come back unsuffixed.
        const series = {}, bands = {};
        const eh = ens && ens.hourly;
        MODEL_SOURCES.forEach(m => {
            series[m.id] = {};
            if (m.ens) bands[m.id] = {};
            Object.keys(MODEL_VARS).forEach(v => {
                if (!m.ens) { series[m.id][v] = h[`${v}_${m.id}`] || h[v] || []; return; }
                if (!eh) { series[m.id][v] = []; return; }
                const st = ensembleStats(eh, m.id, v);
                series[m.id][v] = alignToTimes(eh.time, st.mean, h.time);
                bands[m.id][v] = { lo: alignToTimes(eh.time, st.lo, h.time), hi: alignToTimes(eh.time, st.hi, h.time) };
            });
        });
        const ensNote = ens && ens.error ? `Ensembles (AIFS-ENS, AIGEFS) unavailable: ${ens.error}.` : '';
        modelData = { times, series, bands, ensNote, label, runs: runs || {}, fetched: Date.now() };
        if (locEl) locEl.textContent = `${label} · ${days}-day · fetched ${new Date().toISOString().substring(11, 16)}Z`;
        renderModelCompare();
    } catch (e) {
        if (seq !== modelSeq) return;
        modelData = null;
        if (locEl) locEl.textContent = '—';
        body.innerHTML = `<div class="pt-msg warn">${esc(e.message)}</div>`;
        return false;
    }
}

function renderModelCompare() {
    const body = document.getElementById('model-body');
    if (!body || !modelData || !body.clientWidth) return;   // hidden tab: drawn when it is shown
    const varKey = document.getElementById('model-var')?.value || 'temperature_2m';
    const meta = MODEL_VARS[varKey];
    const withData = MODEL_SOURCES.filter(m => modelData.series[m.id]?.[varKey]?.some(v => v != null));
    const active = withData.filter(m => !modelHidden.has(m.id));
    // The plot lives in its own positioned box so the cursor canvas and the
    // readout can sit on top of it without disturbing the flex column below.
    body.innerHTML = `<div id="model-plot">
            <canvas id="model-canvas" role="img" aria-label="Model comparison chart"></canvas>
            <canvas id="model-cursor"></canvas>
            <div id="model-readout"></div>
        </div>
        <div id="model-legend"></div>
        <div id="model-spread"></div>
        <div class="pt-foot">
            Click a model to hide or show it. Dashed = AI, dotted = hybrid AI/physics. AIFS-ENS and AIGEFS are drawn as the member mean with a shaded 10th–90th percentile band.
            ${withData.length < MODEL_SOURCES.length ? `Not shown for this field: ${esc(MODEL_SOURCES.filter(m => !withData.includes(m)).map(m => m.label).join(', '))}${varKey === 'dewpoint_2m' ? ' (NOAA\'s AI models publish no humidity)' : ''}.` : ''}
            ${modelData.ensNote ? `<span class="c-warn">${esc(modelData.ensNote)}</span>` : ''}
            <br>Model data by <b>Open-Meteo.com</b> (CC BY 4.0) — GFS, HRRR, RRFS, AIGFS, AIGEFS &amp; HGEFS/NOAA NCEP, IFS, AIFS &amp; AIFS-ENS/ECMWF, GEM/ECCC, ICON/DWD.
        </div>`;
    const legend = document.getElementById('model-legend');
    const runs = modelData.runs || {};
    withData.forEach(m => {
        const r = runs[m.id];
        const off = modelHidden.has(m.id);
        // The cycle sits with the model that produced it — a trace is only worth
        // reading once you know which run it came from, and the runs genuinely
        // differ (HRRR is hourly while IFS is six-hourly and lands ~7 h late).
        let runHTML;
        if (r && r.ok) {
            const ageH = Math.max(0, (Date.now() - r.init * 1000) / 3600000);
            runHTML = `<span class="mono" data-fg="${m.color}" `
                + `title="${esc(m.label)} ${esc(m.runDir)} — initialised ${new Date(r.init * 1000).toISOString().replace('T', ' ').substring(0, 16)}Z, `
                + `${ageH.toFixed(1)} h ago">${esc(_modelRunLabel(r.init))}</span>`;
        } else {
            runHTML = `<span class="mono c-warn" `
                + `title="Cycle time unavailable — ${esc((r && r.why) || 'no metadata')}. The forecast itself is current.">run ?</span>`;
        }
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'model-legend-item' + (off ? ' off' : '');
        sw.setAttribute('aria-pressed', String(!off));
        sw.title = off ? `Show ${m.label}` : `Hide ${m.label}`;
        sw.innerHTML = `<span class="swatch" data-bg="${m.color}"></span>`
            + `<span class="name">${esc(m.label)}</span>`
            + (m.ai ? `<span class="pt-badge ai">AI</span>` : '')
            + (m.hybrid ? `<span class="pt-badge hybrid">HYBRID</span>` : '')
            + `<span class="c-dim">${esc(m.org)}</span>`
            + runHTML;
        sw.addEventListener('click', () => {
            modelHidden.has(m.id) ? modelHidden.delete(m.id) : modelHidden.add(m.id);
            try { localStorage.setItem('ncep_model_hidden', JSON.stringify([...modelHidden])); } catch (_) {}
            renderModelCompare();
        });
        legend.appendChild(sw);
    });
    paint(legend);
    renderModelSpread(varKey, active, meta);
    // Chart last: it sizes itself from whatever height the siblings left behind.
    drawModelChart(document.getElementById('model-canvas'), varKey, active);
    _modelHoverBind();
}

// Mean and worst inter-model spread — the number a forecaster actually wants,
// because agreement is the confidence signal, not any single deterministic run.
function renderModelSpread(varKey, active, meta) {
    const el = document.getElementById('model-spread');
    if (!el || active.length < 2) { if (el) el.textContent = ''; return; }
    let sum = 0, n = 0, worst = 0, worstMs = null;
    modelData.times.forEach((ms, i) => {
        const vals = active.map(m => modelData.series[m.id][varKey][i]).filter(v => v != null);
        if (vals.length < 2) return;
        const spread = Math.max(...vals) - Math.min(...vals);
        sum += spread; n++;
        if (spread > worst) { worst = spread; worstMs = ms; }
    });
    if (!n) { el.textContent = ''; return; }
    const t = worstMs ? new Date(worstMs) : null;
    const when = t ? `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCHours()).padStart(2, '0')}Z` : '—';
    el.innerHTML = `<b>Spread</b> — mean ${(sum / n).toFixed(meta.dec)}${meta.unit}, `
        + `max ${worst.toFixed(meta.dec)}${meta.unit} at ${when} `
        + `<span class="c-dim">(${active.length} models; wider spread = lower confidence)</span>`;
}

function drawModelChart(canvas, varKey, active) {
    if (!canvas) return;
    const body = document.getElementById('model-body');
    const plot = canvas.parentElement;          // #model-plot, sibling of the text blocks
    const cssW = Math.max(280, (body?.clientWidth || 700) - 24);   // less the body's padding
    // Grow into whatever the panel gives us — measure the real height of the
    // legend/spread/credit blocks rather than assuming, since the legend wraps
    // to a second line on a narrow panel and not on a maximized one.
    const used = body ? Array.from(body.children).reduce(
        (s, el) => el === plot ? s : s + el.offsetHeight, 0) : 0;
    const cssH = Math.max(240, Math.min(900, (body?.clientHeight || 460) - used - 28));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    const cur = document.getElementById('model-cursor');
    if (cur) {
        cur.width = cssW * dpr; cur.height = cssH * dpr;
        cur.style.width = cssW + 'px'; cur.style.height = cssH + 'px';
        cur.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    _modelPlot = null;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const meta = MODEL_VARS[varKey];
    const times = modelData.times;
    if (!active.length || times.length < 2) {
        ctx.fillStyle = '#8b97a3'; ctx.font = '12px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'center';
        ctx.fillText('No data for this field.', cssW / 2, cssH / 2);
        return;
    }
    const mL = 46, mR = 14, mT = 16, mB = 30;
    const pw = cssW - mL - mR, ph = cssH - mT - mB;
    const t0 = times[0], t1 = times[times.length - 1];
    const X = ms => mL + ((ms - t0) / (t1 - t0)) * pw;
    const all = [];
    active.forEach(m => {
        modelData.series[m.id][varKey].forEach(v => { if (v != null) all.push(v); });
        const b = modelData.bands?.[m.id]?.[varKey];
        if (b) [b.lo, b.hi].forEach(a => a.forEach(v => { if (v != null) all.push(v); }));
    });
    let vMin = Math.min(...all), vMax = Math.max(...all);
    if (vMax - vMin < 1e-6) { vMax += 1; vMin -= 1; }
    const pad = (vMax - vMin) * 0.12;
    vMin -= pad; vMax += pad;
    if (varKey === 'precipitation' && vMin < 0) vMin = 0;
    const Y = v => mT + ph - ((v - vMin) / (vMax - vMin)) * ph;
    ctx.font = '11px ui-monospace,Menlo,Consolas,monospace';
    // y grid + labels
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
        const v = vMin + (vMax - vMin) * (i / 5);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(mL, Y(v)); ctx.lineTo(mL + pw, Y(v)); ctx.stroke();
        ctx.fillStyle = '#8b97a3'; ctx.fillText(v.toFixed(meta.dec), mL - 6, Y(v));
    }
    // x grid: 00Z day boundaries, labels thinned so they never touch on a phone
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const dayPx = pw / Math.max(1, (t1 - t0) / 864e5), labelEvery = Math.ceil(42 / dayPx);
    let dayNo = 0;
    for (let d = new Date(t0); d.getTime() <= t1; d = new Date(d.getTime() + 864e5)) {
        const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        if (dayMs < t0) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath(); ctx.moveTo(X(dayMs), mT); ctx.lineTo(X(dayMs), mT + ph); ctx.stroke();
        ctx.fillStyle = '#8b97a3';
        if (dayNo++ % labelEvery === 0) ctx.fillText(`${String(new Date(dayMs).getUTCDate()).padStart(2, '0')}/00Z`, X(dayMs), mT + ph + 5);
    }
    // spread envelope behind the lines — the visual form of model disagreement
    if (active.length > 1) {
        const top = [], bot = [];
        times.forEach((ms, i) => {
            const vals = active.map(m => modelData.series[m.id][varKey][i]).filter(v => v != null);
            if (vals.length < 2) return;
            top.push([X(ms), Y(Math.max(...vals))]);
            bot.push([X(ms), Y(Math.min(...vals))]);
        });
        if (top.length > 1) {
            ctx.fillStyle = 'rgba(0,229,255,0.09)';
            ctx.beginPath();
            top.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
            for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
            ctx.closePath(); ctx.fill();
        }
    }
    // each ensemble's own 10th–90th percentile band, in its color
    active.filter(m => m.ens).forEach(m => {
        const b = modelData.bands?.[m.id]?.[varKey];
        if (!b) return;
        const pts = [];
        times.forEach((ms, i) => { if (b.lo[i] != null && b.hi[i] != null) pts.push(i); });
        if (pts.length < 2) return;
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        pts.forEach((i, k) => k ? ctx.lineTo(X(times[i]), Y(b.hi[i])) : ctx.moveTo(X(times[i]), Y(b.hi[i])));
        for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(X(times[pts[k]]), Y(b.lo[pts[k]]));
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
    });
    // one line per model
    active.forEach(m => {
        const vals = modelData.series[m.id][varKey];
        ctx.strokeStyle = m.color;
        ctx.lineWidth = m.ens ? 2.6 : m.ai ? 2.2 : 1.8;
        if (m.ai) ctx.setLineDash([6, 3]);   // AI model reads distinctly from the physics runs
        else if (m.hybrid) ctx.setLineDash([2, 3]);
        ctx.beginPath();
        let started = false;
        times.forEach((ms, i) => {
            const v = vals[i];
            if (v == null) { started = false; return; }
            started ? ctx.lineTo(X(ms), Y(v)) : ctx.moveTo(X(ms), Y(v));
            started = true;
        });
        ctx.stroke();
        ctx.setLineDash([]);
    });
    // y-axis title
    ctx.save(); ctx.translate(11, mT + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#60a5fa';
    ctx.fillText(`${meta.label.toUpperCase()} (${meta.unit})`, 0, 0); ctx.restore();
    // Hand the scales to the cursor overlay so hovering never recomputes them.
    _modelPlot = { mL, mT, pw, ph, cssW, cssH, t0, t1, vMin, vMax, varKey, active, meta };
}

// ─── Hover readout ───────────────────────────────────────────────────────────
// Six traces converging and crossing is exactly where the eye stops being able
// to read values off a chart, which is the moment you most want the numbers.
// The crosshair snaps to the forecast hour rather than following the pixel, so
// the readout is the model's actual output and not an interpolation of it.
let _modelPlot = null;

function _modelHoverBind() {
    const plot = document.getElementById('model-plot');
    if (!plot) return;
    // Pointer events so a tap or drag reads values on a phone too.
    ['pointerdown', 'pointermove'].forEach(t => plot.addEventListener(t, _modelHoverMove));
    plot.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') _modelHoverHide(); });
}

function _modelHoverHide() {
    const cur = document.getElementById('model-cursor');
    const out = document.getElementById('model-readout');
    if (cur && _modelPlot) cur.getContext('2d').clearRect(0, 0, _modelPlot.cssW, _modelPlot.cssH);
    if (out) out.style.display = 'none';
}

function _modelHoverMove(e) {
    const P = _modelPlot, cur = document.getElementById('model-cursor'), out = document.getElementById('model-readout');
    if (!P || !cur || !out || !modelData) return;
    const rect = cur.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (px < P.mL || px > P.mL + P.pw || py < P.mT || py > P.mT + P.ph) { _modelHoverHide(); return; }

    const times = modelData.times;
    const target = P.t0 + ((px - P.mL) / P.pw) * (P.t1 - P.t0);
    // Uniform hourly spacing makes the index a division; the ±1 sweep keeps it
    // exact if a feed ever comes back with a gap.
    let i = Math.round((target - P.t0) / ((P.t1 - P.t0) / (times.length - 1)));
    i = Math.max(0, Math.min(times.length - 1, i));
    for (const j of [i - 1, i + 1]) {
        if (j >= 0 && j < times.length && Math.abs(times[j] - target) < Math.abs(times[i] - target)) i = j;
    }

    const X = ms => P.mL + ((ms - P.t0) / (P.t1 - P.t0)) * P.pw;
    const Y = v => P.mT + P.ph - ((v - P.vMin) / (P.vMax - P.vMin)) * P.ph;
    const cx = X(times[i]);

    const c = cur.getContext('2d');
    c.clearRect(0, 0, P.cssW, P.cssH);
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(cx, P.mT); c.lineTo(cx, P.mT + P.ph); c.stroke();
    c.setLineDash([]);

    const rows = [];
    const vals = [];
    P.active.forEach(m => {
        const v = modelData.series[m.id][P.varKey][i];
        if (v == null) { rows.push({ m, txt: '—', dim: true }); return; }
        vals.push(v);
        c.fillStyle = m.color;
        c.beginPath(); c.arc(cx, Y(v), 3.2, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#0d1117'; c.lineWidth = 1.2; c.stroke();
        const b = m.ens && modelData.bands?.[m.id]?.[P.varKey];
        const band = b && b.lo[i] != null ? ` (${b.lo[i].toFixed(P.meta.dec)}–${b.hi[i].toFixed(P.meta.dec)})` : '';
        rows.push({ m, txt: `${v.toFixed(P.meta.dec)}${P.meta.unit}${band}` });
    });

    const d = new Date(times[i]);
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const stamp = `${dow} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCHours()).padStart(2, '0')}Z`;
    const hrOut = Math.round((times[i] - Date.now()) / 3600000);
    let html = `<div class="rd-head">`
        + `${esc(stamp)} <span class="c-dim">${hrOut >= 0 ? '+' + hrOut : hrOut} h</span></div>`;
    rows.forEach(r => {
        html += `<div class="rd-row">`
            + `<span class="swatch" data-bg="${r.m.color}"></span>`
            + `<span class="rd-lbl">${esc(r.m.label)}</span>`
            + `<span class="${r.dim ? 'c-dim' : 'c-txt'}">${esc(r.txt)}</span></div>`;
    });
    if (vals.length > 1) {
        html += `<div class="rd-row rd-sum">`
            + `<span class="rd-lbl">spread</span>`
            + `<span class="c-warn">${(Math.max(...vals) - Math.min(...vals)).toFixed(P.meta.dec)}${P.meta.unit}</span></div>`;
    }
    out.innerHTML = html;
    paint(out);
    out.style.display = 'block';
    // Flip to the cursor's other side near an edge so the box never leaves the plot.
    const bw = out.offsetWidth, bh = out.offsetHeight;
    out.style.left = (cx + 14 + bw > P.cssW ? Math.max(0, cx - 14 - bw) : cx + 14) + 'px';
    out.style.top = Math.max(0, Math.min(P.cssH - bh, py - bh / 2)) + 'px';
}

function initCompareTab() {
    // Field switch re-renders the cached payload — every variable came down in
    // the same request, so there is nothing to refetch.
    document.getElementById('model-var').addEventListener('change', () => renderModelCompare());
    document.getElementById('model-days').addEventListener('change', () => reloadView('compare'));
    // The canvas is a fixed-pixel bitmap, so redraw when the window changes size.
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderModelCompare, 120); });
}
