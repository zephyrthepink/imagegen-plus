import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../core.js';
import { liteRouter, createImagePayload, normalizeModels } from '../providers/literouter.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

test('LiteRouter payload uses only documented fields and omits a random seed', () => {
    const settings = normalizeSettings({ seed: '', exclusions: 'logos', prefix: 'high quality' });
    assert.deepEqual(createImagePayload('A lake', settings), { prompt: 'A lake', model: 'sdxl-turbo', width: 1024, height: 1024 });
    assert.equal(createImagePayload('A lake', { ...settings, seed: '0' }).seed, 0);
    assert.throws(() => createImagePayload('A lake', { ...settings, seed: '-1' }), /Seed/);
    assert.throws(() => createImagePayload('A lake', { ...settings, height: 50000 }), /height/);
});

test('authenticated binary JPEG responses keep available metadata', async () => {
    let actual;
    const image = await liteRouter.generate('A lake', {
        key: 'test-key', settings: normalizeSettings(), headers: { 'X-CSRF-Token': 'local-csrf' },
        fetchFn: async (url, options) => { actual = { url, options }; return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg', 'X-Model': 'actual-model', 'X-Seed': '123', 'X-Request-ID': 'request-1' } }); },
    });
    assert.equal(actual.url, 'https://image.literouter.com/generate');
    assert.equal(actual.options.headers.Authorization, 'Bearer test-key');
    assert.equal(actual.options.headers['X-CSRF-Token'], undefined);
    assert.equal(actual.options.method, 'POST');
    assert.equal(image.blob.type, 'image/jpeg');
    assert.equal(image.model, 'actual-model');
    assert.equal(image.seed, '123');
    assert.equal(image.requestId, 'request-1');
});

test('proxy requests retain native CSRF headers; unavailable headers fall back honestly', async () => {
    let actual;
    const image = await liteRouter.generate('A lake', {
        key: 'test-key', settings: normalizeSettings({ transport: 'proxy' }), headers: { 'X-CSRF-Token': 'csrf' },
        fetchFn: async (url, options) => { actual = { url, options }; return new Response(jpeg); },
    });
    assert.equal(actual.url, '/proxy/https://image.literouter.com/generate');
    assert.equal(actual.options.headers['X-CSRF-Token'], 'csrf');
    assert.equal(image.seed, null);
    assert.equal(image.model, 'sdxl-turbo');
});

test('HTTP errors do not leak provider response bodies or silently retry', async () => {
    let calls = 0;
    await assert.rejects(() => liteRouter.generate('A lake', {
        key: 'secret', settings: normalizeSettings(),
        fetchFn: async () => { calls++; return new Response('echoed secret', { status: 401 }); },
    }), error => /401/.test(error.message) && !error.message.includes('secret'));
    assert.equal(calls, 1);
});

test('HTML, JSON, empty and invalid binary responses are rejected instead of saved', async () => {
    for (const body of ['<html>Cloudflare</html>', '{"error":"no image"}', '', new Uint8Array([1, 2, 3])]) {
        await assert.rejects(() => liteRouter.generate('A lake', { key: 'test-key', settings: normalizeSettings(), fetchFn: async () => new Response(body) }), /instead of a JPEG/);
    }
});

test('cancelled requests preserve AbortError and blank credentials never send a request', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => liteRouter.generate('A lake', {
        key: 'test', settings: normalizeSettings(), signal: controller.signal,
        fetchFn: async (_, options) => { options.signal.throwIfAborted(); },
    }), { name: 'AbortError' });
    await assert.rejects(() => liteRouter.models({ key: '', settings: normalizeSettings(), fetchFn: () => assert.fail('must not send') }), /API key/);
});

test('model discovery accepts arrays, OpenAI data lists and keyed model maps', async () => {
    assert.deepEqual(normalizeModels(['sdxl-turbo', 'sdxl-turbo']), ['sdxl-turbo']);
    assert.deepEqual(normalizeModels({ data: [{ id: 'model-a' }, { name: 'model-b' }] }), ['model-a', 'model-b']);
    assert.deepEqual(normalizeModels({ models: { 'model-a': { description: 'A model' } } }), ['model-a']);
    const models = await liteRouter.models({ key: 'test', settings: normalizeSettings(), fetchFn: async () => Response.json({ models: ['sdxl-turbo'] }) });
    assert.deepEqual(models, ['sdxl-turbo']);
});
