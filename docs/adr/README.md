# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for the `zantarix/actions` repository.

ADRs are short documents that capture significant architectural decisions made during the development of this project. Each record describes the context behind a decision, the decision itself, the alternatives that were considered, and the consequences -- both positive and negative. They serve as a historical log for current and future contributors to understand why the system is shaped the way it is.

Once an ADR is accepted and committed, it is treated as immutable. If a decision is later reversed or revised, a new ADR is created and the original's status is updated to reflect the change.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](001-setup-cursus-github-action.md) | `setup-cursus` GitHub Action | Accepted |
| [ADR-002](002-actions-monorepo-layout.md) | Actions monorepo of independent npm projects | Accepted |
| [ADR-003](003-cursus-release-management.md) | Cursus-managed release workflow for `zantarix/actions` | Proposed |

## Related Projects

When writing ADRs in this repository, consult the ADRs of the following related Zantarix projects for context and prior decisions:

- [zantarix/cursus](https://github.com/zantarix/cursus) -- the release-management CLI that this action installs and verifies. See in particular `docs/adr/` in that repository for decisions on artifact distribution, attestations, and verification (e.g. ADR-022, ADR-049, ADR-051).
