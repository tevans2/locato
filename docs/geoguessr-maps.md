# GeoGuessr maps

The lobby offers World, six regions and 24 country maps. The selected map is saved on this device; selecting a card does not abandon a trip until Play is pressed. Each map has separate leaderboard scores and local bests. World keeps the empty variant ID for existing scores.

## Real location catalogue

World now contains **115,271 unique Google panorama references across 97 country codes**. **35,539** include original GPS coordinates; **79,732** contain only a real panorama ID. Missing GPS is never replaced with a city/country centre or random coordinates. Google supplies current starting coordinates before scoring.

Sources: G³ (79,732), WanderBench (29,885) and StreetView360AtoZ (5,654), after deduplication and geographic filtering. Four headings of one panorama count as one location. Ambiguous G³ country assignments, unsupported territories, malformed IDs and out-of-polygon graph nodes are excluded. [Credits and pinned revisions](../public/assets/geoguessr/locations/SOURCES.md) accompany the metadata; credits are linked from How to play. Only metadata was imported, never third-party copies of Google imagery.

This is a finite historical catalogue. The imported count is not a claim that all IDs are live today, that it is GeoGuessr's proprietary pool, or that Google's entire Street View inventory has been enumerated. Every selected panorama is checked when its round loads. A replaced ID can recover by original GPS when that GPS exists; otherwise another real reference is used. Both browser and ranked play enforce the selected country after lookup. Scoring always uses the current resolved start, never the player's later position.

## Loading and selection

The metadata lives in 97 compact country files (about 4 MB total), outside the JavaScript bundle. Each filename includes a content hash. Country trips download only that country's file; World chooses a small set of countries before downloading their files. Successful downloads are reused between games and production country files receive immutable browser caching. Runtime gameplay uses checked-in assets, with no Hugging Face dependency.

Selection is seeded and country-balanced. A trip visits different available countries before repeating one. It never repeats a panorama ID within a trip, and known GPS starts are kept at least 1 km apart to avoid adjacent graph nodes. Five rounds retain 5,000 points per round / 25,000 per trip.

The server reads the catalogue once. `GET /api/geoguessr/locations?map=france` returns at most 20 candidates, including replacements for disappeared coverage. Server-scored games choose their own references, resolve the private scoring origin, render that exact panorama ID and reveal it only after the guess. Replacement attempts have a time budget. Regional receipts cannot post to the World board. Shared catalogue records are never mutated while preparing a game.

## Discovery and configuration

The previous 698 search anchors remain emergency fallbacks; the separate three-attempt country-guess mode keeps its original 168 frames. The existing generated cache can discover more panoramas inside country polygons in the background. Default discovery remains 100/day, retaining 20,000 generated entries; **these settings do not cap the 115,271 imported references**. Empty refreshes respect the interval and credential/quota errors stop probing.

Ordinary play needs the existing Google Maps JavaScript browser key and can use the whole catalogue even without a server key. Ranked images need the server's Google Street View metadata/static credentials. The server reports imported and generated counts separately. Google does not publish an exhaustive inventory or GeoGuessr's proprietary location-selection algorithm; outdoor lookup also does not guarantee exclusively Google-car imagery.

## Reproduction and checks

Run `node scripts/import-geo-locations.mjs /path/to/g3-metadata /path/to/WanderBench /path/to/caption_metadata.txt` with the pinned metadata in the credits. It deduplicates, filters, partitions by country and generates `catalogueManifest.json` with exact counts and file hashes. Decorative map artwork is still regenerated with `node scripts/generate-geo-map-art.mjs`.

Tests check all 115,271 IDs, file hashes, coordinate/reference separation, all 31 map filters, partial loading, nonrepeating queues, Google ID lookup and stale-ID recovery, country boundaries, private scoring and immutable source records. The real-Google preview at `/tests/fixtures/geoguessr.html` now uses the catalogue; `?fixed=1` retains fixed starting points for visual comparisons.
