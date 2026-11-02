# Source and modification notice

This project contains code from **CometixSpace/CCursor (Cursor++)**, licensed under **GNU Affero General Public License v3.0 or later**. The complete upstream license is in [LICENSE](LICENSE). Original notices in source files are retained. There is no warranty.

- Upstream: https://github.com/CometixSpace/CCursor
- Current upstream snapshot: `c110c6e8ae34f785bca453c163bc113993f19b70` (extension and installer **0.0.16**)
- Original adaptation baseline: `fcac85db793fc2c8cda3318b96ec5a41c24f5e26` (**0.0.15**, 2026-10-21)
- Fresh upstream download and update: **2026-11-02**. GitHub has no `v0.0.16` release tag; the exact merge commit above identifies this version. Later 0.0.17 changes are excluded.
- Public corresponding source for this adaptation: https://github.com/Chekhovin/magpie-ccursor

`vendor/server` originated from `Cursor++/src/server`. `vendor/installer` originated from `installer/src`. These copies came from a new Git clone, not from a locally installed CCursor. No personal credentials or user configuration were copied.

Modifications replace the Cursor-specific SQLite binding with Bun SQLite, isolate data paths, manage standalone lifecycle and file watchers, close sessions and streams, clear caches between runtime instances, and identify the bridge in `/health`. New Magpie Agent/server entry points, lifecycle supervision, automatic client setup with transactional backups, update recovery, documentation and isolated tests were added. Installer defaults use `.magpie-ccursor`, and installer backups have a separate prefix. The 0.0.16 sync brings Cursor 3.27.22 protocol definitions, Agent Window RPC routing, per-turn Agent Host Connect selection, HTTP/1.1 router V3, and idempotent BYOK mode requests. Magpie-specific adaptations preserve catalog source verification and cancellation, prefer explicitly assigned model IDs, refuse fallback to disabled models, and upgrade recorded complete older hooks without discarding original backups.

The source listing and per-file SHA-256 comparison with the fresh upstream snapshot are recorded in [docs/upstream-changes.json](docs/upstream-changes.json). This records the modified and unchanged vendored files without copying installed software or user data.

README structure follows the separately downloaded [tommy0103/better-readme-skill](https://github.com/tommy0103/better-readme-skill). The skill itself is not redistributed in this package.

Cursor, Magpie, and CCursor are names of their respective projects. This adaptation is not an official release from those projects.
