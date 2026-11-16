import { translateWording } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--03-wording-translator/packages/store/src/wording.ts";
const cases: Record<string,string> = {
blockEdgeComment: `steps:
  qa:
    type: agent
    skill: s
    instructions: Check it.
    outcomes:
      pass: # the happy path
        to: describe
        means: ok
`,
flowProseFirst: `steps:
  qa:
    type: agent
    skill: s
    instructions: Check it.
    outcomes:
      pass: { means: ok, verdict: pass, to: describe }
`,
likeAgentName: `steps:
  review:
    type: agent
    skill: s
    instructions: Review.
    outcomes: { approve: { to: $done, means: fine } }
  review-codex:
    like: review
    agent: codex
`,
hashInBlock: `steps:
  a:
    description: |
      text
      # not a comment
    type: check
    run: bun test
    outcomes: { pass: $done }
`,
parseError: `steps:
  a:
    type: agent
   bad: [
`,
};
for (const [k, t] of Object.entries(cases)) { console.log(`=== ${k}`); const r = translateWording(t, "f.yaml"); console.log(r.ok ? r.text : JSON.stringify(r)); }
console.log(translateWording(`steps:
  qa:
    type: agent
    skill: s
    instructions: Check it.
    outcomes:
      pass: { means: ok, verdict: pass, to: describe, counter: c }
`, "f").text);
