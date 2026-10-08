# Changelog

## 1.0.4

- Rename the extension to UIGE — Unremarkable Image Generation Extension, preserving existing settings and credentials.
- Keep generated images as separate chat messages and add browsable studio image history so previous results remain accessible.
- Preserve existing uploaded/generated attachments when adding new images.
- Remove configuration import/export controls.
- Use a plain native wand-menu entry and remove branding/icons from the studio header and settings drawer title.
- Remove the API-key storage hint and make settings action buttons full width.
- Add `/uige`, retaining `/igplus` as an alias.

## 1.0.3

- Preserve manual LiteRouter keys across reloads in native account storage; remove only on explicit clearing.
- Handle the native CORS proxy's Basic Auth / Bearer header collision with a direct fallback after a confirmed local SillyTavern auth rejection.
- Show bounded, credential-redacted provider error details, including proxy 402 responses, without retrying upstream generation failures.
- Redesign the studio into prompt, generation and image-preview panels with responsive layouts.
- Add studio-only model, size, custom dimensions and seed controls, independent of saved defaults and automation.
- Shorten settings help, including a single-sentence prompt-macro explanation.

## 1.0.2

- Add optional manual LiteRouter API-key setup without the ImageGen+ server plugin, with direct browser requests or SillyTavern's built-in CORS proxy.
- Keep manual keys in memory for the current page session, with a clear-key button and no credentials in settings, exports or image metadata.
- Replace beginning/end additions with an editable final image prompt template and request-local `{{ig_prompt}}` macro.
- Support arbitrary draft placement, repeated prompt references, native macros and line breaks, with live previews.
- Migrate existing beginning/end additions automatically and preserve exact repeat requests.
- Keep draft text literal when expanding templates so AI-written macro-looking text does not execute native macros.

## 1.0.1

- Replace separate API-key settings with a saved LiteRouter connection-profile selector.
- Add a bundled server bridge that reuses native account-scoped credentials without exposing keys to the browser.
- Add all 23 curated image models from the supplied catalog, with profile-based model refresh.
- Remove character truncation and configurable length controls; use only the last-N-messages setting for source selection.
- Explain fixed beginning/ending prompt additions with clearer labels and a live example.
- Remove API-key remembering/forgetting controls, direct/proxy route selection and the Provider docs button.
- Migrate settings and remove obsolete credential copies from 1.0.0.

## 1.0.0

Initial release by ZephyrThePink.

- LiteRouter image generation and model discovery.
- Image studio with editable AI-written prompts, image previews, downloads and repeat requests.
- Saved connection profiles, selectable scene sources and native macro templates.
- Writing styles, custom instructions, exclusions and fixed prompt additions.
- Optional per-chat automation with message-role/name filters and cooldowns.
- Cancellation, request timeouts, error pausing and credential-free settings exports.
- Responsive theme-aware UI and `/igplus` command.
