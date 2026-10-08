import { getContext } from '../../../extensions.js';
import { saveBase64AsFile } from '../../../utils.js';
import { MODULE, VERSION, DEFAULTS, NUMBER_LIMITS, appendImageResult, imageResults, buildPromptRequest, composeFinalPrompt, expandMacros, getPath, setPath, normalizeSettings } from './core.js';
import { AutoScheduler, GenerationRuntime, PROVIDERS } from './runtime.js';
import { BRIDGE } from './providers/literouter.js';
import { IMAGE_MODELS, imageProfiles, resolveImageProfile } from './server/shared.mjs';

const assets = new URL('./', import.meta.url);
let settings;
let settingsRoot;
let studioTemplate;
let studioPopup;
let studioRoot;
let studioOptions;
let studioSize = '';
let selectedResultUrl = '';
let runtime;
let scheduler;
let draft = '';
let focus = '';
let notice = 'Ready';
let noticeError = false;
// Stored separately in native account storage.
let manualApiKey = '';

const context = () => getContext();
const persist = () => context().saveSettingsDebounced();
const notify = (message, error = false) => { notice = message; noticeError = error; renderState(); };

async function loadAsset(file) {
    const response = await fetch(new URL(file, assets));
    if (!response.ok) throw new Error(`Could not load UIGE ${file}.`);
    return response.text();
}
function fromHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.firstElementChild;
}

function populateProfiles() {
    const select = settingsRoot.querySelector('[data-setting=profileId]');
    select.replaceChildren(new Option('Follow selected connection profile', ''));
    let profiles = [];
    try { profiles = context().ConnectionManagerRequestService?.getSupportedProfiles() ?? []; } catch { /* Connection Manager is disabled. */ }
    for (const profile of [...profiles].sort((a, b) => a.name.localeCompare(b.name))) select.add(new Option(`${profile.name} · ${profile.model || profile.api}`, profile.id));
    if (settings.profileId && !profiles.some(profile => profile.id === settings.profileId)) select.add(new Option('Saved profile unavailable — choose another', settings.profileId));
    select.value = settings.profileId;
    const imageSelect = settingsRoot.querySelector('[data-setting=imageProfileId]');
    imageSelect.replaceChildren(new Option('Follow selected LiteRouter profile', ''));
    const imageConnections = imageProfiles(context());
    for (const profile of [...imageConnections].sort((a, b) => a.name.localeCompare(b.name))) imageSelect.add(new Option(profile.name, profile.id));
    if (settings.imageProfileId && !imageConnections.some(profile => profile.id === settings.imageProfileId)) imageSelect.add(new Option('Saved LiteRouter profile unavailable — choose another', settings.imageProfileId));
    imageSelect.value = settings.imageProfileId;
}

function renderModelChoices() {
    const select = settingsRoot.querySelector('[data-setting=model]');
    select.replaceChildren(...IMAGE_MODELS.map(model => new Option(`${model.id}${model.tier ? ` · ${model.tier}` : ''} · ${model.cost} credits`, model.id)));
    select.value = settings.model;
}

function renderAdditionsPreview() {
    const preview = settingsRoot.querySelector('[data-additions-preview]');
    try { preview.textContent = composeFinalPrompt('your image prompt', settings, (text, macros) => expandMacros(context(), text, macros)); }
    catch (error) { preview.textContent = error.message; }
}

async function checkBridge() {
    const status = settingsRoot.querySelector('[data-bridge-status]');
    try {
        const response = await fetch(`${BRIDGE}/health`, { headers: context().getRequestHeaders(), cache: 'no-store' });
        if (!response.ok || !(await response.json()).ready) throw new Error('Unavailable');
        status.textContent = 'Profile bridge ready.';
        settingsRoot.querySelector('[data-bridge-setup]').open = false;
    } catch {
        status.textContent = 'Profile bridge not installed.';
        settingsRoot.querySelector('[data-bridge-setup]').open = true;
    }
}

function renderSettings() {
    for (const element of settingsRoot.querySelectorAll('[data-setting]')) {
        const value = getPath(settings, element.dataset.setting);
        if (element.type === 'checkbox') element.checked = value;
        else element.value = value;
    }
    settingsRoot.querySelector('[data-custom-template]').hidden = settings.promptMode !== 'custom';
    settingsRoot.querySelector('[data-profile-connection]').hidden = settings.imageConnection !== 'profile';
    settingsRoot.querySelector('[data-manual-connection]').hidden = settings.imageConnection !== 'manual';
    const size = settingsRoot.querySelector('[data-size]');
    size.value = [...size.options].some(option => option.value === `${settings.width}x${settings.height}`) ? `${settings.width}x${settings.height}` : '';
    populateProfiles();
    renderModelChoices();
    renderAdditionsPreview();
    renderState();
    renderStudio();
}

function renderState() {
    if (!settingsRoot || !runtime) return;
    const status = runtime.busy ? runtime.phase : notice;
    for (const root of [settingsRoot, studioRoot].filter(Boolean)) {
        const element = root.querySelector('.ig-status');
        element.textContent = status;
        element.dataset.error = String(!runtime.busy && noticeError);
        for (const button of root.querySelectorAll('[data-action]')) {
            if (['write', 'scene', 'generate', 'repeat'].includes(button.dataset.action)) button.disabled = runtime.busy || !settings.enabled;
            if (button.dataset.action === 'cancel') button.hidden = !runtime.busy;
        }
        for (const input of root.querySelectorAll('[data-image-option], [data-studio-size]')) input.disabled = runtime.busy;
    }
    const badge = settingsRoot.querySelector('.ig-badge');
    badge.textContent = settings.enabled ? `Enabled · ${VERSION}` : 'Disabled';
    badge.classList.toggle('active', settings.enabled);
    if (!scheduler) return;
    const rule = settings.auto;
    const active = settings.enabled && rule.enabled;
    const summary = settingsRoot.querySelector('[data-auto-summary]');
    summary.textContent = active ? `Every ${rule.every} ${rule.role === 'all' ? 'matching' : rule.role === 'user' ? 'user' : 'bot'} message${rule.every === 1 ? '' : 's'}${rule.names.trim() ? ' · name filter' : ''}` : 'Off · generate only when you ask';
    const autoStatus = settingsRoot.querySelector('.ig-auto-status');
    const count = scheduler.state().count;
    autoStatus.textContent = scheduler.paused ? `Paused: ${scheduler.paused}` : !active ? 'Automatic generation is off.' : `${count} / ${rule.every} matching messages${scheduler.pending ? ' · image queued for the latest scene' : ''}${scheduler.chatBusy || scheduler.groupBusy ? ' · waiting for the chat reply to finish' : ''}.`;
    autoStatus.dataset.paused = String(Boolean(scheduler.paused));
    settingsRoot.querySelector('[data-action=resume]').hidden = !scheduler.paused;
    const menu = document.getElementById('imagegen_plus_wand');
    if (menu) menu.hidden = !settings.enabled;
}

function finalPrompt() {
    try { return composeFinalPrompt(draft, settings, (text, macros) => expandMacros(context(), text, macros)); }
    catch (error) { return draft.trim() ? error.message : 'Write or generate a draft to see the final prompt.'; }
}

function currentResult() {
    const results = imageResults(context());
    return results.find(result => result.url === selectedResultUrl) ?? results.at(-1) ?? null;
}

function renderStudio() {
    if (!studioRoot) return;
    studioRoot.querySelector('[data-draft]').value = draft;
    studioRoot.querySelector('[data-focus]').value = focus;
    studioRoot.querySelector('[data-final-prompt]').textContent = finalPrompt();
    renderStudioOptions();
    const result = currentResult();
    const results = imageResults(context());
    const gallery = studioRoot.querySelector('[data-image-gallery]');
    gallery.replaceChildren(...results.map((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ig-thumbnail';
        button.dataset.resultUrl = item.url;
        button.setAttribute('aria-label', `Image ${index + 1}`);
        button.setAttribute('aria-pressed', String(item === result));
        const thumbnail = document.createElement('img');
        thumbnail.src = item.url;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        button.append(thumbnail);
        return button;
    }));
    gallery.hidden = results.length < 2;
    studioRoot.querySelector('[data-image-count]').textContent = results.length ? `${results.findIndex(item => item === result) + 1} / ${results.length}` : '';
    studioRoot.querySelector('.ig-result').hidden = !result;
    studioRoot.querySelector('[data-empty-preview]').hidden = Boolean(result);
    if (result) {
        studioRoot.querySelector('[data-image]').src = result.url;
        studioRoot.querySelector('[data-image-link]').href = result.url;
        studioRoot.querySelector('[data-download]').href = result.url;
        studioRoot.querySelector('[data-result-meta]').textContent = `${result.model} · ${result.settings.width} × ${result.settings.height} · seed ${result.seed ?? 'random'}`;
    }
    renderState();
}

function resetStudioOptions() {
    studioOptions = Object.fromEntries(['model', 'width', 'height', 'seed'].map(key => [key, settings[key]]));
    const dimensions = `${settings.width}x${settings.height}`;
    studioSize = ['1024x1024', '768x1024', '1024x768', '512x512'].includes(dimensions) ? dimensions : '';
}

function renderStudioOptions() {
    if (!studioRoot || !studioOptions) return;
    for (const input of studioRoot.querySelectorAll('[data-image-option]')) input.value = studioOptions[input.dataset.imageOption];
    const size = studioRoot.querySelector('[data-studio-size]');
    size.value = studioSize;
    studioRoot.querySelector('[data-custom-size]').hidden = size.value !== '';
}

async function showPopup(content, options = {}) {
    const ctx = context();
    const popup = new ctx.Popup(content, ctx.POPUP_TYPE.TEXT, '', { okButton: 'Close', allowVerticalScrolling: true, ...options });
    popup.dlg.classList.add('ig-popup');
    return popup.show();
}

async function openStudio() {
    if (studioPopup) return;
    studioRoot = fromHtml(studioTemplate);
    selectedResultUrl = '';
    resetStudioOptions();
    const modelSelect = studioRoot.querySelector('[data-image-option=model]');
    modelSelect.replaceChildren(...IMAGE_MODELS.map(model => new Option(model.id, model.id)));
    studioRoot.addEventListener('click', event => {
        const thumbnail = event.target.closest('[data-result-url]');
        if (thumbnail) { selectedResultUrl = thumbnail.dataset.resultUrl; renderStudio(); return; }
        const button = event.target.closest('[data-action]');
        if (button) void handleAction(button.dataset.action, button);
    });
    studioRoot.querySelector('[data-draft]').addEventListener('input', event => {
        draft = event.target.value;
        studioRoot.querySelector('[data-final-prompt]').textContent = finalPrompt();
    });
    studioRoot.querySelector('[data-focus]').addEventListener('input', event => { focus = event.target.value; });
    studioRoot.addEventListener('input', event => {
        const input = event.target;
        const key = input.dataset.imageOption;
        if (!key) return;
        studioOptions[key] = ['width', 'height'].includes(key) ? (input.value === '' ? NaN : Number(input.value)) : input.value;
    });
    studioRoot.querySelector('[data-studio-size]').addEventListener('change', event => {
        studioSize = event.target.value;
        if (event.target.value) {
            [studioOptions.width, studioOptions.height] = event.target.value.split('x').map(Number);
            renderStudioOptions();
        } else studioRoot.querySelector('[data-custom-size]').hidden = false;
    });
    const ctx = context();
    studioPopup = new ctx.Popup(studioRoot, ctx.POPUP_TYPE.TEXT, '', { okButton: 'Close', allowVerticalScrolling: true });
    studioPopup.dlg.classList.add('ig-popup', 'ig-studio-popup');
    renderStudio();
    try { await studioPopup.show(); }
    finally { studioRoot = null; studioPopup = null; studioOptions = null; }
}

async function blobBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the generated image.'));
        reader.readAsDataURL(blob);
    });
}

async function publishImage(result, origin) {
    const ctx = context();
    const { message, index } = appendImageResult(origin, result);
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, index, 'extension');
    ctx.addOneMessage(message, { forceId: index });
    await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, index, 'extension');
    await ctx.saveChat();
    ctx.scrollOnMediaLoad?.();
    selectedResultUrl = result.url;
    renderStudio();
}

async function generate(kind, automatic = false, exact = null, inputDraft = null, imageOptions = {}) {
    if (runtime.busy) throw new Error('A UIGE request is already running.');
    notify('Starting…');
    try {
        const result = await runtime.run(kind, { draft: inputDraft ?? draft, focus: automatic ? '' : focus, auto: automatic, exact, imageOptions });
        if (result.draft) draft = result.draft;
        notify(kind === 'prompt' ? 'Prompt ready.' : result.transport === 'direct' && settings.directTransport === 'proxy' ? 'Image saved · direct request (proxy blocked by Basic Auth).' : 'Image saved to this chat.');
        renderStudio();
        if (automatic) globalThis.toastr?.success('A new scene image was added to the chat.', 'UIGE');
        return result;
    } catch (error) {
        notify(error.name === 'AbortError' ? 'Request cancelled.' : error.message, error.name !== 'AbortError');
        throw error;
    } finally { scheduler?.schedule(); }
}

async function previewInput() {
    const ctx = context();
    if (ctx.groupId) await ctx.unshallowGroupMembers?.(ctx.groupId);
    else if (ctx.characterId !== undefined) await ctx.unshallowCharacter?.(ctx.characterId);
    const messages = buildPromptRequest(ctx, settings, focus);
    const root = document.createElement('div');
    root.className = 'ig-root ig-input-preview';
    for (const message of messages) {
        const label = document.createElement('b');
        label.textContent = message.role === 'system' ? 'Writer instructions' : 'Scene input';
        const text = document.createElement('pre');
        text.textContent = message.content;
        root.append(label, text);
    }
    await showPopup(root);
}

async function handleAction(action, button) {
    try {
        const imageOptions = button?.closest('.ig-studio') ? { ...studioOptions } : {};
        switch (action) {
            case 'studio': await openStudio(); break;
            case 'write': await generate('prompt'); break;
            case 'scene': await generate('scene', false, null, null, imageOptions); break;
            case 'generate': await generate('image', false, null, null, imageOptions); break;
            case 'cancel': runtime.cancel(); scheduler.stop(); break;
            case 'reuse': draft = currentResult()?.draft || ''; renderStudio(); break;
            case 'repeat': {
                const result = currentResult();
                if (!result) break;
                await generate('image', false, { prompt: result.prompt, draft: result.draft, settings: result.settings });
                break;
            }
            case 'models': {
                button.disabled = true;
                const profile = settings.imageConnection === 'profile' ? resolveImageProfile(context(), settings.imageProfileId) : null;
                const models = await PROVIDERS.get(settings.provider).models({ profile, apiKey: manualApiKey, settings: structuredClone(settings), headers: context().getRequestHeaders() });
                settingsRoot.querySelector('[data-model-status]').textContent = `${models.filter(model => model.listed).length} / ${models.length} models available.`;
                notify('Image models refreshed.');
                break;
            }
            case 'check-bridge': await checkBridge(); break;
            case 'forget-key': {
                runtime.cancel();
                scheduler.stop();
                manualApiKey = '';
                context().accountStorage.removeItem(`${MODULE}:manual-api-key`);
                context().accountStorage.removeItem(`${MODULE}:api-key`);
                settingsRoot.querySelector('[data-api-key]').value = '';
                notify('Manual API key cleared.');
                break;
            }
            case 'preview-input': await previewInput(); break;
            case 'resume': scheduler.resume(); break;
            case 'reset-counter': {
                const state = scheduler.state();
                state.count = 0;
                scheduler.stop();
                context().saveMetadataDebounced();
                renderState();
                break;
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') { notify(error.message, true); globalThis.toastr?.error(error.message, 'UIGE'); }
    } finally { if (action === 'models') button.disabled = false; }
}

function bindSettings() {
    settingsRoot.querySelector('[data-api-key]').addEventListener('input', event => {
        manualApiKey = event.target.value;
        context().accountStorage.setItem(`${MODULE}:manual-api-key`, manualApiKey);
    });
    settingsRoot.addEventListener('input', event => {
        const element = event.target;
        const path = element.dataset.setting;
        if (!path || !Object.hasOwn(DEFAULTS, path.split('.')[0])) return;
        let value = element.type === 'checkbox' ? element.checked : element.value;
        if (element.type === 'number' && path !== 'seed') {
            if (element.value === '' || !element.checkValidity()) return;
            value = Number(element.value);
            const [min, max] = NUMBER_LIMITS[path];
            if (!Number.isInteger(value) || value < min || value > max) return;
        }
        if (path === 'seed' && value !== '' && !element.checkValidity()) return;
        setPath(settings, path, value);
        if (path === 'enabled' && !value) { runtime.cancel(); scheduler.stop(); }
        if (path.startsWith('auto.')) {
            scheduler.stop();
            if (path !== 'auto.cooldownSeconds') scheduler.reset();
            context().saveMetadataDebounced();
        }
        persist();
        if (path === 'finalTemplate') renderAdditionsPreview();
        if (path === 'imageConnection') { runtime.cancel(); scheduler.stop(); if (value === 'profile') void checkBridge(); }
        if (['imageConnection', 'promptMode', 'style', 'width', 'height'].includes(path)) renderSettings();
        else { renderState(); if (studioRoot) studioRoot.querySelector('[data-final-prompt]').textContent = finalPrompt(); }
    });
    settingsRoot.addEventListener('change', event => {
        const element = event.target;
        if (element.type === 'number') {
            element.value = getPath(settings, element.dataset.setting);
            renderSettings();
        }
    });
    settingsRoot.querySelector('[data-size]').addEventListener('change', event => {
        if (!event.target.value) return;
        [settings.width, settings.height] = event.target.value.split('x').map(Number);
        persist();
        renderSettings();
    });
    settingsRoot.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button) void handleAction(button.dataset.action, button);
    });

}

function addChatMenu() {
    if (document.getElementById('imagegen_plus_wand')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const item = document.createElement('div');
    item.id = 'imagegen_plus_wand';
    item.className = 'list-group-item flex-container flexGap5';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-image extensionsMenuExtensionButton" aria-hidden="true"></div><span>Image studio</span>';
    item.addEventListener('click', () => { void handleAction('studio', item); });
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void handleAction('studio', item); }
    });
    menu.append(item);
    renderState();
}

function bindEvents() {
    const ctx = context();
    const on = (key, handler) => { if (ctx.eventTypes[key]) ctx.eventSource.on(ctx.eventTypes[key], handler); };
    on('MESSAGE_SENT', (index, type) => { scheduler.observe(index, type); });
    on('MESSAGE_RECEIVED', (index, type) => { scheduler.observe(index, type); });
    on('GENERATION_STARTED', type => { if (type !== 'quiet') scheduler.setChatBusy(true); });
    on('GENERATION_ENDED', () => { scheduler.setChatBusy(false); renderState(); });
    on('GENERATION_STOPPED', () => { scheduler.setChatBusy(false); renderState(); });
    on('GROUP_WRAPPER_STARTED', () => { scheduler.setGroupBusy(true); renderState(); });
    on('GROUP_WRAPPER_FINISHED', () => { scheduler.setGroupBusy(false); renderState(); });
    on('CHAT_CHANGED', () => {
        runtime.cancel();
        scheduler.setChatBusy(false);
        scheduler.setGroupBusy(false);
        draft = '';
        focus = '';
        selectedResultUrl = '';
        if (studioRoot) resetStudioOptions();
        notice = 'Ready';
        noticeError = false;
        scheduler.reset();
        renderStudio();
        renderState();
    });
    for (const key of ['CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_UPDATED', 'CONNECTION_PROFILE_DELETED', 'CONNECTION_PROFILE_LOADED', 'SETTINGS_UPDATED']) on(key, () => { populateProfiles(); });
    on('APP_READY', () => { addChatMenu(); });
    if (ctx.SlashCommandParser && ctx.SlashCommand) {
        ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
            name: 'uige', aliases: ['igplus'],
            callback: async (_args, value) => {
                try {
                    const text = String(value ?? '').trim();
                    const result = await generate(text ? 'image' : 'scene', false, null, text || null);
                    return result?.url || '';
                } catch (error) { if (error.name !== 'AbortError') globalThis.toastr?.error(error.message, 'UIGE'); return ''; }
            },
            unnamedArgumentList: [ctx.SlashCommandArgument.fromProps({ description: 'Image prompt (omit to illustrate the current scene)', typeList: [ctx.ARGUMENT_TYPE.STRING], isRequired: false })],
            helpString: 'Generate a UIGE image from your prompt, or omit the prompt to illustrate the current scene.',
        }));
    }
}

async function initialize() {
    if (document.getElementById('imagegen_plus_settings')) return;
    const ctx = context();
    settings = normalizeSettings(ctx.extensionSettings[MODULE]);
    ctx.extensionSettings[MODULE] = settings;
    manualApiKey = ctx.accountStorage.getItem(`${MODULE}:manual-api-key`) ?? ctx.accountStorage.getItem(`${MODULE}:api-key`) ?? '';
    const [html, studio] = await Promise.all([loadAsset('settings.html'), loadAsset('studio.html')]);
    settingsRoot = fromHtml(html);
    settingsRoot.querySelector('[data-api-key]').value = manualApiKey;
    studioTemplate = studio;
    document.getElementById('extensions_settings2').append(settingsRoot);
    runtime = new GenerationRuntime({
        context, settings: () => settings, apiKey: () => manualApiKey,
        saveImage: async (image, origin) => saveBase64AsFile(await blobBase64(image.blob), origin.groupId ? 'UIGE' : origin.name2 || 'UIGE', `uige-${Date.now()}-${crypto.randomUUID()}`, image.format),
        publishImage, onState: renderState,
    });
    scheduler = new AutoScheduler({
        context, settings: () => settings, busy: () => runtime.busy,
        generate: () => generate('scene', true), saveMetadata: () => context().saveMetadataDebounced(), onState: renderState,
    });
    bindSettings();
    bindEvents();
    renderSettings();
    addChatMenu();
    persist();
    if (settings.imageConnection === 'profile') void checkBridge();
}

jQuery(() => { void initialize().catch(error => { globalThis.toastr?.error(error.message, 'UIGE could not load'); }); });
