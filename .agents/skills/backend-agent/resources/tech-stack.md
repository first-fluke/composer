# Backend Agent - Tech Stack Reference

Choose the stack that matches the project's `AGENTS.md` or existing codebase.
All three stacks are equally supported.

---

## Python

- **Framework**: FastAPI 0.110+
- **ORM**: SQLAlchemy 2.0 (async)
- **Validation**: Pydantic v2
- **Database**: PostgreSQL 16+, Redis 7+
- **Auth**: python-jose (JWT), passlib (bcrypt)
- **Testing**: pytest, httpx (async test client)
- **Migrations**: Alembic

## TypeScript (Node.js)

- **Framework**: Express.js, NestJS, or Hono
- **ORM**: Prisma or Drizzle
- **Validation**: Zod
- **Auth**: jsonwebtoken, bcrypt
- **Testing**: Jest + Supertest, or Vitest
- **Migrations**: Prisma Migrate or Drizzle Kit

## Go

- **Framework**: net/http (stdlib) or Echo
- **ORM / Query**: sqlx or GORM
- **Validation**: go-playground/validator
- **Auth**: golang-jwt/jwt, bcrypt (golang.org/x/crypto)
- **Testing**: testing (stdlib) + testify
- **Migrations**: golang-migrate or goose

---

## Architecture (all stacks)

```
backend/
  domain/           # Business logic (no framework deps)
  application/      # Use cases, services
  infrastructure/   # Database, cache, external APIs
  presentation/     # API endpoints, middleware
```

## Security Requirements (all stacks)

- Password hashing: bcrypt (cost factor 10-12)
- JWT: 15 min access tokens, 7 day refresh tokens
- Rate limiting on auth endpoints
- Input validation with schema library (Pydantic / Zod / go-playground/validator)
- Parameterized queries (never string interpolation)

## ORM Guidance

- Cross-ORM operational rules and official vendor references: `resources/orm-reference.md`
- Primary references covered there: Prisma, SQLAlchemy, TypeORM, Sequelize, Hibernate

## Serena MCP Shortcuts

- `find_symbol("create_todo")`: Locate existing function
- `get_symbols_overview("app/api")`: List all endpoints
- `find_referencing_symbols("User")`: Find all usages of a model
