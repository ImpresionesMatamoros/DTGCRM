-- Cover new relationships; keep service-only tables inaccessible to the browser.
create index dtg_library_folder_connection_idx on public.dtg_library_folders(connection_id);
create index dtg_library_grant_actor_idx on public.dtg_library_grants(actor_id);
create index dtg_library_grant_expiry_idx on public.dtg_library_grants(expires_at);
alter policy dtg_identity_self on public.dtg_library_identities using(public.is_active_member() and actor_id=(select auth.uid()));
