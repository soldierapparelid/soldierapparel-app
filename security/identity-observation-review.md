# Identity metadata observation Rules candidate

The separate `identity-access.rules.json` is generated from the unchanged v1
authority Rules. Only five existing self-grant scalar read predicates change,
covering the client's fourteen fixed leaves. All ancestor reads, all browser
writes, private registry/catalog/history paths and every production projection
gate remain closed or byte-equivalent to v1. This file is not deployed.

The v2 branch checks tenant/project binding, initial owner provenance, reviewed
catalog revision, owner grant and the shape of the caller's own grant. Sewing
requires the same reviewed Jahit worker; QC has no worker binding. Active
revision 1 and retained inactive revision 2 can be observed, so revocation can
clear the UI. Owners, partners and QC cannot read each other's grant leaves.

These Rules expose self identity metadata only, not a durable authorization.
RTDB Rules cannot search the private approval map by retained UID without an
additional trusted index; this increment deliberately creates no such index.
Consequently metadata Rules do not prove registry/claim consistency. The
server's full v2 validator and exact signed UID/Google-subject checks remain
mandatory for session and history access, and reject orphan/mixed/forged grants.
Rules use the supported `hasChildren` API and check selected known fields;
exact whole-object keys, timestamp validity and capacity limits are enforced
by the server. Unknown fields cannot create a business permission or ancestor
read. See the [official Rules API](https://firebase.google.com/docs/reference/security/database).
The SDK fixture demonstrates that even a privileged injected orphan can read
only its own metadata while server validation and every business/private path
remain denied. No browser permission, Auth custom claim or observed profile
may replace server admission. Production paths still require schema v1.

The pure tests prove the narrow source diff and deterministic generation. The
isolated Rules emulator cases exercise real denied reads/writes, fourteen leaf
reads per role, malformed scopes and revocation subscription behavior. Those
synthetic tests are not a production deployment or real Google login proof.
Production ancestor privacy, bootstrap/recovery, trusted owner revocation,
history API/UI and ongoing-work migration are still release prerequisites.
