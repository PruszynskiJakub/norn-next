/**
 * The norn lab's content, as text: the script of its eight beats with their captions, the stand-in
 * agent's beats, and the toy app the lab's repo starts from. A named export beside the pack, never part
 * of the `Pack` contract: only `norn lab` reads it, and it parses and validates each file.
 */
import agentYaml from "../assets/lab/agent.yaml" with { type: "text" };
import readmeMd from "../assets/lab/app/README.md" with { type: "text" };
import greetSh from "../assets/lab/app/greet.sh" with { type: "text" };
import testSh from "../assets/lab/app/test.sh" with { type: "text" };
import scriptYaml from "../assets/lab/script.yaml" with { type: "text" };

export interface SdlcLab {
  /** the beat script: the story, the check, and the eight beats with their captions */
  script: string;
  /** the stand-in agent's beats (harness-lab's LabBeats), as YAML */
  agent: string;
  /** the toy app's files by path, committed as the lab repo's first commit */
  app: Readonly<Record<string, string>>;
}

export const SDLC_LAB: SdlcLab = Object.freeze({
  script: scriptYaml,
  agent: agentYaml,
  app: Object.freeze({ "README.md": readmeMd, "greet.sh": greetSh, "test.sh": testSh }),
});
