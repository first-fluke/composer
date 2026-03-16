# Backend Snippets — TypeScript (Express + Prisma + Zod)

Copy-paste ready patterns. Each snippet shows its correct architectural layer.

---

## Route with Auth

Router는 HTTP만 담당한다. 비즈니스 로직과 DB 접근은 Service/Repository에 위임한다.

```typescript
// src/resources/resource.router.ts
import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth";
import { container } from "../core/container"; // DI 컨테이너 (tsyringe / 직접 구성)
import { ResourceCreateSchema, ResourceUpdateSchema } from "./resource.schema";

export const resourceRouter = Router();

resourceRouter.post(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Router 역할: 파싱 → Service 위임 → 응답. 비즈니스 로직 없음.
      const data = ResourceCreateSchema.parse(req.body);
      const svc = container.resolve("ResourceService");
      const resource = await svc.create(req.user!.id, data);
      res.status(201).json(resource);
    } catch (err) {
      next(err);
    }
  }
);

resourceRouter.get(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const svc = container.resolve("ResourceService");
      // ownership 체크는 비즈니스 로직 → Service 책임
      const resource = await svc.getOwnedOrThrow(req.params.id, req.user!.id);
      res.json(resource);
    } catch (err) {
      next(err);
    }
  }
);
```

---

## Request/Response Schema (Zod)

```typescript
// src/resources/resource.schema.ts
import { z } from "zod";

export const ResourceCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

export const ResourceUpdateSchema = ResourceCreateSchema.partial();

export type ResourceCreate = z.infer<typeof ResourceCreateSchema>;
export type ResourceUpdate = z.infer<typeof ResourceUpdateSchema>;

export interface ResourceResponse {
  id: string;
  title: string;
  description: string | null;
  userId: string;
  createdAt: Date;
}
```

---

## DB Model (Prisma schema)

```prisma
// prisma/schema.prisma
model Resource {
  id          String    @id @default(uuid())
  title       String    @db.VarChar(200)
  description String?
  userId      String
  createdAt   DateTime  @default(now())
  deletedAt   DateTime?

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
}
```

---

## Repository (Data Access Layer)

Repository는 Prisma 세부사항을 캡슐화한다. Service는 Repository interface만 안다.

```typescript
// src/resources/resource.repository.ts
import { PrismaClient } from "@prisma/client";
import { ResourceCreate, ResourceUpdate } from "./resource.schema";

export interface IResourceRepository {
  findById(id: string): Promise<{ id: string; title: string; description: string | null; userId: string; createdAt: Date } | null>;
  findByOwner(userId: string, page: number, size: number, search?: string): Promise<{ items: any[]; total: number }>;
  create(userId: string, data: ResourceCreate): Promise<any>;
  update(id: string, data: ResourceUpdate): Promise<any>;
  delete(id: string): Promise<void>;
}

export class PrismaResourceRepository implements IResourceRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    return this.db.resource.findUnique({ where: { id, deletedAt: null } });
  }

  async findByOwner(userId: string, page: number, size: number, search?: string) {
    const where = {
      userId,
      deletedAt: null,
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.resource.findMany({ where, skip: (page - 1) * size, take: size }),
      this.db.resource.count({ where }),
    ]);
    return { items, total };
  }

  async create(userId: string, data: ResourceCreate) {
    return this.db.resource.create({ data: { ...data, userId } });
  }

  async update(id: string, data: ResourceUpdate) {
    return this.db.resource.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.db.resource.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
```

---

## Service (Business Logic Layer)

Service는 Repository interface에만 의존한다. HTTP(Express) 개념 없음.

```typescript
// src/resources/resource.service.ts
import { IResourceRepository } from "./resource.repository";
import { ResourceCreate, ResourceUpdate } from "./resource.schema";
import { NotFoundError, ForbiddenError } from "../core/errors";

export class ResourceService {
  constructor(private readonly repo: IResourceRepository) {}

  async getOwnedOrThrow(id: string, ownerId: string) {
    const resource = await this.repo.findById(id);
    if (!resource) throw new NotFoundError("Resource not found");
    if (resource.userId !== ownerId) throw new ForbiddenError("Access denied");
    return resource;
  }

  async list(userId: string, page: number, size: number, search?: string) {
    return this.repo.findByOwner(userId, page, size, search);
  }

  async create(userId: string, data: ResourceCreate) {
    return this.repo.create(userId, data);
  }

  async update(id: string, ownerId: string, data: ResourceUpdate) {
    await this.getOwnedOrThrow(id, ownerId); // ownership 검증
    return this.repo.update(id, data);
  }

  async delete(id: string, ownerId: string) {
    await this.getOwnedOrThrow(id, ownerId);
    await this.repo.delete(id);
  }
}
```

---

## JWT Auth Middleware

Middleware는 인증만 담당한다. 유저 조회는 AuthService/Repository를 통한다.

```typescript
// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    // JWT 검증만. DB 조회는 필요시 별도 미들웨어 or endpoint에서 처리.
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; email: string };
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
```

---

## Password Hashing

```typescript
// src/core/security.ts
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}
```

---

## Paginated Query (Repository에서 사용)

```typescript
// src/core/pagination.ts
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export function buildPage<T>(items: T[], total: number, page: number, size: number): Page<T> {
  return { items, total, page, size };
}
```

---

## Migration (Prisma Migrate)

```bash
# 개발: 마이그레이션 생성 + 적용
npx prisma migrate dev --name add_resources_table

# 프로덕션: 마이그레이션만 적용
npx prisma migrate deploy
```

---

## Test

Service는 Repository mock으로 단위 테스트. Router는 통합 테스트.

```typescript
// tests/unit/resource.service.test.ts
import { ResourceService } from "../../src/resources/resource.service";
import { NotFoundError, ForbiddenError } from "../../src/core/errors";

const mockRepo = {
  findById: jest.fn(),
  findByOwner: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const svc = new ResourceService(mockRepo);

describe("ResourceService.getOwnedOrThrow", () => {
  it("throws NotFound when resource does not exist", async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(svc.getOwnedOrThrow("id", "user1")).rejects.toThrow(NotFoundError);
  });

  it("throws Forbidden when user is not owner", async () => {
    mockRepo.findById.mockResolvedValue({ id: "id", userId: "owner", title: "T", description: null, createdAt: new Date() });
    await expect(svc.getOwnedOrThrow("id", "other-user")).rejects.toThrow(ForbiddenError);
  });
});

// tests/integration/resource.router.test.ts
import request from "supertest";
import { app } from "../../src/app";

describe("POST /api/resources", () => {
  it("creates a resource", async () => {
    const res = await request(app)
      .post("/api/resources")
      .set("Authorization", `Bearer ${testToken}`)
      .send({ title: "Test", description: "Test desc" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Test");
    expect(res.body.id).toBeDefined();
  });
});
```
