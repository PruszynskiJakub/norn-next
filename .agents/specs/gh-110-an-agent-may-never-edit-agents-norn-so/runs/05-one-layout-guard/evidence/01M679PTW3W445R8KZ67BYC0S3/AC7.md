# AC7 (B17, B18) — by hand in a throwaway repo
Did exactly that: init, commit, moved files back by hand (and in a second pass copied one part to have it in both places).
- `norn status` (markdown): "**Refused (old_layout):** <root> is on the old norn layout (config: .agents/norn/config.yaml; workflows: .agents/norn/workflows; machine files: .agents/norn/trace)  Do instead: norn migrate" — exit 3.
- `norn doctor`: FAIL layout, lists each part, "→ norn migrate", exit 1.
- Both: status says "both the old and the new layout (config: X and Y); norn reads neither / Do instead: keep one of each pair … then run norn migrate in <root>"; doctor says the same.
Evidence: AC1-AC3-AC5-old.txt, AC2-AC4-both.txt.
Note: `norn status --segment` (Herdr tab bar) prints an empty segment on the old layout (segment-old.txt), as review #1 noted; plain status is what AC7 names.
