# Library new-image indexing and compact captions

Library now uses ticketPhotos, the same current attachment index as Kanban, instead of only legacy bitacora files. New ticket-conversation images, linked chat images and readable unlinked conversation images join the library. Public images marked no-ticket-required also remain discoverable. Storage bucket/path deduplication prevents repeated legacy/chat copies. Existing unlinked public photos remain in organizing cards; conversation-linked photos are excluded from that pending section.

Attachment viewers retain the original storage bucket, including chat-private. Post IDs are not passed to legacy bitacora-photo deletion. Deleted/pending images are excluded, and private conversations belonging to other users are excluded in addition to server RLS filtering. Existing filters and signed URL loading remain in use.

Cards use borderless square photos and small caption strips. Additional descriptions are hidden on cards; organizing actions expand on demand, with mobile touch targets retained.

LIBRARY-FIX-QA.cjs covers new private ticket-chat images, resolved public images, unrelated DM exclusion, deleted image exclusion, correct viewer bucket, deletion safety and compact metadata, plus the existing library fixture tests. Mobile-app and touch-ticket suites pass.
