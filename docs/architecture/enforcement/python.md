# Python 아키텍처 강제 — import-linter + Ruff

> 계층 의존성 방향 규칙(`docs/architecture/LAYERS.md`)을 CI에서 자동 검사한다.

---

## 설치

```bash
pip install import-linter
# 또는 uv 사용 시
uv add --dev import-linter
```

---

## .importlinter 설정 예시

프로젝트 루트에 `.importlinter`를 생성한다.

```ini
[importlinter]
root_package = src

[importlinter:contract:no-domain-to-infrastructure]
name = Domain 계층은 Infrastructure를 import하지 않는다
type = forbidden
source_modules =
    src.domain
forbidden_modules =
    src.infrastructure

[importlinter:contract:no-domain-to-application]
name = Domain 계층은 Application을 import하지 않는다
type = forbidden
source_modules =
    src.domain
forbidden_modules =
    src.application

[importlinter:contract:no-domain-to-presentation]
name = Domain 계층은 Presentation을 import하지 않는다
type = forbidden
source_modules =
    src.domain
forbidden_modules =
    src.presentation

[importlinter:contract:no-infrastructure-to-application]
name = Infrastructure 계층은 Application을 import하지 않는다
type = forbidden
source_modules =
    src.infrastructure
forbidden_modules =
    src.application

[importlinter:contract:no-infrastructure-to-presentation]
name = Infrastructure 계층은 Presentation을 import하지 않는다
type = forbidden
source_modules =
    src.infrastructure
forbidden_modules =
    src.presentation

[importlinter:contract:layers]
name = 계층 의존성 방향 순서
type = layers
layers =
    src.presentation
    src.application
    src.domain
    src.infrastructure
```

`type = layers` 계약은 위에서 아래 방향 의존만 허용하며 역방향을 자동으로 금지한다. `forbidden` 계약은 특정 위반을 명시적으로 잡는다. 둘 다 설정하면 중복 검사로 누락을 방지한다.

---

## CI 실행

```bash
lint-imports
```

위반 시 exit code 1을 반환한다.

`scripts/harness/validate.sh`에 추가:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking architecture layer constraints (Python)..."
lint-imports

echo "==> Architecture check passed."
```

---

## Ruff 연동 — import 순서 강제

`pyproject.toml`에 Ruff 설정을 추가한다.

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle errors
    "F",   # pyflakes
    "I",   # isort (import 순서)
    "UP",  # pyupgrade
]

[tool.ruff.lint.isort]
# 계층별 import 그룹 순서
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

Ruff 실행:

```bash
ruff check src/
ruff format --check src/
```

---

## 위반 시 출력 예시

```
违반: Domain 계층은 Infrastructure를 import하지 않는다
  src/domain/issue.py imports src/infrastructure/linear_client.py

  Fix: domain/에서 IssueTrackerPort 인터페이스를 정의하고,
       LinearClient는 infrastructure/에서 해당 인터페이스를 구현한다.
```
