# ADR-002: Actions monorepo of independent npm projects

## Status

Accepted (2026-05-01)

## Context

The repository at `zantarix/setup-cursus` was created to hold a single GitHub Action ([ADR-001](001-setup-cursus-github-action.md)). Following the constraints established there, the action ships as plain ESM JavaScript with no build step, and its single runtime dependency (`smol-toml`) is vendored into `node_modules/` at the repository root and committed to git so consumers do not pay an `npm install` cost at workflow runtime. This vendoring is load-bearing for the trust posture: the audit surface is exactly `action.yml` plus the JavaScript source plus `node_modules/smol-toml/`, and there is no install step to compromise.

Vendoring `node_modules/` in this way relies on a specific npm behaviour: running `npm install` in the action's directory must produce a local `node_modules/` in that same directory. Hoisting -- npm's behaviour when a `package.json` is part of a workspace, where transitive dependencies are pulled up to the workspace root -- breaks the contract entirely. A hoisted layout would mean the action's runtime dependency no longer lives next to `action.yml`, the `bundleDependencies` declaration would no longer match the on-disk layout, and the action would fail at runtime on consumer workflows.

A new requirement has surfaced: the project needs developer tooling at the repository level (linters, formatters, and similar) that has nothing to do with the action's runtime. Dev tooling conventionally declares its dependencies in a `package.json` and conventionally lives at the repository root, where the configuration files it expects to find (eslint configs, prettier configs, editor configs, CI scripts) also live. Two `package.json` files cannot share a single directory, and the existing `package.json` (the action's manifest) cannot be repurposed to also carry dev dependencies without leaking those deps into the vendored install layout.

The obvious-looking workaround -- declaring an npm workspace at the repository root that includes the action as a member -- is not viable. npm workspaces hoist dependencies to the workspace root by default; that hoisting is precisely the behaviour ruled out by the vendoring contract. Even with hoisting suppressed via `nohoist`-style overrides, the workspace topology would entangle the action's reproducible install with the dev-tooling install in ways that future maintainers would have to carry as ongoing complexity. The cleaner answer is that the two installs are simply not related.

The repository is also pre-publication: no consumer has yet referenced `zantarix/setup-cursus@<sha>`, so a breaking rename of the repository carries no migration cost. That window will close as soon as the first action release is cut, so any layout decision that benefits from a rename should be made before then.

A side note on capacity: a layout that supports a second action falls out naturally from any solution that separates the action's working tree from the repository root. This is a side-effect, not a goal -- there is no concrete second action planned, and committing to a roster of sibling actions would be premature.

## Decision

We will rename the repository from `zantarix/setup-cursus` to `zantarix/actions`, move all action-specific files into a `setup-cursus/` subdirectory, and reserve the repository root for repo-level concerns (dev tooling, repo-level documentation, the Nix devshell). The two `package.json` files -- one at the root for dev tooling, one at `setup-cursus/` for the action -- shall be fully independent npm projects that happen to share a working tree. They are explicitly **not** an npm workspace.

### Repository layout

After the rename, the working tree shall be:

- `setup-cursus/` -- contains every file that defines the action: `action.yml`, `main.js`, `src/`, `tests/`, `package.json`, `package-lock.json`, and the vendored `node_modules/`. Everything that ADR-001 places at the repository root moves into this directory unchanged.
- Repository root -- contains the dev-tooling `package.json` (private, no `workspaces` field), repo-level documentation (a brief root `README.md` that indexes the actions in the repository), and existing repo-level configuration (Nix devshell, ADRs under `docs/adr/`, community files).

### Independent npm projects, not a workspace

The root `package.json` MUST NOT declare a `workspaces` field. The two projects share a working tree but do not share an install topology: `npm install` at the repository root resolves only the dev-tooling dependencies into `./node_modules/` at the root, and `npm install` inside `setup-cursus/` resolves only the action's runtime dependencies into `setup-cursus/node_modules/`. Neither install knows about the other. This is the simplest layout that satisfies the vendoring contract while admitting a second `package.json` at the root.

The root `package.json` shall be marked `"private": true`. It is not published to any registry; it exists solely to declare the dev tooling that operates over the working tree.

### Consumer-facing reference

Consumers shall reference the action as `uses: zantarix/actions/setup-cursus@<sha>`. This follows GitHub's standard `owner/repo/path@ref` convention for actions hosted in subdirectories of a repository (the same shape used by, for example, `actions/cache/restore`).

### Tag strategy

Releases shall be tagged at the repository level using shared tags (e.g. `v1.0.0`) rather than path-prefixed tags (e.g. `setup-cursus/v1.0.0`). This is the simpler choice while only one action lives in the repository. It does mean that, were a second action ever added, the two actions' release cycles would become coupled by the shared tag namespace -- a `v1.1.0` release would advance both. This coupling is acknowledged and is revisitable in a future ADR if and when a second action is added; the decision at that point would be either to accept lockstep releases or to migrate to path-prefixed tags. No second action is planned, so the simpler scheme applies.

### Future actions are out of scope

The chosen layout admits the addition of sibling actions (`zantarix/actions/<other>`), but this ADR does not commit to any particular roster of future actions. Adding a second action would inherit the same independent-projects rule (its own `package.json`, its own vendored `node_modules/` if it follows the ADR-001 pattern) and would prompt the tag-strategy revisit noted above.

## Consequences

### Positive

- The vendoring contract from [ADR-001](001-setup-cursus-github-action.md) is preserved exactly as written: `setup-cursus/node_modules/smol-toml/` is unchanged on disk, and the action's audit surface is unchanged.
- Dev tooling can live at the repository root using conventional layout (root-level configs, root-level scripts), with no contortions to dodge the action's `package.json`.
- The two installs are fully independent -- there is no interaction between `npm install` at root and `npm install` in `setup-cursus/`. A bug in one cannot affect the other.
- The breaking rename happens in the pre-publication window where no consumer has pinned the action by SHA, so the cost of the rename is paid once with no migration burden on external users.
- The layout incidentally admits a second action in the future without forcing a further restructure, even though no second action is planned.

### Negative

- CI workflows that build, test, or smoke-test the action need an explicit `working-directory: setup-cursus` (or equivalent path argument) to run in the right place. The local smoke test `uses: ./` becomes `uses: ./setup-cursus`. This is a small but real new source of footgun for anyone editing CI in this repository.
- Shared repo-wide tags (`v1.0.0` rather than `setup-cursus/v1.0.0`) couple the release cycles of any future sibling actions. The simpler scheme is correct for a single-action repository, but adding a second action would require revisiting tag layout under a future ADR.
- The rename invalidates any internal documentation, bookmarks, or cross-references that point at `zantarix/setup-cursus`. Cross-repository ADR links (for example, from cursus) and any external write-ups need to be updated. Inside this repository, [ADR-001](001-setup-cursus-github-action.md) requires minor in-place edits to its layout assertions.
- A single repository hosting "all Zantarix actions" is a slightly larger blast radius for repository-level events (force-pushes, branch-protection misconfiguration, secret leaks) than a one-action-per-repo layout would be. The mitigation is that the action's trust chain is anchored in build-provenance attestations and per-version SHA pins, not in the repository name -- a repository-level event cannot retroactively forge attestations on already-released tags.

### Neutral

- The root `README.md` becomes an index that points to per-action READMEs (currently just `setup-cursus/README.md`). It is a thin file but a real one.
- The Nix devshell at the repository root continues to operate at the working-tree level and is unaffected by the subdirectory move.
- ADR-001 receives minimal in-place edits (path and reference strings only). Its decision logic, alternatives, and consequences are unchanged. This ADR does not supersede ADR-001; it sits alongside it.
- Whether the action is published to the GitHub Marketplace remains a separate decision, unaffected by this layout change. Marketplace listings can target `zantarix/actions/setup-cursus` just as cleanly as a single-action repo.

## Alternatives Considered

### Status quo, with dev tooling in a `/dev` or `/tools` subfolder

Keep the action at the repository root and place the dev-tooling `package.json` (and its supporting configs and scripts) in a sub-directory such as `dev/` or `tools/`. This avoids the rename and the move.

Rejected because conventional dev tooling layout is at the repository root: linter configs, formatter configs, editor configs, and CI helper scripts are all expected to live at the top level by both tooling defaults and contributor muscle memory. Pushing them into a subfolder requires every tool invocation to thread an explicit working directory, every config file to be discovered via non-default lookups, and every contributor to learn the local-only convention. The unconventional layout costs more in friction over the lifetime of the repository than the rename costs once.

### True npm workspaces

Declare the repository root as an npm workspace whose members are `setup-cursus/` (and any future sibling actions), and rely on workspace tooling for the dev/runtime split.

Rejected because npm workspaces hoist dependencies to the workspace root by default, which directly violates the vendoring contract codified in [ADR-001](001-setup-cursus-github-action.md). The vendored `node_modules/` next to `action.yml` is load-bearing for the action's trust posture and on-disk audit surface; any topology that risks moving runtime dependencies out of that directory -- whether by default or by configuration drift -- is the wrong primitive. Even with hoisting suppressed, the workspace topology entangles two installs that do not need to be entangled, for no benefit.

### Path-prefixed release tags (`setup-cursus/v1.0.0`)

Adopt path-prefixed tags from day one (e.g. `setup-cursus/v1.0.0`, `setup-cursus/v1.0.1`) so that a future second action could carry its own independent tag stream without colliding.

Deferred. Path-prefixed tags solve a problem this repository does not yet have: multiple actions sharing a release pipeline. While only one action is published from the repository, repo-wide tags (`v1.0.0`) are simpler, match GitHub's most common Marketplace expectations, and produce cleaner consumer pin syntax. If a second action is ever added, this decision should be revisited under a new ADR -- at that point either lockstep releases under shared tags or a migration to path-prefixed tags would be the choice. Picking path-prefixed tags now would pre-pay a cost that may never come due.
