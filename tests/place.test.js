// The shared place: geocoding rules, the saved place, when a tab must refetch,
// and the nearest-station list MOS works from.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./_load');

const geo = (results, seen = []) => load(['geocodePlace', 'US_STATE_NAMES'], {
    fetch: async url => { seen.push(url); return { ok: true, json: async () => results }; }
}).geocodePlace;
const hit = (name, admin1, country_code, country, latitude = 1) => ({ name, admin1, country_code, country, latitude, longitude: 2 });

test('a ZIP goes to Zippopotam, a city to Open-Meteo', async () => {
    const seen = [];
    const g = await geo({ places: [{ latitude: '32.29', longitude: '-90.19', 'place name': 'Jackson', 'state abbreviation': 'MS' }] }, seen)('39201');
    assert.deepEqual(g, { lat: 32.29, lon: -90.19, label: 'Jackson, MS 39201' });
    assert.match(seen[0], /^https:\/\/api\.zippopotam\.us\/us\/39201$/);
});

test('the state picks the town, with or without a comma', async () => {
    const r = { results: [hit('Jackson', 'Wyoming', 'US', 'United States'), hit('Jackson', 'Mississippi', 'US', 'United States', 32)] };
    assert.equal((await geo(r)('Jackson, MS')).lat, 32);
    assert.equal((await geo(r)('jackson ms')).lat, 32);
    assert.equal((await geo(r)('Jackson')).label, 'Jackson, Wyoming');
});

test('a state that matches nothing is an error, never another town of that name', async () => {
    const r = { results: [hit('Jackson', 'Wyoming', 'US', 'United States')] };
    await assert.rejects(geo(r)('Jackson, ZZ'), /No match/);
    await assert.rejects(geo({ results: [hit('Paw Paw', 'West Virginia', 'US', 'United States')] })('Paw Paw, VA'), /No match/);
    await assert.rejects(geo({})('Nowhere'), /No match/);
    await assert.rejects(geo({})('  '), /Enter a ZIP/);
});

test('a country works too, and Puerto Rico by its code', async () => {
    const r = { results: [hit('Paris', 'Texas', 'US', 'United States', 33), hit('Paris', 'Île-de-France', 'FR', 'France', 48)] };
    assert.equal((await geo(r)('Paris, France')).lat, 48);
    const pr = { results: [hit('San Juan', 'Texas', 'US', 'United States', 26), hit('San Juan', 'San Juan', 'PR', undefined, 18)] };
    assert.equal((await geo(pr)('San Juan, PR')).lat, 18);
});

test('a broken saved place falls back to Jackson', () => {
    const { parsePlace } = load(['DEFAULT_PLACE', 'parsePlace']);
    for (const bad of [null, '', '{', '{"lat":99,"lon":0,"label":"x"}', '{"lat":1,"lon":2}']) assert.equal(parsePlace(bad).q, 'Jackson, MS');
    assert.deepEqual(parsePlace('{"q":"39201","lat":32.3,"lon":-90.2,"label":"Jackson, MS 39201"}'),
        { q: '39201', lat: 32.3, lon: -90.2, label: 'Jackson, MS 39201' });
});

test('a tab refetches only for a new place or after 30 minutes', () => {
    const { viewStale } = load(['VIEW_MAX_AGE', 'viewStale']);
    assert.equal(viewStale(undefined, 'a', 0), true);
    assert.equal(viewStale({ key: 'a', at: 0 }, 'a', 29 * 60000), false);
    assert.equal(viewStale({ key: 'a', at: 0 }, 'b', 0), true);
    assert.equal(viewStale({ key: 'a', at: 0 }, 'a', 31 * 60000), true);
});

test('MOS candidates: airports only, nearest first, none past 100 miles', () => {
    const { mosCandidates } = load(['fcstMiles', 'MOS_MAX_MI', 'mosCandidates']);
    const f = (id, lon, lat) => ({ geometry: { coordinates: [lon, lat] }, properties: { stationIdentifier: id, name: id } });
    const got = mosCandidates({ features: [f('KVKS', -90.93, 32.23), f('FHMC1', -90.18, 32.3), f('KJAN', -90.08, 32.32), f('KFAR', -96.8, 46.9), f('C1234', -90.2, 32.3)] }, { lat: 32.2988, lon: -90.1848 });
    assert.deepEqual(got.map(s => s.id), ['KJAN', 'KVKS']);
    assert.equal(got[0].mi, 6);
    assert.deepEqual(mosCandidates(null, { lat: 0, lon: 0 }), []);
});
