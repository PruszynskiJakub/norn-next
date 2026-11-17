/** The shared tracker contract, run against the local tracker on an in-memory host. */
import { trackerContract } from "@norn/conformance";
import { localWorld } from "./world.ts";

trackerContract("local", () => localWorld());

trackerContract("local, own prefix and folder", () => localWorld({ keyPrefix: "loc", dir: "/elsewhere/items/" }));
