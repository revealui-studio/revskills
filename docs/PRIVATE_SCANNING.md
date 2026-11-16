# Private detection rules

Client, prospect and relationship dictionaries belong in private configuration.
This repository contains the scanner and fabricated tests only. Public results
contain opaque rule IDs, SHA-256 file references, and line numbers (zero means a
filename match). They never include matched content, dictionary values or paths.

The scanner requires a nonempty JSON array in a mode-0600 regular file:

```json
[{"id":"rule-001","literal":"Fictional Client Canary"}]
```

Run trusted scanner code against candidate data:

```bash
node scripts/check-client-leaks.mts --rules "$PRIVATE_RULES_FILE" "$CANDIDATE_ROOT"
```

Missing configuration, invalid input, unreadable files and empty scopes fail
closed. Every file and relative filename is checked, including binaries and
dependency directories. Only Git bookkeeping (`.git`) is excluded. Symlink
targets are inspected as text; external targets are never followed. The private
rule file itself cannot be inside the candidate scope.

The GitHub workflow runs code from the protected base revision and checks out
the candidate separately as data. It never runs candidate scripts or installs
candidate dependencies. Issue, pull-request and comment text is also treated as
data, without interpolating it into shell commands. Rules come from the encrypted
repository secret `CLIENT_LEAK_RULES_JSON`; their temporary file and event input
are deleted on both success and failure.

Provisioning this secret transfers the private dictionary to GitHub. It requires
the owner's explicit approval for that payload and destination. After approval,
use standard input, never command arguments or an echoed value:

```bash
gh secret set CLIENT_LEAK_RULES_JSON -R RevealUIStudio/revskills < "$PRIVATE_RULES_FILE"
```

Provision the secret before merging the workflow; without it the gate fails.
The workflow becomes active when its reviewed implementation reaches the
protected default branch. Local synthetic tests do not establish that hosted
Actions ran. Removing private literals from this revision does not rewrite
existing Git history or remote copies.
