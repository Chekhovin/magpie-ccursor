# Verification record

Date: 2026-10-21. Source baseline: CCursor `fcac85db793fc2c8cda3318b96ec5a41c24f5e26`.

## Executed locally

Windows, using the actual Bun 1.4.3 binary shipped in the local Magpie cache:

```sh
bun test ./tests
```

Result for **0.2.3**: **55 tests passed, 0 failed**, with 345 assertions across six files.

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
| Shutdown during setup | A real daemon with its first backup copy delayed by 5.5 seconds completes setup after parent stdin closes, exits successfully, and releases both patch and bridge locks |
| Upgrade and recovery | Clean updates get separate snapshots; partial hooks, checksum mismatches and damaged backups are refused; manual restore pauses automatic setup |
| Concurrent operations | Setup writes and restore share an exclusive patch lock; ready-only inspection preserves existing locks without acquiring one; abandoned locks are not reclaimed automatically; detected external version changes preserve the updater's files |
| Protocol selection | Actual desktop/glass capability method shapes select Connect when BYOK is enabled and restore official gates when disabled; a single routes SSE connection updates the choice |
| Plugin patch upgrade | Recorded old hooks upgrade without replacing clean backups; a failed upgrade restores the old patched files and manifest; malformed BidiAppend receives an error rather than a success ACK |

An initial 0.1.0 full run failed in a rollback fixture, followed by 20 passing adapter reruns. During 0.2.0 integration, one full run also failed in the successful-restore/idempotency fixture; its filtered output did not retain the exception. The adapter suite then passed 30 consecutive runs, and the final 44-test run passed. During 0.2.3 verification the same restore/idempotency fixture failed once, followed by 20 passing targeted reruns and a passing 55-test run. No root cause is claimed for these intermittent failures.

## Official host boundary

The separately downloaded official `internal/plugin/host.js` was run using:

```sh
bun scripts/host-smoke.ts /path/to/official/host.js
```

It successfully loaded this package and installed fixture Cursor hooks **before any Agent configuration existed**. After writing a fixture connection, the bridge started on a random sandbox port, recovered after child termination without creating a duplicate snapshot, and stopped after host stdin closed. All subprocesses explicitly override the Cursor path and home directory. No live Magpie profile was modified by these tests.

The same official host was also tested against a separate copy of the actual **Cursor 3.26.13** application files (9 files, approximately 106 MB). Automatic setup created one snapshot and reported `ready: true`; assigning one fixture model made it appear in `AvailableModels`. After the host and bridge exited, restore returned all 9 files to their original SHA-256 hashes. This version omits the legacy singleton file; a regression test covers that layout.

For 0.2.1, live client logs identified `RunInference` / `local_loop` traffic being decoded as the older Agent protocol. A separate Cursor 3.26.13 file copy was patched with 0.2.0 and then upgraded through the new setup path. Both renderer gate methods selected Connect with BYOK enabled and preserved the official gate result with BYOK disabled. Repeated setup made no changes; restore returned all 9 original file hashes. This validates patch selection and migration, not a completed live model conversation.

During local 0.2.1 deployment, a temporary plugin host exited while setup was running and left a patch lock from a dead process. The applied snapshot and all 60 target and backup hashes still matched. After archiving only that verified stale lock, the resident plugin completed the upgrade: desktop/glass compatibility, `localLoop`, and overall `ready` all passed. Version 0.2.2 waits for the active setup transaction before starting the runtime shutdown deadline, with the delayed-backup test above covering this case. Another short-lived command-line reload left a lock despite that graceful-shutdown fix; a forced termination source was not established. Version 0.2.3 performs snapshot validation and ready-only inspection without acquiring a write lock, and takes the lock only when changes are required. The new test confirms an existing lock and snapshot remain untouched by ready-only inspection.

Official `internal/agent/plugged.go` was inspected to verify `connect()` values are written and stashed/restored on disconnect; the desktop Agent UI was not exercised.

## Not yet verified

- Installation from the Magpie desktop plugin UI and a real Cursor conversation.
- Applying/restoring on other Cursor versions and macOS application-signature behavior.
- Every tool, image, reasoning model and Cursor version supported by upstream.
- Cancellation for other vendored provider classes. This plugin currently routes through `openai-chat`, whose cancellation is covered.
- Web-to-Markdown: upstream optional `supermarkdown` native platform packages returned 404 during dependency installation.
- Full upstream test suite. It contains installed-Cursor probes and is intentionally excluded from this package's test command.

The GitHub CI checks Windows and Linux after publication; its results must be read separately from the local results above. Unit tests and fixture success do not establish real-client compatibility.
