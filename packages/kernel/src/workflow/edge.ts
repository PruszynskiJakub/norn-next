/**
 * Edge names `<step>.<outcome>` and shared exits `<use>.<exit>`. A step or use step name never holds
 * a dot and an outcome may (`ci.failed`), so a name splits at its first dot only.
 */

export function splitEdge(edge: string): [head: string, rest: string] {
  const at = edge.indexOf(".");
  return at < 0 ? [edge, ""] : [edge.slice(0, at), edge.slice(at + 1)];
}
