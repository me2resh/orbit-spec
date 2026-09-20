# ORBIT

ORBIT is a portable planning and reconciliation standard for durable software intent, current project reality, and the next bounded execution change.

ORBIT is part of [Agent SDLC](https://agentsdlc.ai). Visit the project website at [orbitspec.dev](https://orbitspec.dev).

This repository is the source for the standard, its schemas, examples, validators, and skills. The website is published separately so the standard can be used without a website or a specific coding harness.

## Current status

ORBIT v0.1 is under development. The repository begins with the four record schemas and examples that currently live in the website repository. The initial Plan, Project Snapshot, Reconciliation, and Execution Slice are under [`orbit/`](orbit/).

## Records

- **Plan** — durable intent, outcomes, acceptance criteria, constraints, and planning knowledge.
- **ProjectSnapshot** — point-in-time project and repository state.
- **Reconciliation** — assessment of a Plan against observed evidence.
- **ExecutionSlice** — the next bounded change justified by a Reconciliation.

## Validate

```sh
npm install
npm test
```

The validator checks every example against its schema and verifies the cross-record references in the complete example set.

## Scope

ORBIT does not require a specific agent, issue tracker, branch strategy, repository layout, storage system, or execution provider.

## Licensing

Specification and documentation are licensed under [CC BY 4.0](LICENSE). Code, scripts, and skills are licensed under [MIT](LICENSE-CODE).

## Contributors

<a href="https://github.com/me2resh" title="me2resh"><img src="https://github.com/me2resh.png?size=100" width="64" height="64" alt="me2resh"></a>
