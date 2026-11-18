// Bun imports any file `with { type: "text" }` as its text; these are the asset kinds the pack carries
// that bun's own declarations do not name.
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*.sh" {
  const text: string;
  export default text;
}
