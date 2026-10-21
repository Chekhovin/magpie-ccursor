# Magpie CCursor

**English** · [简体中文](README.md)

Use the models you configured in **Magpie** directly inside **Cursor**: manage model providers, API keys, and usage tracking in Magpie while switching models, chatting, and running Agent tasks in Cursor.

[AGPL-3.0-or-later](LICENSE) · Based on [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)

`magpie-ccursor` is a CCursor Agent plugin built for Magpie. It runs a lightweight local protocol bridge (`127.0.0.1:39831`) that forwards Cursor's model requests to your local Magpie gateway, which then routes them to your configured providers. Model usage is billed by the providers you configure in Magpie.

```text
Cursor → Local CCursor bridge (127.0.0.1:39831) → Magpie gateway → Model providers
```

## Quick start

Installing the plugin in Magpie also installs the Cursor client hooks automatically. You do not need to clone the repository or run setup commands:

1. Add `github:Chekhovin/magpie-ccursor` on Magpie's plugin page.
2. Open **Agent → CCursor**, enable the connection, and select the models you want to use.
3. Start Cursor and choose a model from the model picker. If Cursor was open when you installed the plugin, restart it once to load the hooks, then send a test message:

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

### Step 2: Enable the Agent and open Cursor

When Magpie first loads the plugin, it finds your local Cursor installation, backs up the original files, and installs the client hooks. Existing complete hooks are reused. Once setup finishes, enable **Agent → CCursor** in Magpie, assign models, and start Cursor. If Cursor is already open, restart it once.

If setup fails, the plugin rolls back the changes and reports the reason in Magpie's plugin logs. After a Cursor update, it checks the hooks again and creates a new backup before patching an eligible clean version. For custom installation paths or write permissions, see the [Setup and recovery guide (Chinese)](docs/setup.md).

#### Already using upstream CCursor

Stop the original CCursor server and disable its auto-start to prevent a conflict on port `39831`. You can keep the original installation files. Complete client hooks that point to the default `127.0.0.1:39831` address can still be used.

For details on existing installations, custom ports, and patch compatibility, see the [Setup and recovery guide (Chinese)](docs/setup.md).

## Commands and configuration

From a local clone of this repository, you can use `bun cli.ts` (requires [Bun](https://bun.sh) `>= 1.3.0`) to check status, debug in the foreground, or restore modified Cursor files:

| Action or setting | Command / details |
| --- | --- |
| Check bridge and patch status | `bun cli.ts status` (no keys are printed) |
| Run the bridge in the foreground (debug) | `bun cli.ts start`; press `Ctrl+C` to stop |
| Retry client setup manually | Close all Cursor windows, then run `bun cli.ts setup --cursor-closed` |
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
