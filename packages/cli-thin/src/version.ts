/** This norn's version, from the package; only the default context reads it, so a test can run the CLI as any binary. */
import { version } from "../package.json";

export const NORN_VERSION: string = version;
