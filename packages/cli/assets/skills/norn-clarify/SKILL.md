---
name: norn-clarify
description: Settles a spec's open questions with the person, one question per turn, and folds each answer into the section it changes. Use when a spec's Open questions need a person's decisions, or when asked to clarify or go through them.
---

# Clarify

Without this, answers end up appended as notes ("question 1: Marta says no") and the spec contradicts itself. Answers come from the person or the people each question names; never fold in your own guess as if it were an answer.

When no person is with you, settle only what the code and the docs can settle, and stop: say which questions are left and who must decide each.

## 1. Take stock

Read the whole spec, not only Open questions: each answer lands in another section. Then read anything added to the story since refinement, and sort every open question:

- **Answered already.** Someone replied, or the person settled it elsewhere. Confirm the reading with the person, then fold it in.
- **A fact, not a decision.** The code, the docs or a third-party API can answer it. Look it up and bring back what you found; a decision that still follows from the fact stays open as that decision.
- **Gone.** Another answer, or a change in the code since, made it moot. Tell the person and, once they agree, delete it.
- **For the person.** Theirs to decide now.
- **For someone else.** Only the person it names can decide.

Order what is left by dependency: a question whose answer changes others comes first.

## 2. Interview

Invoke the `norn-interview` skill on the person's questions. Give each with its context (what it bears on, the options, your recommendation), so they need not reread the spec. Fold each answer in as the interview read it back.

An answer often opens new branches: an edge nobody thought of, a user story it now contradicts, a term it puts in doubt. Follow them to the end; they are part of this work, not the next. When an answer contradicts a decision already in the spec, say so and let the person choose which stands. When an answer grows the story well past what refinement agreed, say so and offer to put the extra part out of scope, as a follow-up story the person files.

## 3. Ask the people who are not here

For each question whose answerer is not present, draft a message the person can send as it stands. The answerer has not read the spec: the draft carries everything they need.

```markdown
@<person> a decision for <story title>: <the question, in one sentence>

Context: <two or three sentences: what the story does and where this point comes up>
Options:
- <a>: <what it means for users>
- <b>: <what it means for users>
Recommended: <a>, because <reason>.
```

Hand the draft to the person; never send or post it yourself. In the spec the question stays, with who is being asked and where.

## 4. Fold the answers in

Write each decision into the section it affects, then delete the question. The spec reads as if it had always said so.

- **User Stories.** Add the stories the answer creates under the next free numbers; rewrite the ones it changes; strike through the ones it removes. Never renumber: later work cites the numbers.
- **Out of Scope.** "Not now" is an out-of-scope entry with its reason, not a deleted question.
- **Problem Statement and Solution.** Rewrite when the answer changes who the story is for or what they will see.
- **Glossary.** A term the answer settled goes into the project's glossary, with the person's agreement.

| Weak fold                                                       | Strong fold                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appends "Marta says archived projects do not count." to the archiving story. | Adds story 10: "As an owner on a plan with a project limit, I want archived projects not to count, so that archiving frees a slot." with the example "limit 5, 5 live → archive one → can create a new project". Deletes the question. |

Then read the whole spec again. An answer in one place often breaks another: an example that no longer holds, an out-of-scope entry now in scope, two stories that now say the same thing. Fix them with the person.

## 5. Hand back

Done when every question is folded in, gone with the person's agreement, or waiting on a named person, no answer survives only as a note, and the person agrees. Hand back the spec, and name each question still waiting and who it waits on: Open questions is then not empty, and whoever picks the spec up next must know.
