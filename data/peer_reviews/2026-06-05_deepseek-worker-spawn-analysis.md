# deepseek (Ollama) analysis — worker spawns but never executes in a fresh workspace repo

Based on the detailed symptoms and the comparison between established vs. fresh repos, here are my top 5 ranked hypotheses with diagnostics and fixes:

### 1. **MCP Server Startup Failure/Hang in Fresh Repo**
**Hypothesis**: The per-worktree `.mcp.json` references MCP servers that fail to start or hang in a fresh repo context (missing dependencies/configs), blocking the agent's initialization.

**Diagnostic**:
- Check if the agent binary has internal MCP client logs (might need `DEBUG=mcp*` env var)
- Add pre-spawn validation: run `mcp list-servers --config .mcp.json` in the worktree
- Monitor process tree: `ps auxf` after spawn to see if MCP server children exist but hang

**Fix**:
- Ensure `.mcp.json` has fallbacks for missing project files
- Add startup timeout for MCP connections in agent code
- Implement MCP server health checks before agent execution

### 2. **Missing Project Canon Files Causing Agent Configuration Failure**
**Hypothesis**: The agent expects `CLAUDE.md`/`AGENTS.md` or other canon files that exist in established repos but are missing in fresh repos, causing configuration errors during agent init.

**Diagnostic**:
- Add agent debug logging: `AGENT_DEBUG=1` or similar env var
- Check if agent has fallback behavior for missing canon files
- Test with minimal canon files added to fresh repo

**Fix**:
- Implement default canon file fallbacks in the agent binary
- Add pre-flight check in listener to ensure required files exist
- Generate minimal canon files during worktree provisioning

### 3. **Git Worktree State Issues with Parking Branch**
**Hypothesis**: The parking branch creation or worktree state in a near-empty repo causes git operations or agent environment detection to fail silently.

**Diagnostic**:
- Verify git status in worktree: `git status --porcelain`
- Check git config: `git config --list` in worktree vs established
- Test with `--no-optional-locks` in git commands

**Fix**:
- Ensure worktree is fully functional: `git reset --hard HEAD`
- Add explicit git environment setup in worktree provisioning
- Consider alternative branching strategies for fresh repos

### 4. **Environment/Auth Differences in Fresh Repo Context**
**Hypothesis**: Environment variables, authentication, or network access that work in established repos fail in fresh repos due to different working directory or missing configs.

**Diagnostic**:
- Compare `env` output between established and fresh worktrees
- Check file permissions and ownership in fresh repo
- Test network connectivity from fresh worktree context

**Fix**:
- Standardize environment setup across all worktrees
- Ensure consistent file permissions and ownership
- Add environment validation step before spawn

### 5. **Fast Early Exit Not Captured by Spawn Monitoring**
**Hypothesis**: The agent exits very quickly due to initialization failure, but the listener's process monitoring misses this rapid exit, leaving `exit_code=null`.

**Diagnostic**:
- Add spawn wrapper with better exit code capture
- Implement synchronous spawn with immediate exit code check
- Add subprocess error event logging

**Fix**:
```javascript
// In listener spawn code
const child = spawn(...);
let exited = false;

child.on('error', (err) => {
  console.error('Spawn error:', err);
  exited = true;
});

child.on('exit', (code) => {
  exited = true;
  console.log('Exit code:', code);
});

// Add timeout to detect hangs
setTimeout(() => {
  if (!exited) {
    console.log('Process still running');
  }
}, 1000);
```

**Implementation Priority**: Start with hypothesis #1 (MCP issues) as most likely, then #2 (missing canon files), as these align closest with the observed symptoms and the presence of the stray `.mcp.json` file in the failed worktree.