/**
 * The bundled skills the shipped workflows name, each as its files by path inside the skill's folder,
 * imported as text so the pack carries them without reading the disk.
 */
import nornSKILLMd from "../assets/skills/norn/SKILL.md" with { type: "text" };
import nornClarifySKILLMd from "../assets/skills/norn-clarify/SKILL.md" with { type: "text" };
import nornCodebaseDesignDEEPENINGMd from "../assets/skills/norn-codebase-design/DEEPENING.md" with { type: "text" };
import nornCodebaseDesignDESIGNITTWICEMd from "../assets/skills/norn-codebase-design/DESIGN-IT-TWICE.md" with { type: "text" };
import nornCodebaseDesignSKILLMd from "../assets/skills/norn-codebase-design/SKILL.md" with { type: "text" };
import nornDiagnoseSKILLMd from "../assets/skills/norn-diagnose/SKILL.md" with { type: "text" };
import nornDiagnoseScriptsHitlLoopTemplateSh from "../assets/skills/norn-diagnose/scripts/hitl-loop.template.sh" with { type: "text" };
import nornFsdSKILLMd from "../assets/skills/norn-fsd/SKILL.md" with { type: "text" };
import nornFsdRoundSKILLMd from "../assets/skills/norn-fsd-round/SKILL.md" with { type: "text" };
import nornImplementSKILLMd from "../assets/skills/norn-implement/SKILL.md" with { type: "text" };
import nornInterviewSKILLMd from "../assets/skills/norn-interview/SKILL.md" with { type: "text" };
import nornMergeSKILLMd from "../assets/skills/norn-merge/SKILL.md" with { type: "text" };
import nornPlanSKILLMd from "../assets/skills/norn-plan/SKILL.md" with { type: "text" };
import nornPrSKILLMd from "../assets/skills/norn-pr/SKILL.md" with { type: "text" };
import nornPrototypeLOGICMd from "../assets/skills/norn-prototype/LOGIC.md" with { type: "text" };
import nornPrototypeSKILLMd from "../assets/skills/norn-prototype/SKILL.md" with { type: "text" };
import nornPrototypeUIMd from "../assets/skills/norn-prototype/UI.md" with { type: "text" };
import nornQaSKILLMd from "../assets/skills/norn-qa/SKILL.md" with { type: "text" };
import nornQaPersonSKILLMd from "../assets/skills/norn-qa-person/SKILL.md" with { type: "text" };
import nornRefineEXAMPLEMd from "../assets/skills/norn-refine/EXAMPLE.md" with { type: "text" };
import nornRefineSKILLMd from "../assets/skills/norn-refine/SKILL.md" with { type: "text" };
import nornRetroSKILLMd from "../assets/skills/norn-retro/SKILL.md" with { type: "text" };
import nornReviewSECURITYMd from "../assets/skills/norn-review/SECURITY.md" with { type: "text" };
import nornReviewSKILLMd from "../assets/skills/norn-review/SKILL.md" with { type: "text" };
import nornReviewSMELLSMd from "../assets/skills/norn-review/SMELLS.md" with { type: "text" };
import nornSliceSKILLMd from "../assets/skills/norn-slice/SKILL.md" with { type: "text" };
import nornTddSKILLMd from "../assets/skills/norn-tdd/SKILL.md" with { type: "text" };
import nornTddMockingMd from "../assets/skills/norn-tdd/mocking.md" with { type: "text" };
import nornTddTestsMd from "../assets/skills/norn-tdd/tests.md" with { type: "text" };
import nornTriageSKILLMd from "../assets/skills/norn-triage/SKILL.md" with { type: "text" };

/** skill name to its files by relative path */
export const SKILLS: Record<string, Record<string, string>> = {
  "norn": {
    "SKILL.md": nornSKILLMd,
  },
  "norn-clarify": {
    "SKILL.md": nornClarifySKILLMd,
  },
  "norn-codebase-design": {
    "DEEPENING.md": nornCodebaseDesignDEEPENINGMd,
    "DESIGN-IT-TWICE.md": nornCodebaseDesignDESIGNITTWICEMd,
    "SKILL.md": nornCodebaseDesignSKILLMd,
  },
  "norn-diagnose": {
    "SKILL.md": nornDiagnoseSKILLMd,
    "scripts/hitl-loop.template.sh": nornDiagnoseScriptsHitlLoopTemplateSh,
  },
  "norn-fsd": {
    "SKILL.md": nornFsdSKILLMd,
  },
  "norn-fsd-round": {
    "SKILL.md": nornFsdRoundSKILLMd,
  },
  "norn-implement": {
    "SKILL.md": nornImplementSKILLMd,
  },
  "norn-interview": {
    "SKILL.md": nornInterviewSKILLMd,
  },
  "norn-merge": {
    "SKILL.md": nornMergeSKILLMd,
  },
  "norn-plan": {
    "SKILL.md": nornPlanSKILLMd,
  },
  "norn-pr": {
    "SKILL.md": nornPrSKILLMd,
  },
  "norn-prototype": {
    "LOGIC.md": nornPrototypeLOGICMd,
    "SKILL.md": nornPrototypeSKILLMd,
    "UI.md": nornPrototypeUIMd,
  },
  "norn-qa": {
    "SKILL.md": nornQaSKILLMd,
  },
  "norn-qa-person": {
    "SKILL.md": nornQaPersonSKILLMd,
  },
  "norn-refine": {
    "EXAMPLE.md": nornRefineEXAMPLEMd,
    "SKILL.md": nornRefineSKILLMd,
  },
  "norn-retro": {
    "SKILL.md": nornRetroSKILLMd,
  },
  "norn-review": {
    "SECURITY.md": nornReviewSECURITYMd,
    "SKILL.md": nornReviewSKILLMd,
    "SMELLS.md": nornReviewSMELLSMd,
  },
  "norn-slice": {
    "SKILL.md": nornSliceSKILLMd,
  },
  "norn-tdd": {
    "SKILL.md": nornTddSKILLMd,
    "mocking.md": nornTddMockingMd,
    "tests.md": nornTddTestsMd,
  },
  "norn-triage": {
    "SKILL.md": nornTriageSKILLMd,
  },
};
