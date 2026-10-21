# Verification record

Date: 2026-10-21. Source baseline: CCursor `fcac85db793fc2c8cda3318b96ec5a41c24f5e26`.

## Executed locally

Windows, using the actual Bun 1.4.3 binary shipped in the local Magpie cache:

```sh
bun test ./tests
```

Result for **0.2.0**: **44 tests passed, 0 failed**, with 228 assertions across five files.

| Boundary | Evidence |
| --- | --- |
| Agent mapping | Gateway key ownership marker, empty initial model list, routed model IDs, limits, image capability and reasoning efforts; malformed config fails closed |
| SQLite | Prepared statements, parameter binding, missing rows, rollback, serialized transactions and persistence after restart |
| Cursor protocol | Real ConnectRPC `RunSSE` + `BidiAppend` → upstream orchestrator → SDK → local mock OpenAI SSE; model, auth, request text, response text and checkpoint asserted |
| Cancellation | Mock upstream accepts a request but returns no headers or data; stop closes it and the Cursor stream within two seconds; another data directory restarts without late database writes |
| Updates | Provider file change replaces model mapping, SDK credentials and refresh notifications; routes changes push SSE updates |
| Isolation | New data directory clears prior blob and web-tool caches; no original CCursor config is read |
| Lifecycle | Active SSE shutdown, pending Agent shutdown, immediate port reuse, startup failure cleanup, child natural exit |
| Supervision | Parent pipe shutdown, dual-process handover, stale empty lock recovery, disconnect/reconnect, malformed config shutdown and retry after spawn/exit failures |
| Patches | Failed operation restores originals; interrupted multi-file restore resumes; later unrelated file changes block restore |
| Automatic setup | A managed daemon installs hooks before Agent connection; complete hooks reuse one snapshot; failed targets wait for changes without stopping the bridge |
| Upgrade and recovery | Clean updates get separate snapshots; partial hooks, checksum mismatches and damaged backups are refused; manual restore pauses automatic setup |
| Concurrent operations | Setup and restore share an exclusive patch lock; abandoned locks are not reclaimed automatically; detected external version changes preserve the updater's files |

An initial 0.1.0 full run failed in a rollback fixture, followed by 20 passing adapter reruns. During 0.2.0 integration, one full run also failed in the successful-restore/idempotency fixture; its filtered output did not retain the exception. The adapter suite then passed 30 consecutive runs, and the final 44-test run passed. No root cause is claimed for these intermittent failures.

## Official host boundary

The separately downloaded official `internal/plugin/host.js` was run using:

```sh
bun scripts/host-smoke.ts /path/to/official/host.js
```

It successfully loaded this package and installed fixture Cursor hooks **before any Agent configuration existed**. After writing a fixture connection, the bridge started on a random sandbox port, recovered after child termination without creating a duplicate snapshot, and stopped after host stdin closed. All subprocesses explicitly override the Cursor path and home directory. No live Magpie profile was modified by these tests.

The same official host was also tested against a separate copy of the actual **Cursor 3.26.13** application files (9 files, approximately 106 MB). Automatic setup created one snapshot and reported `ready: true`; assigning one fixture model made it appear in `AvailableModels`. After the host and bridge exited, restore returned all 9 files to their original SHA-256 hashes. This version omits the legacy singleton file; a regression test covers that layout.

Official `internal/agent/plugged.go` was inspected to verify `connect()` values are written and stashed/restored on disconnect; the desktop Agent UI was not exercised.

## Not yet verified

- Installation from the Magpie desktop plugin UI and a real Cursor conversation.
- Applying/restoring on other Cursor versions and macOS application-signature behavior.
- Every tool, image, reasoning model and Cursor version supported by upstream.
- Cancellation for other vendored provider classes. This plugin currently routes through `openai-chat`, whose cancellation is covered.
- Web-to-Markdown: upstream optional `supermarkdown` native platform packages returned 404 during dependency installation.
- Full upstream test suite. It contains installed-Cursor probes and is intentionally excluded from this package's test command.

The GitHub CI checks Windows and Linux after publication; its results must be read separately from the local results above. Unit tests and fixture success do not establish real-client compatibility.
