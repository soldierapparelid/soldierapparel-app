# Identity-only access and retained revocation candidate

This increment accepts the separately reviewed initial identity v2 through a
new validator, not a relaxation of the initial-only codec or v1 production
validator. Its exact root contains initialization, catalog, grants and an
optional private enrollment registry. No products, cycles, ledgers, tariffs,
wages or aliases are synthesized. Initial owner provenance, the sole active
owner grant at revision 1, and catalog revision 1 are retained by every pure
transition. This validator establishes internal consistency, not provenance
against an independent external anchor or production Auth proof.

The structural registry inspector has no grant or membership authority. The v2
validator separately requires each approved sewing worker in the reviewed
Jahit catalog. QC has no worker binding. Potong, owners, mixed modules, numeric
storage keys, orphan grants and duplicate retained identities are rejected.
Claimed grants exactly match retained reviewed profiles at revision 1. A
revoked claim retains UID, Google subject, worker and original claim, with an
inactive grant at revision 2. Reassignment, edits and reactivation are not
implemented. A future lifecycle must retain those reservations and increase
observable grant revisions when access changes.

First claims require an exact approved email and a five-minute verified
identity. Existing exact UID/Google claims take precedence over email; a partial
match denies without falling back. An approval's eight-per-minute admission
counter persists across service instances and replay does not change a grant.
The enrollment service validates and commits the whole fixed tenant in one
compare-and-set, preserving initialization, catalog and unrelated approvals.
Lost acknowledgments remain unknown until a fresh verified enrollment replay.

Revocation is currently a pure transition, not a production writer or HTTP
endpoint. The caller must already be authorized by a future independently
reviewed owner service. Commands contain request ID, approval ID, exact approval
revision and, for a claimed approval, exact grant revision. A strict receipt is
retained in the selected approval; it records the original revisions and time.
Only the same command can replay after an uncertain acknowledgment, with no
second revision increase. A different command, reused request ID, wrong
revision or attempt to remove the retained identity denies. Pending revocation
creates no grant. Receipts are bounded by the 128 approval limit.

Access reads dispatch by schema: the adapter's self grant reader, enrollment,
ordinary session and isolated stored-history reader can validate v2. Reads of
a nonowner require the signed Google subject to match the retained
claim together with the UID, even if a replacement provider uses the same UID.
Production cycle reads, tariff selection, command transactions and owner tariff views still
require v1. A v2 session exposes only this caller and empty cycle/label arrays;
it does not expose registry, catalog or imply an operational app. History
requires reviewed same-snapshot worker/division membership and fingerprints
initialization and catalog revision across its existing Auth/data fences.
Original totals remain unchanged; no calculation or payment action is added.

The package explicitly copies both required identity modules so deployed code
cannot fail from a missing dependency. Source configuration remains OFF. The
history service remains isolated, without HTTP/UI/runtime wiring. Existing
self-grant Rules do not yet admit v2; all Rules and the live legacy application
remain unchanged. That intentional release gate still requires reviewed v2
self-grant Rules, an owner-authenticated revocation writer, create-only owner
bootstrap/recovery, private namespace protection before any real seed or
archive write, real Auth tests and a coordinated ongoing-work migration.

The local tests use synthetic identities and injected SDK/Auth interfaces.
The separate genuine Admin 14.5.0 fixture uses only a demo RTDB emulator,
loopback URL and fixed fake emulator credential, with real credential overrides
and an Auth emulator forbidden. It exercises actual JSON roundtrips,
enrollment CAS, persisted quota, retained revocation storage and access reads.
Its revocation CAS is test-owned, not evidence of a production owner service;
its Auth checks are injected and cannot prove real Google login. No production
write, migration, billing activation or main installation follows from tests.
