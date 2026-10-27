# UI prototype

Several **radically different variants** on one route, switched from a floating bar. The person flips between them in the browser, picks one or takes parts of several, and the rest is thrown away.

Right shape when the question sounds like:

- "What should this page look like?"
- "Show me a few options for this dashboard before we commit."
- "Try another layout for the settings screen."

If the question is about logic or state rather than looks, use [LOGIC.md](LOGIC.md) instead.

## Where the variants live

A variant is judged best against the rest of the app: the real header, navigation, data and density. On an empty route every variant looks fine.

- **On an existing page (default).** The route exists; the variants render on it, chosen by a `?variant=` URL param. Data fetching, params and auth stay as they are; only the rendered subtree changes. Something new that would live inside an existing page (a new section, card, or stage of a flow) still mounts inside that page.
- **On a new page (last resort).** Only when nothing could host it, such as a new top-level surface. Add a throwaway route that follows the project's routing convention, with `prototype` in its path or file name, and the same `?variant=` param. Check first that no existing page could host it.

## 1. Pick the number

Default to **3 variants**; never more than 5, past which they stop being radically different. Write the plan in one line at the top of the switcher file, e.g. "Three variants of the settings page on the existing settings route, chosen by `?variant=`."

## 2. Draft radically different variants

Each variant serves the page's purpose with the data it has, uses the project's component library and styling, and exports a clear name (`VariantA`, `VariantB`, …).

Variants differ in **structure**: layout, information hierarchy, primary affordance. Not colours, not copy. Three tweaked card grids are wallpaper, not a prototype. If two drafts come out alike, redo one with an explicit constraint ("no card grid"). A shared small piece (a header) is fine; a shared layout defeats the point.

Variants only read. If one must mutate, point it at a stub: the question is what it looks like, not whether the backend works.

## 3. Wire the switcher

One switcher on the route picks the variant from the param; data fetching stays above it:

```tsx
// sketch: adapt to the project's framework
const variant = searchParams.get("variant") ?? "A";
return (
  <>
    {variant === "A" && <VariantA {...data} />}
    {variant === "B" && <VariantB {...data} />}
    {variant === "C" && <VariantC {...data} />}
    <PrototypeSwitcher variants={["A", "B", "C"]} current={variant} />
  </>
);
```

## 4. Build the floating bar

A small fixed bar at the bottom centre: a left arrow, the current variant's key and name (`B (Sidebar layout)`), a right arrow. It lives in one shared component, wherever the project keeps shared UI.

- Arrows cycle through the variants and wrap around, updating the URL param through the framework's router, so a variant is shareable and survives a reload.
- The `←` and `→` keys cycle too, except while an `<input>`, `<textarea>` or `[contenteditable]` has focus.
- It looks plainly not part of the design under review: a high-contrast pill with a light shadow.
- It never renders in a production build (`process.env.NODE_ENV !== "production"` or the project's equivalent).

## 5. Hand it over

Give the person the one command that starts it, the URL and the variant keys. The useful feedback is usually a mix: "the header from B with the list from C". That mix is the design they want; build it as another variant if they need to see it.

## 6. Capture

Record which variant won, or which mix, and why, then keep the prototype as [SKILL.md](SKILL.md) says. Every variant, the switcher and any throwaway route go to the throwaway branch; the page on your branch goes back to how it was. The winning design reaches the code later, rewritten properly by whoever builds it.

## Anti-patterns

- **Variants that differ only in colour or copy.** That is a tweak; real variants disagree about structure.
- **Too much shared code.** A shared layout stops the variants from throwing out the layout.
- **Real mutations.** Stub them.
- **Promoting a variant as is.** It was written without tests or error handling; the real version is written again.
