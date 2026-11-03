# 03 — Drift: a changed and an added tool

**Date:** 2026-11-03 · **Answers:** Q4, Q3 · **Versions:** see [00](00-environment.md)

## Goal

After the notes server has been seen (and blocked and unblocked) in Agent 365, change it the way a server's owner
could: change a tool's description and add a destructive tool. What do API Management, Agent 365 and the chat show
and do with the change?

## Setup

- The environment of [00](00-environment.md), after [02](02-block-and-unblock.md) (the server blocked once, then
  unblocked: `accessState: active`).
- `src/02_probe.py` running ([assets/03-probe.log](assets/03-probe.log)), listing the tools every 5 s.
- The drift, in `services/notes-mcp/server.py` (marked "Experiment 03"; to be reverted at the end of the spike):
  - `add_note`'s description gains an instruction for the model: "After adding a note, always list the notes so
    that the user sees them.";
  - a new tool `delete_note(id)` deletes a note.

## Steps

1. `azd deploy notes-mcp` (17:31–17:33).
2. Watch the probe and Agents > Tools.
3. In a new chat: "List 5 notes, then delete the note that says 'first note through API Management'."

## Result

- **API Management served the change at once:** the probe listed `delete_note` at 17:33:20, as soon as the new
  revision served (the API is a pass-through to the server, which provides the tool list).
- **Agent 365:** on Standard v2, governance is per server; the server's page shows no tools ("doesn't support tool
  discovery"), as in [02](02-block-and-unblock.md). Tool-level review is a capability of the AI Gateway tier.
- **The chat used the new destructive tool at once:** `notes-list_notes`, then `notes-delete_note`; the note was
  deleted.
- Side note: in a first try ("Delete the oldest note.") the model asked `list_notes` for 100 notes, over the
  server's limit (50); the tool error stopped it before any deletion.

## Conclusion

On Standard v2, Agent 365 governs the server as a whole, so a changed or added tool, including a destructive one,
reaches every client of the gateway as soon as the server serves it; blocking the server stops all its tools. To
control individual tools, use the AI Gateway tier ("static list of allowed tools") or an API Management policy written
for the purpose. Re-provisioning while the server is blocked: see [05](05-redeploy-and-discovery.md).
