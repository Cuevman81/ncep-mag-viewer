// Copied from FX-Net NextGen (app.js). Top-level names match so the two copies
// can be compared; tests/_load.js finds declarations by name at column 0.

// ═══ Forecast Soundings: skew-T / log-P at any point ═══

// ── Thermodynamics (Bolton 1980; pseudoadiabatic parcel). T in °C unless noted K. ──
const _Rd = 287.04, _cpd = 1004, _Lv = 2.5e6, _epsw = 0.622, _gg = 9.81;
function _esat(Tc) { return 6.112 * Math.exp(17.67 * Tc / (Tc + 243.5)); }        // hPa
function _mixr(Tc, p) { const e = _esat(Tc); return _epsw * e / (p - e); }          // kg/kg
function _lclTempK(Tk, Tdk) { return 56 + 1 / (1 / (Tdk - 56) + Math.log(Tk / Tdk) / 800); }
function _moistLapse(Tk, p) {                                                        // dT/dp (K/hPa)
    const ws = _mixr(Tk - 273.15, p);
    const num = _Rd * Tk + _Lv * ws;
    const den = _cpd + (_Lv * _Lv * ws * _epsw) / (_Rd * Tk * Tk);
    return (num / den) / p;
}
function _uv(dir, spd) { const a = dir * Math.PI / 180; return [-spd * Math.sin(a), -spd * Math.cos(a)]; }
const _KT2MS = 0.514444;
// Bolton (1980) eq. 39 equivalent potential temperature — the quantity both the
// most-unstable parcel search and DCAPE's source-level search are ranked on.
function _thetaE(Tc, Tdc, p) {
    const Tk = Tc + 273.15, w = _mixr(Tdc, p);
    const Tl = _lclTempK(Tk, Tdc + 273.15);
    const th = Tk * Math.pow(1000 / p, 0.2854 * (1 - 0.28 * w));
    return th * Math.exp((3.376 / Tl - 0.00254) * 1000 * w * (1 + 0.81 * w));
}
function _dewpFromW(w, p) {                    // inverse of _mixr, for the mixed-layer parcel
    const e = w * p / (_epsw + w);
    if (!(e > 0)) return -80;
    const l = Math.log(e / 6.112);
    return 243.5 * l / (17.67 - l);
}
// Thin a profile to ~dp-hPa spacing. The effective-inflow scan lifts a parcel from
// every candidate level, so it runs on a coarsened copy — a 4000-level BUFR sounding
// would otherwise mean thousands of full lifts for a threshold test that only needs
// to know whether CAPE clears 100 J/kg.
function _coarsen(lv, dp) {
    const out = [lv[0]];
    let last = lv[0].pres;
    for (const l of lv) if (last - l.pres >= dp) { out.push(l); last = l.pres; }
    if (out[out.length - 1] !== lv[lv.length - 1]) out.push(lv[lv.length - 1]);
    return out;
}

// ── Generalized parcel lift ────────────────────────────────────────────────
// The original code lifted only the surface parcel. This takes a start index k
// and an explicit (p0,T0,Td0) — which lets the mixed-layer parcel carry averaged
// properties while still starting at the surface, and lets the most-unstable
// parcel start aloft with everything below it excluded from the integration.
// Virtual-temperature buoyancy throughout (SPC/SHARPpy convention).
function _liftParcel(lv, k, p0, T0c, Td0c) {
    const n = lv.length;
    const T0 = T0c + 273.15, w0 = _mixr(Td0c, p0);
    const Tlcl = _lclTempK(T0, Td0c + 273.15);
    const Plcl = p0 * Math.pow(Tlcl / T0, 1 / 0.2854);
    const TkLcl = T0 * Math.pow(Plcl / p0, 0.2854);
    const Tp = new Array(n).fill(NaN), buoy = new Array(n).fill(NaN);
    const tv = (Tk, w) => Tk * (1 + 0.61 * w);
    let mT = TkLcl, mP = Plcl;
    for (let i = k; i < n; i++) {
        const p = lv[i].pres;
        if (p >= Plcl) { Tp[i] = T0 * Math.pow(p / p0, 0.2854); mT = TkLcl; mP = Plcl; }
        else {
            let Tk = mT, pp = mP;
            while (pp > p) { const dp = Math.max(-2, p - pp); Tk += _moistLapse(Tk, pp) * dp; pp += dp; }
            Tp[i] = Tk; mT = Tk; mP = p;
        }
        const Tev = tv(lv[i].tmpc + 273.15, _mixr(lv[i].dwpc, p));
        buoy[i] = (tv(Tp[i], p >= Plcl ? w0 : _mixr(Tp[i] - 273.15, p)) - Tev) / Tev;
    }
    const pos = [];
    for (let i = k; i < n; i++) if (lv[i].pres <= Plcl + 0.5 && buoy[i] > 0) pos.push(i);
    let cape = 0, cin = 0, lfc = null, el = null, elZ = null;
    if (pos.length) {
        const lfcI = pos[0], elI = pos[pos.length - 1];
        lfc = lv[lfcI].pres; el = lv[elI].pres; elZ = lv[elI].hght;
        for (let i = lfcI + 1; i <= elI; i++) { const dz = lv[i].hght - lv[i - 1].hght; cape += _gg * 0.5 * (Math.max(buoy[i - 1], 0) + Math.max(buoy[i], 0)) * dz; }
        for (let i = k + 1; i <= lfcI; i++) { const dz = lv[i].hght - lv[i - 1].hght; cin += _gg * 0.5 * (Math.min(buoy[i - 1], 0) + Math.min(buoy[i], 0)) * dz; }
    }
    let li = null;
    for (let i = k; i < n; i++) if (Math.abs(lv[i].pres - 500) < 8) { li = (lv[i].tmpc + 273.15) - Tp[i]; break; }
    const lclZ = (_Rd * 0.5 * (T0 + Tlcl) / _gg) * Math.log(p0 / Plcl);
    return { Tp, buoy, Plcl, lclZ, cape, cin, li, lfc, el, elZ };
}
// Mixed-layer parcel: mean theta and mean mixing ratio over the lowest 100 hPa,
// brought back to the surface. Less hostage to one superadiabatic surface reading
// than SB, which is why SPC hangs most severe parameters off it.
function _mlParcel(lv) {
    const p0 = lv[0].pres, ptop = p0 - 100;
    let sth = 0, sw = 0, n = 0;
    for (const l of lv) {
        if (l.pres < ptop) break;
        sth += (l.tmpc + 273.15) * Math.pow(1000 / l.pres, 0.2854);
        sw += _mixr(l.dwpc, l.pres); n++;
    }
    if (!n) return null;
    const Tk = (sth / n) * Math.pow(p0 / 1000, 0.2854);
    return { k: 0, p: p0, T: Tk - 273.15, Td: _dewpFromW(sw / n, p0) };
}
// Most-unstable parcel: highest theta-e in the lowest 300 hPa. This is the one
// that finds elevated convection a surface parcel reports as zero.
function _muParcel(lv) {
    const ptop = lv[0].pres - 300;
    let best = 0, bthe = -1e9;
    for (let i = 0; i < lv.length; i++) {
        if (lv[i].pres < ptop) break;
        const the = _thetaE(lv[i].tmpc, lv[i].dwpc, lv[i].pres);
        if (the > bthe) { bthe = the; best = i; }
    }
    return { k: best, p: lv[best].pres, T: lv[best].tmpc, Td: lv[best].dwpc };
}
// Effective inflow layer (Thompson et al. 2007): the contiguous run of levels whose
// parcels have CAPE >= 100 J/kg and CIN >= -250 J/kg. Replaces fixed 0-1/0-3 km
// layers for storm-relative helicity and is what SPC's STP/SCP are defined on.
function _effInflow(lvC) {
    const p0 = lvC[0].pres, z0 = lvC[0].hght;
    let bot = null, top = null;
    for (let i = 0; i < lvC.length; i++) {
        if (lvC[i].pres < p0 - 400) break;
        const r = _liftParcel(lvC, i, lvC[i].pres, lvC[i].tmpc, lvC[i].dwpc);
        if (r.cape >= 100 && r.cin >= -250) { if (bot === null) bot = i; top = i; }
        else if (bot !== null) break;
    }
    // A single qualifying level is a zero-depth "layer": SRH and shear across it are
    // identically ~0, which reads as "no helicity" rather than "not applicable".
    // SPC shows no effective inflow layer in that case, so neither do we.
    if (bot === null || top <= bot) return null;
    return {
        botZ: lvC[bot].hght - z0, topZ: lvC[top].hght - z0,
        botP: lvC[bot].pres, topP: lvC[top].pres,
        depth: lvC[top].hght - lvC[bot].hght
    };
}
// Bunkers (2000) internal dynamics method — 0-6 km mean wind deviated 7.5 m/s
// orthogonal to the 0-6 km shear vector. Returns m/s components.
function _bunkers(lv) {
    const w = lv.filter(l => l.drct != null && l.sknt != null && l.hght != null);
    if (w.length < 2) return null;
    const z0 = w[0].hght;
    const meanUV = (zlo, zhi) => {
        let su = 0, sv = 0, n = 0;
        for (const l of w) { const z = l.hght - z0; if (z >= zlo && z <= zhi) { const uv = _uv(l.drct, l.sknt); su += uv[0]; sv += uv[1]; n++; } }
        return n ? [su / n * _KT2MS, sv / n * _KT2MS] : null;
    };
    const mean06 = meanUV(0, 6000);
    if (!mean06) return null;
    const low = meanUV(0, 500) || mean06, high = meanUV(5500, 6000) || mean06;
    const sh = [high[0] - low[0], high[1] - low[1]];
    const mag = Math.hypot(sh[0], sh[1]);
    if (!(mag > 0)) return { rm: mean06, lm: mean06, mean: mean06 };
    const D = 7.5;
    return {
        rm: [mean06[0] + D * sh[1] / mag, mean06[1] - D * sh[0] / mag],
        lm: [mean06[0] - D * sh[1] / mag, mean06[1] + D * sh[0] / mag],
        mean: mean06
    };
}
// Storm-relative helicity over an AGL layer, given storm motion C (m/s).
function _srh(lv, zlo, zhi, C) {
    const w = lv.filter(l => l.drct != null && l.sknt != null && l.hght != null);
    if (w.length < 2 || !C) return null;
    const z0 = w[0].hght;
    let s = 0;
    for (let i = 1; i < w.length; i++) {
        const za = w[i - 1].hght - z0, zb = w[i].hght - z0;
        if (zb < zlo || za > zhi) continue;
        const a = _uv(w[i - 1].drct, w[i - 1].sknt), b = _uv(w[i].drct, w[i].sknt);
        const u0 = a[0] * _KT2MS - C[0], v0 = a[1] * _KT2MS - C[1];
        const u1 = b[0] * _KT2MS - C[0], v1 = b[1] * _KT2MS - C[1];
        s += (u1 * v0 - u0 * v1);
    }
    return s;
}
// Bulk shear magnitude (kt) between two AGL heights.
function _bulkShear(lv, zlo, zhi) {
    const w = lv.filter(l => l.drct != null && l.sknt != null && l.hght != null);
    if (w.length < 2) return null;
    const z0 = w[0].hght;
    const at = agl => { let best = w[0], bd = 1e18; for (const l of w) { const d = Math.abs((l.hght - z0) - agl); if (d < bd) { bd = d; best = l; } } return best; };
    const a = _uv(at(zlo).drct, at(zlo).sknt), b = _uv(at(zhi).drct, at(zhi).sknt);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
// DCAPE — lowest-theta-e parcel in the lowest 400 hPa brought down moist-adiabatically
// to the surface. A proxy for downdraft strength / wet-microburst potential.
function _dcape(lv) {
    const ptop = lv[0].pres - 400;
    let src = 0, bthe = 1e9;
    for (let i = 0; i < lv.length; i++) {
        if (lv[i].pres < ptop) break;
        const the = _thetaE(lv[i].tmpc, lv[i].dwpc, lv[i].pres);
        if (the < bthe) { bthe = the; src = i; }
    }
    if (!src) return null;
    // The descending parcel starts SATURATED at the source level's wet-bulb
    // temperature — not its dewpoint. Starting at Td makes the parcel several
    // degrees too cold the whole way down and roughly doubles the answer.
    let Tk = _wetBulb(lv[src].tmpc, lv[src].dwpc, lv[src].pres) + 273.15;
    let pp = lv[src].pres, d = 0;
    for (let i = src - 1; i >= 0; i--) {
        const p = lv[i].pres;
        while (pp < p) { const dp = Math.min(2, p - pp); Tk += _moistLapse(Tk, pp) * dp; pp += dp; }
        const Tenv = lv[i].tmpc + 273.15;
        d += _gg * ((Tenv - Tk) / Tenv) * (lv[i + 1].hght - lv[i].hght);
    }
    return d > 0 ? d : 0;
}
function _lapse(lv, zlo, zhi) {                 // °C/km over an AGL layer
    const z0 = lv[0].hght;
    const at = agl => { let best = lv[0], bd = 1e18; for (const l of lv) { const d = Math.abs((l.hght - z0) - agl); if (d < bd) { bd = d; best = l; } } return best; };
    const a = at(zlo), b = at(zhi);
    const dz = (b.hght - a.hght) / 1000;
    return dz > 0.1 ? (a.tmpc - b.tmpc) / dz : null;
}
function _lapseP(lv, plo, phi) {                // °C/km between two pressure levels
    const at = p => { let best = lv[0], bd = 1e18; for (const l of lv) { const d = Math.abs(l.pres - p); if (d < bd) { bd = d; best = l; } } return best; };
    const a = at(plo), b = at(phi);
    const dz = (b.hght - a.hght) / 1000;
    return dz > 0.1 ? (a.tmpc - b.tmpc) / dz : null;
}
// Wet-bulb temperature by Normand's construction: lift to the LCL, then descend the
// saturated adiabat back to the starting pressure.
function _wetBulb(Tc, Tdc, p) {
    const Tk = Tc + 273.15;
    const Tlcl = _lclTempK(Tk, Tdc + 273.15);
    const Plcl = p * Math.pow(Tlcl / Tk, 1 / 0.2854);
    let T = Tlcl, pp = Plcl;
    while (pp < p) { const dp = Math.min(2, p - pp); T += _moistLapse(T, pp) * dp; pp += dp; }
    return T - 273.15;
}
function _wbzHeight(lv) {                       // lowest AGL crossing of Tw = 0 °C
    const z0 = lv[0].hght;
    let prev = _wetBulb(lv[0].tmpc, lv[0].dwpc, lv[0].pres);
    for (let i = 1; i < lv.length; i++) {
        const tw = _wetBulb(lv[i].tmpc, lv[i].dwpc, lv[i].pres);
        if (prev >= 0 && tw <= 0) {
            const f = prev / (prev - tw || 1);
            return lv[i - 1].hght + f * (lv[i].hght - lv[i - 1].hght) - z0;
        }
        prev = tw;
    }
    return null;
}
function _heightOf(lv, Tc) {                    // first AGL crossing of an isotherm
    const z0 = lv[0].hght;
    for (let i = 1; i < lv.length; i++) {
        if (lv[i - 1].tmpc >= Tc && lv[i].tmpc <= Tc) {
            const f = (lv[i - 1].tmpc - Tc) / (lv[i - 1].tmpc - lv[i].tmpc || 1);
            return lv[i - 1].hght + f * (lv[i].hght - lv[i - 1].hght) - z0;
        }
    }
    return null;
}

function _skewtShear(lv) {
    const w = lv.filter(l => l.drct != null && l.sknt != null && l.hght != null);
    if (w.length < 2) return { shear01: null, shear06: null };
    const z0 = w[0].hght;
    const nearest = agl => { let best = w[0], bd = 1e18; for (const l of w) { const d = Math.abs((l.hght - z0) - agl); if (d < bd) { bd = d; best = l; } } return best; };
    const s = _uv(w[0].drct, w[0].sknt);
    const u1 = _uv(nearest(1000).drct, nearest(1000).sknt);
    const u6 = _uv(nearest(6000).drct, nearest(6000).sknt);
    const mag = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
    return { shear01: mag(s, u1), shear06: mag(s, u6) };
}
function _skewtCompute(lv) {
    const sfc = lv[0];
    const P = lv.map(l => l.pres), Z = lv.map(l => l.hght), Te = lv.map(l => l.tmpc + 273.15);
    // Surface parcel — still the one drawn on the chart and shaded for CAPE.
    const SB = _liftParcel(lv, 0, sfc.pres, sfc.tmpc, sfc.dwpc);
    // Mixed-layer and most-unstable parcels. ML is what the severe composites below
    // key on; MU is what catches elevated convection that SB reports as zero.
    const mlp = _mlParcel(lv), mup = _muParcel(lv);
    const ML = mlp ? _liftParcel(lv, mlp.k, mlp.p, mlp.T, mlp.Td) : null;
    const MU = mup ? _liftParcel(lv, mup.k, mup.p, mup.T, mup.Td) : null;

    let pw = 0; for (let i = 1; i < lv.length; i++) { const w0 = _mixr(lv[i - 1].dwpc, lv[i - 1].pres), w1 = _mixr(lv[i].dwpc, lv[i].pres); pw += 0.5 * (w0 + w1) * (lv[i - 1].pres - lv[i].pres) * 100 / _gg; }

    // ── Kinematics ──
    const bunk = _bunkers(lv);
    const Crm = bunk ? bunk.rm : null;
    const srh01 = _srh(lv, 0, 1000, Crm), srh03 = _srh(lv, 0, 3000, Crm);
    // Effective inflow layer runs on a coarsened profile — see _coarsen.
    const eff = _effInflow(_coarsen(lv, 10));
    let esrh = null, ebwd = null;
    if (eff && Crm) {
        esrh = _srh(lv, eff.botZ, eff.topZ, Crm);
        // Effective bulk wind difference: inflow base to half the depth between the
        // inflow base and the MU equilibrium level (Thompson et al. 2007).
        if (MU && MU.elZ != null) {
            const half = eff.botZ + 0.5 * ((MU.elZ - lv[0].hght) - eff.botZ);
            if (half > eff.botZ) ebwd = _bulkShear(lv, eff.botZ, half);
        }
    }

    // ── Composites (SPC formulations) ──
    let scp = null, stp = null;
    if (MU && esrh != null && ebwd != null) {
        const sh = ebwd * _KT2MS;
        const shT = sh > 20 ? 1 : sh < 10 ? 0 : sh / 20;
        scp = (MU.cape / 1000) * (esrh / 50) * shT;
    }
    if (ML && eff && esrh != null && ebwd != null) {
        const sh = ebwd * _KT2MS;
        const shT = sh > 30 ? 1.5 : sh < 12.5 ? 0 : sh / 20;
        const lclT = ML.lclZ < 1000 ? 1 : ML.lclZ > 2000 ? 0 : (2000 - ML.lclZ) / 1000;
        const cinT = ML.cin > -50 ? 1 : ML.cin < -200 ? 0 : (200 + ML.cin) / 150;
        stp = (ML.cape / 1500) * lclT * (esrh / 150) * shT * cinT;
    }

    return Object.assign({
        P, Z, Te, Tp: SB.Tp, Plcl: SB.Plcl,
        cape: SB.cape, cin: SB.cin, li: SB.li, lclZ: SB.lclZ, lfc: SB.lfc, el: SB.el,
        pw, SB, ML, MU, mlSrc: mlp, muSrc: mup,
        eff, bunkers: bunk, srh01, srh03, esrh, ebwd, scp, stp,
        dcape: _dcape(lv),
        lr03: _lapse(lv, 0, 3000), lr75: _lapseP(lv, 700, 500),
        fzZ: _heightOf(lv, 0), m20Z: _heightOf(lv, -20), wbzZ: _wbzHeight(lv)
    }, _skewtShear(lv));
}

function _ir(k, v, c) { return `<div class="snd-row"><span class="c-mut">${k}</span><b data-fg="${c}">${v}</b></div>`; }
// One-line header summary, shared by the observed and model paths so they can't drift.
function _skewtSummary(D) {
    const p = x => x == null ? '—' : Math.round(x.cape);
    let s = `SB ${p(D.SB)} / ML ${p(D.ML)} / MU ${p(D.MU)} J/kg · CIN ${Math.round(D.cin)}`
        + ` · LI ${D.li != null ? D.li.toFixed(1) : '—'} · PWAT ${(D.pw / 25.4).toFixed(2)} in`;
    if (D.esrh != null) s += ` · ESRH ${Math.round(D.esrh)}`;
    if (D.stp != null) s += ` · STP ${D.stp.toFixed(1)}`;
    return s;
}
function _skewtHodo(wl) {
    const S = 200, cx = S / 2, cy = S / 2;
    const z0 = wl.length ? wl[0].hght : 0;
    const raw = wl.filter(l => (l.hght - z0) <= 10000);
    const hstep = Math.max(1, Math.ceil(raw.length / 120));   // thin dense BUFR winds
    const pts = raw.filter((_, i) => i % hstep === 0 || i === raw.length - 1).map(l => { const uv = _uv(l.drct, l.sknt); return { u: uv[0], v: uv[1] }; });
    const maxS = Math.max(20, ...pts.map(p => Math.hypot(p.u, p.v)));
    const ring = Math.ceil(maxS / 10) * 10;
    const sc = (S / 2 - 12) / ring;
    let g = `<rect x="0" y="0" width="${S}" height="${S}" fill="#0a0f16" stroke="#1e2a35"/>`;
    for (let r = 10; r <= ring; r += 10) { g += `<circle cx="${cx}" cy="${cy}" r="${(r * sc).toFixed(1)}" fill="none" stroke="#1e2a35" stroke-width="0.7"/><text x="${cx + r * sc}" y="${cy - 2}" fill="#5c6b78" font-size="7">${r}</text>`; }
    g += `<line x1="${cx}" y1="0" x2="${cx}" y2="${S}" stroke="#1e2a35" stroke-width="0.6"/><line x1="0" y1="${cy}" x2="${S}" y2="${cy}" stroke="#1e2a35" stroke-width="0.6"/>`;
    const XY = pts.map(p => [cx + p.u * sc, cy - p.v * sc]);
    if (XY.length) g += `<polyline points="${XY.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="#ffe14d" stroke-width="1.8"/>`;
    XY.forEach((p, i) => { const col = i === 0 ? '#33c27a' : i === XY.length - 1 ? '#ff3b3b' : '#ffe14d'; g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="${col}"/>`; });
    return `<svg viewBox="0 0 ${S} ${S}" width="200" height="200" class="snd-hodo" role="img" aria-label="Hodograph"><text x="2" y="9" fill="#8b97a3" font-size="8">Hodograph (kt, 0–10 km) ● sfc ● top</text>${g}</svg>`;
}
function renderSkewT(lv, D) {
    const PL = 46, PT = 16, PW = 372, PH = 520, PB = PT + PH, PR = PL + PW;
    const Ptop = 100, Pbot = 1050, Tmin = -45, Tmax = 45, SKEW = 0.62;
    const yP = p => PT + Math.log(p / Ptop) / Math.log(Pbot / Ptop) * PH;
    const xTP = (Tc, p) => PL + ((Tc - Tmin) / (Tmax - Tmin)) * PW + (PB - yP(p)) * SKEW;
    const poly = a => a.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    // isobars + labels
    let grid = '';
    [1000, 850, 700, 500, 400, 300, 250, 200, 150, 100].forEach(p => {
        const y = yP(p);
        grid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PR}" y2="${y.toFixed(1)}" stroke="#243040" stroke-width="0.7"/>`;
        grid += `<text x="${PL - 4}" y="${(y + 3).toFixed(1)}" fill="#7f8c99" font-size="8" text-anchor="end">${p}</text>`;
    });
    // isotherms (clipped)
    let iso = '';
    for (let T = -100; T <= 50; T += 10) {
        const x1 = xTP(T, Pbot), y1 = yP(Pbot), x2 = xTP(T, Ptop), y2 = yP(Ptop);
        const c = T === 0 ? '#4a6a55' : '#26333f';
        iso += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="${T === 0 ? 1.1 : 0.6}"/>`;
        if (x1 >= PL - 2 && x1 <= PR + 2) iso += `<text x="${x1.toFixed(1)}" y="${(PB + 11).toFixed(1)}" fill="#7d8790" font-size="7" text-anchor="middle">${T}</text>`;
    }
    // dry adiabats (faint, clipped)
    let dry = '';
    for (let th = -20; th <= 160; th += 20) {
        let d = '';
        for (let p = Pbot; p >= Ptop; p -= 25) { const Tc = (th + 273.15) * Math.pow(p / 1000, 0.2854) - 273.15; d += (d ? 'L' : 'M') + xTP(Tc, p).toFixed(1) + ',' + yP(p).toFixed(1); }
        dry += `<path d="${d}" fill="none" stroke="#2a2118" stroke-width="0.6"/>`;
    }
    // traces — decimated (dense BUFR profiles are ~4000 levels; ~500 pts is plenty
    // for a smooth curve and keeps the SVG DOM light).
    const step = Math.max(1, Math.ceil(lv.length / 500));
    const keep = [];
    for (let i = 0; i < lv.length; i += step) keep.push(i);
    if (keep[keep.length - 1] !== lv.length - 1) keep.push(lv.length - 1);
    const Ttrace = keep.map(i => [xTP(lv[i].tmpc, lv[i].pres), yP(lv[i].pres)]);
    const Dtrace = keep.map(i => [xTP(lv[i].dwpc, lv[i].pres), yP(lv[i].pres)]);
    const Ptrace = keep.map(i => [xTP(D.Tp[i] - 273.15, lv[i].pres), yP(lv[i].pres)]);
    // CAPE shading (parcel warmer than env, LFC→EL), sampled the same way
    let capeShade = '';
    if (D.lfc && D.el) {
        const idx = keep.filter(i => lv[i].pres <= D.lfc && lv[i].pres >= D.el && D.Tp[i] > D.Te[i]);
        if (idx.length > 1) {
            const up = idx.map(i => [xTP(D.Tp[i] - 273.15, lv[i].pres), yP(lv[i].pres)]);
            const down = idx.slice().reverse().map(i => [xTP(lv[i].tmpc, lv[i].pres), yP(lv[i].pres)]);
            capeShade = `<polygon points="${poly(up.concat(down))}" fill="#ff3b3b" fill-opacity="0.15"/>`;
        }
    }
    // wind barbs at right margin — evenly spaced by screen position (every ~18 px)
    // so dense BUFR profiles show many more levels than a fixed mandatory-level list.
    let barbs = ''; const bx = PR + 22;
    const wl = lv.filter(l => l.drct != null && l.sknt != null);
    const chosen = []; let lastBarbY = Infinity;
    for (const l of wl) {                        // wl is surface-first (descending pressure)
        const y = yP(l.pres);
        if (y < PT || y > PB) continue;
        if (lastBarbY - y >= 18) { chosen.push(l); lastBarbY = y; }
    }
    chosen.forEach(l => {
        const y = yP(l.pres); const bp = _vadBarbPaths(bx, y, l.drct, l.sknt, 17);
        barbs += bp.lines.map(d => `<path d="${d}" stroke="#cfe0ee" stroke-width="1" fill="none"/>`).join('');
        barbs += bp.flags.map(d => `<path d="${d}" fill="#cfe0ee" stroke="#cfe0ee" stroke-width="0.5"/>`).join('');
    });
    const svgW = PR + 46, svgH = PB + 22;
    const skewSVG = `<svg viewBox="0 0 ${svgW} ${svgH}" class="snd-chart" role="img" aria-label="Skew-T log-P diagram">
        <defs><clipPath id="skewtclip"><rect x="${PL}" y="${PT}" width="${PW}" height="${PH}"/></clipPath></defs>
        ${grid}
        <g clip-path="url(#skewtclip)">${dry}${iso}${capeShade}
            <polyline points="${poly(Dtrace)}" fill="none" stroke="#33c27a" stroke-width="2"/>
            <polyline points="${poly(Ttrace)}" fill="none" stroke="#ff4444" stroke-width="2"/>
            <polyline points="${poly(Ptrace)}" fill="none" stroke="#ffe14d" stroke-width="1.4" stroke-dasharray="4,3"/>
        </g>
        <rect x="${PL}" y="${PT}" width="${PW}" height="${PH}" fill="none" stroke="#2e3d4c" stroke-width="1"/>
        ${barbs}
        <text x="${PL}" y="11" fill="#8b97a3" font-size="8">Skew-T / Log-P (°C) — ▬ T ▬ Td ┈ parcel</text>
    </svg>`;
    const fx = v => v == null ? '—' : Math.round(v);
    const f1 = v => v == null ? '—' : v.toFixed(1);
    // Parcel table — SB / ML / MU side by side, the way NSHARP lays it out. The
    // point of three columns is that they disagree: MU finds elevated instability
    // SB reports as zero, and ML resists a single overheated surface reading.
    const cap = (p, warn) => p == null ? '<td class="c-mut">—</td>'
        : `<td class="strong" data-fg="${warn && p.cape > 1000 ? '#ff6a6a' : '#cdd6df'}">${Math.round(p.cape)}</td>`;
    const cell = (p, f, c) => p == null ? '<td class="c-mut">—</td>'
        : `<td data-fg="${c || '#cdd6df'}">${f(p)}</td>`;
    const th = t => `<th>${t}</th>`;
    const rowLbl = t => `<td class="lbl">${t}</td>`;
    const parcels = [D.SB, D.ML, D.MU];
    const parcelTable = `<table class="snd-parcels">
        <tr><td></td>${th('SB')}${th('ML')}${th('MU')}</tr>
        <tr>${rowLbl('CAPE J/kg')}${parcels.map(p => cap(p, true)).join('')}</tr>
        <tr>${rowLbl('CIN J/kg')}${parcels.map(p => cell(p, x => Math.round(x.cin), '#7fbfff')).join('')}</tr>
        <tr>${rowLbl('LCL m AGL')}${parcels.map(p => cell(p, x => Math.round(x.lclZ))).join('')}</tr>
        <tr>${rowLbl('LFC hPa')}${parcels.map(p => cell(p, x => x.lfc ? Math.round(x.lfc) : '—')).join('')}</tr>
        <tr>${rowLbl('EL hPa')}${parcels.map(p => cell(p, x => x.el ? Math.round(x.el) : '—')).join('')}</tr>
        <tr>${rowLbl('LI °C')}${parcels.map(p => cell(p, x => x.li != null ? x.li.toFixed(1) : '—', p && p.li < 0 ? '#ff6a6a' : '#cdd6df')).join('')}</tr>
    </table>`;
    const effTxt = D.eff ? `${Math.round(D.eff.botZ)}–${Math.round(D.eff.topZ)} m` : 'none';
    const bunkTxt = D.bunkers
        ? `${Math.round((270 - Math.atan2(D.bunkers.rm[1], D.bunkers.rm[0]) * 180 / Math.PI + 360) % 360)}° / ${Math.round(Math.hypot(D.bunkers.rm[0], D.bunkers.rm[1]) / _KT2MS)} kt`
        : '—';
    const sect = t => `<div class="snd-sect">${t}</div>`;
    const idxHTML = `<div class="snd-idx">
        <div class="snd-sect first">Parcels — surface / mixed-layer / most-unstable</div>
        ${parcelTable}
        ${sect('Kinematics')}
        ${_ir('0–1 / 0–6 km shear', (D.shear01 != null ? D.shear01 : '—') + ' / ' + (D.shear06 != null ? D.shear06 : '—') + ' kt', '#ffd23c')}
        ${_ir('Effective shear', D.ebwd != null ? Math.round(D.ebwd) + ' kt' : '—', '#ffd23c')}
        ${_ir('0–1 / 0–3 km SRH', fx(D.srh01) + ' / ' + fx(D.srh03) + ' m²/s²', '#ffb0f0')}
        ${_ir('Effective SRH', fx(D.esrh) + ' m²/s²', D.esrh > 150 ? '#ff6a6a' : '#ffb0f0')}
        ${_ir('Eff. inflow layer', effTxt, '#cdd6df')}
        ${_ir('Bunkers right', bunkTxt, '#cdd6df')}
        ${sect('Composites')}
        ${_ir('Sig. tornado (eff)', f1(D.stp), D.stp > 1 ? '#ff6a6a' : '#9fd3ff')}
        ${_ir('Supercell (eff)', f1(D.scp), D.scp > 1 ? '#ff6a6a' : '#9fd3ff')}
        ${sect('Thermo')}
        ${_ir('PWAT', (D.pw / 25.4).toFixed(2) + ' in', '#33c27a')}
        ${_ir('DCAPE', fx(D.dcape) + ' J/kg', '#ffa04d')}
        ${_ir('0–3 km lapse', f1(D.lr03) + ' °C/km', '#cdd6df')}
        ${_ir('700–500 lapse', f1(D.lr75) + ' °C/km', D.lr75 > 7 ? '#ff6a6a' : '#cdd6df')}
        ${_ir('Freezing / −20°', fx(D.fzZ) + ' / ' + fx(D.m20Z) + ' m', '#cdd6df')}
        ${_ir('Wet-bulb zero', fx(D.wbzZ) + ' m AGL', '#cdd6df')}
        <div class="snd-note rule">Surface ${lv[0].tmpc.toFixed(1)}° / ${lv[0].dwpc.toFixed(1)}°C @ ${Math.round(lv[0].pres)} hPa${D.muSrc && D.muSrc.k ? ` · MU parcel ${Math.round(D.muSrc.p)} hPa` : ''}</div>
        <div class="snd-note">Virtual-temperature CAPE/CIN · effective inflow layer per Thompson et al. 2007 · Bunkers right-mover storm motion. Chart shows the surface parcel.</div>
    </div>`;
    return `${skewSVG}<div class="snd-side">${_skewtHodo(wl)}${idxHTML}</div>`;
}

// ── Wind barb ──
function _vadBarbPaths(cx, cy, dirFrom, spd, len) {
    // Shaft points toward the direction the wind comes FROM (met convention, N=up).
    const a = dirFrom * Math.PI / 180;
    const ux = Math.sin(a), uy = -Math.cos(a);
    const ex = cx + ux * len, ey = cy + uy * len;       // free end
    const bx = -uy, by = ux;                             // perpendicular (barb side)
    const lines = [`M${cx.toFixed(1)},${cy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`];
    const flags = [];
    let s = Math.round(spd / 5) * 5;
    let n50 = Math.floor(s / 50); s -= n50 * 50;
    let n10 = Math.floor(s / 10); s -= n10 * 10;
    let n5 = Math.floor(s / 5);
    let d = 0; const step = 4.6, bl = 9;
    for (let i = 0; i < n50; i++) {
        const p1x = ex - ux * d, p1y = ey - uy * d;
        const p2x = ex - ux * (d + step) + bx * bl, p2y = ey - uy * (d + step) + by * bl;
        const p3x = ex - ux * (d + step), p3y = ey - uy * (d + step);
        flags.push(`M${p1x.toFixed(1)},${p1y.toFixed(1)} L${p2x.toFixed(1)},${p2y.toFixed(1)} L${p3x.toFixed(1)},${p3y.toFixed(1)} Z`);
        d += step + 1.6;
    }
    for (let i = 0; i < n10; i++) {
        const p1x = ex - ux * d, p1y = ey - uy * d;
        lines.push(`M${p1x.toFixed(1)},${p1y.toFixed(1)} L${(p1x + bx * bl).toFixed(1)},${(p1y + by * bl).toFixed(1)}`);
        d += step;
    }
    for (let i = 0; i < n5; i++) {
        if (d === 0) d += step;
        const p1x = ex - ux * d, p1y = ey - uy * d;
        lines.push(`M${p1x.toFixed(1)},${p1y.toFixed(1)} L${(p1x + bx * bl * 0.5).toFixed(1)},${(p1y + by * bl * 0.5).toFixed(1)}`);
        d += step;
    }
    return { lines, flags };
}

// ─── Model forecast soundings ───────────────────────────────────────────────
// Builds the same level array ({pres,tmpc,dwpc,hght,drct,sknt}) FX-Net uses for
// an observed sounding, so _skewtCompute and renderSkewT are unchanged here.
// Observed RAOBs are left out: they need FX-Net's /api/raob proxy.
// HRRR is the point of the exercise (3 km, hourly runs, convection-allowing);
// GFS is offered alongside it so you can see the mesoscale solution diverge from
// the global one at the same spot.
const SOUNDING_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100];
const SOUNDING_MODELS = {
    gfs_hrrr:     { label: 'HRRR — 3 km forecast', hours: 48 },
    gfs_seamless: { label: 'GFS — global forecast', hours: 120 }
};

// Open-Meteo publishes RH per level, not dewpoint. Alduchov-Eskridge Magnus.
function _dewpointFromRh(tC, rh) {
    if (tC == null || rh == null) return null;
    const a = 17.625, b = 243.04;
    const r = Math.min(100, Math.max(1, rh));
    const al = Math.log(r / 100) + (a * tC) / (b + tC);
    return (b * al) / (a - al);
}

let _modelSndCache = {};   // `${model}|${lat}|${lon}` -> cached run

async function _fetchModelSounding(model, lat, lon) {
    const key = `${model}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    const hit = _modelSndCache[key];
    if (hit && Date.now() - hit.fetched < 20 * 60 * 1000) return hit;
    const def = SOUNDING_MODELS[model];
    const vars = [];
    SOUNDING_LEVELS.forEach(L => vars.push(
        `temperature_${L}hPa`, `relative_humidity_${L}hPa`, `geopotential_height_${L}hPa`,
        `wind_speed_${L}hPa`, `wind_direction_${L}hPa`));
    vars.push('temperature_2m', 'dewpoint_2m', 'surface_pressure', 'wind_speed_10m', 'wind_direction_10m');
    // The whole run comes down once and is cached, so stepping forecast hours
    // costs nothing — same trick the Model Comparison panel uses for its fields.
    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
        + `&hourly=${vars.join(',')}&models=${model}`
        + `&forecast_days=${Math.max(1, Math.ceil((def.hours || 48) / 24))}`
        + '&wind_speed_unit=kn';   // °C and hPa are already the defaults the renderer wants
    const res = await fetch(url);
    if (res.status === 429) throw new Error('Open-Meteo rate limit reached — wait a minute and retry');
    if (res.status === 400 && model === 'gfs_hrrr') throw new Error('HRRR covers the contiguous U.S. only; switch to GFS');
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const j = await res.json();
    const rec = { times: (j.hourly && j.hourly.time) || [], hourly: j.hourly || {}, elevation: j.elevation, fetched: Date.now() };
    if (!rec.times.length) throw new Error('no forecast returned for this point');
    _modelSndCache[key] = rec;
    return rec;
}

// One timestep of a cached run -> the level array the renderer expects.
function _modelSoundingProfile(rec, i) {
    const h = rec.hourly, lv = [];
    const sfcP = h.surface_pressure ? h.surface_pressure[i] : null;
    const sfcT = h.temperature_2m ? h.temperature_2m[i] : null;
    const sfcTd = h.dewpoint_2m ? h.dewpoint_2m[i] : null;
    // A surface parcel is what makes SBCAPE/CIN mean anything, so seed the
    // profile with the 2 m state rather than starting at 1000 hPa.
    if (sfcP != null && sfcT != null && sfcTd != null) {
        lv.push({ pres: sfcP, tmpc: sfcT, dwpc: sfcTd, hght: rec.elevation != null ? rec.elevation : 0,
            drct: h.wind_direction_10m ? h.wind_direction_10m[i] : null,
            sknt: h.wind_speed_10m ? h.wind_speed_10m[i] : null });
    }
    SOUNDING_LEVELS.forEach(L => {
        const t = h[`temperature_${L}hPa`] ? h[`temperature_${L}hPa`][i] : null;
        const rh = h[`relative_humidity_${L}hPa`] ? h[`relative_humidity_${L}hPa`][i] : null;
        const z = h[`geopotential_height_${L}hPa`] ? h[`geopotential_height_${L}hPa`][i] : null;
        if (t == null || rh == null || z == null) return;
        if (sfcP != null && L > sfcP) return;   // level is underground at this point
        lv.push({ pres: L, tmpc: t, dwpc: _dewpointFromRh(t, rh), hght: z,
            drct: h[`wind_direction_${L}hPa`] ? h[`wind_direction_${L}hPa`][i] : null,
            sknt: h[`wind_speed_${L}hPa`] ? h[`wind_speed_${L}hPa`][i] : null });
    });
    return lv.filter(l => l.dwpc != null && isFinite(l.dwpc)).sort((a, b) => b.pres - a.pres);
}

let _skewtSeq = 0;   // drop stale responses when the place, model or hour changes quickly
async function loadSkewtModel(pt) {
    const seq = ++_skewtSeq;
    const meta = document.getElementById('skewt-meta'), body = document.getElementById('skewt-body');
    const model = document.getElementById('skewt-source').value;
    const def = SOUNDING_MODELS[model];
    meta.textContent = `Fetching ${def.label} for ${pt.label}…`;
    try {
        const rec = await _fetchModelSounding(model, pt.lat, pt.lon);
        if (seq !== _skewtSeq) return;
        _fillSkewtForecastHours(rec);
        const i = rec.times.indexOf(document.getElementById('skewt-time').value);
        const lv = _modelSoundingProfile(rec, i);
        if (lv.length < 4) throw new Error('profile too sparse at this hour');
        const D = _skewtCompute(lv);
        const validZ = rec.times[i].replace('T', ' ') + 'Z';
        meta.innerHTML = `${esc(pt.label)} · <b class="c-warn">${esc(def.label)}</b> · valid ${esc(validZ)} · ${lv.length} lvl · ${_skewtSummary(D)}`;
        body.innerHTML = renderSkewT(lv, D);
        paint(body);
        return true;
    } catch (e) {
        if (seq !== _skewtSeq) return;
        meta.textContent = '—';
        body.innerHTML = `<div class="pt-msg warn">Could not build a ${esc(def.label)} sounding for ${esc(pt.label)} (${esc(e.message)}).</div>`;
        return false;
    }
}

function _nearestForecastIndex(rec) {
    const now = Date.now();
    let best = 0, bd = Infinity;
    rec.times.forEach((t, i) => {
        const d = Math.abs(Date.parse(t + 'Z') - now);
        if (d < bd) { bd = d; best = i; }
    });
    return best;
}

// The option value is the valid time, so switching model or place keeps the hour
// on screen whenever the new run has it.
function _fillSkewtForecastHours(rec) {
    const sel = document.getElementById('skewt-time');
    const keep = sel.value;
    sel.innerHTML = '';
    const now = Date.now();
    rec.times.forEach(t => {
        const fh = Math.round((Date.parse(t + 'Z') - now) / 3600000);
        const o = document.createElement('option');
        o.value = t;
        o.textContent = `${t.slice(8, 10)}/${t.slice(11, 13)}Z  ${fh >= 0 ? '+' + fh : fh}h`;
        sel.appendChild(o);
    });
    // Open-Meteo returns the whole day including hours already past, which are
    // worth keeping (the model's recent state) but are a poor default.
    sel.value = rec.times.includes(keep) ? keep : rec.times[_nearestForecastIndex(rec)];
}

function initSoundingTab() {
    ['skewt-source', 'skewt-time'].forEach(id => document.getElementById(id).addEventListener('change', () => reloadView('soundings')));
}
