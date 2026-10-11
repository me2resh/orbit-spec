# Validated body prefix for GitHub sync

> Adapters need one workflow line at the top of a synced issue. The fixed body cannot hold it. I chose a validated plain-text prefix option on `orbit sync github` and accepted one more input to validate.

## Context

- `buildGitHubIssuePayload` builds a fixed issue body. `orbit sync github` has no option to change it.
- Some harness workflows require a line at the top of an issue. For example, a governance hook can require `ORBIT slice: <id>`.
- Today an adapter runs `--dry-run`, copies the preview, adds the line, and creates the issue itself.
- That workaround skips the Projects v2 item-add and the `--issue` edit path. Each adapter rebuilds the same write logic.
- AgDR-0005 keeps provider behavior behind `orbit sync`. Provider fields must stay out of ORBIT schemas.

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| Keep the fixed body | No interface change | Adapters keep the manual dry-run workaround and skip the real sync path |
| Add a provider field to the Slice schema | The record carries the text | Couples canonical records to a provider, which AgDR-0005 forbids |
| Add body templates | Full control of the body | Adapters can remove provenance sections, and the interface grows large |
| Add a validated plain-text prefix option to `sync github` | Small interface, generated sections stay intact, same path for preview and write | One more input to validate and document |

## Decision

Chosen: **a validated plain-text prefix option on `orbit sync github`**, because adapters can use the real sync path and the generated body stays unchanged.

The interface addition is:

- CLI: `--body-prefix <text>` or `--body-prefix-file <file>`. The two options are mutually exclusive.
- Library: `syncGitHub({ ..., bodyPrefix })` and `buildGitHubIssuePayload({ ..., bodyPrefix })`.
- Library: `validateBodyPrefix(bodyPrefix)` and `MAX_BODY_PREFIX_LENGTH` (1,024).

The adapter writes the prefix, one blank line, and then the generated body.
The dry-run preview, the create path, and the edit path use the same body.

The adapter validates the prefix and never changes it.
It rejects the prefix before any provider call when the prefix:

- Is empty or contains only whitespace.
- Has more than 1,024 Unicode code points.
- Contains a C0 control other than tab or line feed, DEL, or a C1 control.
- Contains a bidirectional control from U+202A to U+202E or from U+2066 to U+2069.
- Starts or ends with a line break.

The file option removes one final line ending, because text files usually end with one.
The CLI documents this step. It changes no other content.

The record chain is validated before the prefix.
The adapter boundary from AgDR-0005 does not change.
The prefix is a provider input to the sync command. It is not stored in any ORBIT record.

## Consequences

- Adapters can create and edit issues through the real sync path, including the Projects v2 item-add.
- Adapters must supply the prefix on each sync. ORBIT does not remember it.
- A prefix with control characters, such as CRLF line endings, fails. The operator must correct the input.
- Custom titles and templates stay out of scope.

## Artifacts

- [Issue #29](https://github.com/me2resh/orbit-spec/issues/29)
- [AgDR-0005](AgDR-0005-explicit-provider-adapter-boundary.md)
