# Secret scanning

Both Fly deployment workflows fetch full history and run the same mandatory Gitleaks scan before installing dependencies, building or deploying. A separate workflow scans pushes and pull requests on other branches. Scanner download failure, checksum mismatch or a finding fails the job. Gitleaks is pinned to version 8.30.1 and the official Linux archive SHA-256. Reports and logs redact matched values. This CI gate prevents deployment of detected credentials; it does not prevent a credential from reaching GitHub in the initial push.

Local `.env` files remain ignored by Git and are excluded from Docker build uploads, together with local `output/` files.

## Reviewed scanner exceptions

The default Gitleaks rules remain enabled. Only these exact public identifiers are excluded from its Generic API Key rule, and only in the named files:

- `locato.achievements.v1` in the local achievement store and development seed: a browser storage namespace, with no authentication authority.
- The existing Cloudflare Web Analytics beacon identifier in `index.html` and its historical patch: the same public identifier installed in page HTML, not a Cloudflare account API token. [Cloudflare's installation documentation](https://developers.cloudflare.com/web-analytics/get-started/) describes embedding this snippet.

## Reviewing future findings

Do not paste detected values into issues, logs or chat. Locate the file and credential owner first. If a real credential was published, revoke or rotate it at its provider and update the affected deployment secret; deleting a file or passing a later scan does not invalidate a leaked credential.

For confirmed false positives, record the evidence and prefer exact value-and-path exceptions or one historical fingerprint. Never ignore a whole directory or disable a detector to make a check pass. GitGuardian remains an independent monitor; a green Gitleaks check does not close its incidents.
