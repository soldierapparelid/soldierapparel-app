# Native HTTP host review — 6 October 2026

Status: source **OFF**, separate candidate, not deployed. No real Google login, ADC, business data, live Rules, IAM, billing, frontend activation or main-branch change is performed by these files. This closes an application-process ingress gap in a candidate host; it does not establish that the existing live app is private.

## Why a separate host

The pinned Functions Framework 5.0.5 installs body-parser middleware before the user handler and uses a 1024mb parser limit. Application raw-body checks therefore cannot bound that earlier parsing, decompression or its error logging. Its supported options do not expose a pre-parser admission/redaction hook. The existing Functions adapter remains available and OFF; the new native host does not change that upstream framework behavior. [Pinned server source](https://raw.githubusercontent.com/GoogleCloudPlatform/functions-framework-nodejs/v5.0.5/src/server.ts), [supported options](https://raw.githubusercontent.com/GoogleCloudPlatform/functions-framework-nodejs/v5.0.5/src/options.ts), [error handler](https://raw.githubusercontent.com/pillarjs/finalhandler/v2.1.1/index.js).

`deployment-runtime.cjs` now holds the fixed configuration, SDK assembly and admission shared by both hosts. `functions-adapter.cjs` binds only Functions. `cloud-run-server.cjs` binds only Cloud Run and uses Node's HTTP parser directly. Neither caller input nor environment can select the other host. SDK versions, lock, command semantics, canonical tenant, Auth, grants, quota and five supported routes are unchanged.

## Fixed application boundary

| Boundary | Native candidate contract |
| --- | --- |
| Headers | Node parser 32 KiB; application 128 pairs, including duplicate/framing checks |
| Body | At most 32 KiB retained chunks, no decompression or parsed-body adoption |
| Connections / admission | Eight TCP connections; one admitted buffering or runtime request |
| Incomplete body | Ten-second timeout, generic response, no SDK initialization |
| HTTP response | Thirty-second deadline; pending runtime still retains the sole admission slot |
| Runtime policy | Existing 25-second classification, canonical quota and CAS/idempotent replay |
| Process shutdown | Stop acceptance and idle connections; wait for sockets and admitted work, capped at nine seconds |

Path, query, origin, method, bearer shape, type, encoding, framing and declared size are checked before reading retained body bytes or initializing ADC. JSON syntax is checked by the existing raw handler after the runtime is assembled; malformed JSON is not claimed to reject before ADC. Unknown expectations, upgrade and CONNECT cannot enter the runtime. `100 Continue` is emitted only after admission. Parser errors use static JSON without logging the parser exception or inspecting `rawPacket`. A malformed request rejected directly by Node can still receive Node's fixed parser response rather than the application's JSON envelope.

These are process limits. Network/platform buffering, Node's transient parser/socket buffers and aggregate memory are not measured by the retained-chunk limit. Connection saturation can close a peer without an application response. The candidate has not been benchmarked with real latency or concurrent staff.

Read failures remain generic. A late/disconnected write is uncertain, not rolled back: retain and replay the identical request ID, payload and expected revision with a fresh token. The admission slot is released only when the dispatched runtime promise settles, even after its response socket disappears. Shutdown waits for that explicit work as well as socket closure; the nine-second deadline may terminate unresolved work. Neither HTTP timeout nor termination is database cancellation, proof of commit, or proof of no commit.

## Entrypoint and package

`cloud-run-entry.cjs` imports only source configuration when OFF. Import does not read environment, load HTTP/Admin, listen, register signals or print diagnostics; OFF CLI exits unsuccessfully and silently. Enabled startup requires exact Node 22, fixed reviewed source configuration, a strict environment snapshot and canonical PORT before listening on `0.0.0.0`.

The fixed service/configuration name is `soldier-production`; its revision must belong to that service. Project environment must match source configuration, and emulator/credential-file overrides and Functions target variables are rejected. Cloud Run supplies PORT and service/revision/configuration variables, but the project binding must be set explicitly during a separately reviewed deployment. Request-time validation takes a fresh environment snapshot. [Container runtime contract](https://docs.cloud.google.com/run/docs/container-contract).

Preparation now copies 19 runtime sources and 23 files, with the preparation manifest separate. The existing package main and Firebase/Hosting fragment still describe the Functions path. No container image, Dockerfile, build trigger, Cloud Run rewrite, automatic install/deploy command or source activation is added. An explicit native container command would run `server/deployment/cloud-run-entry.cjs` from the prepared functions directory; it must not launch Functions Framework. Runtime image, build provenance, dependency installation, capacity, identity, ingress, Hosting rewrite and rollback need their own reviewed deployment patch.

The exact dependency lock remains SHA-256 `3b96ac007f3cc4f5ae039b47c4eaf05a6a597117a4f9e42d5fda78847b4337e1`, with Admin 14.5.0 and Functions 7.3.0. No dependency graph or manifest script is introduced.

## Evidence and practical limits

Unit tests cover both host bindings, OFF/getter inertia, cold initialization and disconnect, native framing/body/header/connection limits, actual native deadlines, explicit work drain and entry lifecycle. A separate child-process transport suite uses real Node HTTP and the production HTTP handler with synthetic SDK/Auth/database/services. It captures every response plus child stdout/stderr and checks harmless body/header/token/SDK/service-error canaries; it does not contact Google or use credentials/business values. Node 22 CI is required because the local runner is Node 24. The pre-existing genuine pinned SDK/Functions Framework transport suite remains in CI; its duplicate-header helper now includes Host so assertions reach the intended boundary.

The application process has no request/error logging in this candidate, but Cloud Run automatically produces request and system logs and collects container output. Request metadata can include full URL, IP, user agent and referrer. Never put secrets, business values or tokens into paths/query strings. Restricted log access, retention/exclusions, Error Reporting, platform ingress behavior and actual deployment logs require separate verification. Synthetic process canaries do not prove Google-platform redaction. [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging), [HTTP log fields](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest).

Backend requests verify Google tokens with revocation checking. Immediate browser access removal in the prepared grant design is canonical `profile.active=false` with a grant revision change. Synthetic grant-revocation tests do not prove that disabling a Google user or revoking refresh tokens immediately disconnects every existing direct RTDB wage listener; those Rules do not currently include token-revocation metadata. [Firebase session revocation](https://firebase.google.com/docs/auth/admin/manage-sessions).

Real Google Auth in staging, canonical UID/worker bindings, private bootstrap, all old writers/listeners, wages/history/device reconciliation and rollback remain required before main cutover. Do not move an Auth UID between different Firebase projects or recalculate disputed old wage totals. Potong enrollment stays pending until its account is supplied. This candidate makes no payment, deduction, transfer or Shopee change.

Cloud Run through Firebase Hosting requires billing/Blaze; builds and image storage have separate charges. No billing account, paid plan, budget or service is activated here. Prepare the concrete deployment and measured cost controls before requesting approval for that step. [Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run), [Cloud Run pricing](https://cloud.google.com/run/pricing).
