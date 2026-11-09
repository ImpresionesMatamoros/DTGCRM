-- Keep the issued PDF private and tie access to the saved document's ticket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-document-pdfs', 'ticket-document-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy ticket_document_pdf_read
on storage.objects for select to authenticated
using (
  bucket_id = 'ticket-document-pdfs'
  and (select public.is_active_member())
  and exists (
    select 1 from public.documentos d
    where d.ticket_id::text = split_part(name, '/', 1)
      and d.id::text || '.pdf' = split_part(name, '/', 2)
      and name = d.ticket_id::text || '/' || d.id::text || '.pdf'
      and public.ticket_is_visible_to_me(d.ticket_id)
  )
);

create policy ticket_document_pdf_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ticket-document-pdfs'
  and (select public.is_active_member())
  and exists (
    select 1 from public.documentos d
    where d.ticket_id::text = split_part(name, '/', 1)
      and d.id::text || '.pdf' = split_part(name, '/', 2)
      and name = d.ticket_id::text || '/' || d.id::text || '.pdf'
      and d.pricing_snapshot -> 'pdfArchive' = 'true'::jsonb
      and public.ticket_is_visible_to_me(d.ticket_id)
  )
);
