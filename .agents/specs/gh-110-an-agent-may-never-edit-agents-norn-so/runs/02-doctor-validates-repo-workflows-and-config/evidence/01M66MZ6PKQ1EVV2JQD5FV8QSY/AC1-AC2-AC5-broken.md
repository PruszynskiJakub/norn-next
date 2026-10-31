# AC1/AC2/AC5 — slice.yaml uncounted cycle, story.yaml missing skill
```
$ git diff
diff --git a/.agents/norn/workflows/slice.yaml b/.agents/norn/workflows/slice.yaml
index 158056a..a5abc4b 100644
--- a/.agents/norn/workflows/slice.yaml
+++ b/.agents/norn/workflows/slice.yaml
@@ -23,7 +23,7 @@ steps:
     inputs: [slice, spec, diff]
     outcomes:
       approve:           { to: qa, means: "all criteria met, no blocking findings" }
-      changes_requested: { to: implement, counter: review_loop, means: "blocking findings in the receipt" }
+      changes_requested: { to: implement, means: "blocking findings in the receipt" }
   qa:
     type: agent
     skill: norn-qa
diff --git a/.agents/norn/workflows/story.yaml b/.agents/norn/workflows/story.yaml
index 3349cae..23004ec 100644
--- a/.agents/norn/workflows/story.yaml
+++ b/.agents/norn/workflows/story.yaml
@@ -14,7 +14,7 @@ start: refine
 steps:
   refine:
     type: agent
-    skill: norn-refine
+    skill: norn-nonexistent
     attended: true
     inputs: [spec, handoff]
     instructions: "Write the spec into the body of spec.md; keep its frontmatter unchanged."
[exit 0]

$ n doctor
norn doctor: 2 checks failed (workflow slice, workflow story)

  ok   git            git version 2.50.1 (Apple Git-155)
  ok   agent claude   /Users/jakubpruszynski/.local/bin/claude (2.1.314 (Claude Code)) · hooks fire
  ok   remote         gh as PruszynskiJakub
  ok   runner         none — manual mode only: a person starts agents (MO2)
  ok   skills         installed and linked
       machine        jakubpruszynski@MacBook-Pro-Jakub-2
  ok   workflows      bug valid (.agents/norn/workflows/)
  FAIL workflow slice .agents/norn/workflows/slice.yaml
                      ! /steps/implement: cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)
  FAIL workflow story .agents/norn/workflows/story.yaml
                      ! /steps/refine/skill: skill 'norn-nonexistent' is not installed for agent 'claude' (run norn init, or add it to that agent's skill folder)
  ok   config         .agents/norn/config.yaml
[exit 1]

$ n doctor --repo
norn doctor: 2 checks failed (workflow slice, workflow story)

  ok   workflows      bug valid (.agents/norn/workflows/)
  FAIL workflow slice .agents/norn/workflows/slice.yaml
                      ! /steps/implement: cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)
  FAIL workflow story .agents/norn/workflows/story.yaml
                      ! /steps/refine/skill: skill 'norn-nonexistent' is not installed for agent 'claude' (run norn init, or add it to that agent's skill folder)
  ok   config         .agents/norn/config.yaml
[exit 1]

$ n doctor --json
{"ok":false,"live":false,"hook_command":"\"${NORN_BIN:-norn}\" hook","machine":{"holder":"jakubpruszynski@MacBook-Pro-Jakub-2","override":null},"git":{"ok":true,"version":"git version 2.50.1 (Apple Git-155)"},"agents":[{"name":"claude","adapter":"claude","tier":"blocking","ok":true,"binary":{"command":"claude","path":"/Users/jakubpruszynski/.local/bin/claude","version":"2.1.314 (Claude Code)"},"hooks_installed":true,"hook_fires":{"ok":true,"command":"\"${NORN_BIN:-norn}\" hook session-start --agent claude","exit":0,"recorded":1},"notes":[]}],"remote":{"ok":true,"provider":"gh","user":"PruszynskiJakub","git_remote":{"name":"origin","url":"https://github.com/PruszynskiJakub/norn-qa-throwaway.git"}},"runner":{"ok":true,"configured":false,"note":"manual mode only: a person starts agents (MO2)"},"skills":{"ok":true,"dir":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh110-02/repo/.agents/skills","missing":[],"drifted":[],"unlinked":{}},"repo":{"ok":false,"workflows":[{"name":"bug","file":".agents/norn/workflows/bug.yaml","ok":true,"issues":[]},{"name":"slice","file":".agents/norn/workflows/slice.yaml","ok":false,"issues":[{"code":"uncounted_cycle","path":"/steps/implement","message":"cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)","cycle":["implement","test","review"]}]},{"name":"story","file":".agents/norn/workflows/story.yaml","ok":false,"issues":[{"code":"unknown_skill","path":"/steps/refine/skill","message":"skill 'norn-nonexistent' is not installed for agent 'claude' (run norn init, or add it to that agent's skill folder)"}]}],"config":{"ok":true,"file":".agents/norn/config.yaml","present":true,"errors":[]}},"warnings":[]}
[exit 1]

```
