# Verification record

Date: 2026-10-21. Source baseline: CCursor `fcac85db793fc2c8cda3318b96ec5a41c24f5e26`.

## Executed locally

Windows, using the actual Bun 1.4.3 binary shipped in the local Magpie cache:

```sh
bun test ./tests
```

Result: **21 tests passed, 0 failed** across four files.

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

One initial full run failed in the rollback fixture. The focused test then passed, 20 repeated adapter runs passed, and the final full run passed. The original run's filtered output did not retain the underlying exception, so no root cause is claimed. This remains a Windows filesystem timing uncertainty to watch; it is not represented as a diagnosed fix.

## Official host boundary

The separately downloaded official `internal/plugin/host.js` was run using:

```sh
bun scripts/host-smoke.ts /path/to/official/host.js
```

It successfully loaded this package, started the bridge in a temporary home with a fixture key, recovered after terminating the bridge child, and released the bridge after host stdin closed. No live Magpie profile was modified. Official `internal/agent/plugged.go` was inspected to verify `connect()` values are written and stashed/restored on disconnect; the desktop Agent UI was not exercised.

## Not yet verified

- Installation from the Magpie desktop plugin UI and a real Cursor conversation.
- Applying/restoring the patch functions against an actual Cursor installation; snapshot behavior uses fixtures.
- Every tool, image, reasoning model and Cursor version supported by upstream.
- Cancellation for other vendored provider classes. This plugin currently routes through `openai-chat`, whose cancellation is covered.
- Web-to-Markdown: upstream optional `supermarkdown` native platform packages returned 404 during dependency installation.
- Full upstream test suite. It contains installed-Cursor probes and is intentionally excluded from this package's test command.

The GitHub CI checks Windows and Linux after publication; its results must be read separately from the local results above. Unit tests and fixture success do not establish real-client compatibility.
