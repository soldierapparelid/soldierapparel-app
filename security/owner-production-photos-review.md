# Prepared owner photo storage

This candidate retains the original `soldier/produksi/images` and `soldier/productionPhotos` as independent presence/value slots in an optional schema-2 photo envelope. The existing schema-1 migration and trusted rollback remain supported. Working records use their separate server-only wire and ETag.

The generated Rules default to deny all access. An enabled private installation supplies the exact existing owner UID and project. Only a verified Google identity with that UID can read or transact the fixed photo envelope. The owner cannot read or modify working records, the manifest, or another path through this SDK route. Photo root deletion, binding/provenance edits, unknown envelope fields and invalid revision/receipt transitions are denied.

The photo client captures the authenticated Firebase app/user and fixed database reference. ASCII-encoded JSON preserves null, empty objects, arrays, numeric object keys and Unicode. Both byte/digest validation and immutable binding checks precede use. A separate scoped IndexedDB journal retains the exact request before dispatch. A cached value or cached receipt cannot confirm a save: an authenticated native transaction must return a committed acknowledgment with a validated retained receipt. Retries reuse the prepared command and never repeat the original updater.

The bounded ledger retains at most 128 receipts and does not evict them automatically. Exhaustion stops new writes and preserves the pending draft. This limit and the configured photo wire capacity require an explicit maintenance decision; they do not promise unlimited storage or service usage.

Legacy parent reads may compose business records and owner photos. A business-only change proves photos unchanged before excluding them from its server command; a photo-only change uses the fixed SDK transaction. A change that modifies both business records and photos is held visibly before either write. This candidate does not claim a single atomic transaction across the two partitions. Original drafts are retained.

Pure/fake-SDK tests and the fresh genuine Firebase SDK/Rules emulator fixture are separate evidence. Source defaults remain OFF; preparing these files does not install Rules, migrate production, enable billing, or prove a production owner session. Photos are enabled in a page only through its reviewed fixed configuration after the owner business read has been verified.
