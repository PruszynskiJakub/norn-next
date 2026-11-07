---
name: norn-refine
description: Interview the person about a story and write its spec, with a numbered list of user stories that planning, review and QA check against. Use when asked to refine, spec out or write requirements for a story. Not for settling an existing spec's open questions; use norn-clarify.
---

# Refine

The person makes every decision. Finding facts in the code is yours. The spec is the contract all later work checks against: slices name its user stories, review checks the diff against them, QA walks them one by one. A gap here is a gap in all of them.

## 1. Gather context

Before the first question, know the ground as well as the code can teach it.

- **The story.** Read the story file: its title, its body and anything it links, and the comments on its issue: an earlier triage leaves its repro, affected code and recommendation only there. Whatever is already written is a starting point, not a re-ask.
- **An earlier spec.** When the body already holds a spec (an earlier refinement round), amend it in place: keep every user story's number, strike what goes, and leave an existing Plan section alone.
- **The status quo.** Find where the code does today what the story changes, and run it if that is cheap. Note what users observe now; the Problem is written against it.
- **The vocabulary.** Read the project's glossary (e.g. `CONTEXT.md`, `GLOSSARY.md`) and the decision records (e.g. `docs/adr/`) in the area. The spec uses those terms; a decision record constrains the solution unless the person chooses to revisit it.
- **Neighbours.** Look for behaviour the story will rub against: other commands or screens on the same data, configuration, help text, docs, error paths. These are where the hidden user stories live.
- **Outside facts.** A fact that lives outside the repository (a third-party API, a platform limit) is yours to look up too, not the person's to answer.

## 2. Interview

Invoke the `norn-interview` skill on the story. Walk the branches in this order, since each settles ground for the next:

1. **Problem.** Who has it, when it bites, what they do today instead. A problem stated as a missing feature ("there is no X") is not yet a problem; ask what X would let them do.
2. **Solution.** The change as the user will meet it, not how it is built. If two shapes are plausible, put both with your recommendation.
3. **User stories.** Concrete examples, one at a time: an input or action and what the user observes. Then probe the edges the person has not mentioned (see the checklist below).
4. **Scope.** What a reader might expect the story to cover that it will not.

While interviewing, hold the language and the claims to account:

- **Challenge terms against the glossary.** "The glossary defines a *claim* as X, but you seem to mean Y. Which is it?" When a word could mean two things (*user*, *done*, *sync*), propose the precise term and ask which is meant.
- **Invent scenarios.** Stress the boundaries with specific cases: the empty list, the second run, two people at once, the item deleted halfway through.
- **Cross-check with the code.** When the person says how something works today, check it. "The code closes the whole order, but you said partial closing is possible. Which is right?"
- **Back your own claims with the code.** Before you tell the person what code or config does, find the `file:line` usages that consume it, not only where it is defined. Never infer behaviour from a schema, a type or the docs alone; say "defined but never read" of a key nothing consumes. Your answers feed the spec, so a wrong one becomes a wrong user story.

When a decision turns on how something looks or feels, or on a state model that is hard to judge on paper, offer the person a prototype (the `norn-prototype` skill) before they decide. Its verdict is the decision.

A decision that needs someone not present becomes an open question naming who can answer it, and its branch closes. A branch is not closed by your assumption: an assumption the person has not confirmed is an open question too.

When no person is with you, do not interview and do not decide: settle what the code and the docs can settle, and write every decision that is left as an open question. Build no prototype: where one would settle a question, suggest it in that question's options.

### Edge checklist

Walk it before you call the user stories branch settled. Skip an item only when it plainly does not apply. Each one you walk lands in the spec as a user story, an Out of Scope entry or an open question; the checklist itself is not written down.

- First use, empty state, nothing to show.
- Invalid input, missing input, input at its limits.
- Failure of what the story depends on: network, permissions, a missing file or account.
- Repeating the action; undoing it; doing it twice at once.
- Existing data, configuration and users: what happens to them when this ships.
- Every place the change is visible: output, messages, help, docs, other commands or screens that show the same thing.
- Who may do it, and what the others see.

## 3. Write the spec

Write the spec into the body of the story file, in the layout below, and leave its frontmatter unchanged. It records the decisions from the confirmed summary; no decision appears in it that the person did not make. [EXAMPLE.md](EXAMPLE.md) shows a short spec written to this standard.

**User Stories are the heart of it, and the list should be long.** It covers every aspect of the change. Each story:

- is one behaviour, observable by its actor without reading the code: `As a <actor>, I want <feature>, so that <benefit>`;
- is concrete: name the command, the message, the number, so nobody has to guess what "handled well" means. Add an example line only where a case settles something the sentence cannot (an exact message, a boundary);
- can be checked on its own, so review and QA can check against it;
- covers failures and edges as stories of their own, not as an afterthought in another story.

Number the list `1.`, `2.`, … for reading only: nothing cites a story by its number. Slices, review, QA and the PR name a story by what it says, so each story must be clear when quoted on its own.

| Weak                                              | Strong                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| As a user, I want errors handled well.            | As a user who runs `export` without a project, I want to be told to pass `--project <name>` and get exit code 2, so that I can rerun it.       |
| As a user, I want the list to be fast and sorted. | Two stories: one on sort order, one on the size limit and what happens past it.                                                               |

**Out of Scope** names each thing left out and, in a few words, why, so nobody gold-plates towards it later.

**Further Notes** holds what a later reader needs and fits nowhere else: a constraint from outside, a link the person gave, a decision record it leans on. Leave it out when there is nothing.

**Open questions** are a numbered list, each self-contained: what is undecided, why it matters (the user stories it bears on, in words), the options as you see them with your recommendation, and who can answer it.

**Talking about the spec.** Name a user story or question by what it says ("the warning on open cards"), never by its number, to the person and in every file.

**Glossary.** When the interview settled a new term or sharpened an existing one, tell the person and, with their agreement, update the project's glossary alongside the spec. The glossary holds definitions only, never decisions or implementation.

## 4. Check before handing over

Read the spec once more as the planner will.

- Every decision in the confirmed summary appears in the spec, and nothing appears that is not in it.
- Every user story is concrete and observable without reading the code.
- The edge checklist is reflected: each item covered by a user story, Out of Scope, or an open question.
- Problem Statement and Solution are told from the user's side, in the project's terms.
- No file paths, function names or code snippets: nothing only the code knows (a prototype's line may name its path). What the user meets is fine: a command, a flag, a message, an error code.

Done when the person has confirmed the interview summary (every branch settled, or parked as an open question) and agrees the spec says what they meant; with no person present, when every decision left is an open question. The spec is what you hand back, with Open questions empty or not.

## Spec layout

Shared by refine, clarify and plan. Refine writes everything above Plan.

```markdown
# <story title>

## Problem Statement
The problem the user faces, from their perspective: who, when, and what it costs them today.

## Solution
The solution, from the user's perspective: what they will do and see.

## User Stories
A long, numbered list covering every aspect of the change. Each one reads on its own: later work quotes it, never its number.

1. As a <actor>, I want <feature>, so that <benefit>.

## Out of Scope
- <what is left out> — <why, in a few words>

## Further Notes
Anything a later reader needs that fits nowhere else. Optional.

## Open questions
Numbered. Each names who can answer it. Removed once answered.

1. <the undecided point> (bears on <the user stories, in words>)
   Options: <a> / <b>. Recommended: <a>, because <reason>.
   Who: <person or role>

## Plan
Written by the `norn-plan` skill.
```

Write in the project's domain vocabulary. Code names stay out because they go stale before the story lands. A spec written before this layout (`## Problem`, `## Behaviour` with `B<n>` items) is amended in its own layout; cite its items by what they say too.
