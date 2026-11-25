// Copied from FX-Net NextGen (app.js). Top-level names match so the two copies
// can be compared; tests/_load.js finds declarations by name at column 0.

// ═══ MOS Guidance: MDL station bulletins ═══

// ─── MOS guidance (IEM parses the MDL bulletins into JSON) ───
// NAM MOS (MET) ended with NAM, SREF, HREF and HiresW on 2026-11-03 12 UTC
// (SCN 26-47), replaced by RRFS, and is gone from this list. GFS MOS was not
// retired; MDL points NAM MOS users at GFS MOS or NBM.
// `cycleHrs` is the BULLETIN issuance interval, verified by walking IEM's archive
// cycle by cycle — not the interval the underlying model runs at. That gap is the
// usual source of "why is my guidance stale?": the NBM system itself updates
// every hour, but its NBS station bulletin is only cut every 6 hours and NBE
// every 12. The genuinely hourly station product is LAMP, so the panel says so
// rather than leaving you to wonder whether a 06Z run at 13Z is broken.
//
// There is no standalone "HRRR MOS" bulletin and there never has been. HRRR's
// statistical station guidance ships inside LAMP: MDL has melded HRRR into the
// LAMP ceiling/visibility elements since v2.0 (2017-04-03) and extended the
// station guidance to take HRRR input in v2.5 (2023-06-06). So LAV is the HRRR
// MOS, and its convection/lightning rows (CP1/CC1, LP1/LC1 — 1-h probability
// and N/L/M/H potential out to 25 h) are the part worth having on screen.
const MOS_MODELS = [
    { id: 'GFS', label: 'GFS MOS',  sub: 'MAV · 3-hourly out to 72 h', cycleHrs: 6,
      rows: ['tmp', 'dpt', 'cld', 'wdr', 'wsp', 'p06', 'p12', 'q06', 'q12', 't06_1', 't06_2', 't12_1', 'cig', 'vis', 'obv'] },
    { id: 'MEX', label: 'GFS Ext',  sub: 'MEX · 12-hourly out to 192 h', cycleHrs: 12,
      rows: ['n_x', 'tmp', 'dpt', 'cld', 'wsp', 'p12', 'q12', 't12_1', 't12_2'] },
    { id: 'LAV', label: 'LAMP',     sub: 'Localized Aviation MOS · HRRR-melded · hourly', cycleHrs: 1, hrrr: true,
      rows: ['tmp', 'dpt', 'cld', 'wdr', 'wsp', 'p01', 'cig', 'vis', 'obv', 'ccg', 'cvs', 'ppo', 'pco',
             'lp1', 'lc1', 'cp1', 'cc1'] },
    { id: 'NBS', label: 'NBM Short', sub: 'National Blend · 3-hourly out to ~72 h', cycleHrs: 6, nbm: true,
      rows: ['tmp', 'dpt', 'wdr', 'wsp', 'gst', 'sky', 'p06', 'q06', 't06_1', 'cig', 'vis', 'pra', 'psn', 'pzr', 'ppl', 's06'] },
    { id: 'NBE', label: 'NBM Ext',  sub: 'National Blend · 12-hourly, extended', cycleHrs: 12, nbm: true,
      rows: ['n_x', 'tmp', 'dpt', 'wdr', 'wsp', 'gst', 'sky', 'p12', 'q12', 't12_1', 's12'] }
];

// Bulletin row labels, in MDL's own shorthand so the table reads like the real thing.
const MOS_ROW_LABELS = {
    n_x: 'N/X', tmp: 'TMP', dpt: 'DPT', cld: 'CLD', sky: 'SKY', wdr: 'WDR', wsp: 'WSP', gst: 'GST',
    p01: 'P01', p06: 'P06', p12: 'P12', q06: 'Q06', q12: 'Q12',
    t06_1: 'T06', t06_2: 'T06/S', t12_1: 'T12', t12_2: 'T12/S',
    cig: 'CIG', vis: 'VIS', obv: 'OBV', ccg: 'CCG', cvs: 'CVS', ppo: 'PPO', pco: 'PCO',
    pra: 'PRA', psn: 'PSN', pzr: 'PZR', ppl: 'PPL', s06: 'S06', s12: 'S12',
    lp1: 'LP1', lc1: 'LC1', cp1: 'CP1', cc1: 'CC1'
};

// IEM returns MOS times as UTC values but writes them WITHOUT a zone designator
// ("2026-07-28T06:00:00.000", or "2026-07-28 06:00"). A bare date-time is parsed
// as LOCAL by JS, which silently shifted every projection hour by the viewer's
// UTC offset. Force the Z on.
function parseMosUtc(s) {
    if (!s) return NaN;
    return Date.parse(String(s).trim().replace(' ', 'T').replace(/Z$/, '') + 'Z');
}

function mosStationId(raw) {
    const s = (raw || '').trim().toUpperCase();
    // MDL keys MOS by 4-character ICAO. IEM's CONUS ASOS ids are 3 characters
    // (JAN); Alaska/Hawaii/Pacific are already 4 (PANC, PHKO).
    return s.length === 3 ? 'K' + s : s;
}

// The nearest sites to a point, closest first, from the NWS point service (its
// METAR list; FX-Net reads the METARs on its map instead). Cooperative and mesonet
// ids are dropped because MDL issues MOS for airports.
const MOS_MAX_MI = 100, MOS_MAX_TRIES = 8;
function mosCandidates(gj, pt) {
    return ((gj && gj.features) || []).map(f => {
        const c = (f.geometry && f.geometry.coordinates) || [], p = f.properties || {};
        return { id: String(p.stationIdentifier || ''), name: p.name || '', mi: Math.round(fcstMiles(pt, { lat: c[1], lon: c[0] })) };
    }).filter(s => /^[KPT][A-Z0-9]{3}$/.test(s.id) && s.mi <= MOS_MAX_MI)
        .sort((a, b) => a.mi - b.mi).slice(0, MOS_MAX_TRIES);
}

let _mosNear = {};   // "lat,lon" -> candidate list
async function nearestMosSites(pt) {
    const key = `${(+pt.lat).toFixed(4)},${(+pt.lon).toFixed(4)}`;
    if (_mosNear[key]) return _mosNear[key];
    const r = await fetch(`https://api.weather.gov/points/${key}/stations`, { headers: { 'Accept': 'application/geo+json' } });
    if (r.status === 404) throw new Error('The nearest-station lookup covers U.S. points only. Type a station id instead.');
    if (!r.ok) throw new Error(`Nearest-station lookup failed (NWS HTTP ${r.status}). Type a station id instead.`);
    return (_mosNear[key] = mosCandidates(await r.json(), pt));
}

// Bulletin rows, or null when IEM has none for this station and model.
async function fetchMosRows(station, def) {
    const res = await fetch(`https://mesonet.agron.iastate.edu/api/1/mos.json?station=${encodeURIComponent(station)}&model=${encodeURIComponent(def.id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`IEM HTTP ${res.status}`);
    const rows = (await res.json()).data || [];
    return rows.length ? rows : null;
}

let mosSeq = 0;        // drop stale responses
let mosTyped = false;  // a typed station stays put until the place changes or Nearest is pressed

// `place` picks the nearest site that issues this bulletin; without it, the
// station box is used as typed.
async function loadMos(place) {
    const body = document.getElementById('mos-body');
    const locEl = document.getElementById('mos-loc');
    const input = document.getElementById('mos-station');
    const def = MOS_MODELS.find(m => m.id === document.getElementById('mos-model').value) || MOS_MODELS[0];
    const seq = ++mosSeq;
    const fail = html => {
        if (seq !== mosSeq) return;
        locEl.textContent = '—';
        body.innerHTML = `<div class="pt-msg warn">${html}</div>`;
        return false;
    };
    try {
        let tries;
        if (place) {
            locEl.textContent = `Finding the nearest ${def.label} site to ${place.label}…`;
            body.innerHTML = `<div class="pt-msg">Finding the nearest ${esc(def.label)} site to ${esc(place.label)}…</div>`;
            tries = await nearestMosSites(place);
            if (seq !== mosSeq) return;
            if (!tries.length) return fail(`No station within ${MOS_MAX_MI} miles of ${esc(place.label)}. Type a station id instead.`);
        } else {
            const station = mosStationId(input.value);
            if (!/^[A-Z0-9]{4}$/.test(station)) return fail('Enter a 3- or 4-character station id (e.g. <b>JAN</b> or <b>KJAN</b>).');
            tries = [{ id: station }];
        }
        for (const s of tries) {
            locEl.textContent = `Loading ${s.id} ${def.label}…`;
            body.innerHTML = `<div class="pt-msg">Fetching ${esc(def.label)} for ${esc(s.id)}…</div>`;
            const rows = await fetchMosRows(s.id, def);
            if (seq !== mosSeq) return;
            if (!rows) continue;
            input.value = s.id;
            renderMosTable(s.id, def, rows);
            locEl.textContent = `${s.id} · ${def.label} · run ${rows[0].runtime || '—'}Z`
                + (place ? ` · ${s.name ? s.name + ', ' : ''}${s.mi} mi from ${place.label}` : '');
            return true;
        }
        return fail(place ? `None of the ${tries.length} nearest stations issues ${esc(def.label)}. Try another model or type a station id.`
            : `No current ${esc(def.label)} bulletin for ${esc(tries[0].id)}. MOS is issued for airports — try a nearby ICAO id.`);
    } catch (e) {
        return fail(esc(e.message));
    }
}

function renderMosTable(station, def, rows) {
    const body = document.getElementById('mos-body');
    if (!body) return;
    // Only keep rows this bulletin actually carries, so an empty parameter never
    // takes a line — the real bulletins vary by model and by cycle.
    const useRows = def.rows.filter(k => rows.some(r => r[k] !== null && r[k] !== undefined && r[k] !== ''));
    const ftMs = rows.map(r => parseMosUtc(r.ftime_utc || r.ftime));
    const hdr = ftMs.map(ms => isNaN(ms) ? '--' : String(new Date(ms).getUTCHours()).padStart(2, '0'));
    const days = ftMs.map(ms => isNaN(ms) ? '' : String(new Date(ms).getUTCDate()).padStart(2, '0'));
    let lastDay = null;
    const dayCells = days.map(dv => {
        const show = dv !== lastDay; lastDay = dv;
        return show ? dv : '';
    });
    const cell = v => (v === null || v === undefined || v === '') ? '' : String(v).trim();
    // Age the cycle against its own issuance interval, so a 6-hourly bulletin
    // sitting at 06Z mid-morning reads as on-time instead of looking stale.
    const runMs = parseMosUtc(rows[0].runtime_utc || rows[0].runtime);
    let ageNote = '';
    if (!isNaN(runMs)) {
        const ageMin = Math.max(0, Math.round((Date.now() - runMs) / 60000));
        const ageTxt = ageMin < 90 ? `${ageMin} min` : `${(ageMin / 60).toFixed(1)} h`;
        const nextMs = runMs + def.cycleHrs * 3600 * 1000;
        const nextTxt = `${String(new Date(nextMs).getUTCHours()).padStart(2, '0')}Z`;
        const overdue = Date.now() > nextMs + 75 * 60 * 1000;   // allow normal issuance lag
        ageNote = ` · <span class="${overdue ? 'c-warn' : 'c-mut'}">${ageTxt} old`
            + (def.cycleHrs > 1 ? `, issued every ${def.cycleHrs} h, next ~${nextTxt}` : ', issued hourly')
            + `${overdue ? ' — running late' : ''}</span>`;
    }
    let html = `<div class="mos-head">
            <b>${esc(station)}</b> — ${esc(def.label)} <span class="c-dim">${esc(def.sub)}</span>
            <br>Cycle <b>${esc(rows[0].runtime || '—')}Z</b> · ${rows.length} forecast projections${ageNote}
            ${def.nbm ? '<br><span class="c-dim">The NBM system updates hourly, but this station bulletin is only cut every '
                + def.cycleHrs + ' h. For hourly-updating station guidance use <b>LAMP</b>.</span>' : ''}
            ${def.hrrr ? '<br><span class="c-dim">There is no standalone HRRR MOS. LAMP <b>is</b> the HRRR-based '
                + 'station guidance — MDL statistically melds HRRR into the ceiling, visibility and conditional CIG/VIS elements. '
                + 'LP1/LC1 and CP1/CC1 run to 25 h; the rest go further.</span>' : ''}
        </div>
        <div class="pt-scroll">
        <table class="mos-table"><thead>
            <tr><th>DAY</th>${dayCells.map(d => `<th>${esc(d)}</th>`).join('')}</tr>
            <tr><th>HR (Z)</th>${hdr.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
        </thead><tbody>`;
    useRows.forEach(k => {
        html += `<tr><th title="${esc(k)}">${esc(MOS_ROW_LABELS[k] || k.toUpperCase())}</th>`
            + rows.map(r => `<td>${esc(cell(r[k]))}</td>`).join('') + '</tr>';
    });
    html += `</tbody></table></div>
        <div class="mos-foot">
            MDL bulletins via Iowa Environmental Mesonet. TMP/DPT °F · WSP/GST kt · WDR degrees ·
            P06/P12 PoP % · Q06/Q12 QPF category · T06/T12 thunder (and severe) % ·
            CIG/VIS/CLD categorical · OBV obstruction to vision ·
            CCG/CVS conditional ceiling/visibility · PPO/PCO precip occurrence % and category ·
            LP1/CP1 1-h lightning and convection probability % · LC1/CC1 their potential (N/L/M/H).
            Convection = at least one lightning flash and/or radar ≥ 40 dBZ in the hour ending at that time.
        </div>`;
    body.innerHTML = html;
}

// MOS text size. The bulletin is a dense grid of small numbers, so it gets its
// own size control (remembered per browser) instead of relying on page zoom.
const MOS_FONT_STEPS = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24];
const MOS_FONT_DEFAULT = 12;
function mosFontStep(cur, dir) {
    const i = MOS_FONT_STEPS.indexOf(cur);
    if (i < 0) return MOS_FONT_DEFAULT;
    return MOS_FONT_STEPS[Math.min(MOS_FONT_STEPS.length - 1, Math.max(0, i + dir))];
}
function applyMosFont(px) {
    document.getElementById('mos-body')?.style.setProperty('--mos-fs', `${px}px`);
    const val = document.getElementById('mos-font-val');
    if (val) val.textContent = `${px}px`;
    const down = document.getElementById('mos-font-down');
    const up = document.getElementById('mos-font-up');
    if (down) down.disabled = px <= MOS_FONT_STEPS[0];
    if (up) up.disabled = px >= MOS_FONT_STEPS[MOS_FONT_STEPS.length - 1];
}

function initMosTab() {
    const input = document.getElementById('mos-station');
    const typed = () => { mosTyped = true; reloadView('mos'); };
    document.getElementById('mos-go').addEventListener('click', typed);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); typed(); } });
    document.getElementById('mos-nearest').addEventListener('click', () => { mosTyped = false; reloadView('mos'); });
    document.getElementById('mos-model').addEventListener('change', () => reloadView('mos'));
    let fontPx = (() => { try { return Number(localStorage.getItem('ncep_mos_font')); } catch (_) { return 0; } })();
    if (!MOS_FONT_STEPS.includes(fontPx)) fontPx = MOS_FONT_DEFAULT;
    applyMosFont(fontPx);
    const bumpFont = dir => {
        fontPx = mosFontStep(fontPx, dir);
        applyMosFont(fontPx);
        try { localStorage.setItem('ncep_mos_font', String(fontPx)); } catch (_) {}
    };
    document.getElementById('mos-font-down').addEventListener('click', () => bumpFont(-1));
    document.getElementById('mos-font-up').addEventListener('click', () => bumpFont(1));
}
