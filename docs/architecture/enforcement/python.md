# Python Architecture Enforcement — import-linter + Ruff

> Automatically checks layer dependency direction rules (`docs/architecture/LAYERS.md`) in CI.

---

## Installation

```bash
pip install import-linter
# or with uv
uv add --dev import-linter
```

---

## .importlinter Configuration Example

Create `.importlinter` in the project root.

```ini
[importlinter]
root_package = src

[importlinter:contract:no-domain-to-infrastructure]
name = Domain layer must not import from Infrastructure
type = forbidden
source_modules =
    src.domain
forbidden_modules =
    src.infrastructure

[importlinter:contract:no-domain-to-application]
name = Domain layer must not import from Application
type = forbidden
source_modules =
    src.domain
forbidden_modules =
    src.application

[importlinter:contract:no-domain-to-presentation]
name = Domain layer must not import from Presentation
type = forbidden
source_modules =
    src.domain
forbidden_modules =
    src.presentation

[importlinter:contract:no-infrastructure-to-application]
name = Infrastructure layer must not import from Application
type = forbidden
source_modules =
    src.infrastructure
forbidden_modules =
    src.application

[importlinter:contract:no-infrastructure-to-presentation]
name = Infrastructure layer must not import from Presentation
type = forbidden
source_modules =
    src.infrastructure
forbidden_modules =
    src.presentation

[importlinter:contract:layers]
name = Layer dependency direction order
type = layers
layers =
    src.presentation
    src.application
    src.domain
    src.infrastructure
```

The `type = layers` contract only allows top-to-bottom dependencies and automatically forbids reverse direction. The `forbidden` contracts explicitly catch specific violations. Configuring both provides redundant checks to prevent any gaps.

---

## CI Execution

```bash
lint-imports
```

Returns exit code 1 on violation.

Add to `scripts/harness/validate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking architecture layer constraints (Python)..."
lint-imports

echo "==> Architecture check passed."
```

---

## Ruff Integration — Import Order Enforcement

Add Ruff configuration to `pyproject.toml`.

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle errors
    "F",   # pyflakes
    "I",   # isort (import order)
    "UP",  # pyupgrade
]

[tool.ruff.lint.isort]
# Import group order by layer
known-first-party = ["src"]
section-order = [
    "future",
    "standard-library",
    "third-party",
    "first-party",
    "local-folder",
]
force-sort-within-sections = true
```

Run Ruff:

```bash
ruff check src/
ruff format --check src/
```

---

## Example Output on Violation

```
Violation: Domain layer must not import from Infrastructure
  src/domain/issue.py imports src/infrastructure/linear_client.py

  Fix: Define an IssueTrackerPort interface in domain/,
       and implement it with LinearClient in infrastructure/.
```
