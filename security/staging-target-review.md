# Prepared staging target guard

This change is limited to `https://soldier-access-uji.web.app` and `https://soldier-access-uji.firebaseapp.com`. The known staging hosts on HTTP or a nondefault port fail closed. Normal legacy configuration selection on other hosts remains unchanged. Canonical routing runs before this legacy staging code.

`access-control.js` pins the reviewed Firebase WEB configuration in a private, frozen source literal. It contains only the public browser configuration needed for Firebase login and connection. It contains no Admin credential, service-account key, Shopee or AI secret, account roster, UID, token or financial record. A caller-defined window property, stored setting, query or fragment cannot choose the staging target.

Firebase documents browser API keys as project identifiers; database authorization still depends on Rules and IAM. Before release, review this project's actual API restrictions and keep any non-Firebase billable API keys separate and private. Those restrictions have not been verified here. See the [Firebase API-key guidance](https://firebase.google.com/docs/projects/api-keys) and [security checklist](https://firebase.google.com/support/guides/security-checklist).

The guard validates exact own data fields and the approved origin. It rejects a caller's different normalized configuration before importing the SDK, and rejects inherited or getter-based input without reading those getters. Staging connection editing is disabled. A mismatch after authorization invalidates the existing context and locks its business adapter.

Existing connection settings and drafts are preserved. The legacy initializer can still fill an absent module connection setting with the reviewed public configuration; that is a local configuration write. It does not overwrite an existing setting or write a business record. Invalid reviewed source cannot perform that prefill.

The regression suite replaces the reviewed literal and SDK imports with synthetic fixtures. It checks target priority, configuration mismatch, exact origins, malformed source, getter rejection, preservation of existing state, allowed public prefill, context invalidation, unchanged nonstaging behavior and canonical-first routing. It does not authenticate a real account or contact a database.

The prepared staging banner selects no connection and reads or writes no browser storage. The local staging generator must use that reviewed banner and the current guarded access source; older staging archives or employee-update overlays must not replace it during release assembly.

This prepares a draft change. Live served configuration bytes have not been verified, and no staging deployment is established by these tests. It does not establish a fix for the observed Google network/popup failure, change database Rules or prove partner wage privacy.
