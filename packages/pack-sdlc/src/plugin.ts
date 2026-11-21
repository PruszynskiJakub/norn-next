import { defineNornPlugin } from "@norn/plugin-api";
import { SDLC_PACK } from "./files.ts";

export const packSdlcPlugin = defineNornPlugin({ name: "norn-pack-sdlc", api: "^1.23", provides: { packs: { sdlc: SDLC_PACK } } });
