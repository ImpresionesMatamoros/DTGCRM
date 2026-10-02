# Winking cat reactions and modular library

The reaction cat always winks, without an eye patch. Soft radial shading, muzzle highlights and delicate contours replace the pirate treatment across chat, ticket conversations and the library's existing reaction controls. The seven stored reaction IDs remain unchanged. Exported SVGs match the embedded runtime art.

Library images now use square media tiles with compact client/ticket/author captions. Unlinked images are modular cards rather than full feed posts. Their organizing disclosure retains linking, ticket creation, no-ticket resolution and reactions, using the existing handlers and persistence. Reaction controls display the same seven cat expressions with accessible labels and 44px targets; open tools remain open after updates. Search, author/date filters, logos, linked-image viewer and unlinked preview remain available. Layout uses two columns on mobile and an adaptive desktop grid.

Validation: LIBRARY-QA.cjs covers linked/unlinked previews, seven vector reactions, stable reaction upserts, linking picker, filtering, square media and 320–1280px overflow. Existing mobile-app and chat-inbox suites pass. No schema migration.
