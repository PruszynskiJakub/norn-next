// Child process for the concurrent refusal test: try to take a run's refusals and print how many it got.
import { bindNornHome, claimStopBlock } from "../../../src/index.ts";

const [root, home, runId, tries, from] = [process.argv[2] as string, process.argv[3] as string, process.argv[4] as string, Number(process.argv[5]), Number(process.argv[6])];
bindNornHome(root, home);
let taken = 0;
for (let i = 0; i < tries; i++) if (claimStopBlock(root, runId, from, 3)) taken++;
process.stdout.write(String(taken));
