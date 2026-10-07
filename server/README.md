# ImageGen+ profile bridge

This small SillyTavern server plugin reuses a saved Custom connection profile's API key for LiteRouter images. The key stays on the server. It uses SillyTavern's native, account-scoped secret lookup and sends requests only to `https://image.literouter.com`.

## One-time installation

1. Download **ImageGenPlus-Server-Bridge.zip** from the [latest release](https://github.com/zephyrthepink/imagegen-plus/releases/latest) and extract it into your **SillyTavern root folder**. It adds `plugins/imagegen-plus/`.
2. Set `enableServerPlugins: true` in SillyTavern's `config.yaml`.
3. Restart SillyTavern and reload the browser.
4. In **Extensions → ImageGen+ → Connection**, select a saved Custom (OpenAI-compatible) profile with server URL `https://api.literouter.com/v1`.

Alternatively, copy this whole `server/` directory into `SillyTavern/plugins/imagegen-plus/`. Keep `index.mjs`, `bridge.mjs` and `shared.mjs` together. No npm installation is needed. Launch SillyTavern from its usual root directory so the plugin can import its native secrets module.

Model refresh and image generation use the selected profile's saved secret ID. Profiles without a specific secret ID use the active saved Custom API key, matching SillyTavern's native behavior. The image model is selected separately from the profile's text model. The prompt writer can use a different connection profile.

You do not need to enable the CORS proxy or expose saved keys. The bridge has no credential store of its own, accepts no raw API keys, and does not return or log saved keys. The authenticated request user's directories determine which secrets can be read.

For updates, replace the plugin folder with the bridge from the new release and restart SillyTavern. Removing this folder disables the bridge.
