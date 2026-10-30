<!--
Title: one sentence a user understands, e.g. "norn status shows the step each unit waits on".
It becomes the squash commit on main and the input to the changelog.
norn's open-pr step writes its own body; this template is for a PR opened by hand.
-->

## What's new

<!-- What changes for someone using norn, and why. -->

## Tested

<!-- How you know it works: the commands you ran and what you saw. -->

Closes #

<!--
Bypass only (norn cannot deliver this change): label this PR `bypass` and close an issue
labelled `bypass` whose body links the norn issue for the problem behind it. The "process"
check refuses every other PR that does not come from a norn story branch gh-<N>-<slug>.
-->
