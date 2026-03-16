# Backend Agent - Error Recovery Playbook

When you encounter a failure, find the matching scenario and follow the recovery steps.
Do NOT stop or ask for help until you have exhausted the playbook.

---

## Import / Module Not Found

**Symptoms**: `ModuleNotFoundError`, `ImportError`, `No module named X`, `cannot find module`, `package not found`

1. Check the import path — typo? wrong package name?
2. Verify the dependency exists in the project's package config (`pyproject.toml` / `package.json` / `go.mod`)
3. If missing: note it in your result as "requires package installation (e.g. `pip install X` / `npm install X` / `go get X`)" — do NOT install yourself
4. If it's a local module: check the directory structure with `get_symbols_overview`
5. If the path changed: use `search_for_pattern("class ClassName")` to find the new location

---

## Test Failure

**Symptoms**: Test runner (pytest / Jest / `go test`) reports FAILED, assertion errors

1. Read the full error output — which test, which assertion, expected vs actual
2. `find_symbol("test_function_name")` to read the test code
3. Determine: is the test wrong or is the implementation wrong?
   - Test expects old behavior → update test
   - Implementation has a bug → fix implementation
4. Re-run the specific test (e.g. `pytest path/to/test.py::test_name -v` / `jest --testNamePattern "..."` / `go test -run TestName ./...`)
5. After fix, run full test suite to check for regressions
6. **After 3 failures**: Try a different approach. Record current attempt in progress and implement alternative

---

## Database Migration Error

**Symptoms**: Migration command fails, `IntegrityError`, duplicate column, schema mismatch

1. Read the error — is it a conflict with an existing migration?
2. Check current DB state:
   - Alembic: `alembic current`
   - Prisma: `npx prisma migrate status`
   - golang-migrate: `migrate -path ./migrations -database $DATABASE_URL version`
3. If migration conflicts: roll back one step (e.g. `alembic downgrade -1` / `migrate down 1`) then fix the migration script
4. If schema mismatch: compare model definition with actual DB schema
5. **NEVER stamp/force the head without understanding the state** — risk of data loss

---

## Authentication / JWT Error

**Symptoms**: 401/403 responses, `InvalidTokenError`, `ExpiredSignatureError`

1. Check: is the secret key consistent between encode and decode?
2. Check: is the algorithm specified (`HS256` vs `RS256`)?
3. Check: is the token being sent in the correct header format? (`Bearer {token}`)
4. Check: is token expiry set correctly? (access: 15min, refresh: 7day)
5. Test with a manually created token to isolate the issue

---

## N+1 Query / Slow Response

**Symptoms**: API response > 500ms, many similar SQL queries in logs

1. Enable ORM query logging:
   - SQLAlchemy: `echo=True` on engine
   - Prisma: `log: ["query"]` in PrismaClient options
   - GORM: `db.Debug()`
2. Count queries for a single request
3. If N+1: use the ORM's eager loading (`joinedload` / `include` / `Preload`)
4. If slow single query: check indexes with `EXPLAIN ANALYZE`
5. If still slow: consider caching with Redis

---

## Rate Limit / Quota Error (Gemini API)

**Symptoms**: `429`, `RESOURCE_EXHAUSTED`, `rate limit exceeded`

1. **Stop immediately** — do not make additional API calls
2. Save current work to `progress-{agent-id}.md`
3. Record Status: `quota_exceeded` in `result-{agent-id}.md`
4. Specify remaining tasks so orchestrator can retry later

---

## Serena Memory Unavailable

**Symptoms**: `write_memory` / `read_memory` failure, timeout

1. Retry once (may be transient error)
2. If 2 consecutive failures: fall back to local files
   - progress → write to `/tmp/progress-{agent-id}.md`
   - result → write to `/tmp/result-{agent-id}.md`
3. Add `memory_fallback: true` flag to result

---

## General Principles

- **After 3 failures**: If same approach fails 3 times, must try a different method
- **Blocked**: If no progress after 5 turns, save current state and record `Status: blocked` in result
- **Out of scope**: If you find issues in another agent's domain, only record in result — do not modify directly
