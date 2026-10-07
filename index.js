import { getContext } from '../../../extensions.js';
import { saveBase64AsFile } from '../../../utils.js';
import { MODULE, VERSION, DEFAULTS, STYLES, NUMBER_LIMITS, buildPromptRequest, composeFinalPrompt, getPath, setPath, normalizeSettings } from './core.js';
import { AutoScheduler, GenerationRuntime, PROVIDERS } from './runtime.js';
import { BRIDGE } from './providers/literouter.js';
import { IMAGE_MODELS, imageProfiles, resolveImageProfile } from './server/shared.mjs';

const assets = new URL('./', import.meta.url);
let settings;
let settingsRoot;
let studioTemplate;
let studioPopup;
let studioRoot;
let runtime;
let scheduler;
let draft = '';
let focus = '';
let notice = 'Ready';
let noticeError = false;

const context = () => getContext();
const persist = () => context().saveSettingsDebounced();
const notify = (message, error = false) => { notice = message; noticeError = error; renderState(); };

async function loadAsset(file) {
    const response = await fetch(new URL(file, assets));
    if (!response.ok) throw new Error(`Could not load ImageGen+ ${file}.`);
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
    settingsRoot.querySelector('[data-additions-preview]').textContent = composeFinalPrompt('your image prompt', settings, value => context().substituteParams(value));
}

async function checkBridge() {
    const status = settingsRoot.querySelector('[data-bridge-status]');
    try {
        const response = await fetch(`${BRIDGE}/health`, { headers: context().getRequestHeaders(), cache: 'no-store' });
        if (!response.ok || !(await response.json()).ready) throw new Error('Unavailable');
        status.textContent = 'Profile bridge ready. Saved credentials stay on the server.';
        settingsRoot.querySelector('[data-bridge-setup]').open = false;
    } catch {
        status.textContent = 'Install the profile bridge once to use saved connection credentials.';
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
    settingsRoot.querySelector('[data-style-description]').textContent = STYLES[settings.style].instructions || 'Your instructions below define the writing style.';
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
    try { return composeFinalPrompt(draft, settings, value => context().substituteParams(value)); }
    catch { return 'Write or generate a draft to see the final prompt.'; }
}

function currentResult() { return context().chatMetadata?.[MODULE]?.lastResult ?? null; }

function renderStudio() {
    if (!studioRoot) return;
    studioRoot.querySelector('[data-draft]').value = draft;
    studioRoot.querySelector('[data-focus]').value = focus;
    studioRoot.querySelector('[data-final-prompt]').textContent = finalPrompt();
    studioRoot.querySelector('[data-studio-model]').textContent = settings.model;
    const result = currentResult();
    studioRoot.querySelector('.ig-result').hidden = !result;
    if (result) {
        studioRoot.querySelector('[data-image]').src = result.url;
        studioRoot.querySelector('[data-image-link]').href = result.url;
        studioRoot.querySelector('[data-download]').href = result.url;
        studioRoot.querySelector('[data-result-meta]').textContent = `${result.model} · ${result.settings.width} × ${result.settings.height} · seed ${result.seed ?? 'not exposed by provider'}${result.requestId ? ` · request ${result.requestId}` : ''}`;
    }
    renderState();
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
    studioRoot.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button) void handleAction(button.dataset.action, button);
    });
    studioRoot.querySelector('[data-draft]').addEventListener('input', event => {
        draft = event.target.value;
        studioRoot.querySelector('[data-final-prompt]').textContent = finalPrompt();
    });
    studioRoot.querySelector('[data-focus]').addEventListener('input', event => { focus = event.target.value; });
    const ctx = context();
    studioPopup = new ctx.Popup(studioRoot, ctx.POPUP_TYPE.TEXT, '', { okButton: 'Close', allowVerticalScrolling: true });
    studioPopup.dlg.classList.add('ig-popup');
    renderStudio();
    try { await studioPopup.show(); }
    finally { studioRoot = null; studioPopup = null; }
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
    const message = {
        name: 'ImageGen+', is_user: false, is_system: true, send_date: new Date().toISOString(), mes: '',
        extra: {
            media: [{ url: result.url, type: 'image', source: 'generated', title: result.prompt }],
            media_display: 'gallery', media_index: 0, inline_image: false,
            [MODULE]: result,
        },
    };
    origin.chat.push(message);
    origin.chatMetadata[MODULE] ??= {};
    origin.chatMetadata[MODULE].lastResult = result;
    ctx.addOneMessage(message);
    const index = origin.chat.length - 1;
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, index, 'extension');
    await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, index, 'extension');
    await ctx.saveChat();
    ctx.scrollOnMediaLoad?.();
    renderStudio();
}

async function generate(kind, automatic = false, exact = null, inputDraft = null) {
    if (runtime.busy) throw new Error('An ImageGen+ request is already running.');
    notify('Starting…');
    try {
        const result = await runtime.run(kind, { draft: inputDraft ?? draft, focus: automatic ? '' : focus, auto: automatic, exact });
        if (result.draft) draft = result.draft;
        notify(kind === 'prompt' ? 'Prompt ready. Edit the draft, then generate your image.' : 'Image saved to this chat.');
        renderStudio();
        if (automatic) globalThis.toastr?.success('A new scene image was added to the chat.', 'ImageGen+');
        return result;
    } catch (error) {
        notify(error.name === 'AbortError' ? 'Request cancelled.' : error.message, error.name !== 'AbortError');
        throw error;
    } finally { scheduler?.schedule(); }
}

function downloadJson(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        switch (action) {
            case 'studio': await openStudio(); break;
            case 'write': await generate('prompt'); break;
            case 'scene': await generate('scene'); break;
            case 'generate': await generate('image'); break;
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
                const profile = resolveImageProfile(context(), settings.imageProfileId);
                const models = await PROVIDERS.get(settings.provider).models({ profile, settings: structuredClone(settings), headers: context().getRequestHeaders() });
                settingsRoot.querySelector('[data-model-status]').textContent = `${models.length} curated models · ${models.filter(model => model.listed).length} confirmed by LiteRouter. Availability depends on your plan.`;
                notify('Image models refreshed.');
                break;
            }
            case 'check-bridge': await checkBridge(); break;
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
            case 'export': downloadJson({ extension: MODULE, version: VERSION, settings }, 'imagegen-plus-settings.json'); break;
            case 'import': settingsRoot.querySelector('[data-import-file]').click(); break;
        }
    } catch (error) {
        if (error.name !== 'AbortError') { notify(error.message, true); globalThis.toastr?.error(error.message, 'ImageGen+'); }
    } finally { if (action === 'models') button.disabled = false; }
}

function bindSettings() {
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
        if (path === 'prefix' || path === 'suffix') renderAdditionsPreview();
        if (['promptMode', 'style', 'width', 'height'].includes(path)) renderSettings();
        else { renderState(); if (studioRoot) { studioRoot.querySelector('[data-final-prompt]').textContent = finalPrompt(); studioRoot.querySelector('[data-studio-model]').textContent = settings.model; } }
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
    settingsRoot.querySelector('[data-import-file]').addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('Configuration files must be smaller than 1 MB.');
            const data = JSON.parse(await file.text());
            if (data.extension !== MODULE || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('Choose an ImageGen+ configuration export.');
            runtime.cancel();
            settings = normalizeSettings(data.settings);
            settings.auto.enabled = false;
            context().extensionSettings[MODULE] = settings;
            scheduler.reset();
            persist();
            renderSettings();
            notify('Configuration imported. Automatic generation is off.');
        } catch (error) { notify(error.message, true); }
        finally { event.target.value = ''; }
    });
}

function addChatMenu() {
    if (document.getElementById('imagegen_plus_wand')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const container = document.createElement('div');
    container.className = 'extension_container';
    container.id = 'imagegen_plus_wand';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.innerHTML = '<span class="fa-solid fa-image extensionsMenuExtensionButton" aria-hidden="true"></span><span>ImageGen+ studio</span>';
    button.addEventListener('click', () => { void handleAction('studio', button); });
    container.append(button);
    menu.append(container);
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
            name: 'igplus',
            callback: async (_args, value) => {
                try {
                    const text = String(value ?? '').trim();
                    const result = await generate(text ? 'image' : 'scene', false, null, text || null);
                    return result?.url || '';
                } catch (error) { if (error.name !== 'AbortError') globalThis.toastr?.error(error.message, 'ImageGen+'); return ''; }
            },
            unnamedArgumentList: [ctx.SlashCommandArgument.fromProps({ description: 'Image prompt (omit to illustrate the current scene)', typeList: [ctx.ARGUMENT_TYPE.STRING], isRequired: false })],
            helpString: 'Generate an ImageGen+ image. With no argument, the connection profile writes a prompt from the current scene. With text, use that text as the image prompt.',
        }));
    }
}

async function initialize() {
    if (document.getElementById('imagegen_plus_settings')) return;
    const ctx = context();
    settings = normalizeSettings(ctx.extensionSettings[MODULE]);
    ctx.extensionSettings[MODULE] = settings;
    // One-time migration removes the obsolete v1.0.0 credential copy.
    ctx.accountStorage.removeItem(`${MODULE}:api-key`);
    const [html, studio] = await Promise.all([loadAsset('settings.html'), loadAsset('studio.html')]);
    settingsRoot = fromHtml(html);
    studioTemplate = studio;
    document.getElementById('extensions_settings2').append(settingsRoot);
    runtime = new GenerationRuntime({
        context, settings: () => settings,
        saveImage: async (image, origin) => saveBase64AsFile(await blobBase64(image.blob), origin.groupId ? 'ImageGenPlus' : origin.name2 || 'ImageGenPlus', `imagegen-plus-${Date.now()}-${crypto.randomUUID()}`, image.format),
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
    void checkBridge();
}

jQuery(() => { void initialize().catch(error => { globalThis.toastr?.error(error.message, 'ImageGen+ could not load'); }); });
