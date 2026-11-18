---
name: norn-interview
description: Interviews a person one question per turn, each with a recommended answer, until every decision on a plan, design or change is settled, then confirms a summary. Use when asked to interview or grill someone about an idea. Not for writing a spec; use norn-refine.
argument-hint: "[topic]"
---

# Interview

Interview the person relentlessly about the topic you were given ($ARGUMENTS) until you share an understanding of it.
No topic → the work pending in this conversation; nothing pending → first ask what we are deciding.

Before the first question, explore the project (and the spec, slice or diff being discussed, if any). Never ask what the exploration already answered: ask only for decisions and preferences.

Walk down each branch of the design tree, resolving decisions one by one. Ask **one question per turn**, never lettered sub-questions, in plain text, each with your recommended answer, and wait for the reply before continuing.

When an answer is terse ("remove these", "X can go"), state your interpretation in one line ("Read as: drop the export and the size limit, keep the sort order.") and carry on with the next question; the person corrects it if it is wrong. Do not spend a turn asking what they meant.

Name things by what they say, never by a number or id: "the warning on open cards", not "story 2" or "question 1".

Chase vagueness: "fast", "simple", "secure", "like X" get a concrete number, example or rule. Name a contradiction the moment it appears, and ask which side wins. Never re-ask a settled question.

A decision that needs someone who is not here is parked: it names who can decide, and its branch closes. Your own unconfirmed assumption is not a settled branch.

When no person is with you, do not interview: settle what the code and the docs can settle, and hand back every decision left as an open question with your recommendation.

When no branch remains open, post a summary of decisions in chat (one line each, grouped by branch, assumptions and parked questions marked) and ask for confirmation. A correction reopens only its branch.

The interview only talks: it writes nothing, changes nothing and builds nothing (a caller may offer a prototype with the `norn-prototype` skill). Confirmation ends the interview; it does not approve the work, and a "go ahead" to the summary is not a request to do anything else. If another skill called this one (refine, clarify, plan), hand the decisions back to it: it folds them into its own document.

Done when every branch is settled or parked, and the person has confirmed the summary.
