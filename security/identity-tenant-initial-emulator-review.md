# Initial identity-only storage rehearsal

The four cases in `identity-tenant-initial-emulator.test.cjs` run only against
pinned Admin SDK 14.5.0 and `demo-soldier-security` Database emulator at exactly
`127.0.0.1:9000`, on Node 22+. There is no Auth handle, real credential, ADC
lookup, bootstrap operator, deployment, or production archive/grant write.
The explicit synthetic emulator credential and per-test fixture namespace are
checked before writes and cleanup. Direct SDK writes are synthetic controls.

The roundtrip compares the entire initial-only v2 tenant and its strict decoder,
without products, cycles, assignments or financial data. A v1 control shows
that RTDB removes `products:{}`; both its incomplete stored representation and
an identity-only v2 remain rejected by the existing production validator.
There is no silent conversion or empty-production fallback.

A genuine numeric-key control becomes SDK arrays. The preparer therefore
rejects all-numeric owner/worker map keys for this initial representation;
it cannot rename a selected ID to pass validation. Other controls independently
store owner, catalog and foreign-production changes and require rejection.

Source review/syntax checks are preparation evidence only. Passing execution
must be verified on the exact candidate commit in the Rules workflow before
citing a genuine SDK roundtrip. These tests do not authenticate an operator or
owner, create a production grant, prove fresh Auth records, provide enrollment
or revocation, widen Rules, authorize historical reads, or migrate operations.
The initial v2 codec is not registered in the existing v1 runtime; reviewed
identity lifecycle/session/history/Rules integration and a separate trusted
create-only writer with acknowledgement recovery remain activation prerequisites.
