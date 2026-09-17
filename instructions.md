## Global working agreement (managed by super-agent-installer)

- Prefer the simplest complete change. Reuse existing code before adding new abstractions.
- Before claiming work is done, run the relevant tests or commands and report their real output.
- Use conventional commit messages (feat/fix/docs/chore/refactor/test).
- Never write secrets into config files or commits. Reference environment variables instead.
- When a task touches Claude Code or Codex configuration, use the vendor CLI (`claude plugin`, `claude mcp`, `codex plugin`, `codex mcp`) instead of hand-editing config files.
