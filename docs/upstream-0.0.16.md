# CCursor 0.0.16 integration

Plugin release: **0.3.0**. Fresh upstream source: [c110c6e8ae34f785bca453c163bc113993f19b70](https://github.com/CometixSpace/CCursor/tree/c110c6e8ae34f785bca453c163bc113993f19b70), compared with the original `fcac85db793fc2c8cda3318b96ec5a41c24f5e26` baseline. Both upstream package manifests declare `0.0.16`. GitHub did not publish a matching release tag; later `0.0.17` commits are outside this update.

## Comparison and integration

| Upstream change | Magpie integration |
| --- | --- |
| Four generated protobuf modules updated for Cursor 3.27.22 | Copied from the fixed upstream snapshot, including shared enum imports and removal of the obsolete BackgroundComposer handler |
| Default model selection and request aliases | Shared selection for model catalog, feature defaults, GetDefaultModel and RunSSE; supports `default`, `auto` and empty choices |
| HTTP/1.1 ServerConfig | Sends `FORCE_ALL_DISABLED` while BYOK routes reach the bridge |
| REST and ConnectRPC route events | Both sets are sent on connection and change, using the existing SSE channel |
| Delayed model refresh | Adds one settled refresh after mode changes, so an earlier official response does not become the final catalog |
| Idempotent BYOK toggle | Adds target-value `/byok/mode`; keeps debounced legacy `/byok/toggle` |
| Agent Window renderer routes | Adds locally routed unary and server-streaming Connect calls with response headers, trailers and error handling |
| Agent Host per-turn selection | Guards the managed-local eligible branch when the bridge handles RunSSE; OFF retains Cursor behavior |
| Node router V3 | Replaces older payloads and reloads routing before the first request after a change |
| Original extension state/UI changes | Statusbar/webview changes are not installed; their route notification and target-mode semantics are carried by the standalone runtime and renderer |
| Original multi-window extension server ownership | Not copied: Magpie uses its own supervised standalone daemon and bridge lock |

## Preserved adaptations

- Magpie owns credentials and assigned models; the bridge does not import the installed upstream CCursor profile.
- Bun SQLite, isolated state directories, cancellable model requests, window catalog source verification and runtime cleanup remain.
- Exact assigned model IDs have priority over alias interpretation. Only explicitly enabled models are default candidates, and disabled models are not used as a fallback. Magpie already writes `defaultOn: true` for its assigned models.
- A hash-verified plugin snapshot upgrades in place across renderer, always-local and Agent Host patches; it retains pristine backups and rolls a failed upgrade back to the preceding plugin state. Unknown external modifications remain blocked.
- The local stream decoder additionally rejects missing/malformed terminal frames and releases its reader; it does not replay consumed requests.
- Route-mode read/decide/write is serialized, and debounce/timers are reset between standalone runtime instances.
- Windows atomic JSON replacement retries transient `EPERM`/`EBUSY` failures at most five additional times without deleting the original target.

The [per-file source record](upstream-changes.json) lists the retained vendored files and local adaptations. Unused upstream installer entry points, legacy server shims and an unreferenced generated descriptor have been omitted. The upstream Vitest files remain for source comparison; the executed regression suite is the Bun suite under `tests/`, not the installed-Cursor probes in `vendor/server/tests/`.

## Validation

- Windows with Magpie Bun 1.4.3: **144 tests passed, 0 failed, 1,105 assertions across 14 files**.
- Local full protocol tests cover explicit models, `default`, `auto` and an omitted model through RunSSE/BidiAppend to a mock OpenAI stream.
- Offline renderer/Node tests cover RPC route filtering, mode changes, refresh ordering, stream framing/errors, aborts, no replay, V2-to-V3 replacement, helper integrity and complete legacy-hook upgrades.
- A real Cursor **3.27.22** file copy was rebuilt from verified original backups and patched with committed plugin **0.2.6**, then upgraded. All readiness checks passed, repeated setup changed nothing, and restoring matched the original hashes of all **59 targets**. No live Cursor files were changed by this test.
- Independent read-only reviews accepted the upgrade integration and the additional stream/atomic-write fixes. GitHub CI results are tracked separately.

An intermediate full run captured a Windows `EPERM` during atomic snapshot replacement, explaining one previously unclassified intermittent failure. The bounded retry now has separate success, exhaustion and permanent-error tests. This observation does not prove that every earlier intermittent test failure had the same cause.
