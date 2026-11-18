/** `true` only when A and B are the same type; a schema restating an interface is pinned to it with this. */
export type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
