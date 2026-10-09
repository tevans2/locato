# Locato panorama metadata credits

The World pool contains **115,271 unique Google Street View panorama references across 97 country codes**. 35,539 records include original GPS coordinates; the remaining 79,732 are panorama-ID references. Coordinates used for scoring come from Google's current panorama response. Historical references are checked at play time; this count does not claim that every ID is still available today.

No Street View images were imported or redistributed. Google Maps and Street View load through the existing Google APIs.

## Sources and licenses

- **G³: Geolocation via Guidebook Grounding**, Grace Luo, Giscard Biamby, Trevor Darrell, Daniel Fried and Anna Rohrbach, 2022. [Assets](https://huggingface.co/g-luo/geolocation-via-guidebook-grounding), [project](https://github.com/g-luo/geolocation_via_guidebook_grounding), [paper](https://aclanthology.org/2022.findings-emnlp.430/). Assets declare **Apache License 2.0**. Revision `fc94195e87265fbf9e7c5ddadb6427e04b2f7202`. Metadata files: `dataset/train/train.csv`, `dataset/val/val.csv`, `dataset/test/test.csv`, `dataset/pseudo_labels/countries.json`, `dataset/guidebook.json`. Contribution after filtering/deduplication: **79,732** panorama references.
- **WanderBench: Learning to Wander**, Yushuo Zheng, Huiyu Duan, Zicheng Zhang, Xiaohong Liu and Xiongkuo Min, 2026. [Dataset](https://huggingface.co/datasets/Yushuo-Zheng/WanderBench), [paper](https://arxiv.org/abs/2603.10463). **Creative Commons Attribution 4.0 International**: https://creativecommons.org/licenses/by/4.0/. Revision `e3c1b7a5ed28cb796c36effd40d39496ef4fba3c`. Panorama nodes and GPS from graph JSON files only. Contribution: **29,885** unique in-country records.
- **StreetView360AtoZ / StreetView360X**, Everett Shen, 2024. [Dataset](https://huggingface.co/datasets/everettshen/StreetView360AtoZ). **MIT License**. Revision `f0b9ffb20c4dc68d4422db97b7da7b577970650e`. Only `caption_metadata.txt` was imported; filenames contain panorama IDs and capture coordinates. Contribution: **5,654** additional records.

## Changes made by Locato

Converted metadata into compact country files. Deduplicated panorama IDs across sources and all camera views. Used original GPS to locate countries in the shipped map geometry. Converted WanderBench headings from radians to degrees. Kept G³ country assignments only when all attached guidebook country labels intersect in exactly one ISO3 country. Excluded ambiguous assignments, unsupported territories, malformed IDs and coordinates outside the map's country polygons. Never substituted a country/city centroid for missing GPS. Panorama-ID-only records keep their GPS absent until Google resolves them.

Each file is named with its SHA-256 prefix for reliable caching. Rebuild with `scripts/import-geo-locations.mjs` and the pinned source metadata. Counts describe a finite public metadata pool, not GeoGuessr's proprietary pool or all possible Google panoramas.

Apache 2.0 and MIT license texts accompany this document in `APACHE-2.0.txt` and `MIT-StreetView360X.txt`. WanderBench remains available under CC BY 4.0; attribution and change notices must accompany reuse.
