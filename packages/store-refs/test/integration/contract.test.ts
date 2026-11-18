/** The shared store contract, run against store "refs" over real git with a bare repo as the remote. */
import { storeContract } from "@norn/conformance";
import { refsWorld } from "./world.ts";

storeContract("refs", refsWorld);
