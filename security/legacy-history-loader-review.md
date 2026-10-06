# Stored-history archive loader: isolated OFF candidate

`server/production-legacy-history-loader.cjs` exports
`createProductionLegacyHistoryLoader({enabled,scope,database,publicationProof})`.
The source flag defaults to OFF. OFF does not touch binding, proof, SDK or data.
An enabled factory returns the exact frozen `historySource` descriptor already
accepted by `production-legacy-history-service.cjs`; its `read()` takes no input.
It reads only `legacyStoredHistoryArchives/<fixed tenant>/<fixed version>`.
There is no route, runtime registration, SDK initialization, writer, credential
reader, remapping, caller selector, or mutable legacy-root fallback.

The SDK app object, project/database options, `ref`, reference `get`/`toString`
methods and exact reference URL are pinned and checked at construction and
around each asynchronous read and snapshot callback. A snapshot must refer to
the same version. Binding is checked again after `val()` and decoding, directly
before the frozen logical source is returned. SDK errors become fixed generic
errors; the module has no logger and never echoes raw errors or data.

The shared codec stores an exact envelope containing a canonical JSON **string**
payload. A string retains null, absent fields, zero and explicitly empty arrays
through the modeled RTDB pruning boundary. The codec validates exact schema,
scope, policy, reviewed worker catalog and permitted stored fields, bounded
strict JSON and canonical text; it never reprices or repairs a stored record.
Domain-separated SHA-256 covers scope, version, codec and exact payload bytes,
including the worker review catalog. The recomputed digest must equal both the
blob digest and a separately captured publication proof in a trusted server
closure. The blob cannot create its own trusted proof.

The external proof remains a deployment review prerequisite: its `reviewed` and
`immutable` declarations are not cryptographic publisher identity, proof of a
real publication, or permission for a user. This loader does not authenticate,
read grants or establish canonical catalog membership; the separate history
service provides those checks. A returned source grants no lasting permission
and the observed read fences do not prove atomic revocation, storage immutability
or absence of later writes. Untrusted HTTP/browser code must never construct an
enabled loader or supply publication proof.

Production mode rejects either Database or Auth emulator environment. The
optional own-data `testOnlyEmulator:true` hook is isolated to the exact
`demo-soldier-security` scope, database environment `127.0.0.1:9000`, exact
loopback reference URLs, no Auth emulator or real credential environment, and
an explicit own fixture `getAccessToken` credential. It does not redirect a
production project. Runtime source does not wire this hook or loader.

The dependency lock pins Admin SDK 14.5.0. Its
[official Database implementation](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/database/database.ts)
uses the compat Database interface; the documented
[Reference API](https://firebase.google.com/docs/reference/js/v8/firebase.database.Reference)
supplies `get()` and absolute `toString()`, and
[DataSnapshot](https://firebase.google.com/docs/reference/js/v8/firebase.database.DataSnapshot)
supplies `ref` and `val()`. Tests use synthetic class-shaped SDK handles and the
real codec. They do not prove real SDK network behavior, current production
Auth/grants, live publication, Rules privacy, a cutover, or legacy writer safety.
Size limits apply after the SDK has produced a value; this candidate does not
bound SDK wire traffic or upstream SDK/platform logging.
