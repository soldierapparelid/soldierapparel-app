# Prepared live own finance reader

`server/production-legacy-finance.cjs` is a pure read candidate, OFF by default.
It calls the compatible operation core's validated v2 identity capture and strict
whole-root descriptor codec. Its identity argument must already come from a
trusted Google verifier; this module does not verify a token, connect an SDK,
install Rules, change grants, calculate a bank payment or deploy anything.

The factory takes the same fixed binding/clock/reviewed policy as compatible
operations. `read({root,identity})` returns a bounded, frozen own DTO or a fixed
error. The binding contains only the caller's scope/UID, worker, division and
grant revision. No worker, date range, source path or monetary selector exists.
Other identities, tokens, provider subjects, PINs, device data, source rows,
private receipts and alias counts are excluded.

There are three separate lanes. Stored Jahit records retain stored numeric
components and payment markers without enforcing quantity times rate or
recalculating totals. Idless records retain multiplicity and receive no invented
identity. Exact same explicit-ID copies are displayed once; differing copies
fail instead of selecting the latest timestamp. Own kasbon/cicilan retain stored
balances, amounts and status. No missing balance is inferred and no installment
is interpreted as a bank payment. These lanes are not added to the slip lane.

The slip lane admits only explicit-own, verified workflow-v2 counts with positive
frozen payroll, unique explicit QC links and consistent frozen worker/rate data.
An uninspected count is provisional. Linked QC replaces its payable quantity,
including zero. Initial warehouse records are mirrors, not another wage source.
Explicit repair movements earn once on their completion date at the original
count rate, subtracting repaired quantity from the initial approved part. There
is no current tariff lookup, local-date selection, label authorization, temporal
pair recovery, idless fingerprint deduplication or standalone warehouse fallback.
Explicit linked foreign/non-v2/deleted stages remain unknown; their omission
cannot turn inspected work back into provisional earnings.
Malformed/missing staged evidence yields `pending_review` with no slip entries;
the stored observation lanes can still be read. `combinedPayout` is always null.

Exact product and family/operation-ID tombstones are respected without changing
the source. Duplicate-key marker JSON, malformed markers and invalid targets
are rejected. Opaque legacy signature markers never become event identities:
scoped stored Jahit observations carry a review status, and affected staged
families remain unavailable. Cancellation/deleted QC cannot resurrect provisional
pay. Old alias-only non-v2 families remain owner-private; no per-partner omitted
count is disclosed. A constant coverage label makes the restricted basis clear.

Synthetic tests cover old total preservation, live owner edits, separation of
lanes, frozen/provisional/zero-QC/repair semantics, exact-ID ownership, foreign
data exclusion, duplicate/cancel/tombstone fences, loan observations, bounds and
retained revocation. They do not prove real Auth, root SDK reads, IAM, HTTP/browser
binding, logging, cloud cost or main installation. A trusted adapter still needs
fresh Auth verification, a coherent authoritative root snapshot, current grant
rechecks, no-store HTTP and response validation, and browser cleanup on scope
change. Existing whole-root owner writers and unknown historical payment/source
semantics still need coordinated cutover review.
