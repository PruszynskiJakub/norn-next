const l = JSON.parse(await Bun.file(process.argv[2]).text());
for (const e of l) {
  const v = e.v;
  if (/^started/.test(e.label)) console.log(e.label, JSON.stringify({ agent_session_id: v?.agent_session_id, worktree: v?.worktree, step: v?.step }));
  else if (/^state/.test(e.label)) console.log(e.label, JSON.stringify({ step: v?.step, status: v?.status, sess: v?.run?.agent_session_id }));
  else if (/^(stop|tick|brief.*exit|done9)/.test(e.label)) console.log(e.label, JSON.stringify(v).slice(0, 200));
  else if (/^why/.test(e.label)) console.log(e.label, v.slice(0, 250));
}
