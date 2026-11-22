/**
 * The shipped workflows and the shared files they `use`, as text. Each file is imported as text so
 * the pack reads no disk when it loads, and the runtime parses it through the kernel's loader like any
 * repo workflow.
 */
import wfQuickYaml from "../assets/workflows/quick.yaml" with { type: "text" };
import wfRefinementYaml from "../assets/workflows/refinement.yaml" with { type: "text" };
import wfReproduceYaml from "../assets/workflows/reproduce.yaml" with { type: "text" };
import wfSliceYaml from "../assets/workflows/slice.yaml" with { type: "text" };
import wfStoryYaml from "../assets/workflows/story.yaml" with { type: "text" };
import wfTriageYaml from "../assets/workflows/triage.yaml" with { type: "text" };
import sharedBaseUpdateYaml from "../assets/workflows/shared/base-update.yaml" with { type: "text" };
import sharedCatchUpYaml from "../assets/workflows/shared/catch-up.yaml" with { type: "text" };
import sharedLandYaml from "../assets/workflows/shared/land.yaml" with { type: "text" };
import sharedPublishYaml from "../assets/workflows/shared/publish.yaml" with { type: "text" };

/** workflow file name to its YAML text */
export const WORKFLOWS: Record<string, string> = {
  "quick.yaml": wfQuickYaml,
  "refinement.yaml": wfRefinementYaml,
  "reproduce.yaml": wfReproduceYaml,
  "slice.yaml": wfSliceYaml,
  "story.yaml": wfStoryYaml,
  "triage.yaml": wfTriageYaml,
};

/** shared file name to its YAML text */
export const SHARED: Record<string, string> = {
  "base-update.yaml": sharedBaseUpdateYaml,
  "catch-up.yaml": sharedCatchUpYaml,
  "land.yaml": sharedLandYaml,
  "publish.yaml": sharedPublishYaml,
};
