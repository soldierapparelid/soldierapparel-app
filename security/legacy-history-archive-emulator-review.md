# Isolated archive SDK rehearsal

`legacy-history-archive-emulator.test.cjs` uses pinned Admin SDK 14.5.0,
Node 22+, and the Database emulator at exactly `127.0.0.1:9000` under
`demo-soldier-security`. It supplies an explicit synthetic emulator credential;
it initializes no Auth handle and does not use ADC or a real token. Startup and
cleanup validate the demo environment and a per-test archive namespace. It
changes only synthetic archive fixtures and removes only that namespace.

The seven cases cover actual SDK storage and retrieval through the preparer,
publisher and loader: retained null/absence/zero/types/empty lists and own-worker
projection, an unavailable versus known-empty source, exact replay and conflict,
competing same-version transactions, an independently rehashed replacement
rejected by the trusted loader proof, and resolution after a committed write
loses its acknowledgement. Another callback test temporarily changes the
emulator environment and restores it: the publisher must retain the observed
failure for that operation, and a separate resolve must check binding anew.

Fault injection decorates a genuine Database `ref` and genuine Reference
`transaction`; it keeps the actual reference URL, reads, SDK transaction,
snapshots and store. Injected acknowledgement/environment faults model those
boundaries; they are not evidence of a real network failure or Google Auth.
The comparison with a raw-object write demonstrates actual RTDB pruning while
the canonical JSON string envelope retains the selected stored values exactly.
Quantities and rates never recompute or repair stored totals.

The existing Rules workflow includes this fixture. Its result must be checked
on the exact candidate commit before citing a passing genuine SDK rehearsal;
source review and syntax checking alone are not execution evidence. These
tests prove neither production publication, operator/publisher identity,
immutability against another Admin writer, concurrent production cutover,
current authorization, wire/log privacy, nor preservation of unselected data.
Publisher results keep `immutableStoreProven`, `authorizationGranted`,
`legacyAdopted` and `readyForProduction` false. Runtime, routes, Rules and main
remain unchanged. Production activation still needs a reviewed private proof,
authorized operator and fixed scope, server access/logging review, a canonical
catalog and grants, and a coordinated migration with rollback.
