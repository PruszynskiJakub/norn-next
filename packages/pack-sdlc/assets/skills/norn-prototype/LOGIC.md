# Logic prototype

One self-contained HTML file that lets a person drive a state model by clicking buttons: for business logic, state transitions or data shape, the kind that reads fine on paper and only feels wrong once real cases push through it. Nothing to install, so a designer, product owner or domain expert can open it by double-click; it speaks their language, not the code's.

If the question is what something should look like, use [UI.md](UI.md).

## 1. Keep the logic a pure module

One `<script>` block holds the logic as a small pure module, liftable into the real code later: no DOM, no `document`, no handlers. The page calls it; nothing flows back. Pick the shape the question needs, not the one easiest to wire to buttons:

- **A reducer** `(state, action) => state`: discrete events, one state value.
- **A state machine** with explicit states and transitions: when "which actions are legal now" is part of the question.
- **Pure functions over a plain data type**: when there is no current state, only transformations.

## 2. Build the page

Plain HTML, CSS and JS, all inline: no framework, bundler or server. Every label in **domain language**: buttons read like the business, not like the reducer. Top to bottom:

1. **The question**, visible on the page (not in a comment), so anyone who opens it later knows what it answered.
2. **Current state**: every relevant field, labelled and readable (not a raw JSON dump), re-rendered after every click, with what just changed called out.
3. **Free play**: one button per action, always available, in any order.
4. **Guided scenarios**, one per tab: a plain-language setup and what to watch for, then the presses in order. Starting one resets to a known state, so it runs the same every time. Cover the happy path, a tricky edge, and an attempt at something that should be illegal.

## 3. Hand it over

Give the person the path. When they add a case ("what if X happens first?"), add it as an action or scenario. Record and commit as [SKILL.md](SKILL.md) says; the pure module is the part that may be quoted in the plan.
