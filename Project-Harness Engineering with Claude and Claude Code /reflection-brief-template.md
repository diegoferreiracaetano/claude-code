# Reflection Brief — Harness Engineering Capstone

**Name:** Diego Caetano
**Date:** 2026-09-17

Replace each `→` with your answer. **Every answer cites at least one artifact from your own runs** — a run ID, file path, token count, claim outcome, or test count. Uncited answers do not pass. 3–6 sentences each unless noted. Paste short artifact snippets where they help.

**Environment**

- Model(s): `claude-haiku-4-5-20251001` (System 1 first attempt, System 2), `claude-sonnet-4-5-20250929` (System 1 accepted run)
- OS / Python: macOS (Darwin), Python 3.14.6
- Approx. API spend: ~$0.53 for System 1 (two attempts: $0.10 Haiku + $0.43 Sonnet, from `summary.md` totals) + a small additional amount for System 2 (exact total not printed by the script; `budget.json` shows ~24k input / ~0.9k output tokens for the two compression calls alone, plus the case-facts extraction and 6 eval calls). Systems 3 and 4 cost $0 (System 3 makes no API calls; System 4 ran with `--recorded-response`).

---

## Part 1 — Per-system

### System 1 — Agentic loop

1. **Loop control.** Quote the `stop_reason` sequence from one trace. Name the file and function that decides continue-vs-stop, and how.
   → From `evidence/system-1-claims-intake/run_sonnet_20260917_112347/traces/claim_05_auto_collision.jsonl`:
   ```
   turn 1: stop_reason='tool_use'  → lookup_policy, record_claim_fact ×7
   turn 2: stop_reason='tool_use'  → classify_claim, assess_severity
   turn 3: stop_reason='tool_use'  → route_to_adjuster
   turn 4: stop_reason='end_turn'  → (none)
   ```
   The decision lives in `claims_intake/loop.py`, function `run()` (lines 68–132). It is a plain three-way branch on `response.stop_reason` at lines 103 and 113: `end_turn` returns a `FinalState` immediately; `tool_use` executes every tool call, appends the results as a `user` message, and `continue`s the `while True` loop; anything else raises `UnexpectedStopReason`. Nothing else in the function inspects the model's text.

2. **Anti-pattern.** Name one anti-pattern `test_antipatterns.py` checks for. What would break in your run if the loop used it?
   → `test_no_integer_literal_iteration_cap_in_loop` statically walks `loop.py`'s AST and fails if it finds a `for _ in range(<int literal>)` or `while <var> < <int literal>` construct. If `loop.py` used, say, `for turn in range(3)` as its real stopping mechanism, `claim_04_neighbor_injury` and `claim_05_auto_collision` — which both legitimately need 4 turns to reach `route_to_adjuster` (see `summary.md` in the same run) — would be cut off mid-sequence, before the terminal tool call, silently turning a correct routing decision into a truncated, half-finished one with no error raised.

3. **Tool design.** Pick two tools with overlapping inputs. How do the descriptions prevent misrouting? What did a structured tool error let the agent do that a generic string would not?
   → `route_to_adjuster` and `escalate_to_human` (`claims_intake/tools.py`) are both marked `"TERMINAL TOOL"` and both close out a claim, but their descriptions encode mutually exclusive trigger conditions verbatim: route "when classification confidence is at least 0.6 and severity has been assessed"; escalate "when classification confidence is below 0.6 ... or when the claim cannot be routed safely." Their input schemas also differ in a way that matters: `route_to_adjuster` takes a flat `claim_summary` string, while `escalate_to_human` requires a `structured_summary` **object** with 6 required fields, one of them (`candidate_claim_types`) constrained to an enum array. In `claim_06_low_confidence_escalation`'s trace, this structure is exactly what lets the escalation carry the actual decision-relevant content — `evidence/system-1-claims-intake/run_sonnet_20260917_112347/escalations.jsonl` shows `candidate_claim_types: ["auto", "property_damage"]`, `confidence: 0.4`, and a `root_cause` string all landing in named fields a downstream adjuster queue can parse programmatically. A generic free-text tool would have let the model write an equally informative paragraph, but nothing would force it to include a candidate-types *list* or a numeric confidence at all — the required-field validation is what turns "the model happened to mention it" into "the field is guaranteed present."

4. **Your numbers.** Quote the turn count and cost for one claim. How does it differ from the README sample, and why?
   → Neither this system's own solution folder nor the capstone README publishes a specific per-claim turn/cost sample to compare against (the capstone README only gives an aggregate "$1–5 total for all four systems" ballpark). The more meaningful comparison I have is my own two full runs of the same claim on two models: `claim_05_auto_collision` took **4 turns / $0.0196** on Haiku (`evidence/system-1-claims-intake/attempt1_haiku_terminal_output.txt`) versus **4 turns / $0.0593** on Sonnet (`attempt2_sonnet_terminal_output.txt`) — identical turn count, ~3x the cost. The turn count is stable because the tool-calling *shape* (lookup → facts → classify+severity → route) is dictated by the system prompt's numbered process, not by model choice; the cost gap is pure per-token pricing, since Sonnet used similar token counts.

### System 2 — Context strategy

5. **The reduction.** From `budget.json`: baseline tokens, assembled tokens, reduction %. Which section dominates the assembled context, and why keep it verbatim?
   → `evidence/system-2-retail-context/run_20260917-112911/budget.json`: baseline **38,708** tokens → assembled **16,910** tokens = **56.31%** reduction. The `active` section dominates at **15,789** of the 16,910 assembled tokens (93%) — `case_facts` is 204, `resolved_refund` 439, `resolved_subscription` 496. The active issue (the in-progress payment-method update) is kept byte-exact because it's still being worked out: every turn-by-turn nuance (the exact failure code, the exact card digits mentioned) is potentially load-bearing for the next decision, unlike the two resolved threads where only the *stabilized* facts (amounts, IDs, statuses) still matter.

6. **Summarize vs preserve.** State the rule for what gets summarized vs kept byte-exact, citing your per-section token numbers.
   → The rule: summarize a segment once its issue is *resolved* (compressed here from ~12k input tokens of raw transcript down to 439 and 496 output tokens for the refund and subscription threads respectively, per `budget.json`'s `compression_api` block: `refund: in=12334 out=426`, `subscription: in=11475 out=483`); preserve a segment byte-exact while its issue is still *active* (the 15,789-token active segment, untouched by the compressor — `test_summarize_segment_refuses_to_compress_the_active_segment` in the test suite enforces this at the code level, not just by convention). The 204-token `case_facts` block is a third category: neither a compression of the transcript nor the raw transcript itself, but a small structured extraction that survives regardless of which thread is active, specifically so a fact from a *resolved* thread can't be lost when that thread's prose gets compressed away.

7. **Facts block.** Compare `eval.jsonl` to `eval_control.jsonl`. Which question regressed, and what does that prove?
   → With the case-facts block: **6/6** passed (`evidence/system-2-retail-context/run_20260917-112911/eval.jsonl`). With it stripped (`eval_control.jsonl`): **Q6 failed** — "What is the structured status of the payment-method update issue (use the exact status token, not a paraphrase)?" — the control run answered "there is no structured status token or formal case record provided," where the full run answered `in_progress` directly from the facts block. This proves the case-facts block is genuinely load-bearing for at least one class of question (exact structured values), not decorative — the active-segment prose alone doesn't reliably surface the literal status token the way the case-facts block does. (Q1 passed in both runs — the refund amount also happens to survive in the resolved-thread text — which is expected: the requirement is that *at least one* question regresses, not all of them.)

### System 3 — Claude Code config

8. **Path-scoped rules.** Quote the glob frontmatter from one rule file. Why is it better than a directory-level CLAUDE.md for cross-cutting conventions?
   → `.claude/rules/react.md`:
   ```yaml
   ---
   description: Conventions for React components and pages
   paths:
     - "src/components/**/*"
     - "src/pages/**/*"
   ---
   ```
   A convention like "test files are co-located" or "React types are imported with `import type`" applies to files scattered across the whole monorepo, not to one subtree. A directory-level `CLAUDE.md` only loads for sessions rooted under that directory, so the same convention would have to be copy-pasted into every relevant subdirectory's own `CLAUDE.md` (and kept in sync by hand). A glob-scoped rule instead loads automatically whenever Claude touches a matching file *anywhere* in the repo — `.claude/rules/tests.md` (confirmed present, `test_ac_02_06_test_file_matches_react_and_tests` in the test suite) can even stack with `react.md` for a React test file, matching both rules' globs at once, which a single-directory `CLAUDE.md` hierarchy cannot express.

9. **Forked skill.** Quote the `context: fork` and `allowed-tools` lines. What does running forked + read-only buy you? What breaks without it?
   → `.claude/skills/deploy-check/SKILL.md`:
   ```yaml
   name: deploy-check
   context: fork
   allowed-tools:
     - Read
     - Grep
     - Glob
     - Bash(git status:*)
     - Bash(git diff:*)
     - Bash(git log:*)
     - Bash(git rev-parse:*)
     - Bash(git ls-files:*)
     - Bash(gh pr view:*)
     - Bash(gh pr checks:*)
   ```
   `context: fork` means the pre-deployment check runs in an isolated sub-session — its exploration (reading diffs, running `git log`, checking PR status) never lands in the main session's context, so a verbose or noisy check doesn't push the developer's actual work further from the model's attention. The `allowed-tools` list has no `Write`, `Edit`, or unscoped `Bash`, and every `Bash` entry is scoped to a read-only git/gh subcommand — this is a **code-enforced** guarantee, not a prompt instruction the model could talk itself out of. Without the fork, every file the check reads and every git command's output would bloat the main conversation. Without the read-only restriction, a model that misjudged "check" as license to "fix" could `git commit`, `git push --force`, or edit files during what's supposed to be a pure validation pass.

10. **Scope.** From the validator output: project-level vs user-level scope. Give one example of each from this config.
    → `CLAUDE.md` (validated `OK` by `python -m ecommerce_team_config .`, `evidence/system-3-claude-code-config/validator_output.txt`) documents the scope split directly: **project-level** — `./CLAUDE.md`, `.claude/standards/`, `.claude/rules/` — "lives in git, shared with the whole team" (concretely: this repo's own `CLAUDE.md` plus its four `@`-imported standards files). **User-level** — `~/.claude/CLAUDE.md`, `~/.claude/commands/`, `~/.claude/skills/` — "not shared via version control ... stay on your laptop." The project-level example is physically present in the validated tree (`.claude/rules/react.md`, `.claude/standards/frontend.md`, etc.); the user-level path is, by design, never checked into this repo — it's each teammate's own `~/.claude/` on their machine.

### System 4 — Orchestration

11. **Push work down.** Defects the SQL query returned vs warm-tier total. Name the indexed query. Why does the model never see the full history?
    → `python -m shift_monitor run-shift --shift C --warm-db data/warm.sqlite --since 2026-04-16T00:00:00Z --recorded-response ...` returned **7** new defects (`evidence/system-4-shift-monitor/shift_run_output.txt`, `new=7`) out of **13** total shift-C defects seeded into the warm tier (40 across all shifts). The query is `WarmStore.defects_since(since_ts, limit)` (`shift_monitor/warm.py`, line 75), backed by `CREATE INDEX idx_defects_shift_ts ON defects(shift, ts)`. The filtering happens entirely inside the SQL `WHERE` clause before any row reaches Python — `tests/test_us02_invocation_pipeline.py::test_gather_new_defects_has_no_python_side_filtering` asserts there is no post-query Python-side filter that could accidentally widen the slice back toward the full table. The model is only ever handed the 7 rows the query returned, never the other 33.

12. **Crash recovery.** The resume-vs-fresh decision and its staleness threshold (`recovery.py`). Why is a fresh start with an injected summary sometimes more reliable than resuming?
    → `shift_monitor/recovery.py`: `STALE_RESUME_THRESHOLD_MINUTES = 30`; `decide(state, now)` returns `"resume"` only if the manifest has incomplete steps *and* the last step is ≤30 minutes old, otherwise `"fresh"` (also `"fresh"` if the manifest is empty or already complete). Thirty minutes is chosen as ~1/16 of an 8-hour shift — short enough that a resume is still operating on the same shift's working assumptions, long enough to survive a brief crash without losing work. Past that window, the world has likely moved on (new defects may have arrived, the partial reasoning may reference stale data) — resuming would build the next step on top of possibly-invalid context, whereas starting fresh with the manifest's prior findings injected as a plain-text summary discards the *stale reasoning* while keeping the *facts already established*.

13. **Small state.** Byte size of your `hot_state.json`. Why does the budget matter for a system run once per shift, indefinitely?
    → **775 bytes** (`evidence/system-4-shift-monitor/hot_state.json`), well under the ~5 KB budget (also enforced in code: `test_hotstate_rejects_more_than_20_hashes`). This system is designed to run once per shift *forever* — there is no natural end to the sequence of shifts. If hot state grew a little with every shift instead of staying flat, it would eventually become the dominant cost and latency factor of every single invocation, even though any one shift only cares about recent, decision-relevant data. Keeping it bounded means shift #5 and shift #50,000 cost the same to load.

---

## Part 2 — Synthesis

### 14. **Three layers.** Point to a file/artifact for each layer and justify.
→ **Model:** `claims_intake/loop.py`, line 72, `client.messages.create(...)` — this single call is the entire "Model" layer surface: it has no memory of past shifts or past claims, only the messages array it's handed this call. **Harness:** `Configure Claude Code for a Multi-Surface Monorepo Team/.../solution/.claude/` (the `CLAUDE.md` + `rules/` + `commands/` + `skills/` tree, validated `OK` by `ecommerce_team_config`) — this shapes *every* Claude Code session touching this repo (what conventions apply to which files, what a forked skill is and isn't allowed to touch) without any of that logic living in the model itself. **Orchestration:** `shift_monitor/warm.py` + `recovery.py` + `fork.py` together — tiered state, crash recovery, and fork isolation are all about coordinating *across* independent model invocations over time (shifts, investigations), something no single API call, however well-prompted, can do on its own.

### 15. **Deterministic vs prompt.** Cite one behavior guaranteed in code (terminal tool, read-only allowlist, atomic write, byte budget) and one guided by prompt. When is each right?
→ **Deterministic:** `deploy-check`'s `allowed-tools` read-only list (Q9) — no matter what the model decides mid-check, it is *mechanically incapable* of running `git push` or editing a file, because those tool names simply aren't registered for that skill's forked session. **Prompt-guided:** `claims_intake/system_prompt.py`'s confidence threshold — "if confidence is at least 0.6 ... route; otherwise escalate" is prose the model applies to its own self-assessed confidence number; nothing in `loop.py` checks that number or enforces the 0.6 cutoff in code. Determinism is right for safety/blast-radius boundaries that must hold regardless of model behavior (Q18's whole point); prompt guidance is right for judgment calls that need contextual weighing (a hardcoded confidence cutoff enforced in Python couldn't tell "0.6 with strong corroborating facts" from "0.6 with a shaky guess" — the model's own reasoning is the more flexible instrument there, at the cost of the reliability code would give).

### 16. **Context, two faces.** Compare context management in System 2 (intra-session) and System 4 (cross-session) with cited numbers from both. Same principle, different mechanism — how?
→ Same principle — never hand the model more than the decision-relevant slice — two different mechanisms. System 2 operates **inside one long-lived conversation**: it compresses and reorders history that already exists, cutting a 38,708-token transcript to 16,910 tokens (56.31%) while keeping the 15,789-token active thread verbatim (`budget.json`). System 4 operates **across many independent, memoryless sessions**: there is no history to compress at all, because each shift starts a fresh process with zero conversation carried over. Instead of compression, it uses externalized state — a 775-byte `hot_state.json` plus an indexed SQL query (`defects_since`) that pulled only 7 of 40 defects for this run (Q11) — to reconstruct just enough context for the new session to act. System 2's problem is "this conversation got too big, prune it down"; System 4's problem is "there is no conversation to carry forward, so store the minimum externally and re-derive."

### 17. **Reliability you can't see in one run.** Name one behavior a test guarantees that a single successful run would not reveal. Why does it matter before shipping?
→ `test_hotstate_atomic_write` (System 4) guarantees the hot-state file is never left in a torn/partially-written state if the process dies mid-write. A single successful run — including the one I captured for this brief — never exercises that path at all, because nothing crashed during it; the file simply wrote normally either way. Only a test that deliberately simulates a crash mid-write can distinguish "this write happens to be atomic" from "this write looks fine every time nothing goes wrong, and corrupts state the one time it matters." That distinction is exactly what you need to know *before* a real crash at 3 a.m. on shift C corrupts the one state file the next shift depends on.

### 18. **Blast radius.** Pick one system. What's the blast radius if it misbehaves, and what's the kill switch? Ground it in that system's tools, enforcement points, and state.
→ System 3's `deploy-check` skill. If the model misjudged the task and tried to "fix" what it was only supposed to check, the blast radius is bounded to *nothing that mutates state*: its `allowed-tools` list (Q9) contains only `Read`, `Grep`, `Glob`, and git/gh subcommands that are themselves read-only (`status`, `diff`, `log`, `rev-parse`, `ls-files`, `pr view`, `pr checks`) — there is no `Write`, `Edit`, `git commit`, `git push`, or `gh pr merge` available in that session at all. The kill switch is that same allowlist: shrinking or removing an entry from `allowed-tools` (or the `context: fork` line itself) is a one-line config change, requires no code deploy, and takes effect the next time the skill loads — because the enforcement point is the harness's tool-permission config, not something buried in application logic.

---

## Part 3 — Honest assessment

### 19. **What broke.** One thing that failed first try in your environment, and how you fixed it. (If nothing, what you checked to be sure.)
→ System 1's first `--all` run crashed immediately on `Anthropic(api_key=...)` with `TypeError: Client.__init__() got an unexpected keyword argument 'proxies'` — `anthropic==0.39.0` (pinned by this system's `pyproject.toml`) still passes `proxies=` to `httpx.Client`, but `pip install -e ".[dev]"` had resolved the latest `httpx` (0.28.1), which dropped that kwarg. Fixed by pinning `httpx<0.28` inside that system's own `.venv` (landed on 0.27.2); `pytest` (still 29/29) and the actual `--all` run both succeeded afterward. Separately — not a crash, but a real first-try surprise worth recording here — the very first `--all` run (Haiku) terminated only 3 of 8 claims correctly; re-running with Sonnet improved that to 6/8, with the remaining 2 traced to a specific fixture gap (Q4-adjacent finding, detailed in the System 1 section above and in `evidence/system-1-claims-intake/`).

### 20. **What you'd change.** One architectural decision you'd make differently, grounded in what you observed.
→ I'd make `system_prompt.py`'s "call `request_clarification` when you need more information" instruction structurally enforced rather than purely prose-guided. What I actually observed: on 2 of 8 fixtures, across *both* Haiku and Sonnet, the model — missing a dollar-damage estimate the severity rubric calls for — asked its clarifying question in plain response text instead of via the `request_clarification` tool, which produces a `stop_reason: end_turn` with zero tool calls and nothing for the harness to act on (traces for `claim_01_kitchen_fire` and `claim_03_water_damage`, both attempts). A structural fix in the spirit of Q15 — e.g., the loop refusing to accept an `end_turn` as genuinely terminal unless a terminal tool (`route_to_adjuster`/`escalate_to_human`) was called earlier in the transcript, and otherwise forcing one more turn with an explicit "you must call a tool" nudge — would close this gap deterministically instead of hoping the prompt's instruction holds across every fixture and every model.
