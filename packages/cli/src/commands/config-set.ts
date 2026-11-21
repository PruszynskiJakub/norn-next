/**
 * `norn config set <key> [<value>] [--commit] [--user] [--unset]`: set one config key in the repo-local file (the committed one with --commit).
 * The value is read as YAML (`true`, `3`, `[a, b]`); the file is checked with the others before it is
 * written (`config/set.ts` has the rule). A key a higher file also sets is still written, and the
 * answer says which file wins and the value the merged config keeps (`overridden`).
 */
import { defineCommand, opt, type PersonOnlyWhen } from "../command.ts";
import { configPaths, type Layer, layerFileName, REPO_COMMITTED_FILE, REPO_LOCAL_FILE } from "../config/paths.ts";
import { POLICY_KEY } from "../config/schema.ts";
import { type Override, setConfigKey } from "../config/set.ts";
import { parseValue } from "../config/write.ts";
import { rendered, usageError } from "../output.ts";

/** The warning for a value a higher file overrides, naming the set that would apply. */
function overrideText(o: Override, layer: Layer, key: string, raw: string): string {
  const flag = o.layer === "repo" ? " --commit" : "";
  return `**Overridden:** written, but ${layerFileName(o.layer)} sets ${o.keys.join(", ")} too and wins over ${layerFileName(layer)}: the merged value stays ${JSON.stringify(o.value)}. To change it for everyone: norn config set ${key} ${raw}${flag}; to make it yours, remove ${key} from ${layerFileName(o.layer)}.`;
}

/** The warning for a policy value the merged config holds less of: only the user's file grants, and a repo file narrows. */
function narrowedText(value: unknown, layer: Layer, key: string, raw: string): string {
  const stays = `the merged value stays ${JSON.stringify(value)}`;
  return layer === "user"
    ? `**Narrowed:** written, but a repo file names less of it, and a repo file narrows the policy: ${stays}. To grant it, remove ${key} from ${REPO_LOCAL_FILE} and ${REPO_COMMITTED_FILE}, or widen it there.`
    : `**Narrowed:** written, but only ${layerFileName("user")} grants the policy, and a repo file can only narrow it: ${stays}. To grant it: norn config set ${key} ${raw} --user`;
}

/** The first argument names a policy key: the person alone grants what may stand in for them. */
const setsPolicy: PersonOnlyWhen = {
  when(args) {
    const key = args.find((a) => !a.startsWith("-"));
    return key !== undefined && (key === POLICY_KEY || key.startsWith(`${POLICY_KEY}.`)) ? `config set ${key}` : null;
  },
  help: `A person's command when it sets a \`${POLICY_KEY}\` key: refused then in an agent's session (\`person_only\`).`,
};

const KEY = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

export const configSetCommand = defineCommand({
  name: "config set",
  summary: "Set one config key in the repo-local file (the committed one with --commit)",
  usage: "norn config set <key> [<value>] [--commit] [--user] [--unset]",
  options: {
    commit: { type: "boolean" },
    user: { type: "boolean" },
    unset: { type: "boolean" },
  },
  optionHelp: {
    "--commit": `write the committed config (${REPO_COMMITTED_FILE})`,
    "--user": "write the user config (<norn home>/config.yaml)",
    "--unset": "remove the key instead of setting it",
  },
  positionals: { min: 1, max: 2 },
  personOnly: setsPolicy,
  async run(ctx, args) {
    const [key, raw] = args.positionals as [string, string | undefined];
    const unset = opt.bool(args, "unset");
    if (!KEY.test(key)) throw usageError(`not a config key: ${key} (dotted, as tracker.intake.label)`, "norn config show");
    if (unset && raw !== undefined) throw usageError("--unset takes no value", `norn config set ${key} --unset`);
    if (!unset && raw === undefined) throw usageError(`config set ${key} needs a value, or --unset`, `norn config set ${key} <value>`);
    if (opt.bool(args, "commit") && opt.bool(args, "user")) throw usageError("--commit and --user exclude each other", `norn config set ${key} <value>`);
    const layer: Layer = opt.bool(args, "commit") ? "repo" : opt.bool(args, "user") ? "user" : "local";

    const w = await ctx.repo();
    const value = unset ? undefined : parseValue(raw as string);
    const set = await setConfigKey(w.ctx.files, configPaths(w.home, w.repo.root), layer, key, value);
    const out = { key, ...(unset ? { unset: true } : { value }), layer, ...set };
    const what = unset ? `Removed ${key}` : `Set ${key} = ${JSON.stringify(value)}`;
    const rest = set.problems.length ? `\n\nThe config is not complete yet:\n${set.problems.map((p) => `- ${p.path || "/"}: ${p.message}`).join("\n")}` : "";
    return rendered(out, `${what} in ${layerFileName(layer)}.${set.overridden ? `\n\n${overrideText(set.overridden, layer, key, raw as string)}` : ""}${set.narrowed ? `\n\n${narrowedText(set.narrowed.value, layer, key, raw as string)}` : ""}${rest}`);
  },
});
