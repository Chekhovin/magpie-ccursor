# Magpie CCursor

**English** · [简体中文](README.md)

Use the models you configured in **Magpie** directly inside **Cursor**: manage model providers, API keys, and usage tracking in Magpie while switching models, chatting, and running Agent tasks in Cursor.

[AGPL-3.0-or-later](LICENSE) · Based on [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)

`magpie-ccursor` is a CCursor Agent plugin built for Magpie. It runs a lightweight local protocol bridge (`127.0.0.1:39831`) that forwards Cursor's model requests to your local Magpie gateway, which then routes them to your configured providers. Model usage is billed by the providers you configure in Magpie.

```text
Cursor → Local CCursor bridge (127.0.0.1:39831) → Magpie gateway → Model providers
```

## Quick start

Once you complete the [Installation and setup](#installation-and-setup) below, everyday usage takes three steps:

1. In Magpie, open **Agent → CCursor**, enable the connection, and select the models you want to expose to Cursor.
2. Start (or restart) Cursor and pick one of the assigned models from the Cursor model picker.
3. Send a quick test prompt to verify the connection:

   > Reply only with "Connected successfully".

Keep Magpie running while you use Cursor:

- Whenever you update the assigned models in Magpie, the model list in Cursor updates automatically.
- Model requests authenticate with the dedicated Agent key Magpie assigns to CCursor, so usage is tracked specifically under that Agent.
- Disabling the CCursor connection in Magpie stops the local bridge; re-enabling it starts the bridge again.

## Installation and setup

Before starting, make sure you have a Magpie version with Agent plugin support and the Cursor desktop app. Magpie's bundled Bun runtime loads the plugin entry points directly, so you do not need a separate Bun installation just to use the plugin.

### Step 1: Install the plugin in Magpie

Add the following plugin source on Magpie's plugin page:

```text
github:Chekhovin/magpie-ccursor
```

Or install it via the Magpie CLI:

```sh
magpie plugin add github:Chekhovin/magpie-ccursor
```

### Step 2: Connect the Cursor client

Cursor needs local client hooks that route requests to `127.0.0.1:39831`. Follow the path that matches your setup:

#### Option A: Fresh Cursor installation (not patched with CCursor yet)

If you have not patched Cursor before, apply the client hooks once. With [Bun](https://bun.sh) (`>= 1.3.0`) installed on your machine, **close all Cursor windows first**, then run in a terminal:

```sh
git clone https://github.com/Chekhovin/magpie-ccursor.git
cd magpie-ccursor
bun install --frozen-lockfile --ignore-scripts
bun cli.ts setup --cursor-closed
```

`setup` backs up the original application files before patching and does not install the upstream Cursor++ extension. Once finished, enable the CCursor connection in Magpie and launch Cursor. Updating Cursor later may require running `setup` again; see the [Setup and recovery guide (Chinese)](docs/setup.md) for details.

#### Option B: Already using upstream CCursor

If you already patched Cursor with upstream CCursor and your hooks point to the default `127.0.0.1:39831` address, you can reuse your existing client patch without running `setup`:

1. **Stop the original CCursor server and disable its auto-start** so it does not compete with this plugin for port `39831` (leave the existing patched files in place).
2. Enable **Agent → CCursor** in Magpie, then restart Cursor.

For details on existing installations, custom ports, and patch compatibility, see the [Setup and recovery guide (Chinese)](docs/setup.md).

## Commands and configuration

From a local clone of this repository, you can use `bun cli.ts` (requires [Bun](https://bun.sh) `>= 1.3.0`) to check status, debug in the foreground, or restore modified Cursor files:

| Action or setting | Command / details |
| --- | --- |
| Check bridge and patch status | `bun cli.ts status` (no keys are printed) |
| Run the bridge in the foreground (debug) | `bun cli.ts start`; press `Ctrl+C` to stop |
| Restore patched Cursor files | Close all Cursor windows, then run `bun cli.ts restore --cursor-closed` |
| Providers, models, and Agent key | Manage providers and API keys in Magpie; connect and assign models under **Agent → CCursor** |
| Local state and conversation database | `~/.magpie-ccursor/` (isolated; does not read or import `~/.ccursor`) |
| Connection config file | `~/.magpie-ccursor/connection.json` (written and restored by Magpie) |

> **Security note:** The connection and derived provider files inside `~/.magpie-ccursor/` contain your local gateway key. Never commit those files or paste their keys into an issue or log snippet.

## Troubleshooting and documentation

- **Setup, recovery, and troubleshooting (Chinese):** [docs/setup.md](docs/setup.md)
- **Architecture and runtime boundaries:** [docs/architecture.md](docs/architecture.md)
- **Local development and checks:** [CONTRIBUTING.md](CONTRIBUTING.md)

Running into issues? Please [open an issue](https://github.com/Chekhovin/magpie-ccursor/issues) with your Magpie, Bun, and Cursor versions, reproduction steps, and redacted logs.

## Credits and license

The protocol bridge and client patching logic are adapted from [CometixSpace/CCursor (`fcac85d`)](https://github.com/CometixSpace/CCursor/tree/fcac85db793fc2c8cda3318b96ec5a41c24f5e26). Changes made for Magpie Agent integration are documented in [NOTICE.md](NOTICE.md).

Licensed under [AGPL-3.0-or-later](LICENSE). This is a community-maintained third-party plugin and is not an official release from Cursor, Magpie, or CCursor. It is provided "as is", without warranty of any kind.
