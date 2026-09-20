# Autonomous Agent Directives for Omashow

<!-- antislop:start -->
## antislop
- Antislop applies automatically and silently inline during code authoring.
- **NEVER prompt or ask the user** when antislop applies (neither before starting nor after completion).
- Proceed directly with implementation without stopping for antislop confirmation.
<!-- antislop:end -->

## Loop & Zero-Prompting Autonomy Mode
- **Unattended autonomous execution**: Do NOT stop to ask the user for confirmation, interactive decisions, clarification, or permission during coding sessions.
- **Circuit breaker override**: Do NOT stop or ask for user guidance on build or test failures. Instead, automatically inspect compiler error messages, check `git diff`, refine the implementation, and retry.
- **Strict verification oracle**: Before considering any task complete, you must run and pass:
  1. `cargo test -p omashow-core`
  2. `cargo check --workspace`
  3. Relevant example verification (e.g. `cargo run -p omashow-core --example verify_real`) when modifying PPTX roundtrip logic.
- **Backlog progression**: Always check `TODO.md`. Pick the first unchecked item `[ ]`, implement it completely, verify with the test suite, update `TODO.md` to mark it `[x]`, and make a clean git commit.
- **Continuous loop**: Once a task is committed, immediately continue to the next unchecked task until the active milestone is complete.
