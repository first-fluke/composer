## Summary

**What:**
**Why:**
**Issue:**

---

## Architecture Checklist

> Reference: `docs/architecture/CONSTRAINTS.md`, `docs/architecture/LAYERS.md`

- [ ] No layer violations — domain does not import from infrastructure, presentation, or external SDKs
- [ ] No business logic in routers, handlers, or CLI layer
- [ ] No hardcoded secrets, tokens, or environment-specific values in code
- [ ] No file exceeds 500 lines
- [ ] External inputs validated at system boundary only

---

## Test Coverage

- [ ] Unit tests cover changed logic
- [ ] Edge cases tested (empty input, API errors, missing config)
- [ ] No tests deleted without replacement

---

## Security Checklist

> Reference: `docs/harness/SAFETY.md`

- [ ] No secrets committed — `.env` is in `.gitignore`
- [ ] `./scripts/harness/validate.sh` passes locally
- [ ] External inputs not directly inserted into prompts or shell commands
- [ ] No new outbound network calls outside approved adapters

---

## Reviewer Focus Areas

<!-- Optional: tell the reviewer where to spend their time. -->
