---
name: norn-prototype
description: Build a throwaway prototype with a person to settle one design question — a state model they can click through in a single HTML file, or several radically different UI variants on one route — then commit it on the branch you work on and record the verdict in the spec next to it. Use when a decision depends on how something looks or feels, or on a state model that is hard to judge on paper.
---

# Prototype

A prototype is **throwaway code that answers one question** for a person. The question decides its shape; the person's verdict goes into the spec. The prototype stays on the branch you work on as the record of how the decision was reached, never as code the product runs.

Build one only with a person present: they drive it and give the verdict. With no person, do not build it. Name the question and the shape you would build, and leave that as a suggestion for whoever can answer it.

## 1. Name the question and pick the shape

Write the question down in one sentence and confirm it with the person before any code. A prototype that answers the wrong question is pure waste.

- **"Does this logic or state model feel right?"** → [LOGIC.md](LOGIC.md). One self-contained HTML file a non-developer can drive: free-play buttons, guided scenarios, the full state shown after every click.
- **"What should this look like?"** → [UI.md](UI.md). Several radically different variants on one route, switched by a `?variant=` URL param and a floating bar.

The two shapes produce very different things, so a wrong pick wastes the whole prototype. When the question is ambiguous, ask. If it stays ambiguous, follow the code it is for (a backend module → logic; a page or component → UI) and state that assumption at the top of the prototype.

## 2. Build it

- **Real files start clean.** Before editing a real file for the prototype (mounting variants on a page), check it has no uncommitted changes; if it has, ask the person to commit or set them aside.
- **Marked as throwaway.** Put it next to the module or page it is for, and name it so a casual reader sees it is a prototype (`prototype` in the file or route name). Follow the project's routing and file conventions; invent no new top-level structure.
- **Trivial to run.** A logic prototype opens by double-click. A UI prototype starts with one command from the project's own runner. Tell the person exactly what to open or run.
- **No persistence.** State lives in memory. If the question is about persistence itself, use a scratch database or file named so it is obviously disposable.
- **No polish.** No tests, no error handling beyond what keeps it running, no abstractions, no "what if we later need X". It answers one question.
- **State on show.** After every action (logic) or variant switch (UI), show the full relevant state, so the person sees what changed.

## 3. Get the verdict

Hand it over and let the person drive. The useful moments are "wait, that should not be possible" and "I want the header from B with the list from C": those are the real decisions. Change the prototype as they ask; it is meant to move. Stop when the question has a verdict the person states in their own words. A new question that comes up is a new prototype or an open question, not scope creep in this one.

## 4. Keep the prototype on the branch

The prototype is a primary source: keep it on the branch you are on, so whoever picks the work up can reopen it. Never create or switch branches for it.

- **Only prototype-named files stay.** A logic prototype is one HTML file: keep it where you built it. For a UI prototype, keep the variants and the switcher in their own `prototype` files; put every real file it edited (the page that mounted the variants, a route table) back as it was, so the product runs exactly as before. Say at the top of the switcher file which page mounts it, so it can be mounted again.
- **Nothing reachable in production.** No route, import or flag on the branch leads to the prototype.
- **Commit it** once the spec records the verdict (section 5), with the spec change, in one commit whose message names the question.

```sh
git restore --source=HEAD --staged --worktree -- <real files the prototype edited>
git status                          # only prototype files and the spec are changed
git add <prototype files> <spec>
git commit -m "Prototype: <question>"
```

## 5. Record the verdict in the spec

Fold the decision into the spec as a decision, in prose, where it belongs: a Behaviour item or the Solution when it is about what the user meets, an implementation decision when it is about how it is built. Right under it, add one line that links the prototype:

```markdown
Prototype: `<path to the prototype file or folder>`. Question: <the question>. Verdict: <the answer, and why>.
```

Do not copy prototype code into the real code: it was written without tests or error handling, and whoever builds the decision writes it properly. One exception: a logic prototype's pure module, or a type or schema shape it settled, may be quoted in the plan when it states the decision more precisely than prose.

Done when the person has stated the verdict, the prototype files and the spec are committed together on the branch you are on, no real file still carries a prototype edit, and the spec records the question, the verdict and the prototype's path next to the decision.
