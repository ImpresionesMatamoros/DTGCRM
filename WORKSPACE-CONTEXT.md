# Contextual ticket workspace

Desktop sidebar: Calendar prioritizes delivery dates and prominently marks undated tickets; drag onto a date to schedule. Changing an existing delivery asks for confirmation and offers Undo. Responsible Kanban shows owner names. Library gives every row an image slot and places tickets with photos first, preserving search filters.

Responsible board: Unassigned and your own column stay first. Mi tablero lets each signed-in person reorder colleagues, partially collapse columns and restore defaults. Preferences are local to this device and user. Pending tasks appear above the ticket photo, with quick completion preserved.

Ciclo / Gantt: secondary Tickets view sorted by longest lifecycle by default. Creation to actual delivery (or closure when there was no delivery); ongoing ends today. Promised delivery is a separate marker. Includes active, overdue, total and completed-cycle median, search, scopes and cancelled handling. Cancelled cycles do not distort completed median. Responsive 320–1440px.

Notifications: only direct messages (including attachments), explicit personal mentions, and replies/comments on your own publication. Foreground and server push share these rules. General team messages and unrelated private conversations are excluded. Existing notification hours and per-user settings remain effective. Added missing reply tone and a Probar sonido control. Reconnect banners become a small red corner indicator after four seconds offline.

Concurrent editing: authenticated, RLS-preserving field-level compare-and-set RPCs cover ticket fields, delivery dates, products, tasks and client data. Different fields merge. Stale changes to the same field are rejected, preserving the draft and offering a comparison between current and proposed values. Choosing your edit still checks the latest server value. Background refresh preserves live inputs. RPCs require original values and whitelist editable fields.

Validation: WORKSPACE-CONTEXT-QA.cjs, PUSH-TARGETS-QA.cjs, calendar, responsive calendar, Kanban workspace, tasks, touch tickets, mobile app, account switching and WhatsApp inbox regression suites. Database SQL assertions run transactionally with rollback; include stale field protection, unrelated-field merge, date race protection, notification recipients and permissions. No real test notifications were sent. Browser uses mocked persistence; database tests exercise authenticated RPCs against the real database.

Production migrations applied: 20261002044521_workspace_context_concurrency_notifications and 20261002050201_workspace_client_edit_concurrency.
