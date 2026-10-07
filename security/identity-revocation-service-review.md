# Owner-authorized retained revocation adapter

The fixed-scope adapter is source OFF and supports
only execute/resolve of the reviewed pure identity-v2 revoke command. It cannot
bootstrap, activate, edit roles, reassign a reserved worker, change wages or
accept a v1 production tenant. A separate ordinary-session verifier reuses
the existing exact Google/current UserRecord checks; enrollment remains a
different five-minute-fresh API. Signed project, issuer, UID, provider, verified
email, current enabled record and exact Google subject are verified before
and after a write. No token, email, UID or approval identifier is returned.

Owner admission requires the same fully validated tenant's sole initial owner,
not request roles, token custom claims or email inference. Database/Auth apps,
SDK method identities, URLs, snapshot references and emulator environments
are rechecked; observed scope drift remains latched throughout the operation.
The callback revalidates the entire fixed tenant and exact command revisions,
preserving unrelated concurrent enrollment. Initialization/catalog continuity
is pinned across the write. Token expiry during warm-up denies a mutation.
A bounded value subscription primes the genuine SDK transaction cache; its
snapshot never becomes commit authority and is always unsubscribed.

The immutable receipt retains the command ID and original approval/grant
revisions. An exact existing command can resolve or replay without another
write. A malformed/lost acknowledgment, expiry or failed Auth confirmation
after dispatch remains `result_unknown` with the same-command retry directive;
the service never reports a possible mutation as definitely unsaved. Readonly
resolve requires a retained matching receipt, otherwise it remains unknown.
Auth and database are independently observed fences, not an atomic guarantee
against an Auth account change at the instant a database commit occurs.

There is one in-flight slot per instance and trusted admission before a fresh
write. The prepared HTTP/runtime integration supplies bounded bodies,
duplicate-key rejection, exact minimal receipts, shared capacity, deadline
classification, CORS and pre-Auth host gates. Its separate trusted source flag
`identityRevocationEnabled` defaults OFF, including when absent. Only fixed
POST revoke/resolve paths are conditionally assembled; resolve is readonly.
Deployment log protection and real host validation remain prerequisites. No production
SDK is initialized here. Production refuses database/Auth emulator overrides.
The exact demo fixture uses only loopback RTDB, a fixed fake credential method,
no Auth emulator and no real credential environment overrides.

Local cases use injected SDK/Auth. The genuine Admin 14.5 fixture exercises
actual SDK CAS, pending/claimed receipts, preserved unrelated data, exact
replay, mismatched revision rejection and an injected loss after a real demo
commit. Auth remains injected; this is not production login, IAM or deployment
proof. Ancestor/private namespace protection, trusted bootstrap/recovery,
real Auth/host tests and coordinated migration remain release prerequisites.
