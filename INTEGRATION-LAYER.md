# Google Workspace integration layer

Implementation branch only. No migration, Edge Function, scheduler, DNS record or production UI has been deployed. The default configuration is disabled. Workspace/domain setup is owner-managed; this implementation has not verified the live CRM OAuth connection.

## Architecture

The existing ticket remains the operational center. The new lazy-loaded panel adds original files, versions, customer history, virtual mailboxes and supplier deliveries without changing the existing photo compression, chat, library, customer merge or startup loading paths.

Browser → authenticated integration-api → IntegrationService → GmailAdapter / DriveAdapter / SupabaseStorageAdapter. A durable encrypted outbox is processed by integration-worker. Google OAuth uses a single-use expiring state, PKCE and encrypted refresh tokens. Public browser code contains no Google credentials, service role key, resumable Drive URI or worker secret.

All new tables have the dtg_ prefix. They cover configuration, one Google connection, private encrypted values, logical inboxes and access, email metadata and relationships, assets and immutable physical versions, ticket usages and exact-version approvals, resumable uploads, suppliers, managed grants, deliveries, jobs and append-only events. Original-ticket RLS remains authoritative even when a file is reused. Reuse adds a relationship and does not duplicate the original or inherit approval.

The Supabase migration relies on existing profiles, tickets, clientes, productos and the current is_admin, is_active_member and ticket_is_visible_to_me functions. Review those live definitions before any future rollout. Database tests use representative fixtures and do not establish the state of production permissions.

## Storage and version rules

The configurable initial threshold is 25 MiB. AI/PSD/TIFF/EPS/RAW and production purposes force Drive. Supabase receives other small originals in a new private bucket, without resizing. Existing photo upload code is unchanged. Drive transfer uses 4 MiB chunks, server-confirmed offsets and resumable sessions. Final size and available checksum are recorded before availability. Supported maximum is 2 GiB; real platform and network limits still require staging validation.

Stages are Draft, Proof, Approved, Print Ready and Archived. Changing a version away from Print Ready invalidates production approval. Approval belongs to one physical version and one ticket usage. Selecting a current version does not approve it. Downloads verify Drive size/checksum and stream through the authenticated backend. The UI uses the browser File System Access API for large Drive downloads; supported desktop Chrome/Edge is required.

Previews are independent private JPEGs capped at 1 MiB. A Google raster thumbnail may be used when available. No AI/PSD/TIFF render farm is included: unsupported originals keep an icon/state and accept a manual lightweight companion preview. Google originals remain intact.

## Mail and supplier behavior

One Google mailbox is synchronized once. Messages may belong to several aliases using recipient/delivery-header evidence. Unknown BCC routing is not invented. Gmail remains the source of message bodies and attachments; the CRM stores metadata and authorized relationships. Bodies are requested on demand and rendered as plain text. The current UI does not include a separate Gmail attachment download control. Each logical inbox has explicit read/send grants, signature and verified send-as status. Linking a message to a ticket does not bypass inbox permissions.

Supplier commands snapshot the ticket, physical version, actor, recipient and expiry. Only Print Ready versions approved for that usage can be sent normally. Backend administrative overrides require a reason and are audited. Permissions are specific type=user, role=reader with native expirationTime, never public links. Files/folders with unsafe inherited access are rejected. Small Supabase originals receive an explicitly tracked private Drive delivery copy while the canonical original stays in Supabase.

Grant creation and email sending have separate durable states. Worker retries reconcile uncertain Gmail sends by RFC Message-ID before attempting another POST. An uncertain permission creation requires explicit administrative reconciliation. Revocation stays pending until confirmed by Drive; it does not remove a grant still needed by another active delivery. Expiration cannot revoke copies already downloaded by recipients.

The worker rechecks active membership, ticket visibility, inbox send access and production approval at execution. Job claims and upload claims use expiring leases. Repeated provider failures use bounded backoff. Unknown sends are not automatically resent. Gmail history invalidation triggers resync without removing existing CRM metadata.

## Future rollout procedure

1. Finish Workspace/domain setup using WORKSPACE-956PRINT-SETUP.md. Confirm the real primary account and aliases.
2. Review and apply the additive migration to a staging project first. Keep integrations disabled. Verify existing helper functions and all RLS against representative real roles.
3. Create a Google Cloud OAuth web client for this Workspace organization, enable Gmail and Drive APIs, and configure the exact callback URL. Requested scopes are Gmail readonly/send/settings.basic and Drive drive.file. Confirm organizational OAuth and external sharing policy.
4. Configure backend secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, INTEGRATION_ENCRYPTION_KEY (32 random bytes encoded base64url), INTEGRATION_WORKER_SECRET, CRM_ORIGIN (exact HTTPS origin), and optionally GOOGLE_DRIVE_PARENT_ID (private owner-only folder). Supabase backend URL, anon key and service role key remain server environment values. Never place these secrets in index.html, logs or Git.
5. Merge the function settings in supabase/integration-functions.toml into the actual deployment configuration. JWT checks are performed in integration-api; OAuth callback authenticates one-use state; worker authenticates x-dtg-worker-secret. Deploy only after explicit deployment authorization.
6. Configure a server-side scheduler to POST to integration-worker periodically with its secret. One call processes one job; scheduler throughput must cover expected mail and preview volume. Scheduling is not included or activated by this branch.
7. Connect Google from the admin panel, validate send-as aliases and assign mailbox permissions. Test native expiry with the purchased Workspace edition; blocked or unconfirmed expiry must remain blocked, with no public-link fallback.
8. Exercise real 500 MiB uploads, interruption/reselection/resume, exact-version approval, supplier delivery, outage/retry, uncertain-send reconciliation, revocation and customer merge in staging. Local upload tests simulate Google; no live transfer is claimed.
9. Enable the configuration and release the UI only after approval. Roll back by disabling integrations and stopping the scheduler; retain file and audit metadata. Existing granted permissions still require explicit revocation.

Resumable sessions are server durable. The current panel retains the selected-file/session association in memory; after a page reload an operator must recover the authorized session and reselect the identical local file via the API workflow. There is no background upload daemon or persistent browser queue. Mail and file lists are bounded/paginated API reads; the mailbox panel currently shows the latest 50 entries.

## Validation

- `node --test tests/integrations.test.mjs`: 21 passing tests, including a bounded simulated 500 MiB transfer and lost-response recovery.
- `DTG_PGLITE_PATH=<pglite dist/index.js> node --test tests/integrations-db.test.mjs`: migration and RLS pass in an isolated local PostgreSQL engine.
- `node tests/integrations-ui.cjs`: mocked backend browser workflow, no startup integration requests, version selection, durable command key, draft preservation, safe body display, client history, session reset and 320–1280 px layouts.
- Deno check of all three Edge Function entrypoints passes. integration-deno.lock pins dependencies.
- Existing ASTRA-QA, APP-STARTUP-QA, CLIENTS-WORKSPACE-QA, LIBRARY-QA and SUPABASE-USAGE-QA pass locally.
- CHAT-INBOX-QA passes. ASTRA-02-QA fails on undefined renderWorkOrdersPanel; the same failure is reproducible on the untouched baseline f6eac8518961f08f3706a520b82f0d1ac2adba9d.

These checks are local and use fixtures. They do not validate purchased-account capabilities, real OAuth consent, DNS, actual Supabase deployment or email delivery.

## References

- [Drive sharing and expiry](https://developers.google.com/workspace/drive/api/guides/manage-sharing)
- [Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)


## Customer form handoff

`client-forms.js` uses the existing `DTGIntegrations.open({ticketId,customerId,seq,draftEmail:{subject,body,to?}})` panel. The supplied text is an editable draft only. Sending continues to use `integration-api` action `sendEmail`, `inbox_id`, `ticket_id` and `idempotency_key`; it returns a queued operation, not a delivery receipt. No second Gmail endpoint, OAuth connection, email table or file registry was introduced. Without a loaded enabled configuration and a verified send-as inbox, the send button stays disabled.

Existing File Engine contracts remain authoritative: `beginUpload`, `resumeUpload`, `completeUpload`, `reuseFile`, `setCurrentVersion`, `getFileAccess`. Public form uploads are not wired to these authenticated actions. A future public uploader requires a separate bounded token authorization bridge; do not grant anonymous access to the file registry or storage.
