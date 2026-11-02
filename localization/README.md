# Cursor zh-CN data

This catalog adds the existing user-authorized Cursor 3.27.22 interface translations to both the standard IDE and Agents Window. It is independent of the CCursor upstream source import.

`zh-CN.json` identifies the original English, legacy localized, and corrected localized renderer hashes. Replacements use UTF-8 byte offsets. The installer only transforms matching **clean backups**, validates every slice and resulting SHA-256, then applies the CCursor hooks normally. It never applies these offsets to injected bundles.

The legacy dataset has 4,800 replacements. Four mutate internal identifiers (`Files` and `Hooks`, in each renderer); these are excluded from new localization but retained for deterministic reversal of existing localized originals. The resulting target retains 4,796 translations. Their wording comes from the existing localization; this is not a claim that all translations have received independent linguistic or behavioral review.

The static product checksum delta and old hook translations are not applied as catalog edits. Product checksums are derived after patching, and the model picker's localized placeholder is handled in the bounded hook payload.

Unknown versions or hashes skip localization without disabling model routing. Use [the localization guide](../docs/localization.md) for the switch and restore semantics.
