/**
 * `norn story create [--title "…"] [--body "…" | --body-file <f>] [--workflow <name>] [--web]`
 * (B18–B23, D3): create the issue on the remote with the intake label (and `norn:wf:<name>`),
 * assigned to the person, then run the intake `sync` runs (GR1) — the story is taken in, not started.
 * Without `--title` a terminal is prompted for the title and the body (`$EDITOR`); a script is
 * refused (D2). The workflow is checked and the body read before any remote call, and a remote
 * failure stops before any local write. `--web` opens the remote's new-issue page instead.
 */
import { readFileSync } from "node:fs";
import { cmd, WF_LABEL } from "@norn/core";
import { storyKey } from "@norn/schema";
import { loadWorkflows, WORKFLOWS_DIR } from "@norn/store";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import type { Context } from "../context.ts";
import { CliFailure, failure, refuse, rendered, usageError } from "../output.ts";
import { openLink } from "../runtime/open-link.ts";
import { runTick } from "../runtime/tick.ts";

export const storyCreateCommand = defineCommand({
  name: "story create",
  summary: "Create a story's issue on the remote, assigned to you, and take it in (GR1)",
  usage: `norn story create [--title "…"] [--body "…" | --body-file <f>] [--workflow <name>] [--web]`,
  markdown: true,
  optionHelp: {
    "--title": "the issue title; prompted at a terminal when left out",
    "--body": "the issue body; at a terminal without --title, written in $EDITOR",
    "--body-file <f>": "read the body from a file",
    "--workflow <name>": "label the issue norn:wf:<name> so intake picks that workflow (W9)",
    "--web": "open the remote's new-issue page with the labels filled in; creates nothing",
  },
  options: {
    title: { type: "string" },
    body: { type: "string" },
    "body-file": { type: "string" },
    workflow: { type: "string" },
    web: { type: "boolean" },
  },
  async run(ctx, args) {
    const workflow = opt.str(args, "workflow");
    if (workflow !== undefined) {
      // B21: before anything is created
      const listed = Object.keys(loadWorkflows(ctx.root).workflows).sort();
      if (!listed.includes(workflow))
        throw refuse(`no workflow '${workflow}' in ${WORKFLOWS_DIR}/ (available: ${listed.join(", ") || "none"})`, cmd.storyCreate({ workflow: `<${listed.join("|")}>` }), "unknown_workflow", { workflows: listed });
    }
    const labels = [ctx.config.remote.label, ...(workflow ? [`${WF_LABEL}${workflow}`] : [])];
    const remote = (await ctx.ports()).remote;
    if (!remote) throw refuse("no remote is configured", cmd.doctor(), "no_remote");
    const remoteFailed = (e: unknown) => failure(`the remote failed: ${(e as Error).message}`, cmd.doctor(), "remote_failed");

    if (opt.bool(args, "web")) {
      // B23
      const url = await remote.newIssueUrl({ labels }).catch((e) => Promise.reject(remoteFailed(e)));
      const opened = await openLink(ctx, url);
      if (opened.code !== 0) throw failure(`could not open ${url}: ${opened.stderr.trim() || `exit ${opened.code}`}`, `open ${url} in a browser`, "open_failed");
      return rendered({ url, labels, created: false }, `Opened ${url}\n`);
    }

    const { title, body } = await issueText(ctx, args);
    let created;
    try {
      created = await remote.createIssue({ title, body, labels, assignee: await remote.whoami() });
    } catch (e) {
      throw remoteFailed(e); // B22: nothing written locally yet
    }
    const story = storyKey(created.provider, created.number);
    const made = { story, url: created.url, number: created.number, labels: created.labels };
    const later = (error: string) =>
      // B22: the issue exists, so a failed intake is no failure of this command; a retry would create it twice
      rendered({ ...made, taken_in: false, intake_error: error, do_instead: cmd.sync() }, `${story}\n\nCreated ${created.url}, but the intake did not run: ${error}\nIt is taken in by the next tick, or now with \`${cmd.sync()}\` — do not create it again.\n`);
    // GR1: the same intake `norn sync` runs
    let report;
    try {
      report = await runTick(ctx, { sync: "force" });
    } catch (e) {
      return later(e instanceof CliFailure ? e.body.error : (e as Error).message);
    }
    const intake = report.decisions.find((d) => d.kind === "intake_story" && d.story === story);
    if (!intake?.ok) return later(intake?.error ?? "this tick did not take it in");
    return rendered({ ...made, taken_in: true }, `${story}\n\nCreated ${created.url} and took it in; it starts like any new story (\`${cmd.status()}\`).\n`);
  },
});

/** B18–B20: the title and body from the flags, else from the terminal; a script without a title is refused. */
async function issueText(ctx: Context, args: ParsedArgs): Promise<{ title: string; body: string }> {
  const bodyFlag = opt.str(args, "body");
  const bodyFile = opt.str(args, "body-file");
  if (bodyFlag !== undefined && bodyFile !== undefined) throw usageError("--body and --body-file are exclusive", cmd.storyCreate());
  let body = bodyFlag ?? "";
  if (bodyFile !== undefined) {
    try {
      body = readFileSync(bodyFile, "utf8");
    } catch (e) {
      throw usageError(`cannot read --body-file ${bodyFile}: ${(e as Error).message}`, cmd.storyCreate());
    }
  }
  const given = opt.str(args, "title");
  if (given !== undefined) {
    if (!given.trim()) throw usageError("the title is empty", cmd.storyCreate());
    return { title: given.trim(), body };
  }
  const term = ctx.terminal(args.json === true);
  if (!term) throw usageError("a title is needed and there is no terminal to ask in", `pass --title: ${cmd.storyCreate()}`, "title_required");
  const title = (await term.ask("Title:"))?.trim();
  if (!title) throw usageError("the title is empty; nothing was created", cmd.storyCreate());
  if (bodyFlag !== undefined || bodyFile !== undefined) return { title, body };
  const edited = await term.edit("");
  if (edited === null) throw usageError("the editor failed; nothing was created", `pass --body: ${cmd.storyCreate({ title })}`);
  return { title, body: edited };
}
