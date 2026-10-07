# Prepared recurring shared admission

Source OFF. This preparation adds only one policy gate, its synthetic tests and this review. No runtime/bundle, private policy, seed, Properties/Lock, Google account, root, deployment, billing or main-app switch has been changed. It does not prove actual operation capacity or native shared-state behavior.

## Exact internal interface

`createAppsScriptRecurringRequestAdmission({enabled,binding,policy,scriptLock,scriptProperties,clock,maxRootBytes?})` returns only `admit(request): boolean`. Binding is exactly `{projectId,policyId}`. Trusted assembly must supply ScriptLock and ScriptProperties from the **same single Apps Script project**, not user/document properties, process-local objects or a different host. Native methods are captured and checked; no global native methods are called during module import or factory creation. Defaults are OFF, empty binding and null policy; the legacy default cap is 8 MiB.

Policy contains exactly projectId/policyId/reviewed, explicit startsAt/expiresAt, day and month request/lookup/download-byte limits, and rolling burstWindowMs/burstLimit. The horizon is finite, at most 366 days. UTC calendar days and months are this application's explicit policy periods; they are not Google's daily quota-reset convention. Both monthly and daily ceilings are mandatory. A partial first or final period receives no extra carried credit.

Request is exactly `{projectId,kind,now,maxDatabaseDownloadBytes,maxGoogleLookupCount}` with the current coordinator kinds `read`, `readFinance`, `execute`, `resolve`. Execute reserves three capped database responses and fourteen lookups; the others reserve two responses and ten lookups. Smaller caller estimates, dates, resets, root caps, identities, budgets and other selectors fail. This is an internal trusted coordinator envelope, not a browser API.

Optional **trusted source configuration** `maxRootBytes` accepts only 2 MiB or the existing 8 MiB. It is part of the stored ledger's binding, not a request selector. A missing option retains 8 MiB. Different caps cannot share a seed or convert previously consumed units. The 2 MiB option is valid for integration only after the exact matching cap is independently enforced on transport response bytes and candidate serialization, the working migration root is validated within it, and old client writers cannot expand or replace that source. An observed smaller root is insufficient. This gate does not itself enforce transport or Rules; no such protected working-root activation is claimed.

The implementation reuses the existing finite gate's root/state constants and pure seed-based binding/limit/burst validation. Its old 8 MiB minimum is raised only in a temporary validation object when validating a smaller configured byte allowance; persisted policy and reservations keep the actual smaller limits. No existing gate file was edited. The new module must be allowlisted/pinned separately before bundling.

## Persistence and rollover

One fixed property, `soldier.legacy.recurringRequestBudget.v1`, stores the exact policy/cap, lifetime sequence and costs, last reserved timestamp, current day/month costs and a cross-period rolling burst. No identity, token, command, root, amount, payroll or bank record is stored. `createRecurringAdmissionSeed(policy,maxRootBytes?)` constructs only a string, without persistence; no RPC for provisioning, renewal, reset or refund is exposed.

Under the shared lock, admission validates the canonical retained state and cost equations, then compares a monotonic trusted server time. A legitimate next day/month switches that lane **in the same write as the next full reservation**. Lifetime costs never decrease. The rolling burst survives both boundaries, preventing a midnight/month-end bypass. Skipped days do not accumulate credits. Monthly exhaustion continues to deny on subsequent days. Expiry, missing/corrupt/mismatched state or cap/policy changes never seed, repair or refill themselves. A denied rollover writes nothing.

The exact updated string is read back while still holding the lock; success requires retained lock ownership, valid finishing time and successful release. Failed authentication/network later is never refunded. Lost write ACK, readback mismatch, dropped persistence, lost ownership, method drift or release failure returns false; any already retained reservation stays consumed. A retry spends a new request reservation, even when business command replay is read-only. No automatic overwrite/retry/refund exists. Clock rollback cannot resurrect an earlier accepted period across factories because its timestamp remains in shared state.

Trusted owners/editors can still alter ScriptProperties or code. Native consistency, lock ownership across actual simultaneous invocations, quota failures and execution termination require genuine synthetic proof. A new key/seed is not a migration mechanism: private provisioning must account for already consumed same-period allowance and all other callers before activation. Never deploy a zero seed over existing usage or create a second script to obtain another copy of the budget.

## Concrete capacity arithmetic

The current save plus subsequent own-view refresh comprises one execute and one read: **five root-response units and twenty-four lookups**. The following are reservation arithmetic, not measured total download or proof of free availability:

| Trusted hard root cap | One save + refresh | 20/day for 7 days | 20/day for 30 days | 20/day for 31 days |
| --- | ---: | ---: | ---: | ---: |
| 8 MiB default | 40 MiB | 5.46875 GiB | 23.4375 GiB | 24.21875 GiB |
| 2 MiB protected candidate | 10 MiB | 1.3671875 GiB | 5.859375 GiB | 6.0546875 GiB |

Twenty pairs/day for thirty days also reserves 14,400 Google lookup calls and 3,000 database-response units. Separate opens, finance views, resolve/retries, QC, enrollment, archive and owner activity consume additional allowance. The current four-kind gate does not silently admit those additional lifecycle/enrollment operations; their exact independently reviewed envelopes must be registered before integration.

A deliberately allocated **1 GiB** monthly gate fits at most 25 pairs at 8 MiB or 102 pairs at 2 MiB, assuming no other calls. A hypothetical 7 GiB allocation at 2 MiB fits at most 716 pairs, with any opens/finance/retries reducing that number. A fresh unallocated **10 GB decimal** ceiling fits at most 238 pairs at 8 MiB or 953 at 2 MiB before all other traffic and overhead. These examples are not installed policy values or permission to consume the project's entire allowance.

Firebase currently lists Spark Realtime Database with **1 GB storage and 10 GB/month download**. Storage and download are distinct. This does not authorize a paid upgrade. [Firebase pricing](https://firebase.google.com/pricing).

Firebase counts protocol/encryption and connection traffic, including console and denied requests, alongside downloaded data. A parser cap is applied after a native response has already been buffered; an oversized/failed request can exceed the accepted-body reservation. The gate therefore limits accepted request envelopes, not every byte counted by Firebase or every anonymous Apps Script invocation. Other scripts and legacy readers remain outside it. A separate explicit quota margin, project usage review, ingress abuse control, protected-source bounds and native measurements remain necessary. [Realtime Database usage](https://firebase.google.com/docs/database/usage/billing).

Google documents per-user Apps Script quotas resetting twenty-four hours after the first request; UTC midnight policy rollover does not reset those quotas. Across a rolling twenty-four-hour service window, activity may include two application days. Consumer URL Fetch/property limits and other account scripts must be considered independently; denied calls can still spend invocation/lock/property resources. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

On Spark, exceeding a product's monthly no-cost quota can suspend that product for the rest of the month. Linking billing can change the plan to Blaze and violates the user's current constraint. No billing or plan action is included. [Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## Failure behavior and remaining integration

The gate supplies only true/false and logs nothing. The existing trusted runtime maps false to `rate_limited` before Google/database calls. UI must explain that the temporary usage limit was reached, keep the original pending command/draft, and avoid rapid automatic retry or a new operation ID. A daily boundary is not a guaranteed retry time when the monthly budget, expiry, state health or actual service quota remains exhausted. An uncertain business write keeps `result_unknown` and resolves the exact command when admission permits; a quota denial never implies rollback.

Runtime and transport must demonstrably use the same hard cap; no caller/cached measurement may choose it. Owner initialization, identity admission, current Google checks, retained grants, private receipts, protected legacy writes, core source validation and exact replay remain separate requirements. The recurring gate is not an authorization policy, payment operation, bank transfer or unlimited-free promise. Source/main stay OFF and no added fees are permitted.

The 28 dedicated synthetic cases cover daily/monthly/burst rollover, skipped periods, request/lookup/byte exhaustion, retained lifetime counters, rollback/freshness/expiry, concurrent last-budget contenders, uncertain persistence/readback/release, canonical corruption, cap mismatch and request selectors. No native host or private data is used; genuine Google Auth, transport hard-cap enforcement, paid/free capacity and installation are unproved.
