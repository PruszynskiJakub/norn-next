---
name: norn-prototype
description: Build a throwaway prototype with a person to settle one design question, keep it on the branch and record their verdict in the spec. Use when a decision depends on how something looks or feels, or on a state model hard to judge on paper.
---

# Prototype

A prototype is **throwaway code that answers one question** for a person; their verdict goes into the spec, and the prototype stays on the branch as the record of how it was reached, never as code the product runs.

Build one only with a person present: they drive it and give the verdict. With no person, build nothing: name the question and the shape you would build, as a suggestion in the spec's open question or proposed decision.

## 1. Name the question and pick the shape

Write the question in one sentence and confirm it with the person before any code.

- **"Does this logic or state model feel right?"** → [LOGIC.md](LOGIC.md): one self-contained HTML file a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md): several radically different variants of one screen (a web page, a terminal view, a CLI's output), switched in place.

A wrong pick wastes the whole prototype. If the person cannot say which, follow the code it is for (a module → logic; a page, view or output → UI) and state that assumption at the top of the prototype.

## 2. Build it

- **Home: the spec folder.** Put the prototype in `prototype/` inside the story's spec folder, next to the decision it settles. That keeps it out of the product's sources, builds and lints. Only what must mount inside the real app (a UI variant on an existing page) sits beside that page, with `prototype` in its file name.
- **Real files start clean.** Before editing a real file to mount variants, check it has no uncommitted changes; if it has, ask the person to commit or set them aside.
- **Runs from any checkout.** Import the product's code by paths relative to the prototype, never absolute ones; whoever reopens it has the repo elsewhere.
- **One command to run.** Tell the person exactly what to open or run; write the same line at the top of the prototype.
- **Fake the outside.** State in memory, actions that would change the world only say what they would do. A scratch store named as disposable only when persistence is the question.
- **No polish.** No tests, no error handling beyond what keeps it running, no abstractions for later.

## 3. Get the verdict

Let the person drive. "That should not be possible" and "the header from B with the list from C" are the real decisions; change the prototype as they ask. Stop when the person states the verdict in their own words. A new question is a new prototype or an open question in the spec.

## 4. Record and commit

Fold the decision into the spec where it belongs (a Behaviour item or the Solution for what the user meets, the Plan for how it is built), and add one line under it:

```markdown
Prototype: `<path>`. Question: <the question>. Verdict: <the answer, and why>.
```

Never copy prototype code into the real code; whoever builds the decision writes it properly. Exception: a logic prototype's pure module, or a type or schema shape it settled, may be quoted in the plan.

Then put back every real file the prototype edited, so nothing in the product reaches the prototype, and commit the prototype and the spec together on the branch you are on. Never create or switch branches for it.

```sh
git restore --source=HEAD --staged --worktree -- <real files the prototype edited>
git status                          # only prototype files and the spec are changed
git add <prototype files> <spec>
git commit -m "Prototype: <question>"
```

Done when the person has stated the verdict, no real file carries a prototype edit, and the prototype and the spec line naming its path, the question and the verdict are committed together.
