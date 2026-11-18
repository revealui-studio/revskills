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

The GitHub workflow runs code from its own trusted revision (`github.workflow_sha`)
and checks out the candidate separately as data. This keeps scanner helpers
aligned with the reviewed workflow even when a promotion targets an older branch.
For `pull_request_target`, GitHub selects the workflow from the base repository's
default branch; the PR target can be a different branch. See GitHub's
[event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)
and [workflow context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context).
The job never runs candidate scripts or installs
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

## Linux descriptor traversal

The scanner requires Linux or WSL with `/proc/self/fd` mounted. Node does not
expose a portable `openat` API, so unsupported hosts fail closed with an
explicit Linux requirement. The hosted gate uses a Linux runner. There is no
path-based fallback.

The dictionary and candidate regular files are opened with `O_NOFOLLOW` and
`O_NONBLOCK`, then checked and read through the same descriptor. The dictionary
must have exactly mode `0600`; an in-scope hard link to its device/inode is
rejected before reading candidate bytes. Directory ancestors are opened with
`O_DIRECTORY | O_NOFOLLOW`. Candidate children are opened with
`O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, then classified by `fstat` on that same
descriptor; directories are walked through `/proc/self/fd/<directory descriptor>/`.
Symlinks contribute their link
text only. Directory and file metadata is checked again after reading, so a
concurrent mutation makes the scan incomplete. Every distinct candidate
filename is checked, including two names sharing a nonprivate inode.

Synthetic race coverage is in `test/client-leak-races.test.ts`.
