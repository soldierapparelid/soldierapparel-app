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
button to clear its Auth session, then the explicit “Muat ulang” link for a fresh Google popup. Fresh ID
token issuance alone does not reset Google `auth_time`; approval claiming still
requires a recent Google authentication as enforced by the existing state core.

An owner-only Google editor preview has now exercised the exact page assembler,
real Firebase Google popup/session and real current-account lookup, native
HtmlService RPC, Properties/Lock admission and browser IndexedDB. Both owner
and a synthetic Jahit profile mounted; first enrollment retained one claim at
approval revision 2, reload did not re-enroll, and own finance excluded the second
synthetic partner. All work records and preview grants were synthetic, isolated
in private script properties. No production database request occurred. This
does not establish real partner grants, public deployment or free capacity.

An additional private administrative test revoked that synthetic partner grant
without changing example money. The next finance read cleared the work and wage
DOM; reload and a new genuine Google popup both denied the retained revocation.
The preview grant remained revoked rather than being reclaimed. This proves the
server/bridge enforcement path, not a production owner revocation menu.

The native test also exposed an HtmlService recovery bug: reloading the inner
user iframe left a blank page. Terminal recovery now uses an explicit link to
the reviewed deployment URL, the fixed presentation module and target `_top`,
as required by [Google's iframe navigation guidance](https://developers.google.com/apps-script/guides/html/restrictions).
The signout action hides that link until signout completes; navigation then
requires a new user click and never depends on an asynchronous redirect.
Failed signout exposes a fixed retry message and cannot revive displayed data.
Both the recovery link and the account-choice/signout link were clicked in the
native Google-hosted page and returned to a working web-app page without the
blank iframe. These checks used the revised bootstrap; pending journals were
not deleted by recovery or signout.

Most regression validation uses synthetic identities, storage and transport
hosts. The native preview above does not prove production enrollment,
production grants, public deployment or free-service capacity. No production
data, rules, billing, navigation or login settings were changed by this work.
The new files do not activate protection on the main application. Before cutover,
finish owner access revocation, the remaining writers,
bounded transfer/admission policy and fresh-data/draft reconciliation, then test
the hosted source and coordinate main navigation with restrictive database rules.
