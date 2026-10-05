# Prepared account storage boundary

`account-storage.js` exports the UMD global `SoldierAccountStorage` and CommonJS `{create}`. It is a prepared component, **not installed in the existing module boots**. Existing global caches, journal roots, logout behavior and legacy financial payloads remain migration blockers. This component does not encrypt device data.

## Trusted scope and cache API

Authenticate with Firebase, confirm the server-protected access profile, and derive a scope from that authorized context. Never take a UID, project, module, schema or current-session decision from a URL, form, browser cache or partner-selected ID.

```js
const cache = SoldierAccountStorage.create({
  scope: {
    projectId: context.app.options.projectId,
    databaseURL: context.app.options.databaseURL,
    uid: context.uid,
    module: 'jahit',
    schemaVersion: 2
  },
  storage: window.localStorage,
  isCurrent: () => context.authorized === true &&
    context.auth.currentUser?.uid === context.uid &&
    capturedGeneration === currentGeneration
});
```

The callback is mandatory, synchronous and must return literal `true`. Use a session generation invalidated on logout, revocation, project/schema changes, and worker-binding/role changes. Each cache access checks before and after the underlying operation. Any failed check permanently invalidates that adapter; later reauthorization requires a new factory call with a fresh trusted context.

- `getItem(logicalKey)`, `setItem(logicalKey, stringValue)`, `removeItem(logicalKey)`, `key(index)`, and `length` expose only that immutable scope. Enumeration returns logical names only. There is no broad `clear()` or export method.
- `legacyStatus({keys: [...], prefixes: [...]})` reports only `{present, count}` for explicitly named unbound legacy keys. It never reads their values, adopts or deletes them, or reports another account's namespaced records. Use static known cache/journal names, not account-derived selectors.
- `invalidate()` immediately prevents subsequent access and returns a promise settling cleanup of opened journal adapters. Previously queued durable writes are allowed to settle in their original, immutable scope; this is preservation, not reassignment to another account.

Failure messages are fixed codes: `invalid_storage_options`, `invalid_storage_scope`, `invalid_storage_key`, `invalid_storage_value`, `storage_inactive`, or `storage_unavailable`. No rejected credential, parser excerpt, underlying storage error or account identifier is echoed.

## Existing durable CAS integration

```js
const durable = await cache.openJournals({
  keys: ['jahit_production_journal_v1', 'jahit_meta_journal_v1'],
  indexedDB: window.indexedDB,
  appSyncStorage: window.AppSyncStorage,
  onChange: updateOwnSyncStatus
});
// After authorization and the application's schema migration:
const journal = ProductionJournal.create({
  key: 'jahit_production_journal_v1',
  storage: durable,
  sessionStorage: window.sessionStorage,
  // Prefer an equally scoped, per-page ownerId for the tab's CAS identity.
  ownerId: trustedScopedTabId,
  toView: ownAuthorizedView,
  merge: mergeOwnAuthorizedOperations
});
```

`openJournals()` uses a different IndexedDB database name for every canonical project + database URL + UID + module + schema tuple. Its localStorage source is the scoped cache adapter. The existing `AppSyncStorage.migrateLegacy()` consequently sees only explicitly selected keys in that same authorized scope, never global unbound legacy journals. The CAS implementation is unchanged.

The returned adapter provides the existing journal-facing `getItem`, `setItem`, `removeItem`, `key`, `length`, `status`, `whenIdle`, `refresh`, and `close` methods. Every operation enforces the session guard. Async opening/refresh/durability completion checks the session again before returning. `refresh()` returns the guarded wrapper, never the raw adapter. Underlying errors are redacted. `close()` stops wrapper access immediately and drains/closes its original database; it does not delete records. There is no `exportState()` passthrough. Design a separately reviewed owner recovery/export flow before replacing existing recovery controls.

The scope database is separate from `soldier-app-sync-journals-v1`. No prior database, legacy localStorage value, receipt, recovery copy or original draft is deleted by this API. It does not scan or expose legacy IndexedDB records. Owner migration must explicitly inspect and preserve them.

## Required application work before installation

Reorder each monolith boot to authenticate first, open scoped storage second, and hydrate/render third. Replace every business cache, deletion log, draft, image cache, backup and cross-module fallback with the authorized scoped adapter. Keep only public connection configuration outside business namespaces. Do not call legacy `seedLegacy`, `initialize`, or `resumeSavedDraft` with unbound records on behalf of a new partner.

Quarantine legacy records separately with exact raw copies, checksums and read-back verification; leave originals in place. Partners should see only a generic owner-review notice. A verified owner recovery workflow must explicitly establish the old project, account/worker mapping, schema and server baseline before producing a new scoped candidate. A display name, editable binding or tab token does not establish account ownership. Existing journal recovery APIs may resume only already bound records in the same scope; they must not claim unbound legacy drafts.

On logout/revocation, invalidate the session generation and adapter, stop business listeners/reconnection timers, clear in-memory business views and DOM, then await local durability where needed. Guard every network write and transaction callback separately. Storage scope checks do not themselves cancel an already running Firebase transaction or provide database authorization. Firebase Rules and private verified identity mapping remain the access authority.

Namespaces prevent accidental cross-account cache reuse; same-origin scripts, developer tools or filesystem access can still read plaintext existing records. Sensitive cache retention on shared devices requires a separate protection decision. A changed role/worker binding may also require a new authorization revision in the application's namespace or a fresh server projection before hydration; this prepared tuple alone does not encode those permissions.
