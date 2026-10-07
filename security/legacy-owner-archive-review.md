# Compatible owner archives and wire-stable lifecycle receipts

Prepared 7 October 2026. SOURCE OFF; main pages, production data/Rules,
grants and billing are unchanged.

The existing owner report archives eight cycle collections and clears their
current copies. Direct owner writes bypass lifecycle evidence. This candidate
adds separately authenticated owner read/capture/execute/resolve methods to
the same pure lifecycle core and internal Google coordinator. Initial owner
UID and active retained owner grant are required after current-account
verification. QC/Jahit cannot borrow the owner lane; payload roles are rejected.
The dedicated SOURCE-OFF owner RPC accepts typed archive/restore/relabel/PO
and maintenance commands; it cannot select a caller, role or raw patch. Main-page wiring is
still disabled.

Four typed commands archive a cycle, restore a selected stable archive ID,
change an archive label or update PO controls. Archive copies retain original
collection shape, unknown row fields, paid markers, rates, amounts and PO
controls. Restore first archives any current work under an explicitly supplied
new safety ID; it never overwrites current work without retaining it. Archives
are moved rather than deleted. No permanent deletion or automatic repricing is
provided. Concurrent owner changes require a fresh whole-product version.
Owner view schema 2 includes the archive selector and a separate bounded
maintenance projection: reviewed worker labels, assignment progress, sewing
quantities with that record's stored rate/total, date-only payment notes and
paid markers. Only the currently verified retained initial owner can read it.
It excludes raw records, PINs, emails, grants, images, cash records and the
database root. QC/Jahit owner-lane calls are denied before journal opening.

Private receipt schema **2**, policy `legacy-lifecycle-current-v2`, extends the
same collection chains through owner archive/restore changes, including
archives, cutting, payment notes and PO controls. Earlier QC/Jahit commands
remain independently resolvable after their current rows move into an archive.
Untracked direct writes still fail; there is no automatic evidence rebase or
ledger reset. Schema 1 is deliberately rejected; previous versions were
SOURCE-OFF candidates and their synthetic proof ledgers must not be adopted.

Firebase prunes null/empty values and may return numeric-key arrays as maps.
Receipt collection digests now compare that wire meaning, preserving numeric
indices, false/zero/empty-string values and every non-null field. This is a hash
comparison only; source values are not rewritten. Chain origin is an explicit
empty string, which Firebase retains. A null origin would disappear from the
stored receipt. Missing/malformed origin, empty effects, cyclic chains and
changed source content cannot confirm acceptance.

Focused pure/coordinator cases cover preservation, own finance before/after
archive, exact replay and ACK recovery, role denial, safety restore, map/null
shape, stale owner money, untracked edits and old-format rejection. Four
additional pinned SDK cases use loopback demo storage only: real pruning and
restore, deletion of the last count, committed archive with injected ACK loss,
and competing conditional owner changes. SDK storage proof uses an isolated
synthetic subtree; identity is synthetic and no production deployment,
Firebase caller grants or live root authority is implied.

The owner browser channel uses a separate bounded IndexedDB journal, tied to
the exact account/project/tenant/grant/deployment. It preserves the original
command through missing acknowledgement and reload. A validated definite
conflict/invalid-request reply on the first dispatch can retain a rejected
record without blocking a corrected new request. Previously uncertain
attempts remain pending on a resolution conflict and are never marked rejected.
Rejected commands are not resent. There is no journal deletion or automatic
import from the division/older append journals.

Owner forms derive archive/safety/request IDs and source/grant versions from
the current scoped view. Restore requires a fresh safety archive when work is
present. Archive/restore have explicit review checkboxes; changed fields clear
the confirmation. Products and archive choices are paginated. The UI creates
DOM text nodes rather than rendering stored labels as HTML, and it sends no
prices, totals, account selectors or arbitrary JSON root. Its projection does
not replace the separately scoped owner finance modules.

Typed maintenance commands add/edit assignments, add/edit sewing, add/edit
date-only payment notes and review paid markers for sewing/count/QC records.
Assignments cannot go below submitted work, change workers after submission,
exceed available capacity or make historical unlinked work ambiguous.
Sewing corrections preserve unknown fields and respect assignment/count
dependencies. Date-only corrections retain original amounts exactly. Changes
to quantities, worker or amounts require explicit reviewed rate and total;
the prior observations remain in bounded correction history. This does not
reprice frozen count/QC payroll. Paid work requires a reviewed payment
correction first. Clearing a paid marker retains its previous date/status.
Payment notes preserve any existing nominal fields and do not mark work paid
or initiate a transfer. All these changes extend the same receipt chains.

Fifteen additional composed maintenance tests cover authority/projection,
capacity and ambiguous links, anomalous stored amounts, explicit corrections,
count dependencies, paid-marker recovery, date-note separation, lost replies,
concurrent money changes and history capacity. Three additional genuine SDK
cases cover paid/unpaid corrections followed by archive, payment ACK recovery
after a later edit, and reviewed amounts with a competing owner change.

Before release, remaining owner cutting/catalog/create/delete/advance and
other module writers, revocation and legacy clients must join or safely
reconcile with this history. The codec/journal/forms are SOURCE-OFF candidates.
The earlier native owner hosted archive/PO proof used the previous exact
assembly; native proof of these new maintenance forms is separate.
Real enrollment/grants, native admission and measured
free capacity, fresh backup/drafts and coordinated main/Rules cutover remain
required.
