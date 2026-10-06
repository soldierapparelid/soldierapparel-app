# Enrollment service review

The new service is disabled by default and is not a deployment, owner bootstrap,
roster import, client login flow, or permission to enable a server. This review
contains no actual enrollment records, credentials, or business values.

## Contract and authority

`createProductionEnrollmentService(options).execute({idToken})` accepts only that
own-data request. Its result is a frozen `{ok:true}` or `{ok:false,error}` with a
fixed generic error. No response contains the identity, email, approval identifier,
worker binding, registry row, SDK error, or a receipt. The disabled constructor
uses only an own enumerable data `enabled:true` flag; other options and the request
are not inspected while disabled.

Private pinned copies use the registry's descriptor-safe copier; service equality
walks validated own-data fields without object serialization hooks. Error codes
are selected only from an own enumerable data field and a fixed allowlist, without
invoking an arbitrary error accessor. Focused boundary tests cover these behaviors;
they do not claim every preexisting application codec has been hardened.

Enabled operation binds the Auth verifier and database to one reviewed project,
database URL, and tenant. The identity helper verifies revoked/disabled-account
status, recent Google authentication and token issuance, verified exact lowercase
Gmail, the current Google provider subject, and the current user record. No email
alias conversion or caller-selected role/worker is permitted. Canonical tenant
validation and the registry codec enforce the existing owner prerequisite and the
reviewed Jahit/QC scope; initial Jahit enrollment needs an assigned worker in an
active reviewed cycle. Potong and owner enrollment are unavailable in this version.

## Atomic writes and admission

Only the fixed `authorityTenants/<tenant>` reference is used. Initial enrollment
creates one previously absent UID grant and consumes its preapproval in the same
tenant transaction. Existing UID grants, including inactive grants, cannot be
overwritten. A selected eligible approval has a canonical fixed quota of eight
admissions per minute; successful replay also consumes this quota and advances the
approval revision. Unknown, revoked, expired pending, or conflicting identities
create no quota or grant write and no arbitrary UID bucket.

The service independently bounds pre-Auth attempts to twenty per fixed minute and
one outstanding request per instance. That memory guard resets on process restart;
the eligible approval quota survives through the canonical tenant. These controls
do not establish a platform traffic or billing cap.

Every transaction validates its current canonical input, pins the observed
approval policy/revision and verified identity, rechecks freshness, and validates
the complete proposed tenant. The service verifies that changes are confined to
the selected registry row and the initial UID grant; products, tariffs, ledgers,
other registry rows and other grants remain intact. An exact active claimed UID
and Google subject may replay after initial approval expiry or cycle closure.
Replay never reactivates a grant or changes its permissions.

Retained UID/Google-subject bindings are resolved before pending email approvals.
A verified email change can replay its existing binding but cannot select a
different worker's pending approval. Partial or conflicting retained identities
fail closed; email is an initial pending-approval selector rather than a recurring
permission authority.

## Retries, clocks, and uncertain outcomes

The SDK cache-warm subscription has a fixed five-second deadline and is cleaned on
every path. Null cold-cache callbacks abort. Repeated SDK update callbacks abort
and retry outside the callback, with fresh Auth verification and a canonical read;
there are at most three outer attempts. Changed approval policy/revision is denied
conservatively, and a separate verified request may safely replay a committed claim.
No asynchronous Auth verification runs inside an SDK update callback.

Lost or malformed commit acknowledgement, binding drift or stale identity after
dispatch returns `result_unknown`, rather than asserting that permission was not
saved. A new request can resolve the retained UID/Google-subject binding while
consuming the same bounded canonical quota. Firebase Auth revocation and the
database transaction do not form one cross-service atomic transaction; subsequent
protected operations must continue checking Auth and the current canonical grant.

The process clock is monotonic across requests and awaits. Persisted admission can
detect a backwards minute, and replay cannot precede its original claim time. Its
two-field minute/count state cannot prove the ordering of every previous replay
within the same minute after a process restart. Clock guarantees must not be
expanded beyond those checks.

## Validation limits

The focused service tests use synthetic in-memory SDK/Auth fixtures, including
class-based handles, callback retries, concurrent canonical changes, persistent
quota across independent service instances, revocation, lost acknowledgements and
the actual warm deadline. They establish no live Google sign-in, real Auth user
record, production database, hosting, platform logging policy, or deployment
readiness. No fixture imports credentials or sends requests to Google.

The service and its helpers add no logging. SDK or hosting behavior outside these
modules requires separate review. Rules privacy tests and genuine Admin SDK/RTDB
emulator integration must pass before any later enabling review. The deployment
source remains OFF, and the service performs no initial owner provisioning.

`security/production-enrollment-emulator.test.cjs` separately prepares genuine
Admin SDK 14.5.0 named Auth/app/options and Database handles against only the demo
loopback RTDB emulator. Auth verification/getUser methods are replaced with explicit
fixtures, and the returned user record is synthetic. It covers independent SDK
clients, a fresh third client, atomic claim/quota races, actual transaction retries,
lost acknowledgement, revocation, retained products and nonempty ledgers, and the
unchanged ordinary session admission/privacy contract. Guards require the exact
loopback endpoint and reject real credential configuration; cleanup checks and
removes only its named synthetic tenant and normal quota namespaces. Local syntax
and seed/ledger validation do not establish a successful emulator or live Auth run;
the isolated CI harness must supply the actual integration result.
