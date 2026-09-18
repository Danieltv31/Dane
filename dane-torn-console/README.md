# Dane Torn Console

Canonical release: Dane-Torn-Console.user.js, currently 8.2.0.

Tampermonkey reads @updateURL and @downloadURL from this public file. Enable script update checks in Tampermonkey. Updating a chat message does not publish a release: maintainers must validate and update the canonical file in this folder. Never change its name, namespace or DTC8 storage prefix casually.

## Release process

1. Read the current canonical source and preserve unrelated modules and account storage.
2. Increment @version and VERSION together.
3. Run npm install, then npm test. Tests use linkedom; its select-value setter is shimmed. These are DOM fixtures, not a live Torn browser test.
4. Review permissions, single-flight requests, caches, routing, unknown data, UI layout, profile isolation and error handling.
5. Publish the complete reviewed source to this same path. Compare published bytes with tested bytes.
6. State any remaining live-site validation limits. Paste the full userscript when delivering it in chat.

## 8.2.0

Moves inline panels outside floated heading containers. Adds pre-fight plans using equipment, mastery levels and stat imbalances, plus post-fight observations and next-fight suggestions. Native Tampermonkey update headers are enabled. No remote eval, auto-attacks, merit spending or selling.

## Privacy

API keys and account snapshots stay in Tampermonkey storage. The published script contains no player key or private account snapshot. An optional, explicitly selected Dane equipment preset is included for backward compatibility.
