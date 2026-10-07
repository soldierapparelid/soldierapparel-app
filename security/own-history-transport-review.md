# Prepared own stored-history route and Jahit view

Source switches and canonical page mode remain OFF. `legacyHistoryEnabled`
is a separate trusted opt-in, absent/false OFF. Only fixed GET
`/v1/production/history/own` is added. Header gates reject the disabled path
before body/SDK and allow a GET Authorization preflight without ADC. Private
deployment configuration must supply an exact archive version and independently
reviewed publication proof bound to the fixed project/database/tenant. The
public configuration contains null; real proof/archive values must stay outside
the public repository, browser, CI and logs.

The runtime uses the existing fixed-path codec/loader and history service.
Google token verification/current UserRecord, retained subject/UID grant and
catalog fencing precede the private archive read and repeat before returning
money. Admission shares the canonical UID rate bucket. No caller worker,
archive, version, source or owner selector exists. The full returned view is
normalized at the HTTP boundary, including own-worker record checks and exact
stored field types. Extra/private fields reject the whole response. Owner,
QC, unknown, disabled, replaced-subject or revoked accounts cannot use the
partner endpoint. Stored totals, null, zero, fractional values, absent fields
and available-empty versus unavailable semantics remain unchanged.

The prepared browser bridge adds an explicit read method after verified
session/metadata observation. It requests a refreshed Google token in a header,
fixed GET, bounded decoded stream, no redirects, cookies, referrer, selectors,
business listeners, storage or history journal. The response must match the
captured UID/worker/division/grant revision. Session loss aborts the read and
discards late money. A separate read slot rejects duplicate unresolved reads;
the form controller shares its ordinary busy gate with production commands.
The controller repeats view normalization against its own verified scope.

The Jahit button displays stored history independently of cycle selection and
future computed wages. It prints stored totals rather than quantity times rate,
shows null as unset and distinguishes source unavailable from empty. Payment
flags are described as recorded marks, not proof of a bank transfer. Rendering
uses textContent; owner/QC hide and cannot invoke the button. Blocking/disposal
clears the section and prevents late responses from rendering.

Tests exercise HTTP, deployed-host assembly, actual core codec/loader/service
with injected SDK/Auth, streaming bridge/session invalidation, controller scope
and DOM rendering. The DOM is a synthetic fixture, not a real browser. Existing
genuine SDK fixtures test codec/loader separately; the new runtime test does
not prove production Auth, network permissions or host behavior. The known
Functions upstream parser/log gap remains; no production secrets are used.
No archive publication, billing, IAM, bootstrap, Rules activation, main-site
deployment or ongoing-production/finance migration is performed. Full rollout
still requires those reviews and a coordinated recoverable data transition.
