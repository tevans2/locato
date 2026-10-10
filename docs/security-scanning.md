# Secret scanning and the October 9 catalogue alert

GitGuardian reported eight Generic Password incidents on commit `127e783`. The forwarded email links five incidents, all at line 1 of imported panorama JSON files: Belgium, Bangladesh, Finland, Germany and Croatia. Their password-like strings are Google panorama IDs, including random IDs containing `pwd`. The matching references were verified against the pinned public source metadata described in [the catalogue credits](../public/assets/geoguessr/locations/SOURCES.md). No application password or credential is stored in these records. The other three incident details require access to the GitGuardian workspace; they have not been individually verified or resolved.

The former importer placed every country's references on one long JSON line. The importer now writes one complete tuple per line, preserving every ID, coordinate, heading and country assignment while limiting unrelated scanner context. Content-hashed filenames and the manifest are regenerated together. Catalogue tests check record counts, hashes and the format. This change does not erase the historical alert or establish that GitGuardian has rescanned it successfully; confirmed false positives still need classification in its dashboard.

The earlier staging workflow checked tests, build and service health without a pre-deployment secret scan. Both Fly deployment workflows now fetch full history and run the same mandatory Gitleaks scan before installing dependencies, building or deploying. A separate workflow scans pushes and pull requests on other branches. Scanner download failure, checksum mismatch or a finding fails the job. Gitleaks is pinned to version 8.30.1 and the official Linux archive SHA-256. Reports and logs redact matched values. This CI gate prevents deployment of detected credentials; it does not prevent a credential from reaching GitHub in the initial push.

## Reviewed scanner exceptions

The default Gitleaks rules remain enabled. Only these exact public identifiers are excluded from its Generic API Key rule, and only in the named files:

- `locato.achievements.v1` in the local achievement store and development seed: a browser storage namespace, with no authentication authority.
- The existing Cloudflare Web Analytics beacon identifier in `index.html` and its historical patch: the same public identifier installed in page HTML, not a Cloudflare account API token. [Cloudflare's installation documentation](https://developers.cloudflare.com/web-analytics/get-started/) describes embedding this snippet.

`.gitleaksignore` contains one exact historical fingerprint for a country-label grouping expression in the importer, at line 56 of commit `127e783`. The current variable is renamed to `labelGroup`. The exception does not exclude the file, catalogue, detector or entire commit. New credentials in any of those files continue to fail scanning.

The audit checked all 216 commits reachable at the time of investigation and the current repository files, using redacted results. The configured local Maps key was also compared privately against committed files and was absent. Local `.env` files remain ignored by Git and are now excluded from Docker build uploads, together with local `output/` files.

## Reviewing future findings

Do not paste detected values into issues, logs or chat. Locate the file and credential owner first. If a real credential was published, revoke or rotate it at its provider and update the affected deployment secret; deleting a file or passing a later scan does not invalidate a leaked credential. Review historical removal separately, with the repository owners, instead of force-pushing shared branches during an investigation.

For confirmed false positives, record the evidence and prefer exact value-and-path exceptions or one historical fingerprint. Never ignore the entire metadata directory or disable a detector to make a check pass. GitGuardian remains an independent monitor; a green Gitleaks check does not close its incidents.
