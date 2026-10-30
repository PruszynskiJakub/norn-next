# Logic prototype

One self-contained HTML file that lets a person drive a state model by clicking buttons. Use it when the question is about **business logic, state transitions or data shape**: the kind of thing that reads fine on paper and only feels wrong once real cases push through it.

It is one file with nothing to install, so a non-developer (a designer, a product owner, a domain expert) can open it and feel the model. It speaks their language, not the code's.

Right shape when the question sounds like:

- "Does the model handle X followed by Y?"
- "Can this data shape represent the case where …?"
- "What should this interface feel like before we write it?"
- Anything where someone wants to **press buttons and watch state change**.

If the question is what something should look like, use [UI.md](UI.md) instead.

## 1. State the question in the file

Put the question and the model being tested in a visible intro at the top of the page, not in a comment. Anyone who opens the file later can check what it was meant to answer.

## 2. Keep the logic a pure module

Write the logic in one `<script>` block as a small pure module, liftable into the real code later. Pick the shape the question needs, not the one easiest to wire to buttons:

- **A reducer** `(state, action) => state`: discrete events, one state value.
- **A state machine** with explicit states and transitions: when "which actions are legal now" is part of the question.
- **Pure functions over a plain data type**: when there is no current state, only transformations.
- **A small class or module with a clear method surface**: when the logic really owns ongoing state.

No DOM, no `document`, no handlers inside it. The page calls the module; nothing flows back. This module is the part worth keeping; the page around it is not.

## 3. Build the page

One file of plain HTML, CSS and JS, everything inline: no framework, no bundler, no server. It must open by double-click and survive being sent around.

Every label is in **domain language**: buttons and fields read like the business, not like the reducer. Lay it out top to bottom:

1. **Title and one line** saying what the page lets you explore (the question).
2. **Current state**: every relevant field, labelled and readable (not a raw JSON dump), re-rendered after every click, with what just changed called out.
3. **Free play**: one button per action, always available, so the person can poke the model in any order.
4. **Guided scenarios**, one per tab: a short plain-language setup and what to watch for, then the buttons to press in order. Each press performs its action and moves to the next one. Starting a scenario resets to a known initial state, so it runs the same way every time.

Choose scenarios for the awkward cases: the happy path, a tricky edge, and an attempt at something that should be illegal.

Clean typography, generous spacing, one accent colour, no animations: nothing that competes with the state and the buttons.

## 4. Hand it over

Open it for the person or give them the path. When they say "that should not be possible" or "I assumed X would differ", that is a flaw in the idea, which is what the prototype is for. Add the actions or scenarios they ask for.

## 5. Capture

Keep the prototype and record the verdict as [SKILL.md](SKILL.md) says. The pure module is what may be quoted in the plan as the settled model; the HTML page stays on the branch, where, being one file, it stays trivial to reopen.

## Anti-patterns

- **Tests.** A prototype that needs tests is no longer a prototype.
- **The real database.** In-memory state, unless persistence is the question.
- **Generalising.** No "what if we later support X".
- **Logic tangled with the page.** A module that touches the DOM or handlers can no longer be lifted out.
- **A framework, bundler or dev server.** It defeats "open it by double-click".
- **Shipping the page.** It is built to be clicked through by hand, never to run in production.
