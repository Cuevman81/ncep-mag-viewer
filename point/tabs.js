// The tab bar and the one place box that drives every point-forecast tab.
// A tab fetches nothing until it is opened; opening it again refetches only if
// the place changed or its data is over 30 minutes old.

const DEFAULT_PLACE = { q: 'Jackson, MS', lat: 32.2988, lon: -90.1848, label: 'Jackson, Mississippi' };
const VIEW_MAX_AGE = 30 * 60 * 1000;

// Charts is the MAG grid and belongs to app.js. `load` returns false on failure;
// `shown` redraws what is already loaded.
const VIEWS = {
    charts: {},
    compare: { load: p => loadModelCompareAt(p.lat, p.lon, p.label), shown: () => renderModelCompare() },
    mos: { load: p => loadMos(mosTyped ? null : p) },
    soundings: { load: p => loadSkewtModel(p) },
    winter: { load: p => loadWinterAt(p.lat, p.lon, p.label) }
};

// A saved place is used only if it is complete and on the globe.
function parsePlace(json) {
    try {
        const p = JSON.parse(json);
        if (p && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.label) {
            return { q: String(p.q || p.label), lat: +p.lat, lon: +p.lon, label: String(p.label) };
        }
    } catch (_) {}
    return { ...DEFAULT_PLACE };
}

// Must this tab fetch? `rec` is what it last loaded.
function viewStale(rec, key, nowMs) {
    return !rec || rec.key !== key || nowMs - rec.at > VIEW_MAX_AGE;
}

let currentView = 'charts';
let currentPlace = { ...DEFAULT_PLACE };
const viewLoaded = {};   // view -> { key, at }

function reloadView(name) {
    const rec = { key: `${currentPlace.lat},${currentPlace.lon}`, at: Date.now() };
    viewLoaded[name] = rec;
    Promise.resolve(VIEWS[name].load(currentPlace)).then(ok => {
        if (ok === false && viewLoaded[name] === rec) delete viewLoaded[name];   // retry on the next open
    });
}

function showView(name) {
    if (!VIEWS[name]) name = 'charts';
    currentView = name;
    Object.keys(VIEWS).forEach(v => { document.getElementById(`view-${v}`).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach(b => {
        if (b.dataset.view === name) {
            b.setAttribute('aria-current', 'page');
            b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else b.removeAttribute('aria-current');
    });
    document.getElementById('placeBar').hidden = name === 'charts';
    history.replaceState(null, '', name === 'charts' ? location.pathname + location.search : `#${name}`);
    if (!VIEWS[name].load) return;
    if (viewStale(viewLoaded[name], `${currentPlace.lat},${currentPlace.lon}`, Date.now())) reloadView(name);
    else if (VIEWS[name].shown) VIEWS[name].shown();
}

let placeSeq = 0;
async function searchPlace() {
    const input = document.getElementById('placeInput'), status = document.getElementById('placeStatus');
    const q = input.value.trim(), seq = ++placeSeq;
    // Same text again means refresh, with no second lookup.
    if (q && q !== currentPlace.q) {
        status.className = 'place-status';
        status.textContent = 'Searching…';
        try {
            const g = await geocodePlace(q);
            if (seq !== placeSeq) return;
            currentPlace = { q, lat: g.lat, lon: g.lon, label: g.label };
        } catch (e) {
            if (seq !== placeSeq) return;
            status.className = 'place-status c-warn';
            status.textContent = e.message;
            return;
        }
        mosTyped = false;
        try { localStorage.setItem('ncep_place', JSON.stringify(currentPlace)); } catch (_) {}
    }
    showPlace();
    if (VIEWS[currentView].load) reloadView(currentView);
}

function showPlace() {
    const status = document.getElementById('placeStatus');
    document.getElementById('placeInput').value = currentPlace.q;
    status.className = 'place-status';
    status.textContent = `${currentPlace.label} (${currentPlace.lat.toFixed(2)}, ${currentPlace.lon.toFixed(2)})`;
}

document.addEventListener('DOMContentLoaded', () => {
    let saved = null;
    try { saved = localStorage.getItem('ncep_place'); } catch (_) {}
    currentPlace = parsePlace(saved);
    showPlace();
    initCompareTab();
    initMosTab();
    initSoundingTab();
    initWinterTab();
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
    document.getElementById('placeGo').addEventListener('click', searchPlace);
    document.getElementById('placeInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); searchPlace(); }
    });
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
    showView(location.hash.slice(1));
});
