/** The shared store contract, run against store "local" on an in-memory host. */
import { storeContract } from "@norn/conformance";
import { localStoreWorld } from "./world.ts";

storeContract("local", () => localStoreWorld());
