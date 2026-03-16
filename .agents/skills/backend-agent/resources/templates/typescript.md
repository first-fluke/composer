# API Endpoint Template — TypeScript (Express + Prisma + Zod)

전체 CRUD 구현 예시. Router → Service → Repository → Model 4레이어 구조.

---

## 레이어 구조

```
src/resources/
├── resource.model.ts       ← 도메인 타입 (DB 모델)
├── resource.schema.ts      ← Zod 입/출력 스키마
├── resource.repository.ts  ← DB CRUD (Prisma만 안다)
├── resource.service.ts     ← 비즈니스 로직 (Repository interface만 안다)
└── resource.router.ts      ← HTTP 처리 (Service만 안다)
```

---

## resource.model.ts

```typescript
// 도메인 모델 — DB 구조 반영. HTTP/API 스키마와 분리.
export interface ResourceModel {
  id: string;
  title: string;
  description: string | null;
  userId: string;
  createdAt: Date;
  deletedAt: Date | null;
}
```

---

## resource.schema.ts

```typescript
import { z } from "zod";

export const ResourceCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

export const ResourceUpdateSchema = ResourceCreateSchema.partial();

export type ResourceCreate = z.infer<typeof ResourceCreateSchema>;
export type ResourceUpdate = z.infer<typeof ResourceUpdateSchema>;

// API 응답 타입 (deletedAt 등 내부 필드 제외)
export interface ResourceResponse {
  id: string;
  title: string;
  description: string | null;
  userId: string;
  createdAt: Date;
}
```

---

## resource.repository.ts

Repository는 Prisma 세부사항을 캡슐화한다. Service는 interface만 의존한다.

```typescript
import { PrismaClient } from "@prisma/client";
import { ResourceModel } from "./resource.model";
import { ResourceCreate, ResourceUpdate } from "./resource.schema";

// Service가 의존하는 interface — 테스트 시 mock 가능
export interface IResourceRepository {
  findById(id: string): Promise<ResourceModel | null>;
  findByOwner(
    userId: string,
    page: number,
    size: number,
    search?: string
  ): Promise<{ items: ResourceModel[]; total: number }>;
  create(userId: string, data: ResourceCreate): Promise<ResourceModel>;
  update(id: string, data: ResourceUpdate): Promise<ResourceModel>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
}

// Prisma 구현체
export class PrismaResourceRepository implements IResourceRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<ResourceModel | null> {
    return this.db.resource.findUnique({ where: { id, deletedAt: null } });
  }

  async findByOwner(userId: string, page: number, size: number, search?: string) {
    const where = {
      userId,
      deletedAt: null,
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.resource.findMany({ where, skip: (page - 1) * size, take: size, orderBy: { createdAt: "desc" } }),
      this.db.resource.count({ where }),
    ]);
    return { items, total };
  }

  async create(userId: string, data: ResourceCreate): Promise<ResourceModel> {
    return this.db.resource.create({ data: { ...data, userId } });
  }

  async update(id: string, data: ResourceUpdate): Promise<ResourceModel> {
    return this.db.resource.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<void> {
    await this.db.resource.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.resource.delete({ where: { id } });
  }
}
```

---

## resource.service.ts

Service는 Repository interface를 통해서만 DB에 접근한다. HTTP(Express) 개념 없음.

```typescript
import { IResourceRepository } from "./resource.repository";
import { ResourceCreate, ResourceUpdate, ResourceResponse } from "./resource.schema";
import { NotFoundError, ForbiddenError } from "../core/errors";

export interface ResourcePage {
  items: ResourceResponse[];
  total: number;
  page: number;
  size: number;
}

export class ResourceService {
  constructor(private readonly repo: IResourceRepository) {}

  // 소유권 검증 포함 조회. 없으면 NotFoundError, 타인 소유면 ForbiddenError.
  async getOwnedOrThrow(id: string, ownerId: string): Promise<ResourceResponse> {
    const resource = await this.repo.findById(id);
    if (!resource) throw new NotFoundError("Resource not found");
    if (resource.userId !== ownerId) throw new ForbiddenError("Access denied");
    return this.toResponse(resource);
  }

  async list(userId: string, page: number, size: number, search?: string): Promise<ResourcePage> {
    const { items, total } = await this.repo.findByOwner(userId, page, size, search);
    return { items: items.map(this.toResponse), total, page, size };
  }

  async create(userId: string, data: ResourceCreate): Promise<ResourceResponse> {
    const resource = await this.repo.create(userId, data);
    return this.toResponse(resource);
  }

  async update(id: string, ownerId: string, data: ResourceUpdate): Promise<ResourceResponse> {
    await this.getOwnedOrThrow(id, ownerId); // ownership 검증
    const resource = await this.repo.update(id, data);
    return this.toResponse(resource);
  }

  async delete(id: string, ownerId: string, hard = false): Promise<void> {
    await this.getOwnedOrThrow(id, ownerId);
    if (hard) {
      await this.repo.hardDelete(id);
    } else {
      await this.repo.softDelete(id);
    }
  }

  private toResponse(r: { id: string; title: string; description: string | null; userId: string; createdAt: Date }): ResourceResponse {
    return { id: r.id, title: r.title, description: r.description, userId: r.userId, createdAt: r.createdAt };
  }
}
```

---

## resource.router.ts

Router는 HTTP만 담당한다. 비즈니스 로직 없음. Service에 위임.

```typescript
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { ResourceService } from "./resource.service";
import { ResourceCreateSchema, ResourceUpdateSchema } from "./resource.schema";
import { handleError } from "../core/errors";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export function createResourceRouter(svc: ResourceService): Router {
  const router = Router();

  router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ListQuerySchema.parse(req.query);
      const result = await svc.list(req.user!.id, query.page, query.size, query.search);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.get("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resource = await svc.getOwnedOrThrow(req.params.id, req.user!.id);
      res.json(resource);
    } catch (err) { next(err); }
  });

  router.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = ResourceCreateSchema.parse(req.body);
      const resource = await svc.create(req.user!.id, data);
      res.status(201).json(resource);
    } catch (err) { next(err); }
  });

  router.patch("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = ResourceUpdateSchema.parse(req.body);
      const resource = await svc.update(req.params.id, req.user!.id, data);
      res.json(resource);
    } catch (err) { next(err); }
  });

  router.delete("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hard = req.query.hard === "true";
      await svc.delete(req.params.id, req.user!.id, hard);
      res.status(204).send();
    } catch (err) { next(err); }
  });

  return router;
}
```

---

## 조립 (app.ts)

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaResourceRepository } from "./resources/resource.repository";
import { ResourceService } from "./resources/resource.service";
import { createResourceRouter } from "./resources/resource.router";

const prisma = new PrismaClient();
const resourceRepo = new PrismaResourceRepository(prisma);
const resourceSvc = new ResourceService(resourceRepo);

app.use("/api/resources", createResourceRouter(resourceSvc));
```

---

## 단위 테스트 (Service — Repository mock)

```typescript
// tests/unit/resource.service.test.ts
import { ResourceService } from "../../src/resources/resource.service";
import { IResourceRepository } from "../../src/resources/resource.repository";
import { NotFoundError, ForbiddenError } from "../../src/core/errors";

const makeRepo = (overrides: Partial<IResourceRepository> = {}): IResourceRepository => ({
  findById: jest.fn().mockResolvedValue(null),
  findByOwner: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  hardDelete: jest.fn(),
  ...overrides,
});

describe("ResourceService", () => {
  it("getOwnedOrThrow: throws NotFound when resource missing", async () => {
    const svc = new ResourceService(makeRepo());
    await expect(svc.getOwnedOrThrow("id", "user1")).rejects.toThrow(NotFoundError);
  });

  it("getOwnedOrThrow: throws Forbidden when not owner", async () => {
    const resource = { id: "id", userId: "owner", title: "T", description: null, createdAt: new Date(), deletedAt: null };
    const svc = new ResourceService(makeRepo({ findById: jest.fn().mockResolvedValue(resource) }));
    await expect(svc.getOwnedOrThrow("id", "not-owner")).rejects.toThrow(ForbiddenError);
  });

  it("create: delegates to repository", async () => {
    const mockCreate = jest.fn().mockResolvedValue({ id: "new-id", title: "T", description: null, userId: "u1", createdAt: new Date() });
    const svc = new ResourceService(makeRepo({ create: mockCreate }));
    await svc.create("u1", { title: "T" });
    expect(mockCreate).toHaveBeenCalledWith("u1", { title: "T" });
  });
});
```
