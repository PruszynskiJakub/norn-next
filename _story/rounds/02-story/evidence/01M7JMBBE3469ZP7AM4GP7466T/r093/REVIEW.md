# Review

How a review judges a change in this repository. The `norn-review` skill reads this file before it reviews; edit it to fit the repo.

## Ignore

Paths the review does not report on (generated files, fixtures, vendored code, lockfiles):

- `**/*.lock`
- `**/fixtures/**`

## What counts as failure here

A finding blocks when it breaks one of these (add your own):

- A behaviour the spec asks for is missing, partial or wrong.
- A bug: wrong result, crash, data loss, a leaked secret.
- A breach of a rule documented in this repo.

## Do not report

- Style that the formatter or linter already enforces.
- Nits: naming, wording or ordering preferences that change nothing.
