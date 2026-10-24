---
name: clarify
description: Settle a spec's open questions with the person, one question per turn, and fold each answer into the spec. Use when a spec has an "Open questions" list that needs a person's decisions.
---

# Clarify

Close every open question in the spec with the person, and leave the spec as if the questions had never been open.

## Process

1. Read the spec and the code it touches. Order the open questions so the ones that unlock others come first. Drop any the code or spec already answers, noting why.
2. **Ask one question per turn**: the question, the options, your recommended answer and why. Then stop and wait.
3. After each answer, fold it in immediately:
   - a new or changed Behaviour item (append a new number; never renumber),
   - an edge checklist line resolved,
   - or an Out of scope entry.
   Remove the question from Open questions. If the answer raises a new question, add it and ask it later.
4. Record notable decisions under `## Decisions` in the spec: decision and reason, one line each.

## Rules

- Never fold in your own guess as if it were the person's answer.
- Keep the spec's format; change only what the answers touch.
- If an answer contradicts an existing Behaviour item, say so and ask which wins.

## Finished when

Open questions is empty, every answer is reflected in Behaviour, the edge checklist or Out of scope, and the person agrees the spec reads right.
