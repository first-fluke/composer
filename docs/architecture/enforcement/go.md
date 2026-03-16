# Go 아키텍처 강제 — go vet + golangci-lint

> 계층 의존성 방향 규칙(`docs/architecture/LAYERS.md`)을 CI와 로컬 개발 환경에서 자동 검사한다.

---

## 도구

| 도구 | 역할 |
|---|---|
| `go vet` | 표준 정적 분석. 컴파일러가 잡지 못하는 버그 패턴 검사. |
| `golangci-lint` | 계층 import 제한, 복잡도, 코드 스타일 통합 린터. |
| `deadcode` | 도달 불가능한 코드 검출. |

---

## 패키지 구조 규칙

Go의 패키지 구조는 계층을 명확하게 반영한다.

```
src/
├── domain/          ← Domain 계층: 순수 Go 구조체 + 인터페이스. 외부 의존 없음.
├── application/     ← Application 계층: 유스케이스 조율.
├── infrastructure/  ← Infrastructure 계층: 외부 시스템 구현체.
└── presentation/    ← Presentation 계층: HTTP 핸들러, CLI.
```

표준 Go 레이아웃과 혼용 시:

```
cmd/
└── server/
    └── main.go
internal/
├── domain/
├── application/
├── infrastructure/
└── presentation/
```

`internal/`을 사용하면 패키지 외부에서 import를 차단하는 Go 컴파일러 기능을 활용할 수 있다.

---

## golangci-lint 설정

프로젝트 루트에 `.golangci.yml`을 생성한다.

```yaml
linters:
  enable:
    - govet
    - errcheck
    - staticcheck
    - revive
    - gocritic
    - depguard
    - cyclop

linters-settings:
  depguard:
    rules:
      domain-no-infrastructure:
        list-mode: lax
        files:
          - "**/domain/**/*.go"
        deny:
          - pkg: "*/infrastructure"
            desc: >
              Domain 계층은 Infrastructure를 import할 수 없다.
              LAYERS.md 참조.
              Fix: domain/ 에 인터페이스를 정의하고 infrastructure/ 에서 구현하라.
          - pkg: "*/application"
            desc: >
              Domain 계층은 Application을 import할 수 없다.
              LAYERS.md 참조.
          - pkg: "*/presentation"
            desc: >
              Domain 계층은 Presentation을 import할 수 없다.
              LAYERS.md 참조.
      infrastructure-no-application:
        list-mode: lax
        files:
          - "**/infrastructure/**/*.go"
        deny:
          - pkg: "*/application"
            desc: >
              Infrastructure 계층은 Application을 import할 수 없다.
              LAYERS.md 참조.
          - pkg: "*/presentation"
            desc: >
              Infrastructure 계층은 Presentation을 import할 수 없다.
              LAYERS.md 참조.

  cyclop:
    max-complexity: 10

  revive:
    rules:
      - name: exported
      - name: error-return
      - name: error-strings

issues:
  max-same-issues: 0
  exclude-use-default: false
```

---

## deadcode 설치 및 사용

```bash
go install golang.org/x/tools/cmd/deadcode@latest
deadcode -test ./...
```

도달 불가능한 함수 및 메서드를 보고한다. 계층 분리 후 사용되지 않는 인터페이스 메서드를 찾는 데 유용하다.

---

## Makefile target

프로젝트 루트의 `Makefile`에 추가한다.

```makefile
.PHONY: lint vet deadcode validate

vet:
	go vet ./...

lint:
	golangci-lint run ./...

deadcode:
	deadcode -test ./...

validate: vet lint
	@echo "Architecture check passed."
```

로컬 실행:

```bash
make validate
```

CI에서 `scripts/harness/validate.sh`에 추가:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking architecture layer constraints (Go)..."
make validate

echo "==> Architecture check passed."
```

---

## golangci-lint 설치

```bash
# macOS
brew install golangci-lint

# 또는 공식 설치 스크립트
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
  | sh -s -- -b $(go env GOPATH)/bin v1.57.2
```

버전은 `golangci-lint --version`으로 확인한다. CI와 로컬이 동일한 버전을 사용해야 한다.
