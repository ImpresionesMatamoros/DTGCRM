# Pirate reactions and geographic delivery picker

Seven original vector pirate-cat reactions share a warm apricot coat, dark patch on the same eye and distinct expressions: celebrate, ack, im_in, love, laugh, surprised and oh_no. Native SVGs remain clear at 22–32px, with large invisible button targets, existing reaction labels/counts and identical stored reaction IDs. Historical terrible/confused reactions also render using the cat family. Only hover/focus adds a subtle movement; reduced-motion preference disables it. Exported SVG assets are available under assets/reactions; the runtime embeds the same shapes to avoid extra network requests.

Delivery locations retain existing city IDs and storage behavior. The 26 city markers use geographic coordinates rather than a schematic grid. Texas locations use representative coordinates from the 2024 US Census Places Gazetteer; Matamoros, Reynosa and Starbase have reference center coordinates. The local projection adjusts longitude for latitude near 26° and keeps north up. Labels have leader lines and collision avoidance. Simplified Rio Grande, coast and road corridor provide orientation, with a north arrow and approximate 20km scale. These lines are orientation aids, not detailed cartographic boundaries. No external tiles, keys, location permission or new subscription is required. Pan, zoom, keyboard selection and text search remain available. Opening an assigned ticket centers its city.

Sources:
- US Census Gazetteer: https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2024.html
- Texas coordinate data: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_gaz_place_48.txt
- Matamoros geographic reference: https://www.tamaulipas.gob.mx/estado/municipios/matamoros/
- Starbase reference: https://www.wikidata.org/wiki/Q16950811

Validation: CAT-MAP-QA.cjs exercises 26 cities, coordinate relationships, label bounds/no overlap, zoom/reset, real location writes in the mock persistence fixture, seven distinct reaction SVGs and 320/390/768px. CHAT-INBOX-QA.cjs verifies mobile/hover reaction menus, labels and existing chat flows. Ticket intuition and task regressions pass. No database migration needed.
