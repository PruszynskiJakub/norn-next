# Cockpit tabs prototype (throwaway)

Question: how should the cockpit (`norn status --watch`) handle a growing list of stories, so rows are not
cramped, each story's stage is clear, and the list stays navigable?
Verdict: tabs (`1 Now`, `2 Backlog`, `3 Done`) over today's layout with six fixes. This is variant `T`.

Gists have no folders, so put it back together first:

```sh
mkdir -p cockpit-prototype/variants && cd cockpit-prototype   # put the gist's files here
for f in variants-*.ts; do mv "$f" "variants/${f#variants-}"; done
bun gen-big.ts                       # big.json: 68 stories, 23 need you, from model.json's rows
bun serve.ts                         # http://localhost:4747/?variant=T  (xterm.js in the browser)
bun run.ts --variant T               # or full screen in a terminal; Tab cycles variants
```

The imports point at a norn checkout at `/Users/jakubpruszynski/Projects/norn` (renderer, `@norn/view`
types). If yours is elsewhere, change that prefix in `shared.ts` and `variants/*.ts`. `model.json` is
`norn status --watch --json` from the main checkout on 2026-11-01.

- `0`: today's cockpit, unchanged.
- `0+` (`variants/d.ts`): today's cockpit with each fix behind a number key: 1 no repeats, closed folded,
  sorted by stage · 2 story titles on NEEDS YOU rows · 3 stage as `workflow · step n/m` (held back until
  #136) · 4 60% list · 5 section counts, `]` `[` `n` · 6 less clutter · 0 all on/off.
- `T` (`variants/e.ts`): the tabs, every tab is `0+` with all fixes on.

Actions never run anything: they show "would run: norn …".

