# Bog Road Walk

Offline field map of 844 Bog Road (Hillsborough, NH, Tax Map 3 Lot 39) for walking the ACEP-WRE easement drafts.

- Field app: https://jlcaron401.github.io/bogwalk-vj1ky6/ (Add to Home Screen in Safari; works with no service once loaded)
- Read-only presentation (e.g. for NRCS): https://jlcaron401.github.io/bogwalk-vj1ky6/?view

Base maps: USDA NAIP aerial, LiDAR terrain with 10-ft contours (USGS 3DEP), USGS Topo. Overlays: both easement drafts,
property line (NH GRANIT tax map), NWI wetlands, NHD brooks, lots, tower spots. Pins ("Easement OK", "Keep for us", photos),
walk tracks, navigation to a pin, press-and-hold spot info. Photos carry GPS / heading / time EXIF.

Pins stay on each phone (IndexedDB). "Share" makes a zip (bogwalk.json, KML, GPX, GeoJSON, photos) to AirDrop.

Build (from `844 Bog Road Maps/_src/lots/`):
- `build_walk_app.py NAIP_DIR`: tiles, layers.js, elev.bin, precache.js
- `publish_pins.py a.zip b.zip`: bake shared field notes into the ?view map
- After any change bump `VERSION` in `sw.js` (and `APP_VERSION` in `app.js`), commit, push.

Boundaries are working drafts for discussion, not a survey.
