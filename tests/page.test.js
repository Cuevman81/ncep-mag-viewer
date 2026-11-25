// The page is CSP-locked, so markup the browser would silently drop is a bug:
// inline style attributes, inline scripts and handlers, and unlisted hosts.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const js = fs.readdirSync(path.join(root, 'point')).filter(f => f.endsWith('.js'));

test('script-src and style-src stay strict', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    assert.match(csp, /script-src 'self';/);
    assert.doesNotMatch(csp, /unsafe/);
    assert.match(csp, /connect-src 'self'/);
});

test('no inline style, script or handler in the page or in generated markup', () => {
    assert.doesNotMatch(html, /<[^>]*\sstyle=/);
    assert.doesNotMatch(html, /<[^>]*\son[a-z]+=/);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
    js.forEach(f => {
        assert.doesNotMatch(read(`point/${f}`), /[\s"]style="/, `${f} writes a style attribute`);
        assert.doesNotMatch(read(`point/${f}`), /<[a-z]+[^>]*\son[a-z]+="/, `${f} writes an inline handler`);
    });
});

test('every host the tabs contact is in connect-src', () => {
    const allowed = /connect-src ([^;]+)/.exec(html)[1];
    const hosts = new Set(js.flatMap(f => read(`point/${f}`).match(/https:\/\/[a-z0-9.-]+/g) || []));
    assert.ok(hosts.size >= 5);
    hosts.forEach(h => assert.ok(allowed.includes(h), `${h} missing from connect-src`));
});

test('every local script and stylesheet exists and carries ?v=', () => {
    const refs = [...html.matchAll(/(?:src|href)="((?!https?:)[^"]+\.(?:js|css)[^"]*)"/g)].map(m => m[1]);
    assert.ok(refs.length >= 9);
    refs.forEach(r => {
        assert.match(r, /\?v=\w+$/);
        assert.ok(fs.existsSync(path.join(root, r.split('?')[0])), r);
    });
});
