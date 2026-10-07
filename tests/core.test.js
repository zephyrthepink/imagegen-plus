import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, MODULE, normalizeSettings, matchesRule, chatKey, collectSources, buildPromptRequest, cleanPromptResponse, composeFinalPrompt } from '../core.js';

function fixture() {
    return {
        name1: 'Zephyr', name2: 'Mira', characterId: 0,
        characters: [{ description: 'A silver-haired mage.', scenario: 'A quiet tavern.' }],
        powerUserSettings: { persona_description: 'A traveler.' },
        chat: [{ name: 'Zephyr', is_user: true, mes: 'Hello' }, { name: 'Mira', is_user: false, mes: '<think>Secret thought.</think><b>Welcome</b> to the tavern.' }],
        substituteParamsExtended: (text, extra = {}) => text.replace(/{{(.*?)}}/g, (_, key) => ({ char: 'Mira', user: 'Zephyr', ...extra })[key] ?? `{{${key}}}`),
    };
}

test('defaults disable automation and persisted credentials; normalization rejects invalid or unknown settings', () => {
    const settings = normalizeSettings({ auto: { enabled: true, every: 0, role: 'invalid' }, width: 0, seed: '-1', apiKey: 'secret', rememberKey: true, transport: 'direct', contextChars: 1000, maxTokens: 64, sources: { history: false }, model: '' });
    assert.equal(DEFAULTS.auto.enabled, false);
    for (const key of ['rememberKey', 'transport', 'contextChars', 'maxTokens']) assert.equal(Object.hasOwn(settings, key), false);
    assert.equal(settings.width, 1024);
    assert.equal(settings.seed, '');
    assert.equal(settings.auto.every, 3);
    assert.equal(settings.auto.role, 'assistant');
    assert.equal(settings.auto.enabled, true);
    assert.equal(settings.sources.history, false);
    assert.equal(settings.sources.character, true);
    assert.equal(settings.model, 'sdxl-turbo');
    assert.equal(Object.hasOwn(settings, 'apiKey'), false);
    settings.sources.character = false;
    assert.equal(DEFAULTS.sources.character, true);
});

test('name matching combines role with exact case-insensitive names, and excludes generated/system messages', () => {
    const rule = { role: 'assistant', names: 'The Storymaker\nMira' };
    assert.equal(matchesRule({ name: 'the storymaker', mes: 'A new scene', is_user: false }, rule), true);
    assert.equal(matchesRule({ name: 'The Storymaker 2', mes: 'Scene', is_user: false }, rule), false);
    assert.equal(matchesRule({ name: 'Mira', mes: 'Scene', is_user: true }, rule), false);
    assert.equal(matchesRule({ name: 'Mira', mes: 'Scene', is_system: true }, rule), false);
    assert.equal(matchesRule({ name: 'Mira', mes: 'Scene', extra: { [MODULE]: {} } }, rule), false);
    assert.equal(matchesRule({ name: 'Mira', mes: 'Scene', extra: { media: [{ source: 'generated' }] } }, rule), false);
    assert.equal(matchesRule({ name: 'Mira', mes: 'Scene', extra: { image: '/image.jpg' } }, rule), false);
});

test('sources respect selection, recent-message limit and persona fields while excluding image messages and reasoning', () => {
    const context = fixture();
    context.chat.push({ name: 'ImageGen+', is_system: true, mes: 'Ignore this' });
    const settings = normalizeSettings({ historyMessages: 1, sources: { scenario: false } });
    const sources = collectSources(context, settings);
    assert.equal(sources.history, 'Mira: Welcome to the tavern.');
    assert.equal(sources.persona, 'A traveler.');
    assert.equal(sources.character, 'A silver-haired mage.');
    assert.equal(sources.scenario, '');
    assert.equal(sources.personality, '');
});

test('user messages with uploaded images and text still count as conversation messages', () => {
    assert.equal(matchesRule({ name: 'User', is_user: true, mes: 'Look at this place', extra: { image: '/upload.jpg' } }, { role: 'user', names: '' }), true);
});

test('group chat identity is stable when the speaking character changes', () => {
    assert.equal(chatKey({ groupId: 'group-1', characterId: 1, chatId: 'chat-1' }), chatKey({ groupId: 'group-1', characterId: 2, chatId: 'chat-1' }));
    assert.notEqual(chatKey({ characterId: 1, chatId: 'chat-1' }), chatKey({ characterId: 2, chatId: 'chat-1' }));
});

test('native card resolution takes precedence for group scenario/persona/description', () => {
    const context = fixture();
    context.getCharacterCardFields = () => ({ description: 'Group character cards.', scenario: 'Overridden scenario.', persona: 'Selected persona.' });
    const sources = collectSources(context, normalizeSettings());
    assert.equal(sources.character, 'Group character cards.');
    assert.equal(sources.scenario, 'Overridden scenario.');
    assert.equal(sources.persona, 'Selected persona.');
});

test('groups with no active speaker fall back to their member cards', () => {
    const context = fixture();
    context.groupId = 'group-1';
    context.characterId = undefined;
    context.characters[0].avatar = 'mira.png';
    context.characters[0].name = 'Mira';
    context.groups = [{ id: 'group-1', members: ['mira.png'] }];
    context.getCharacterCardFields = () => ({ description: '', scenario: '' });
    const sources = collectSources(context, normalizeSettings());
    assert.equal(sources.character, 'Mira: A silver-haired mage.');
    assert.equal(sources.scenario, 'Mira: A quiet tavern.');
});

test('selected sources and recent messages remain complete regardless of obsolete character settings', () => {
    const context = fixture();
    context.characters[0].description = 'x'.repeat(5000);
    context.chat[1].mes = 'a'.repeat(5000) + 'latest moment';
    const sources = collectSources(context, normalizeSettings({ contextChars: 1000 }));
    assert.equal(sources.character, 'x'.repeat(5000));
    assert.equal(sources.history, `Zephyr: Hello\n\nMira: ${'a'.repeat(5000)}latest moment`);
});

test('only the last five conversation messages are included, without truncating their text', () => {
    const context = fixture();
    context.chat = Array.from({ length: 12 }, (_, index) => ({ name: 'Mira', mes: `Message ${index}: ${'x'.repeat(6000)}`, is_user: false }));
    const sources = collectSources(context, normalizeSettings({ historyMessages: 5 }));
    assert(!sources.history.includes('Message 6:'));
    for (let index = 7; index < 12; index++) assert(sources.history.includes(`Message ${index}: ${'x'.repeat(6000)}`));
});

test('custom templates expand both native and selected-source macros; styles and exclusions remain in system instructions', () => {
    const context = fixture();
    const settings = normalizeSettings({ promptMode: 'custom', template: '{{user}} and {{char}}\n{{ig_history}}\n{{ig_scenario}}', sources: { scenario: false }, instructions: 'Use 60 words for {{char}}.', exclusions: 'logos' });
    const request = buildPromptRequest(context, settings, 'Close-up of {{char}}');
    assert(request[0].content.includes('Use 60 words for Mira.'));
    assert(request[0].content.includes('logos'));
    assert(request[1].content.includes('Zephyr and Mira'));
    assert(request[1].content.includes('Close-up of Mira'));
    assert(!request[1].content.includes('A quiet tavern.'));
});

test('empty sources produce an actionable error but explicit direction works', () => {
    const context = fixture();
    const settings = normalizeSettings({ sources: Object.fromEntries(Object.keys(DEFAULTS.sources).map(key => [key, false])) });
    assert.throws(() => buildPromptRequest(context, settings), /Choose at least/);
    assert(buildPromptRequest(context, settings, 'A landscape')[1].content.includes('A landscape'));
});

test('AI responses remove reasoning and wrappers but reject missing content', () => {
    assert.equal(cleanPromptResponse({ content: '<think>hidden</think>Prompt: "A moonlit lake"' }), 'A moonlit lake');
    assert.equal(cleanPromptResponse('```text\nA lake\n```'), 'A lake');
    assert.throws(() => cleanPromptResponse({ reasoning: 'only thought' }), /no prompt text/);
    assert.throws(() => cleanPromptResponse('<think>hidden</think>'), /empty prompt/);
});

test('fixed additions apply to a draft exactly once without changing the draft', () => {
    const settings = normalizeSettings({ prefix: 'masterpiece', suffix: '{{char}}, accurate anatomy' });
    const draft = 'A lake';
    assert.equal(composeFinalPrompt(draft, settings, text => text.replace('{{char}}', 'Mira')), 'masterpiece, A lake, Mira, accurate anatomy');
    assert.equal(draft, 'A lake');
    assert.throws(() => composeFinalPrompt('', settings), /Write or generate/);
});
