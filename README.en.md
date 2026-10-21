# Magpie CCursor

**English** · [简体中文](README.md)

Use the models you configured in **Magpie** directly inside **Cursor**: manage model providers, API keys, and usage tracking in Magpie while switching models, chatting, and running Agent tasks in Cursor.

[AGPL-3.0-or-later](LICENSE) · Based on [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)

`magpie-ccursor` is a CCursor Agent plugin built for Magpie. It runs a lightweight local protocol bridge (`127.0.0.1:39831`) that forwards Cursor's model requests to your local Magpie gateway, which then routes them to your configured providers. Model usage is billed by the providers you configure in Magpie.

```text
Cursor → Local CCursor bridge (127.0.0.1:39831) → Magpie gateway → Model providers
```

## Quick start

Installing the plugin in Magpie also sets up the Cursor client hooks automatically—no need to clone the repository or run `setup` commands for normal use. Everything is configured right under **Agent → CCursor** in Magpie, with no separate CCursor setup page:

1. Add `github:Chekhovin/magpie-ccursor` on Magpie's plugin page.
2. Open **Agent → CCursor**, enable the connection, and select the models to assign to Cursor.
3. Open Cursor and pick a model from the model picker (if Cursor was running while you installed or updated the plugin, quit it completely and reopen it so the hooks load), then send a test message:

   > Reply only with "Connected successfully".

Keep Magpie running while you use Cursor:

- Assigned models sync to both the standard IDE window and the Agents Window. Changing model assignments in Magpie updates Cursor automatically, and updating the plugin keeps your existing model selections.
- Cursor's **Auto** uses the default model assigned by Magpie. You can also choose a specific model in the picker.
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

When Magpie first loads the plugin, it locates your local Cursor installation, backs up the original files, and installs the client hooks. All configuration lives in **Agent → CCursor**—once enabled with models assigned, open Cursor to start using them. If Cursor was running during plugin installation or update, quit Cursor completely and reopen it.

Earlier hooks backed up and managed by this plugin are upgraded automatically. If setup fails, the plugin rolls back the changes and reports the reason in Magpie's plugin logs. After a Cursor update, it checks the installation again and backs up and patches an eligible clean version. For custom installation paths or write permissions, see the [Setup and recovery guide (Chinese)](docs/setup.md).

#### Already using upstream CCursor

Stop the original CCursor server and disable its auto-start to avoid a conflict on port `39831`; you can keep its installation files. Upstream client patches may not be compatible with this plugin. If the logs report incomplete patches or an upgrade that cannot proceed safely, restore them using the original installation's recovery method, or use a clean Cursor installation, then let this plugin set it up automatically.

For details on existing upstream installations, custom ports, patch compatibility, and recovery, see the [Setup and recovery guide (Chinese)](docs/setup.md).

## Commands and configuration

You do not need the CLI for everyday use. For troubleshooting, foreground debugging, or manual recovery from a local clone of this repository, use `bun cli.ts` (requires [Bun](https://bun.sh) `>= 1.3.0`):

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
