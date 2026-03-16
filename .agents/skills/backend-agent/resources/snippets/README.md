# Backend Agent - Code Snippets

Stack-specific copy-paste patterns. Use the file that matches your project's stack.

| File | Stack |
|---|---|
| `python.md` | FastAPI + SQLAlchemy + Pydantic |
| `typescript.md` | Express/NestJS + Prisma/Drizzle + Zod |
| `go.md` | Echo/net/http + sqlx/GORM |

Each file covers the same patterns:
1. Route with Auth
2. Request/Response Schema
3. DB Model
4. JWT Auth Dependency
5. Password Hashing
6. Paginated Query
7. Migration
8. Test

To add a new stack, create `<stack>.md` with the same structure.
