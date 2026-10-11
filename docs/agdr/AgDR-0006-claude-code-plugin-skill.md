# Claude Code plugin as a thin CLI skill

> ORBIT needs a Claude Code entry point without coupling the published package or the record contract to one harness. I chose a plugin manifest plus one skill that shells out to the `orbit` CLI, and I kept that plugin out of the npm package.

## Context

- AgDR-0001 keeps the core general-purpose and puts harness behavior in thin adapters.
- AgDR-0004 requires project validation to name a record root with `--root`.
- AgDR-0005 keeps provider writes behind `orbit sync` so lifecycle commands stay deterministic.
- Claude Code installs a plugin from `.claude-plugin/plugin.json` and loads skills from `skills/<name>/SKILL.md` at the plugin root.

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| Document the CLI only | No new packaging surface | Each Claude Code user rebuilds the workflow |
| Put the skill inside the npm `files` list | One artifact carries the adapter | Changes the published package and ships a harness file to every consumer |
| Ship a Claude Code plugin in the repository, outside `files` | Installable skill, unchanged npm tarball, CLI remains the contract | Plugin metadata is maintained separately from `package.json` |

## Decision

Chosen: **a Claude Code plugin whose only component is a skill that runs the `orbit` CLI**, because the adapter must stay thin and the npm package contents must stay the same.

The manifest is `.claude-plugin/plugin.json`. The skill is `skills/orbit/SKILL.md`. Neither path is added to `package.json` `files`.

The skill checks `command -v orbit` and stops with the CLI install line when the command is missing. It stores project records in `orbit/` at that project's root and runs `orbit validate --all --root orbit` after each write. Lifecycle order is Plan, Snapshot, Reconcile, Slice. A GitHub slice issue is created only after the slice record exists, through `orbit sync github`, and a dry run comes first. The skill does not embed another product's paths, hooks, or skills, so it works in any repository.

## Consequences

- Claude Code users install the plugin from a marketplace and still install the CLI separately.
- `npm pack` file lists stay aligned with the CLI package.
- Flag changes belong in the CLI and must be copied into the skill from `bin/orbit.js` and the README, not invented in the skill.
- Another harness can add its own adapter without changing this plugin.

## Artifacts

- [Issue #19](https://github.com/me2resh/orbit-spec/issues/19)
- [AgDR-0001](AgDR-0001-general-purpose-core-with-harness-adapters.md)
- [AgDR-0004](AgDR-0004-explicit-project-record-root.md)
- [AgDR-0005](AgDR-0005-explicit-provider-adapter-boundary.md)
