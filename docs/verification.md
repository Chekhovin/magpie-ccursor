# Verification record

## 0.3.0 upstream synchronization (2026-11-02)

The fresh upstream snapshot `c110c6e8ae34f785bca453c163bc113993f19b70` identifies CCursor 0.0.16 and the Cursor 3.27.22 protocol update. See the [integration comparison](upstream-0.0.16.md) for applied changes and deliberate Magpie adaptations.

Final local Bun 1.4.3 run: **144 tests passed, 0 failed, 1,105 assertions across 14 files**. A real 3.27.22 copy reconstructed with committed plugin 0.2.6 upgraded successfully, retained clean backups, made no changes on a repeat, and restored all 59 target hashes. Read-only reviews passed. Tests also reject missing/malformed Connect end frames and cover bounded Windows atomic-rename retries.

The live installation had unrecorded changes to both renderer bundles and product metadata, including Chinese localization. Its files were not treated as an intact plugin snapshot or overwritten by the isolated tests. Local deployment and live UI results must be recorded separately; passing file-copy tests do not remove that ownership check.


Date: 2026-10-21. Source baseline: CCursor `fcac85db793fc2c8cda3318b96ec5a41c24f5e26`.

## Executed locally

Windows, using the actual Bun 1.4.3 binary shipped in the local Magpie cache:

```sh
bun test ./tests
```

Result for **0.2.4**: **73 tests passed, 0 failed**, with 510 assertions across eight files.

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
| Concurrent operations | In 0.2.4, setup and restore shared an exclusive file lock and required manual abandoned-lock review. The 0.2.6 recovery changes are recorded below. Ready-only inspection remains lock-free; detected external version changes preserve updater files |
| Protocol selection | Actual desktop/glass capability method shapes select Connect when BYOK is enabled and restore official gates when disabled; a single routes SSE connection updates the choice |
| Default model | Cursor's reserved `default` uses the assigned default exposed by all feature configs and `GetDefaultModel`; explicit IDs retain precedence and unknown IDs are rejected. Both explicit and Auto requests traverse real RunSSE/BidiAppend to mock OpenAI SSE |
| Window catalog | Captured services synchronize models, picker display and feature defaults from a marked bridge response; tests cover stale overwrite repair, shared storage, own-key cache, OFF/disconnect restoration, late replies, empty catalogs, malformed hooks and upgrade idempotency |
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

For 0.2.4, the ordinary IDE visibly showed 58 assigned models while the Agents window showed only Auto. Read-only DevTools inspection confirmed the Agents service and picker still held 46 official models; the active bridge and global database held 58 assigned models. This establishes stale window state, not which internal writer caused it. The renderer now synchronizes each captured service's catalog, display configuration and feature defaults using the normal reactive APIs. It only accepts a response carrying the bridge catalog header and BYOK display contract, and restores the earlier state on disconnect or BYOK OFF. A Cursor 3.26.13 copy with 0.2.3 hooks upgraded successfully, retained the original backups, made no changes on repeated setup, and restored all 9 original file hashes.

Official `internal/agent/plugged.go` was inspected to verify `connect()` values are written and stashed/restored on disconnect; the desktop Agent UI was not exercised.

## Not yet verified

- Installation from the Magpie desktop plugin UI and a real Cursor conversation.
- Applying/restoring on other Cursor versions and macOS application-signature behavior.
- Every tool, image, reasoning model and Cursor version supported by upstream.
- Cancellation for other vendored provider classes. This plugin currently routes through `openai-chat`, whose cancellation is covered.
- Web-to-Markdown: upstream optional `supermarkdown` native platform packages returned 404 during dependency installation.
- Full upstream test suite. It contains installed-Cursor probes and is intentionally excluded from this package's test command.

The GitHub CI originally checked Windows and Linux; 0.2.6 also includes macOS. Results must be read separately from the local results above. Unit tests and fixture success do not establish real-client compatibility.

## 0.2.5 documentation and page removal

After the 0.2.4 deployment, the user confirmed that the reported Agents-window problem was resolved. This is user-reported confirmation; it does not add coverage for every model or tool.

Version 0.2.5 updates both READMEs and removes the standalone Magpie page registration and all three page assets. Agent and server registration remain. Package-entry and documentation-link checks, bilingual structure/command/link parity, and a package dry run passed; the package contains both READMEs and no page files. The official host smoke test passed without a page registration, including automatic Cursor setup, bridge recovery and shutdown. Runtime behavior is unchanged apart from the versioned User-Agent string; the 73-test result above belongs to 0.2.4.

## 0.2.6 update recovery (2026-10-31)

Windows with Magpie's Bun 1.4.3: **119 tests passed, 0 failed, 847 assertions across ten files**. Package entry and documentation-link checks passed. The initial full-suite runner was stopped by a 55-second harness timeout after 91 passing checks and no assertion failures; the subsequent recorded run completed in 63.55 seconds with exit code 0.

New process-level cases kill a CLI after its `applying` manifest is committed but before target writes, then verify automatic recovery and preservation of the interrupted record and original backups. Killing after an unrecorded target change remains blocked without further writes. Restore is interrupted both before and after its first target copy; the durable manual intent prevents automatic reapplication, and explicit restore finishes safely.

The lock tests cover separate processes, two competing recoverers, forced exit, an old writer winning the file-lock race, fixed-port collisions, directory aliases, malformed/live owners, PID probe errors, and incomplete temporary cleanup. Automatic setup retries a busy guard with unchanged files, including across daemon restarts. A controlled race verifies that manual restore winning before automatic lock acquisition leaves the installation paused. Invalid/missing/duplicate entries, corrupt backups, checksum failures, changed targets and cross-version interrupted snapshots stay blocked.

A separate **Cursor 3.27.22** copy (59 patch targets plus two package metadata files) was built from verified original backups. A real child was terminated after committing the recovery manifest; the new reconciler archived the abandoned owner and recovered to `ready`. Repeated setup changed nothing; restore returned every target to its original hash, and interrupted history was retained. This release does not require a Glass product checksum because the actual version omits it; tests still reject mismatched provided checksums and altered Glass bytes. The full real-copy harness exceeded its 55-second tool limit after reaching `ready`; a continuation verified the same sandbox's no-op and restore behavior, then removed it. No live Cursor file was changed by these tests.

Independent read-only reviews found no blocking issues. These results cover process termination, not power-loss durability or arbitrary future Cursor protocol changes. A clean completed Cursor update receives its own snapshot as before; automatic recovery of an interrupted older-version snapshot remains deliberately unsupported. CI results and local deployment must be checked separately. The first macOS CI run exposed an existing test that assumed `readdir` order; it compared the same two files in a different order. Those assertions now sort the names: macOS first exposed this in the renderer preflight test, and Linux exposed it in the malformed-owner parameterized cases. The matrix runs all platforms to completion even when one fails.

