/**
 * The signal source contract as a reusable suite: what the kernel may assume of any source of a
 * signal (the host's vcs and clock, a plugin's `ci-failed`). Sources remember nothing they reported,
 * so firing once per occurrence rests on the same occurrence getting the same id on every read and
 * every machine; `null` means nothing happened and a failure means the source could not tell; and a
 * read is only a read, since the host asks on every tick.
 */
import { describe, expect } from "bun:test";
import type { HostContext, SignalReadInput, SignalSourceDefinition } from "@norn/plugin-api";
import { check, Signal } from "@norn/schema";
import { type ContractOptions, contractTest, expectValid, failureOf, valueOf } from "./contract.ts";

export interface SignalWorld {
  /** the signal's name, as an `on:` entry routes it */
  name: string;
  source: SignalSourceDefinition;
  /** what the host asks the source with, for the story the world is about */
  input(): SignalReadInput;
  /** the `on:` entry's parameters for the signal; none when absent */
  params?: Record<string, unknown>;
  ctx: HostContext;
  /** while on, the signal stands for the story; off, nothing happened */
  happen(on: boolean): void | Promise<void>;
  /** while on, the source cannot tell, as when its provider is down */
  failing(on: boolean): void | Promise<void>;
  /** make the signal stand again as a new occurrence (the base moved again, a new visit) */
  again?(): void | Promise<void>;
  /** every effect performed so far, in a form compared by value: what a read must never add to */
  effects(): unknown;
}

export type SignalContractTest =
  | "nothing happened reads null"
  | "a signal is valid and of the name asked for"
  | "the same occurrence gives the same id on every read and every machine"
  | "a new occurrence gives a new id"
  | "a source that cannot tell answers a failure, never a signal or null"
  | "a read performs no effect";

export function signalSourceContract(label: string, makeWorld: () => SignalWorld | Promise<SignalWorld>, opts: ContractOptions<SignalContractTest> = {}): void {
  describe(`signal source contract: ${label}`, () => {
    const t = (n: SignalContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);
    const read = (w: SignalWorld) => w.source.read(w.input(), w.params ?? {}, w.ctx);

    t("nothing happened reads null", async () => {
      const w = await makeWorld();
      await w.happen(false);
      expect(valueOf(await read(w))).toBeNull();
    });

    t("a signal is valid and of the name asked for", async () => {
      const w = await makeWorld();
      await w.happen(true);
      const got = valueOf(await read(w));
      expectValid(`${w.name} signal`, check(Signal, got));
      expect(got?.type).toBe(w.name);
    });

    t("the same occurrence gives the same id on every read and every machine", async () => {
      const w = await makeWorld();
      await w.happen(true);
      const first = valueOf(await read(w));
      const second = valueOf(await read(w));
      const other = await makeWorld();
      await other.happen(true);
      const elsewhere = valueOf(await read(other));
      expect(first?.id).toBeString();
      expect([second?.id, elsewhere?.id]).toEqual([first?.id, first?.id]);
    });

    t("a new occurrence gives a new id", async () => {
      const w = await makeWorld();
      if (!w.again) return;
      await w.happen(true);
      const first = valueOf(await read(w));
      await w.again();
      const next = valueOf(await read(w));
      expect(next?.id).toBeString();
      expect(next?.id).not.toBe(first?.id as string);
    });

    t("a source that cannot tell answers a failure, never a signal or null", async () => {
      const w = await makeWorld();
      await w.happen(true);
      await w.failing(true);
      failureOf(await read(w));
      await w.failing(false);
      expect(valueOf(await read(w))?.type).toBe(w.name);
    });

    t("a read performs no effect", async () => {
      const w = await makeWorld();
      const before = structuredClone(w.effects());
      await w.happen(false);
      await read(w);
      await w.happen(true);
      await read(w);
      await read(w);
      expect(w.effects()).toEqual(before);
    });
  });
}
