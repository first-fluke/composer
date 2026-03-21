# AGENTS.md — apps/web

> Next.js 16 web application with App Router, TailwindCSS v4, and shadcn/ui.

---

## 1. Quick Start

```bash
# Install dependencies
bun install

# Run dev server (Turbopack)
bun run dev

# Type-check
bun run typecheck

# Lint
bun run lint

# Lint + fix
bun run lint:fix

# Format
bun run format

# Build for production
bun run build
```

---

## 2. Tech Stack

| Category | Library | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16 |
| Language | TypeScript | 5 |
| Styling | TailwindCSS | 4 |
| Component Library | shadcn/ui (base-nova) | 4 |
| State (server) | TanStack Query | 5 |
| State (URL) | nuqs | 2 |
| State (client) | Jotai | 2 |
| Forms | TanStack Form | 1 |
| Linter/Formatter | Biome | 2 |
| Runtime | Bun | latest |

---

## 3. Project Structure

```
apps/web/
├── src/
│   ├── app/           ← App Router pages and layouts
│   │   ├── layout.tsx ← Root layout with Providers
│   │   ├── page.tsx   ← Home page
│   │   ├── providers.tsx ← Client providers (QueryClient, NuqsAdapter)
│   │   └── globals.css   ← TailwindCSS + shadcn/ui theme
│   ├── components/
│   │   └── ui/        ← shadcn/ui components (do not edit directly)
│   ├── lib/
│   │   └── utils.ts   ← Utility functions (cn helper)
│   └── hooks/         ← Custom React hooks
├── public/            ← Static assets
├── biome.json         ← Biome config
├── components.json    ← shadcn/ui config
├── next.config.ts     ← Next.js config
├── postcss.config.mjs ← PostCSS config for TailwindCSS v4
└── tsconfig.json      ← TypeScript config
```

---

## 4. State Management Strategy

| State Type | Tool | When to Use |
|---|---|---|
| Server state | TanStack Query | API data fetching, caching, mutations |
| URL state | nuqs | Search params, filters, pagination |
| Client state | Jotai | UI state shared across components (atoms) |
| Form state | TanStack Form | Form validation and submission |

**Principle:** Prefer URL state (nuqs) and server state (TanStack Query) over client state. Use Jotai only for ephemeral UI state that doesn't belong in the URL.

---

## 5. Conventions

- **Components:** Use shadcn/ui primitives. Add new components via `bunx shadcn@latest add <component>`.
- **Styling:** TailwindCSS utility classes. Use `cn()` helper for conditional classes.
- **Imports:** Use `@/*` path alias for all imports within the app.
- **Linting:** Biome handles both linting and formatting. Run `bun run lint` before committing.
- **React Compiler:** Enabled — avoid manual `useMemo`/`useCallback` unless profiling shows a need.
- **Server Components:** Default to Server Components. Add `"use client"` only when hooks or browser APIs are needed.

---

## 6. Adding shadcn/ui Components

```bash
bunx shadcn@latest add <component-name>
```

Components are installed to `src/components/ui/`. Do not manually edit generated component files — customize via the theme in `globals.css` or wrapper components.
