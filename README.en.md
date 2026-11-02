# Magpie CCursor

**English** · [简体中文](README.md)

Use the models you manage in **Magpie** directly inside **Cursor**: configure model providers, API keys, and usage tracking in Magpie while switching models, chatting, and running Agent tasks in Cursor.

`magpie-ccursor` is a CCursor Agent plugin built for Magpie. It runs a lightweight local protocol bridge (`127.0.0.1:39831`) that forwards Cursor's model requests to your local Magpie gateway, which then routes them to your configured providers. Model usage is billed by the providers you configure in Magpie.

```text
Cursor → Local CCursor bridge (127.0.0.1:39831) → Magpie gateway → Model providers
```

## Quick start

> **Before installing (Important):** Please open the **Cursor client and sign in to your official account first** before installing the Magpie CCursor plugin. If the plugin is installed while Cursor is still signed out, completing authorization in the browser may leave the client stuck in an unauthenticated state. If you run into this, see [Cursor stays unauthenticated after browser sign-in](#cursor-stays-unauthenticated-after-browser-sign-in).

After installation in Magpie, the plugin automatically checks and sets up a compatible Cursor client. For everyday use, there is no need to clone the repository, install Bun separately, or run `setup` commands:

1. Add `github:Chekhovin/magpie-ccursor` on Magpie's plugin page, or install it via the Magpie CLI:

   ```sh
   magpie plugin add github:Chekhovin/magpie-ccursor
   ```

2. Open **Agent → CCursor**, enable the connection, and select the models to assign to Cursor. If CCursor does not appear immediately after installation, manually refresh the Magpie page. The optional **Cursor Chinese interface** switch is at the **bottom of the Agent page** and enabled by default.
3. Open Cursor and pick a model in the model picker (if Cursor was running while you installed or updated the plugin, quit it completely and reopen it first so the hooks load), then send a test message:

   > Reply only with "Connected successfully".

For everyday use, keep the following in mind:

- **Keep Magpie running:** The local bridge runs alongside Magpie's plugin host. Disabling the CCursor connection in Magpie stops the bridge; re-enabling it starts the bridge again.
- **Automatic model sync:** Assigned models sync to both the standard IDE window and the Agents Window. Changes in Magpie update automatically, and plugin updates preserve your existing assignments.
- **Default model and usage tracking:** Cursor's **Auto** mode and new conversations without an explicit model choice use the first enabled model assigned by Magpie. Model requests authenticate with CCursor's dedicated Agent key so usage is tracked under that Agent.

## Client setup and updates

Magpie's built-in Bun runtime loads the plugin directly. On first load, the plugin locates your local Cursor installation, backs up the original files, and installs the client hooks automatically.

- **Plugin and client updates:** Hooks managed by this plugin upgrade automatically when the plugin updates. After a Cursor update, keep Magpie running so the plugin can back up the new files and reapply compatible hooks, then quit Cursor completely and reopen it.
- **Compatibility safeguards:** Client hooks only apply to supported Cursor builds rather than all Cursor versions universally. If a newer Cursor release changes its internal interfaces or client files were modified externally, the plugin preserves its backups and logs the reason without overwriting the new installation with older files.
- **Custom installation path:** If Cursor is installed in a non-default location, set the `CCURSOR_CURSOR_ROOT` environment variable for Magpie pointing to Cursor's `resources/app` directory.

For custom paths, write permissions, interrupted setup recovery, and compatibility details, see the [Setup and recovery guide (Chinese)](docs/setup.md).

### Already using upstream CCursor

Stop the original CCursor server and disable its auto-start to avoid a conflict on port `39831`; you can keep its installation files. Upstream client patches may not be compatible with this plugin. If logs report incomplete patches or an unsafe upgrade, restore the client files using the original installation's recovery method (or start from a clean Cursor installation) before letting this plugin set it up automatically. See the [Setup and recovery guide (Chinese)](docs/setup.md).

## Chinese interface switch

The **Cursor Chinese interface** switch at the **bottom of Magpie's Agent page** is enabled by default and translates the sidebar, settings, and related UI across both the standard IDE window and the Agents Window:

- **Independent and persistent toggle:** Turning the switch off saves `false` persistently across Magpie restarts and plugin updates. It removes only the plugin's UI translations while leaving model hooks, assigned models, and conversation history intact. After saving, wait for background setup to finish, then quit Cursor completely and reopen it.
- **Localization compatibility:** Bundled translations apply only to Cursor builds whose version and original file hashes match the verified catalog. Unmatched builds skip localization; skipping translation does not itself disable model routing, though the client hooks must still be compatible with Cursor. If files were modified externally, the plugin may stop setup and retain its backups.
- **Difference from language packs and `restore`:**
  - Any installed VS Code Chinese language pack is managed separately and is not removed by this switch, so the base editor may remain in Chinese.
  - Turning off this switch only removes the plugin's translation layer while keeping model hooks active, whereas running `bun cli.ts restore --cursor-closed` restores the initial `.original` client backups and pauses automatic setup.

If the interface does not change as expected after restarting Cursor, check Magpie's plugin logs or run `bun cli.ts status`. For compatibility scope and recovery details, see the [localization and recovery notes (Chinese)](docs/localization.md).

## Commands and configuration

You do not need the CLI for everyday use. For troubleshooting, foreground debugging, or manual recovery, install [Bun](https://bun.sh), then clone the repository and install its dependencies as shown in the [setup and recovery guide](docs/setup.md). Run `bun cli.ts` from the repository directory:

| Action or setting | Command / details |
| --- | --- |
| Check bridge and patch status | `bun cli.ts status` (inspects the bridge, client patches, and automatic setup state; prints no keys) |
| Run the bridge in the foreground (debug) | `bun cli.ts start`; press `Ctrl+C` to stop |
| Retry client setup manually | Close all Cursor windows, then run `bun cli.ts setup --cursor-closed` (also re-enables automatic setup after a manual `restore`) |
| Restore patched Cursor files | Close all Cursor windows, then run `bun cli.ts restore --cursor-closed` (restores initial backups and pauses automatic setup) |
| Additional Cursor translations | **Bottom of Magpie's Agent page → Cursor Chinese interface** (enabled by default; synced to `~/.magpie-ccursor/plugin-options.json`) |
| Providers, models, and Agent key | Manage providers and API keys in Magpie; enable connection and assign models under **Agent → CCursor** |
| Local state and conversation database | `~/.magpie-ccursor/` (isolated; does not read or import `~/.ccursor`) |
| Connection config file | `~/.magpie-ccursor/connection.json` (written and restored automatically by Magpie) |

> **Security note:** The connection and derived provider files inside `~/.magpie-ccursor/` contain your local gateway key. Never upload those files or paste their keys into an issue or log snippet.

## Troubleshooting and documentation

### Cursor stays unauthenticated after browser sign-in

**Symptom:** The plugin was installed before signing in to an account in the Cursor client; after installing and enabling the plugin, clicking sign-in in Cursor and completing official authorization in the browser still leaves the Cursor client stuck waiting to sign in.

**Possible cause:** When BYOK routing is enabled by default (`byokMode: 1`), the route configuration file `~/.magpie-ccursor/routes.json` (`%USERPROFILE%\.magpie-ccursor\routes.json` on Windows) includes `"REST:/auth/poll"` in its `redirect` array. This rule redirects Cursor's login-polling requests to the local protocol bridge (`127.0.0.1:39831`), whose local endpoint returns placeholder login data, which can prevent the client from receiving the real browser authorization result (though network, proxy, or account issues can also prevent sign-in independently).

**Resolution (no need to reinstall or re-sign Cursor):**

1. **Keep the bridge online:** Keep Magpie running and make sure the **Agent → CCursor** connection remains enabled so the local protocol bridge stays online.
2. **Back up the route file:** Back up the route configuration file before editing:
   - macOS / Linux: `~/.magpie-ccursor/routes.json` (for example, copy it to `~/.magpie-ccursor/routes.json.bak`)
   - Windows: `%USERPROFILE%\.magpie-ccursor\routes.json` (`$HOME\.magpie-ccursor\routes.json` in PowerShell)
3. **Remove only the login-polling rule:** Open `routes.json` in a text editor, remove **only `"REST:/auth/poll"`** from the `redirect` array, and save the file:
   - Clean up any extra comma so the file remains **valid JSON** (if the JSON syntax is invalid, the protocol bridge may fall back to default routes, causing `"REST:/auth/poll"` to take effect again).
   - **Do not** remove other rules in `redirect` (such as `agent.v1.AgentService/*`, `aiserver.v1.*`, etc.), **do not** modify `byokMode` (keep it set to `1`), and never share or paste keys from other files under `~/.magpie-ccursor/` when reporting issues.
4. **Retry sign-in and verify:** Saving `routes.json` hot-reloads the routing rules automatically. Wait a moment for the reload, then return to Cursor, initiate sign-in again, complete authorization in your browser, and check whether the client is now signed in (if sign-in still fails, check for other causes such as network connectivity or account status). Your BYOK models and Agent routing rules remain active.

> **Note:** Switching BYOK mode rebuilds the `redirect` array, and re-enabling BYOK (`byokMode: 1`) will add `"REST:/auth/poll"` back. If browser sign-in stops completing again after a plugin update or mode change, re-check the `redirect` array in `routes.json`.

### Further documentation

- **Setup, recovery, and troubleshooting (Chinese):** [docs/setup.md](docs/setup.md)
- **Chinese interface switch and compatibility notes (Chinese):** [docs/localization.md](docs/localization.md)
- **Architecture and runtime boundaries:** [docs/architecture.md](docs/architecture.md)
- **Local development and checks:** [CONTRIBUTING.md](CONTRIBUTING.md)

Running into issues? Please [open an issue](https://github.com/Chekhovin/magpie-ccursor/issues) with your environment details, reproduction steps, and redacted logs.

## Credits and license

- The protocol bridge and client patching logic are adapted from [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor). Changes made for Magpie Agent integration are documented in [NOTICE.md](NOTICE.md).
- Cursor interface localization references [rongwei-lab/cursor-chinese](https://github.com/rongwei-lab/cursor-chinese).
- Licensed under [AGPL-3.0-or-later](LICENSE). This is a community-maintained third-party plugin and is not an official release from Cursor, Magpie, or CCursor. It is provided "as is", without warranty of any kind.
