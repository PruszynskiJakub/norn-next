import json, os
D = os.environ["D"]
p = lambda *fs: ", ".join(f"{D}/{f}" for f in fs)
P = {
 "B1": p("ev/B1.md"), "B2": p("ev/B2.md"), "B3": p("ev/B3.md"), "B4": p("ev/B4.md"), "B5": p("ev/B5.md"),
 "B6": p("e1/B6.md", "ev/B61.md"), "B7": p("ev/B7.md", "e1/B9.md", "e1/B51.md", "e1/B50.md", "ev/B7-doctor.md"),
 "B8": p("ev/B8-B71-lint.txt"), "B9": p("e1/B9.md", "ev/B9-B10-released.md"), "B10": p("e1/B10.md", "ev/B9-B10-released.md"),
 "B11": p("ec/B11-harness.md", "ev/B11.typescript", "ev/B11-esc.typescript"),
 "B13": p("ev/B13-fresh.md", "ev/B13.md"), "B14": p("ev/B14.md"), "B15": p("e1/B15.md", "ev/B70.md"),
 "B16": p("e1/B16.md", "ec/B16-pr.md", "e3/B55.md"), "B20": p("ev/B20.md"), "B21": p("e1/B21-harness.md"), "B22": p("e1/B22-harness.md"),
 "B24": p("e1/B24.md"), "B25": p("e1/B58.md", "e1/B25.md"), "B26": p("e1/B26.md", "e1/B56.md"), "B27": p("e3/B27.md", "e1/B27.md"),
 "B28": p("e3/B28.md", "ec/B28-open.md"), "B30": p("e1/B30.md"), "B31": p("e1/B31.md"), "B32": p("e1/B32.md"),
 "B33": p("ec/B33-cross.md", "e1/B33.md"), "B34": p("ec/B34-cross.md", "e3/B55.md"), "B35": p("e1/B35.md"), "B36": p("e1/B36.md"),
 "B37": p("e1/B37.md"), "B38": p("e1/B38.md"), "B39": p("e1/B39.md"), "B40": p("e1/B40.md", "ec/B40-gate.md"), "B41": p("e1/B41.md"),
 "B42": p("e1/B42.md"), "B43": p("e1/B43.md", "e3/B27.md"), "B44": p("e1/B44.md"), "B45": p("e1/B45.md", "e3/B45.md"),
 "B48": p("e1/B48.md"), "B49": p("e1/B49.md"), "B50": p("e1/B50.md"), "B51": p("e1/B51.md"), "B52": p("e1/B52.md", "e1/B48.md"),
 "B53": p("e1/B53.md"), "B54": p("e1/B54.md"), "B55": p("e3/B55.md"), "B56": p("e1/B56.md"), "B57": p("e1/B57.md"), "B58": p("e1/B58.md"),
 "B59": p("e1/B59.md"), "B60": p("e1/B60.md", "ev/B20.md"), "B61": p("ev/B61.md"), "B62": p("ev/B62.md"), "B63": p("ev/B63.md"),
 "B64": p("ev/B64.typescript"), "B65": p("ev/B65.md"), "B66": p("ev/B66.md"), "B67": p("ev/B67.md"), "B68": p("ev/B68.md"),
 "B69": p("e69/B69.md", "ev/B69-usage.md"), "B70": p("ev/B70.md", "ev/B70-schema.md"), "B71": p("ev/B8-B71-lint.txt"),
}
DEV = "bun packages/cli/src/main.ts (the branch) in a throwaway repo under $TMPDIR"
U = {
 "B12": ("this session lacks herdr (the step's capabilities); only the outside-Herdr refusal was observed: exit 3 not_in_herdr, do_instead `norn status --watch`", f"In a Herdr pane, in a throwaway repo, run `{DEV} status --watch --pane`: a new pane opens below the current one running the cockpit; then run it outside Herdr: refused, do_instead `norn status --watch`.", p("ev/B12.md")),
 "B17": ("this session lacks a browser", f"With a story that has a PR and one without (real gh remote), run `{DEV} story view gh-N --web`: the browser opens PR #… ; for the story without a PR it opens the issue page.", None),
 "B18": ("this session lacks the real remote; observed only against the harness's fake remote (issue #81 created with labels norn + norn:wf:gated, assignee tester, taken in)", f"Against a throwaway GitHub repo (as the person did at head af6e5816 in gh-75/12 human-qa#1, PruszynskiJakub/norn-qa-story-create): `{DEV} story create --title \"Fix login timeout\" --workflow story` prints gh-N; the issue has labels norn and norn:wf:story and is assigned to you; `norn status` lists gh-N as new / not started.", p("e1/B18-harness.md")),
 "B23": ("this session lacks a browser and the real remote", f"In a repo with a gh remote: `{DEV} story create --web --workflow spec`: the browser opens …/issues/new with labels norn and norn:wf:spec prefilled; no issue is created (gh-75/12 human-qa#1 saw the URL ?labels=norn%2Cnorn%3Awf%3Astory and no issue, at an older head).", None),
 "B29": ("this session lacks herdr", f"In Herdr: `{DEV} story chat gh-N` opens a `gh-N orient` workspace with an agent; run again: it focuses the same workspace.", None),
 "B46": ("this session lacks herdr", f"In Herdr with a unit running headful: `{DEV} run attach gh-N` focuses its agent pane; on a unit with no live pane: refused nothing_to_attach, giving its start command when it has one.", None),
 "B47": ("this session lacks herdr", f"In Herdr with two Your turn units with live panes: `{DEV} run attach --next` focuses the older one, no prompt; with none: refused nothing_to_attach.", None),
}
out = []
for i in range(1, 72):
    k = f"B{i}"
    if k in U:
        r, h, e = U[k]; d = {"id": k, "verdict": "unverified", "reason": r, "how": h}
        if e: d["evidence"] = e
    elif k == "B19":
        d = {"id": k, "verdict": "person", "how": f"Real TTY: in a throwaway repo with a gh remote run `{DEV} story create` with no flags: a 'Title:' prompt, then $EDITOR opens for the body; the issue is created with that title/body. Then run it again and press Enter at 'Title:' with nothing typed: exit 2, 'the title is empty; nothing was created', no issue. The empty-title path was observed here on a real TTY (ev/B19-empty-title.typescript) and the title+editor path through the harness's scripted terminal (e1/B19-harness.md); only the real $EDITOR round trip is left for the person.", "evidence": p("ev/B19-empty-title.typescript", "e1/B19-harness.md")}
    else:
        d = {"id": k, "verdict": "pass", "evidence": P[k]}
    out.append(d)
json.dump(out, open(f"{D}/criteria.json", "w"), indent=1)
print(len(out), {v: sum(1 for o in out if o["verdict"] == v) for v in ("pass","person","unverified","fail")})
