---
name: norn-interview
description: Relentless one-question-at-a-time interview that reaches shared understanding on a plan, design or change before any action is taken. Ends in a summary the person confirms. Use when asked to interview, grill or question someone about an idea, or when another skill needs decisions settled with a person.
argument-hint: "[topic]"
---

# Interview

Interview the person relentlessly about $ARGUMENTS until we reach a shared understanding.
No topic → the work pending in this conversation; nothing pending → first ask what we are deciding.

Before the first question, explore the project (and the spec, slice or diff being discussed, if any) for a foundational understanding. Never ask what the exploration already answered — ask only for decisions and preferences.

Walk down each branch of the design tree, resolving decisions one by one. Ask **one question per turn** — never lettered sub-questions — in plain text, each with your recommended answer, and wait for the reply before continuing. When showing is easier than describing, the caller may build a prototype; the interview itself enacts nothing.

Chase vagueness: "fast", "simple", "secure", "like X" get a concrete number, example or rule. Name a contradiction the moment it appears, and ask which side wins. Never re-ask a settled question.

When no branch remains open, post a summary of decisions in chat — one line each, grouped by branch, assumptions marked — and ask for confirmation. A correction reopens only its branch. Confirmation ends the interview; it does not approve the work. If another skill called this one (refine, clarify, plan), hand back to it: it folds the decisions into its own document. A "go ahead" to the summary is not a request to do anything else.

Write nothing and change nothing: the interview only talks.

Done when every branch is settled or explicitly parked, and the person has confirmed the summary.
