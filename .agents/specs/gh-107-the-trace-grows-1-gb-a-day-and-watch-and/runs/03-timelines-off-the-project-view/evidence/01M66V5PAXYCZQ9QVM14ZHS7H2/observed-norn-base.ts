import { setTraceReadObserver } from "/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa-gh107-03/base/packages/store/src/index.ts";
setTraceReadObserver(({ file }) => process.stderr.write("TRACE-READ " + file.split("/").pop() + "\n"));
await import("/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//qa-gh107-03/base/packages/cli/src/main.ts");
