The free HtmlService production page now assembles the reviewed Jahit, QC and
owner forms behind a dedicated Firebase Google login bootstrap. It uses the
existing scoped lifecycle RPC bridges and their separate durable IndexedDB
journals. The browser imports only Firebase App and Auth, not the database SDK.
An account must receive a validated server view before its journal is opened.

The page module selects a presentation lane, not an identity, permission, worker
or wage scope. The server denies the owner lane to partners. For Jahit/QC, the
actual server division controls the form and finance access even if a caller
selects another page label. The public configuration contains only the fixed
Firebase browser binding and Apps Script deployment URL. Roster email addresses,
UID mappings, passwords, Shopee secrets and service OAuth tokens are absent.

Source configuration is OFF with blank bindings. The browser API exposes only
`start` and is not replaceable. The offline page builder verifies hashes for 14
fixed browser sources, assembles them in dependency order, and can prepare three
SOURCE-OFF HTML files without contacting Google or Firebase. Enabling a page
requires an explicit reviewed public binding during offline assembly.

The bootstrap uses session Auth persistence, starts the popup in the click task,
binds one account object, and closes forms before signout. Source, app, runner,
page/controller/bridge replacement or account change invalidates callbacks.
Terminal cleanup clears displayed records while preserving unsent and uncertain
commands. A lost owner reply was exercised through the real form, RPC bridge,
controller and fake IndexedDB across a bootstrap reload: receipt resolution
confirmed the same command without a second production write.

The runtime also has an optional server-side `enrollmentEnabled` switch, absent
or false by default. With it enabled, the first normal lifecycle read can claim
an existing reviewed, unexpired exact-email approval using the current verified
Firebase UID and Google subject. The retained registry and grant are written
together in a full-root ETag CAS; legacy records and private fields are preserved.
An additional existing shared write reservation precedes the claim PUT. Current
Auth is checked at the write and confirmation boundaries before returning a view.
Unknown, expired, stale, foreign, disabled or revoked identities cannot claim.
An uncertain claim returns no view; a fresh read recognizes an already retained
active claim without changing its revision or repeating the write. This path was
also tested in the generated V8 graph with the existing shared admission state.
The read RPC accepts no client enrollment, email, role or worker selector.

A cached session that cannot enroll can use the terminal “Keluar dan pilih akun”
button to clear its Auth session and reload for a fresh Google popup. Fresh ID
token issuance alone does not reset Google `auth_time`; approval claiming still
requires a recent Google authentication as enforced by the existing state core.

Validation uses synthetic identities, storage and transport hosts. It does not
prove this page in a live Google HtmlService iframe, real partner enrollment,
production grants, public deployment or free-service capacity. No production
data, rules, billing, navigation or login settings were changed by this work.
The new files do not activate protection on the main application. Before cutover,
prove native enrollment and finish owner access revocation, the remaining writers,
bounded transfer/admission policy and fresh-data/draft reconciliation, then test
the hosted source and coordinate main navigation with restrictive database rules.
