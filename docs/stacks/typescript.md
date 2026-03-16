# TypeScript 착수 가이드

> 이 파일은 TypeScript 스택으로 Symphony 구현을 시작할 때 참조한다.
> 계층 원칙은 `docs/architecture/LAYERS.md`, 금지 규칙은 `docs/architecture/CONSTRAINTS.md` 참조.

---

## 권장 스택

| 역할 | 선택 |
|---|---|
| 런타임 | Node.js 20+ |
| 언어 | TypeScript 5+ |
| HTTP 서버 | Express 또는 Hono |
| ORM | Prisma |
| 스키마 검증 | Zod |
| 테스트 | Jest + ts-jest |
| 아키텍처 린터 | dependency-cruiser |
| 코드 린터 | ESLint + Prettier |

---

## 프로젝트 초기화

```bash
# 1. 프로젝트 디렉터리 생성
mkdir my-symphony && cd my-symphony

# 2. npm 초기화
npm init -y

# 3. TypeScript 설치
npm install --save-dev typescript ts-node @types/node

# 4. TypeScript 설정 생성
npx tsc --init

# 5. 핵심 의존성 설치
npm install express zod dotenv
npm install --save-dev @types/express

# 6. 테스트 도구
npm install --save-dev jest ts-jest @types/jest

# 7. 린터
npm install --save-dev eslint prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-config-prettier

# 8. 아키텍처 린터
npm install --save-dev dependency-cruiser
```

---

## 디렉터리 구조

`docs/architecture/LAYERS.md`에 정의된 계층을 그대로 반영한다.

```
src/
├── domain/
│   ├── issue.ts              ← Issue 도메인 모델
│   ├── workspace.ts          ← Workspace 도메인 모델
│   ├── runAttempt.ts         ← RunAttempt 도메인 모델
│   └── ports/
│       ├── issueTrackerPort.ts  ← 외부 시스템 인터페이스 (Infrastructure가 구현)
│       └── workspacePort.ts
├── application/
│   ├── orchestrator/
│   │   ├── poller.ts
│   │   ├── stateMachine.ts
│   │   ├── retryQueue.ts
│   │   └── index.ts
│   └── workspaceManager.ts
├── infrastructure/
│   ├── linearApiClient.ts    ← issueTrackerPort 구현
│   ├── fileSystem.ts
│   ├── git.ts
│   └── logger.ts
├── presentation/
│   ├── router.ts
│   └── cli.ts
└── index.ts                  ← 진입점: DI 조립 + 서버 시작
```

---

## tsconfig.json 핵심 설정

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@domain/*": ["src/domain/*"],
      "@application/*": ["src/application/*"],
      "@infrastructure/*": ["src/infrastructure/*"],
      "@presentation/*": ["src/presentation/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`strict: true`는 필수다. 에이전트가 생성하는 코드의 타입 안전성을 강제한다.

---

## 환경변수 로딩 — dotenv + Zod 타입 검증

```typescript
// src/infrastructure/config.ts
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  LINEAR_API_KEY: z.string().min(1, {
    message:
      "LINEAR_API_KEY is not set. Add it to .env (see .env.example).\n" +
      "  Format: LINEAR_API_KEY=lin_api_xxxxxxxx",
  }),
  LINEAR_TEAM_ID: z.string().min(1, {
    message:
      "LINEAR_TEAM_ID is not set. Add it to .env.\n" +
      "  Find it in Linear: Settings → Members → Team",
  }),
  WORKSPACE_ROOT: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("/"), {
      message:
        "WORKSPACE_ROOT must be an absolute path.\n" +
        "  Fix: Set WORKSPACE_ROOT=/absolute/path in .env",
    }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuration error:\n");
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join(".")}: ${issue.message}\n`);
  });
  process.exit(1);
}

export const config = parsed.data;
```

---

## 린터 설정

### ESLint — eslint.config.mjs

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "no-console": ["warn", { allow: ["error"] }],
    },
  }
);
```

### Prettier — .prettierrc

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### package.json scripts

```json
{
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "test": "jest",
    "validate": "npm run lint && npx depcruise --config .dependency-cruiser.cjs src"
  }
}
```

---

## 아키텍처 린터 연동

`docs/architecture/enforcement/typescript.md` 참조하여 `.dependency-cruiser.cjs`를 설정한다.
