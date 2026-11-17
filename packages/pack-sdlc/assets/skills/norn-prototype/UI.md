# UI prototype

Several **radically different variants** of one screen, switched in place. The person flips between them, picks one or takes parts of several, and the rest is thrown away.

If the question is about logic or state rather than looks, use [LOGIC.md](LOGIC.md).

## 1. Real data, real surroundings

A variant is judged against the rest of the product: the real header, navigation, data and density. On an empty screen every variant looks fine.

- **Web app:** mount the variants on the existing page, chosen by a `?variant=` URL param; data fetching, params and auth stay above the switch. A new route (with `prototype` in its path) only when nothing existing could host it.
- **Terminal view or CLI output:** a small harness in the prototype folder renders the real data (a captured `--json` output, or a fixture built from it) through each variant, chosen by `--variant <key>` and cycled with a key (Tab). Add a flag that prints one frame to stdout at a given width, so a variant can be shown without a live terminal.

Default to **3 variants**, never more than 5. Write the plan in one line at the top of the switcher, e.g. "Three variants of the settings page on the existing route, chosen by `?variant=`." Keep today's screen as a variant `0` when the question is "change it or keep it".

## 2. Make them differ in structure

Variants differ in layout, information hierarchy and primary affordance, not colours or copy: three tweaked card grids are one variant. If two come out alike, redo one under an explicit constraint ("no card grid"). A shared small piece is fine; a shared layout defeats the point. Use the project's own components and styling, and name each variant (`B (Sidebar layout)`).

Variants only read: point any action at a stub that shows what it would do.

## 3. The switcher

- Cycles through the variants and wraps around; the current key and name are always visible.
- Web: a small fixed bar at the bottom centre with `←` `→` buttons, plainly not part of the design (a high-contrast pill). The arrow keys cycle too, except while an `<input>`, `<textarea>` or `[contenteditable]` has focus. Switching updates the URL param, so a variant survives a reload and can be shared. It never renders in a production build.

## 4. Hand it over

Give the person the one command, the URL or flag, and the variant keys. A mix they ask for ("the header from B with the list from C") is the design they want: build it as another variant if they need to see it. Record which variant or mix won and why, and commit as [SKILL.md](SKILL.md) says. Say at the top of the switcher which page mounted it, so it can be mounted again.
