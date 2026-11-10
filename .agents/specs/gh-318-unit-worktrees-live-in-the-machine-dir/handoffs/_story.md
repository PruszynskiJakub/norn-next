## Goal

Unit worktrees are created in the checkout's machine dir (`<machine dir>/worktrees/<story>-<slug>[--<nn>-<slug>]`), never in `<repo>-worktrees/`.

## Proof

Refine only: the spec (spec.md) holds the decided user stories; nothing built yet.

## Easy to miss

- Core is pure: the worktrees dir must reach decide through Facts (filled by observe), not by calling the machine dir from core.
- Slice paths derive from the story worktree's path; orphan detection (observe, tidy), the view's scan and `story start`'s gone-check all match the old `<repo>-worktrees/` prefix today and must move to the new folder.

## Not proven yet

Everything: plan, build, QA.

## Notes

- Person decided: no compatibility with `<repo>-worktrees/` (no users to carry over); repo moves and doctor's adoption advice out of scope; worktrees inside the per-checkout machine dir, not a shared `~/.norn/worktrees/`.
- Nothing in norn relies on worktrees being siblings of the repo.

## Resume

Plan the spec (norn-plan).
