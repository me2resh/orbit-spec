# Use Ajv for ORBIT JSON Schema validation

> In the context of adding a portable ORBIT CLI, facing a dependency-free validator that implements only a subset of JSON Schema, I decided to use Ajv with the Draft 2020-12 entry point to achieve standards-complete validation, accepting a small runtime dependency and its maintenance cost.

## Context

- ORBIT schemas declare JSON Schema Draft 2020-12.
- The previous validator implemented only selected keywords and could drift from the schema standard.
- The CLI must provide the same validation result for every harness.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Keep the custom validator | No dependency and simple startup | Incomplete keyword support and ongoing maintenance burden |
| Use Ajv Draft 2020-12 | Standards-complete validation, mature Node.js support, and clear errors | Adds runtime dependencies |
| Use a different language validator | Broad ecosystem choices | Adds another runtime and complicates the portable CLI |

## Decision

Chosen: **Ajv Draft 2020-12**, because it matches the schemas already published by ORBIT and keeps the CLI in the existing Node.js runtime.

## Consequences

- `ajv` and `ajv-formats` are runtime dependencies of the CLI.
- Schema validation uses the standard Draft 2020-12 implementation.
- Cross-record invariants remain explicit ORBIT checks above the schema layer.
- Dependency audits must include the CLI package.
