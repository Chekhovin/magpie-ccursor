# Magpie CCursor

**English** · [简体中文](README.md)

Use **Magpie's models in Cursor**: manage providers and usage in Magpie, then select models, chat, and run Agent tasks in Cursor.

[AGPL-3.0-or-later](LICENSE) · Based on [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor) · Experimental

This is a Magpie **Agent integration plugin** adapted from CCursor. It runs a standalone local BYOK bridge that routes Cursor requests through the Magpie gateway. You need Cursor and a Magpie installation with working models. Model charges depend on the providers you configure in Magpie.

## Usage

After installation, open **Agent → CCursor** in Magpie, enable the connection, and assign models. Start or restart Cursor, select a model in its model picker, and send:

> Reply only with “Connected successfully”.

Model list changes sync automatically. Requests use the Agent key that Magpie assigns to CCursor, and usage is attributed to that Agent. Disconnecting the Agent stops the bridge; reconnecting starts it again. Keep Magpie running while you use Cursor.

```text
Cursor → Local CCursor bridge → Magpie gateway → Your configured model providers
```

## Installation

Add this source on Magpie's plugin page:

```text
github:Chekhovin/magpie-ccursor
```

Or use the Magpie CLI:

```sh
magpie plugin add github:Chekhovin/magpie-ccursor
```

The repository includes the source entry points, which Magpie's Bun runtime loads directly. No `postinstall` script or prebuilt `dist` is required. Use a recent Magpie version that supports Agent plugins and plugin pages.

**Already using CCursor?** Stop the original CCursor service and disable its automatic startup. Keep its files and configuration. Existing client patches that connect to `127.0.0.1:39831` can be reused. Connect CCursor in Magpie, then restart Cursor. For custom ports, older versions, or incomplete patches, see [Setup and recovery (Chinese)](docs/setup.md).

**Cursor has not been patched yet?** After installing the plugin, you also need to set up Cursor once. With [Bun](https://bun.sh) installed, clone this repository, close all Cursor windows, and run:

```sh
git clone https://github.com/Chekhovin/magpie-ccursor.git
cd magpie-ccursor
bun install --frozen-lockfile --ignore-scripts
bun cli.ts setup --cursor-closed
```

`setup` backs up and modifies Cursor application files. It does not install the original Cursor++ extension. After setup, connect CCursor in Magpie before starting Cursor. A Cursor update may require setup again; see [Setup and recovery (Chinese)](docs/setup.md).

## Configuration and status

| Item | Location or behavior |
| --- | --- |
| Models, providers, and Agent key | Managed by Magpie |
| Connection configuration | `~/.magpie-ccursor/connection.json`, written and restored by Magpie |
| Derived configuration and conversation database | `~/.magpie-ccursor/`; existing `~/.ccursor` data is not imported |
| Bridge address | `127.0.0.1:39831`, listening on the local machine only |
| Check status | Run `bun cli.ts status` from the source directory |
| Run in the foreground for debugging | `bun cli.ts start`; press Ctrl+C to stop |
| Restore Cursor files patched by this plugin | Close Cursor, then run `bun cli.ts restore --cursor-closed` |

The connection and derived provider configuration files contain the gateway key. Do not commit them or paste them into an issue. The plugin does not read provider configuration, login credentials, or conversation history from your installed CCursor.

## Current limitations

- The complete text protocol flow, model updates, database persistence, shutdown, and recovery have been tested with a local mock gateway. **Installation through the Magpie desktop UI and interaction with a real Cursor client have not yet been tested.** See the [verification record](docs/verification.md) for details.
- Upstream Agent, tool, and image handling code is retained. Compatibility with specific model and client combinations still needs testing. The plugin connects to Magpie through OpenAI Chat Completions; Magpie translates requests to each provider's protocol.
- The original CCursor service and this plugin cannot use the default port at the same time. The plugin does not automatically terminate other processes or uninstall the original version.
- Some platform-specific native packages for the upstream `supermarkdown` dependency returned 404 during installation. Web page conversion to Markdown remains unverified. This does not block the text conversation flow covered by the tests.
- Cursor client patches depend on upstream support for each Cursor version. `setup` has not been run against a real client. It refuses incomplete patches and attempts to restore backups if patching fails. Disabling the plugin does not automatically restore Cursor application files.

## Feedback and development

When [reporting an issue](https://github.com/Chekhovin/magpie-ccursor/issues), include your Magpie, Bun, and Cursor versions, reproduction steps, and logs with sensitive information removed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and validation instructions, and the [architecture guide](docs/architecture.md) for integration details and source changes.

## Source and license

The service and patch logic come from a fresh checkout of [CCursor `fcac85d`](https://github.com/CometixSpace/CCursor/tree/fcac85db793fc2c8cda3318b96ec5a41c24f5e26). This project retains the [AGPL-3.0-or-later](LICENSE) license; adaptation details are recorded in [NOTICE.md](NOTICE.md). This is not an official release from Cursor, Magpie, or CCursor. It comes with no warranty.
