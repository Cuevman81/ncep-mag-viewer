// Forecast soundings: model level data -> profile, and the parcel math on a
// profile with a known answer.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./_load').load(['_Rd', '_esat', '_mixr', '_lclTempK', '_moistLapse', '_uv', '_KT2MS', '_thetaE', '_dewpFromW', '_coarsen',
    '_liftParcel', '_mlParcel', '_muParcel', '_effInflow', '_bunkers', '_srh', '_bulkShear', '_dcape', '_lapse', '_lapseP', '_wetBulb',
    '_wbzHeight', '_heightOf', '_skewtShear', '_skewtCompute', 'SOUNDING_LEVELS', 'SOUNDING_MODELS', '_dewpointFromRh', '_modelSoundingProfile', '_nearestForecastIndex']);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('dewpoint from RH: saturated equals temperature, 50% at 20 C is 9.3 C', () => {
    near(S._dewpointFromRh(20, 100), 20, 1e-9);
    near(S._dewpointFromRh(20, 50), 9.27, 0.05);
    assert.equal(S._dewpointFromRh(null, 50), null);
});

test('profile starts at the 2 m state and drops levels below ground', () => {
    const h = { surface_pressure: [960], temperature_2m: [25], dewpoint_2m: [20], wind_direction_10m: [180], wind_speed_10m: [10] };
    S.SOUNDING_LEVELS.forEach((L, k) => {
        h[`temperature_${L}hPa`] = [24 - 5 * k]; h[`relative_humidity_${L}hPa`] = [60]; h[`geopotential_height_${L}hPa`] = [100 + 700 * k];
        h[`wind_direction_${L}hPa`] = [200]; h[`wind_speed_${L}hPa`] = [20];
    });
    const lv = S._modelSoundingProfile({ hourly: h, elevation: 400 }, 0);
    assert.deepEqual([lv[0].pres, lv[0].tmpc, lv[0].dwpc, lv[0].hght], [960, 25, 20, 400]);
    assert.equal(lv[1].pres, 950);
    assert.ok(lv.every((l, i) => !i || l.pres < lv[i - 1].pres));
});

// Warm, moist surface under a 7.5 C/km troposphere with veering wind.
const lv = Array.from({ length: 60 }, (_, i) => {
    const z = i * 250, T = z <= 12000 ? 30 - 7.5 * z / 1000 : -60;
    return { pres: 1000 * Math.exp(-z / 8000), tmpc: T, dwpc: Math.min(T - 0.5, 22 - 5 * z / 1000), hght: z,
        drct: 160 + Math.min(90, z / 60), sknt: 10 + Math.min(50, z / 150) };
});

test('an unstable profile gives CAPE, a negative LI, and ordered LCL < LFC < EL', () => {
    const D = S._skewtCompute(lv);
    assert.ok(D.cape > 1500, `SBCAPE ${D.cape}`);
    assert.ok(D.li < -3);
    assert.ok(D.Plcl >= D.lfc - 30 && D.lfc > D.el);
    assert.ok(D.MU.cape >= D.SB.cape - 1);
    assert.ok(D.srh03 > 0 && D.shear06 > 30 && D.scp > 0);
    near(D.lr03, 7.5, 0.01);
});

test('a stable profile gives no CAPE and no composites', () => {
    const D = S._skewtCompute(lv.map(l => ({ ...l, tmpc: 10 - l.hght / 1000, dwpc: -10 - l.hght / 1000 })));
    assert.equal(D.cape, 0);
    assert.equal(D.eff, null);
    assert.equal(D.stp, null);
});

test('the default hour is the one nearest now', () => {
    const iso = h => new Date(Math.floor(Date.now() / 3600000) * 3600000 + h * 3600000).toISOString().slice(0, 16);
    assert.ok([2, 3].includes(S._nearestForecastIndex({ times: [iso(-2), iso(-1), iso(0), iso(1)] })));
});

test('GFS is plain GFS, not the seamless blend that returns HRRR over the U.S.', () => {
    assert.deepEqual(Object.keys(S.SOUNDING_MODELS), ['gfs_hrrr', 'gfs_global']);
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
    const menu = html.match(/id="skewt-source"[\s\S]*?<\/select>/)[0];
    assert.deepEqual([...menu.matchAll(/value="([^"]+)"/g)].map(m => m[1]), Object.keys(S.SOUNDING_MODELS));
});
