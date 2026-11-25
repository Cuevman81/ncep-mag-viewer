// Helpers shared by the point-forecast tabs (Model Comparison, MOS, Soundings,
// Winter). Plain scripts in load order, no modules: common.js, the four tabs,
// then tabs.js.
//
// Copied from FX-Net NextGen (app.js). Top-level names match so the two copies
// can be compared; tests/_load.js finds declarations by name at column 0.

// Escape feed-derived text before interpolating into innerHTML. NWS/CAP alert
// text, LSR spotter remarks, gauge names, etc. originate from many upstream
// systems — never trust them as markup.
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// For hosts that ship no Cache-Control (Open-Meteo meta.json): browsers would
// otherwise serve the previous cycle for hours.
function cacheBust(url) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + '_cb=' + Date.now();
}

function fcstMiles(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Geocode a ZIP code or city name to a lat/lon (keyless, CORS-enabled):
// 5-digit ZIP → Zippopotam.us, otherwise city name → Open-Meteo geocoding.
async function geocodePlace(qRaw) {
    const q = (qRaw || '').trim();
    if (!q) throw new Error('Enter a ZIP code or city name.');
    if (/^\d{5}$/.test(q)) {
        const r = await fetch(`https://api.zippopotam.us/us/${q}`);
        if (!r.ok) throw new Error(`ZIP ${q} not found.`);
        const j = await r.json();
        const pl = j.places && j.places[0];
        if (!pl) throw new Error(`ZIP ${q} not found.`);
        return { lat: +pl.latitude, lon: +pl.longitude, label: `${pl['place name']}, ${pl['state abbreviation']} ${q}` };
    }
    // Split off a trailing state ("City, ST" or "City ST") so we can query the
    // bare city name and filter results to that state (Open-Meteo admin1 = full name).
    let name = q, stateFull = '', stateCode = '';
    if (q.includes(',')) {
        const parts = q.split(',');
        name = parts[0].trim();
        const st = parts[1].trim();
        stateCode = st.toUpperCase();
        stateFull = (US_STATE_NAMES[st.toUpperCase()] || st).toLowerCase();
    } else {
        const toks = q.split(/\s+/);
        const last = (toks[toks.length - 1] || '').toUpperCase();
        if (toks.length > 1 && US_STATE_NAMES[last]) {
            stateFull = US_STATE_NAMES[last].toLowerCase();
            stateCode = last;
            name = toks.slice(0, -1).join(' ');
        }
    }
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=100&language=en&format=json`);
    if (!r.ok) throw new Error('Geocoding failed.');
    const j = await r.json();
    const results = j.results || [];
    let pool = results.filter(x => x.country_code === 'US');
    if (!pool.length) pool = results;
    let hit;
    // A state or country that matches nothing is an error, not a reason to show
    // some other town of the same name.
    if (stateFull) {
        hit = pool.find(x => (x.admin1 || '').toLowerCase() === stateFull)
            || results.find(x => (x.country || '').toLowerCase() === stateFull)
            || results.find(x => x.country_code === stateCode)   // Puerto Rico comes back with no country name
            || (US_STATE_NAMES[stateCode] ? null : results.find(x => (x.admin1 || '').toLowerCase().includes(stateFull)));   // not "VA" in West Virginia
    } else hit = pool[0];
    if (!hit) throw new Error(`No match for “${q}”.`);
    return { lat: hit.latitude, lon: hit.longitude, label: `${hit.name}${hit.admin1 ? ', ' + hit.admin1 : ''}` };
}

const US_STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico' };

// Linear-interpolated quantile of an ascending array.
function quantileSorted(a, q) {
    if (!a.length) return null;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

// A published cycle is only believable while the metadata is still tracking the
// data. Open-Meteo's cmc_gem_gdps meta.json is a live example of the failure:
// it has been frozen for weeks while the model itself keeps delivering current
// forecasts, so printing its stated run would put a two-month-old timestamp on
// a trace that is actually today's. Three cycles plus a six-hour grace is well
// past any normal delivery delay, and past it we say nothing rather than lie.
function _modelRunUsable(meta) {
    const init = meta && meta.last_run_initialisation_time;
    if (!init) return false;
    const interval = (meta.update_interval_seconds || 6 * 3600) * 1000;
    const age = Date.now() - init * 1000;
    return age > -3600 * 1000 && age <= 3 * interval + 6 * 3600 * 1000;
}

// The page's CSP has no 'unsafe-inline' for styles, so a style attribute in
// generated markup is ignored. Colors that come from data are written as
// data-fg / data-bg / data-fill and applied here through the DOM instead.
function paint(root) {
    root.querySelectorAll('[data-fg]').forEach(el => { el.style.color = el.dataset.fg; });
    root.querySelectorAll('[data-bg]').forEach(el => { el.style.background = el.dataset.bg; });
    root.querySelectorAll('[data-fill]').forEach(el => { el.style.fill = el.dataset.fill; });
}
