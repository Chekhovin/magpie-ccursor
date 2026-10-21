# Contributing

Use Bun 1.3 or newer. Installation must work without lifecycle scripts, matching Magpie's GitHub plugin installation:

```sh
bun install --frozen-lockfile --ignore-scripts
bun test ./tests
bun run check
```

`tests/` uses temporary directories, loopback fixtures and no production credentials. Do not replace these fixtures with a personal Magpie endpoint. `vendor/server/tests/` is retained upstream material, not the package's test suite; some upstream tests search installed Cursor paths and must not be included in the isolated test command.

To check the actual Magpie host boundary, obtain `internal/plugin/host.js` from the official Magpie repository, then run:

```sh
bun scripts/host-smoke.ts /path/to/official/host.js
```

This command creates a temporary home, uses a mock gateway address with a fixture key, and needs port 39831 to be free. It checks official host loading, child recovery, and cleanup. It does not install the plugin into your live Magpie profile.

The CLI offers a foreground diagnostic mode (`bun cli.ts start`). Keep the original CCursor server stopped before using the default port.

## Change boundaries

- Prefer small adapters around vendored protocol code.
- Preserve upstream license notices and record changed vendored files in `NOTICE.md`.
- Keep all GitHub-loadable source files in the repository; no postinstall builds.
- Do not commit `connection.json`, `providers.json`, SQLite files, logs or personal configuration.
- Test cancellation, disconnect and restart when changing lifecycle code.
- Verify README links and commands. User instructions belong in README/docs; release and implementation notes belong here.

## Publishing

The root `package.json` is the installation entry. The GitHub topic `magpie-plugin` allows discovery in Magpie's unofficial plugin list. A GitHub push is sufficient for this distribution path; npm publication is not required.

Run the checks above before publishing, review `git diff --cached`, and verify a fresh checkout installs with scripts disabled. Keep release claims aligned with [verification.md](docs/verification.md), especially when real Cursor/Magpie testing is still pending.
