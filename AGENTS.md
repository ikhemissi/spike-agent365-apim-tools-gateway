# AGENTS.md — Governing API Management MCP servers with Agent 365

This repository is a **spike**: it answers questions by experiment, within a time box (2 days). Nothing here is production code. Read [README.md](README.md) for the questions and the status.

## How the spike works

- **Questions first:** [docs/QUESTIONS.md](docs/QUESTIONS.md) lists what we want to know. Every experiment answers at least one question; a question can need several experiments.
- **One experiment, one file:** `docs/experiments/NN-<slug>.md` from [the template](docs/experiments/TEMPLATE.md): goal, setup, steps, result, evidence (commands, outputs, screenshots, queries), conclusion. Number them in the order they run; never renumber.
- **Evidence over opinion:** record what was observed, with the date and the versions involved. Products change: a result without a date and a version cannot be retested.
- **Findings:** [docs/FINDINGS.md](docs/FINDINGS.md) answers each question in one paragraph, with links to the experiments. Update it after every experiment.
- **Retest plan:** [docs/RETEST-PLAN.md](docs/RETEST-PLAN.md) lists what to run again when a product or a version changes.
- **Demo:** [docs/DEMO-RUNBOOK.md](docs/DEMO-RUNBOOK.md) is the step-by-step script for showing the results, written for someone else to run.
- **Time box:** when it runs out, stop and write the findings, including "unanswered" with what blocked it.
- **Ask before deciding** when a choice changes what the spike can conclude; propose a default.

## Rules

- **Never commit secrets**, keys, tokens, tenant or subscription IDs, or real user data. Use your own Entra identity (Azure CLI) and managed identities; local settings go to `.env` (git-ignored).
- **Generalize what you write:** the findings may be shared; customer, employer-internal and personal details stay out.
- Code is throwaway but must stay readable by another developer: small scripts in `src/`, one per experiment when useful, named after it (`src/03_call_with_obo.py`), each with a one-line purpose at the top, explicit names, no clever tricks, settings from the environment.
- **Commits:** conventional commits (`docs(experiment): 03 …`, `feat(spike): …`), ending with the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **At the end:** harvest the reusable learnings into the knowledge base (pitfalls, findings, decisions), generalized.

## Infrastructure

- **Layers:** the layers listed in `azure.yaml` that come from shared building blocks (`infra/azure-platform`, `infra/foundry-model`, `infra/apim-gateway`, `infra/notes-mcp`, `infra/chat-ui`) are shared building blocks, each its own Terraform root and state. Keep them as they are, so that their improvements can be merged in later; put the spike's own resources in a new layer (`infra/<name>/`, reading the other layers' outputs from azd values in its `main.tfvars.json`) and add it to `azure.yaml`.
- **Gateway settings** (MCP servers and their policies) are Azure resources: register them in a layer of the spike's own (azapi for the MCP APIs), never by hand in the portal, so that a re-provision does not undo them.
- **Notes MCP server:** `infra/notes-mcp` and `services/notes-mcp` are a shared building block; its checks: `uv run --no-project --with-requirements requirements.txt --with-requirements requirements-dev.txt pytest` in `services/notes-mcp`.
- **Chat UI:** `infra/chat-ui` and `services/chat-ui` are a shared building block too: change what it shows and tells the model with its settings (`CHAT_UI_TITLE`, `CHAT_UI_INTRO`, `CHAT_UI_INSTRUCTIONS`), not its files. Its checks: `npm ci && npm run typecheck && npm run lint && npm test && npm run build` in `services/chat-ui`.
- **Before every `azd provision`:** `azd hooks run preprovision`, then `azd provision --preview`, and read the plan.

## Code humans can maintain

Everything here must be maintainable by human developers, whoever (or whatever) wrote it. A developer new to the project understands a module in minutes and changes it with confidence.

- **Simple and explicit over clever:** no metaprogramming, hidden magic or generic frameworks; an abstraction only when a second real use exists.
- **One role per unit:** a module states its role in one or two lines at the top; a function does one thing and fits on a screen (about 40 lines), otherwise split it into named steps.
- **Names carry meaning:** domain words, full words, booleans that read as questions; no single letters except short loop indices.
- **Flat control flow:** early returns, named intermediate values, no dense one-liners or formatter opt-outs.
- **Comments explain why** (the decision, the constraint, a link to the design or ADR), never what the code already says.
- **Consistency beats preference:** follow the patterns already in the repository before introducing a new one.
- **Few dependencies:** ask before adding one; prefer the standard library and what is already used.
- **Tests read as documentation:** named after the behaviour or spec scenario they check; arrange, act, assert.
- **Read your diff as a reviewer before calling a change done;** if a piece cannot be explained simply, rewrite it.

## Known pitfalls

If `.fast-start/pitfalls.md` exists (local only, git-ignored: never commit, copy or quote it), read it before changing
infrastructure or services: it lists pitfalls known for this kind of project.

- None recorded yet.
Add a pitfall here every time something bites you, in one line: the symptom, then what to do.
