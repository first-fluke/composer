# TypeScript 아키텍처 강제 — dependency-cruiser

> 계층 의존성 방향 규칙(`docs/architecture/LAYERS.md`)을 CI와 pre-commit에서 자동 검사한다.

---

## 설치

```bash
npm install --save-dev dependency-cruiser
```

---

## .dependency-cruiser.cjs 설정 예시

프로젝트 루트에 `.dependency-cruiser.cjs`를 생성한다.

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-domain-to-infrastructure",
      comment:
        "Domain 계층은 Infrastructure를 import할 수 없다. LAYERS.md 참조.",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/infrastructure" },
    },
    {
      name: "no-domain-to-application",
      comment:
        "Domain 계층은 Application을 import할 수 없다. LAYERS.md 참조.",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/application" },
    },
    {
      name: "no-domain-to-presentation",
      comment:
        "Domain 계층은 Presentation을 import할 수 없다. LAYERS.md 참조.",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/presentation" },
    },
    {
      name: "no-infrastructure-to-application",
      comment:
        "Infrastructure 계층은 Application을 import할 수 없다. LAYERS.md 참조.",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/application" },
    },
    {
      name: "no-infrastructure-to-presentation",
      comment:
        "Infrastructure 계층은 Presentation을 import할 수 없다. LAYERS.md 참조.",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/presentation" },
    },
    {
      name: "no-application-to-presentation",
      comment:
        "Application 계층은 Presentation을 import할 수 없다. LAYERS.md 참조.",
      severity: "error",
      from: { path: "^src/application" },
      to: { path: "^src/presentation" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
```

---

## CI 실행 명령

```bash
npx depcruise --config .dependency-cruiser.cjs src
```

위반 시 exit code 1을 반환하므로 CI가 자동으로 실패한다.

`scripts/harness/validate.sh`에 추가 예시:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking architecture layer constraints..."
npx depcruise --config .dependency-cruiser.cjs src

echo "==> Architecture check passed."
```

---

## pre-commit hook 연동

`.pre-commit-config.yaml`에 추가:

```yaml
repos:
  - repo: local
    hooks:
      - id: dependency-cruiser
        name: Dependency Cruiser (architecture layers)
        language: node
        entry: npx depcruise --config .dependency-cruiser.cjs src
        pass_filenames: false
        types: [typescript]
```

또는 `package.json`의 `lint-staged`와 연동:

```json
{
  "lint-staged": {
    "src/**/*.ts": [
      "npx depcruise --config .dependency-cruiser.cjs"
    ]
  }
}
```

---

## 규칙 위반 시 출력 예시

```
error no-domain-to-infrastructure: src/domain/issue.ts -> src/infrastructure/linearApiClient.ts

  Domain 계층은 Infrastructure를 import할 수 없다. LAYERS.md 참조.
  Fix: Domain에서 인터페이스만 정의하고, LinearApiClient는 infrastructure/에 위치시킨다.
```
