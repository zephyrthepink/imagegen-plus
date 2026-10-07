import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHandlers } from '../server/bridge.mjs';

const profile = { id: 'literouter-profile', api: 'custom', 'api-url': 'https://api.literouter.com/v1', 'secret-id': 'profile-secret-id' };
const directories = { root: '/test-account' };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function response() {
    const result = new EventEmitter();
    Object.assign(result, {
        code: 200, headers: {}, data: null, writableEnded: false,
        status(code) { this.code = code; return this; },
        json(data) { this.data = data; this.writableEnded = true; return this; },
        send(data) { this.data = data; this.writableEnded = true; return this; },
        setHeader(key, value) { this.headers[key] = value; },
    });
    return result;
}
const request = overrides => ({ user: { directories }, body: { profile, prompt: 'A lake', model: 'sdxl-turbo', width: 1024, height: 1024, seed: '', ...overrides } });

test('server bridge uses the authenticated account and the selected profile secret, forwarding only the documented image payload', async () => {
    let lookup;
    let upstream;
    const handlers = createHandlers({
        readSecret: (...args) => { lookup = args; return 'private-account-key'; },
        fetcher: async (url, options) => { upstream = { url, options }; return new Response(jpeg, { headers: { 'X-Seed': '7', 'X-Model': 'sdxl-turbo', 'X-Request-ID': 'request-1' } }); },
    });
    const res = response();
    await handlers.generate(request({ key: 'client-value-is-ignored', url: 'https://other.test', negative_prompt: 'unsupported' }), res);
    assert.deepEqual(lookup, [directories, 'api_key_custom', 'profile-secret-id']);
    assert.equal(upstream.url, 'https://image.literouter.com/generate');
    assert.equal(upstream.options.headers.Authorization, 'Bearer private-account-key');
    assert.equal(upstream.options.redirect, 'error');
    assert.deepEqual(JSON.parse(upstream.options.body), { prompt: 'A lake', model: 'sdxl-turbo', width: 1024, height: 1024 });
    assert.equal(res.headers['Content-Type'], 'image/jpeg');
    assert.equal(res.headers['X-Seed'], '7');
    assert.equal(res.headers['X-Request-ID'], 'request-1');
    assert.deepEqual(res.data, Buffer.from(jpeg));
    assert.equal(res.listenerCount('close'), 0);
});

test('profiles without a secret ID use the current account’s active Custom key like native SillyTavern', async () => {
    let lookup;
    const handlers = createHandlers({ readSecret: (...args) => { lookup = args; return 'active-key'; }, fetcher: async () => Response.json({ models: ['sdxl-turbo'] }) });
    const res = response();
    await handlers.models(request({ profile: { ...profile, 'secret-id': null } }), res);
    assert.deepEqual(lookup, [directories, 'api_key_custom', null]);
});

test('model refresh uses the same saved key and filters the response to the curated image catalog', async () => {
    let upstream;
    const handlers = createHandlers({ readSecret: () => 'saved-key', fetcher: async (url, options) => { upstream = { url, options }; return Response.json({ data: [{ id: 'sdxl-turbo' }, { id: 'proteus' }, { id: 'text-model' }] }); } });
    const res = response();
    await handlers.models(request(), res);
    assert.equal(upstream.url, 'https://image.literouter.com/models');
    assert.equal(upstream.options.method, 'GET');
    assert.equal(upstream.options.headers.Authorization, 'Bearer saved-key');
    assert.deepEqual(res.data, { models: ['sdxl-turbo', 'proteus'] });
});

test('bridge rejects unauthenticated requests and invalid profiles before reading keys or making requests', async () => {
    const handlers = createHandlers({ readSecret: () => assert.fail('no key lookup'), fetcher: () => assert.fail('no request') });
    const unauthenticated = response();
    await handlers.models({ body: { profile } }, unauthenticated);
    assert.equal(unauthenticated.code, 401);
    for (const invalid of [{ ...profile, 'api-url': 'https://another.test/v1' }, { ...profile, api: 'openai' }, { ...profile, 'secret-id': {} }]) {
        const res = response();
        await handlers.models(request({ profile: invalid }), res);
        assert.equal(res.code, 400);
    }
});

test('missing saved credentials and invalid generation options have actionable errors and never generate', async () => {
    const handlers = createHandlers({ readSecret: () => '', fetcher: () => assert.fail('no request') });
    const missing = response();
    await handlers.generate(request(), missing);
    assert.equal(missing.code, 400);
    assert.match(missing.data.error, /no saved API key/);
    for (const fields of [{ model: 'unknown' }, { width: 99999 }, { seed: -1 }, { prompt: '' }]) {
        const res = response();
        await handlers.generate(request(fields), res);
        assert.equal(res.code, 400);
    }
});

test('upstream errors do not leak keys or response text and do not retry', async () => {
    let count = 0;
    const handlers = createHandlers({ readSecret: () => 'secret-value', fetcher: async () => { count++; return new Response('echoed secret-value', { status: 401 }); } });
    const res = response();
    await handlers.generate(request(), res);
    assert.equal(res.code, 401);
    assert.equal(count, 1);
    assert(!JSON.stringify(res.data).includes('secret-value'));
});

test('upstream HTML is rejected before image upload', async () => {
    const handlers = createHandlers({ readSecret: () => 'key', fetcher: async () => new Response('<html>Cloudflare</html>') });
    const res = response();
    await handlers.generate(request(), res);
    assert.equal(res.code, 502);
    assert.match(res.data.error, /instead of a JPEG/);
});

test('disconnecting the browser aborts upstream work and cleans up the listener', async () => {
    let signal;
    const handlers = createHandlers({ readSecret: () => 'key', fetcher: async (_url, options) => { signal = options.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
    const res = response();
    const pending = handlers.generate(request(), res);
    assert.equal(signal.aborted, false);
    res.emit('close');
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(res.data, null);
    assert.equal(res.listenerCount('close'), 0);
});
