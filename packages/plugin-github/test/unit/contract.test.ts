/**
 * The GitHub plugin against the shared tracker and forge contracts, over a scripted gh: once with
 * the repository configured, once with it asked of `gh repo view`.
 */
import { forgeContract, trackerContract } from "@norn/conformance";
import { forgeWorld, trackerWorld } from "./world.ts";

trackerContract("github, repository configured", () => trackerWorld({ repo: "acme/app" }));
trackerContract("github, repository from gh repo view", () => trackerWorld({}));

forgeContract("github, repository configured", () => forgeWorld({ repo: "acme/app" }));
forgeContract("github, repository from gh repo view", () => forgeWorld({}));
