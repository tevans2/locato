# Territory flag sources

The territory/dependency gallery intentionally uses full SVG artwork rather than the simplified 3:2 icon set.

- **`region-flags@1.1.0`** supplies the detailed, native-proportion Wikipedia-derived SVGs for most territories, including emblem-heavy British territories, Ascension Island, Saint Helena, Tristan da Cunha, and Mayotte.
- **`svg-country-flags@1.2.10`** supplies the detailed Saint Barthélemy and French Southern Territories artwork where the region set otherwise aliases/simplifies the design.
- **France aliases (`GP`, `PM`, `RE`)** reuse `public/assets/flags/fr.svg`, keeping those entries identical to the main country flag set.
- **Project-owned current/split flags** are kept for Bonaire (`BQ-BO`), Saba (`BQ-SA`), Sint Eustatius (`BQ-SE`), Saint Martin (`MF`), and the current Martinique flag (`MQ`).

Run `npm run sync:territory-flags` after dependencies are installed to materialize the package-backed SVGs into this directory.
