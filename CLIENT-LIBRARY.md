# Client library — pilot release, 2026-10-06

Originals selected from business computers are uploaded directly to bound Google Drive resumable session URLs. Owner OAuth tokens stay in the backend. Initiation includes the CRM Origin so both 308 and final PUT responses have browser CORS. Offsets are reconciled with Google; sent length is never treated as confirmation after a failed response.

Files use the existing dtg_assets/dtg_files registry. General client assets have a null origin ticket. Ticket assets retain origin-ticket RLS; reuse never broadens that visibility. The catalog uses keyset pagination, SHA256 duplicate proposals, immutable versions, exact-version production approvals and merged-client history. A manifest persists batch progress locally without storing OAuth tokens or resumable URLs. Reselection rehashes the full file in a bounded-memory Worker. Source directory paths are manifest information, not reconstructed folder trees.

Managed folders are private My Drive folders owned by the connected Workspace account. Staff individually verify an identity from the configured Workspace domain using OpenID email authorization. The CRM account and its authentication provider do not change. Direct file opens grant managed, per-file, expiring reader access. The worker reconciles expiration, inactive actors and lost origin-ticket visibility. Ancestor checks stop at the managed root, avoiding access to unrelated My Drive roots under drive.file scope. Broadly shared folders and unmanaged existing grants are rejected rather than silently replaced.

Small existing images use lazy private derivatives: avatar 96px, card 320px, max128KiB. The API checks source Storage RLS before resolving or registering a derivative. First use may fetch the prior image to generate the derivative; later use resolves the stored one. Full photo zoom, library viewer, ticket gallery and KDS detail keep the larger source. Thumbnails live in a private bucket with no direct browser policies. Account reset invalidates cached responses. CDR previews can be added manually; Google previews are requested explicitly.

The legacy integration panel routes new original uploads into this library when loaded; the historical proxy API is retained for compatibility and rollback.

## Automatic ticket attachments

The ordinary ticket chat attachments and ticket photo batches now route recognized design extensions/MIME (CDR, PSD/PSB, AI, PDF, SVG, TIFF, etc.), photos >=5MiB, and other files >25MiB directly to Drive through the existing library session API. Ticket/customer scope is captured before upload. Missing clients are rejected; the original never falls back to a Supabase proxy. Files up to2GiB are admitted by the ticket chat; backend policy is still authoritative. General and personal chat attachments without ticket context retain their previous behavior.

Bounded-memory full hashing and persisted, actor/ticket/content/name-specific idempotency keys let message retries reuse the uploaded original. Recovery queries the provider's confirmed offset. Local storage contains keys, not owner tokens or upload capability URLs. Logout aborts work and clears memory. Compatible raster originals get <=128KiB/320px previews; only these small images travel through Storage. Original links are stored in existing references_data or bitacora payloads, with original-file RLS enforced when clicked. Private messages keep ticket_id null and use their conversation scope, as required by the existing database guard.

tests/automatic-attachments-ui.cjs passes using the actual transfer helper and app upload functions: small CDR, 30MiB PSD, heavy photo, small photo, byte-preserving direct PUT, preview-only Storage writes, private message rules, message retry, session reset and missing-client rejection. Library/integration UI, startup, scroll and usage regression checks pass. CHAT-WHATSAPP-QA.cjs has a pre-existing notification assertion failure, reproduced against the unmodified baseline; the new automatic-attachment checks pass independently.

## Deployment and verification

Applied to staging hhzqmqndavqqswerjhxe and production jpjpnxamiclvhmcywyhx:
- client_drive_library
- workspace_idle_polling
- library_pilot_checks
- library_client_merge_history

These were applied with the Supabase migration connector. Remote migration versions may differ from the local CLI filenames; reconcile history before using db push. Do not blindly apply the SQL again.

Production functions: integration-api v9, google-oauth-callback v7, integration-worker v11. Staging functions v5. Existing custom JWT/worker-secret authentication is preserved. Source also preserves production fixes for personal mailbox grants and primary Gmail sendAs aliases that were newer than the repository baseline.

The production readiness probe passed: private temporary folder, direct two-chunk upload without owner token in PUT, CORS matching https://crm.956print.com, confirmed offset262144, exact bytes, correct parent; temporary objects deleted. Google reported quota322122546000 bytes, approximately300GiB, which does not confirm the owner's expected2TB. No user content was migrated. Individual employee OAuth and native downloads are pilot acceptance steps.

40 backend/DB tests pass plus browser library QA at1280/390, APP-STARTUP, SCROLL-POSITION, SUPABASE-USAGE and integrations-ui regression. Browser mock deliberately aborts one upload response to test reconciliation. RLS advisors correctly identify service-only tables with no client policies; no browser grants should be added to silence those informational notices. New FK indexes and identity initplan issues were addressed. Broader pre-existing advisor notices are outside this release.

## Operations

library_enabled controls the new library independently from the existing integrations flag. Disable it to pause direct library operations without deleting metadata. Previously granted Google access requires reconciliation; UI rollback is not ACL revocation. Read access expires in one hour; revocation is bounded by provider availability. Never make managed folders public or domain-shared. Do not change the connected owner without reconciling folders and grants.

sync_interval_seconds defaults300; cron still runs each minute but dispatches the worker only for eligible work, due sync or revocations. Pending work remains eligible everyminute. Realtime remains active. Task writes refresh relevant tables. Report measured egress/log changes after a representative pilot; never claim zero logs or measured percentage savings from request counts alone.

Deferred beyond the local-computer pilot: Google Picker import of existing remote files, shared-drive ownership rollout, bulk historical conversion/migration, scheduled backup restore drill and business-wide migration. Original local files are not deleted.
