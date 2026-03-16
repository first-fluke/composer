# API Endpoint Template — Python (FastAPI + SQLAlchemy + Pydantic)

전체 CRUD 구현 예시. Router → Service → Repository → Model 4레이어 구조.

---

## 레이어 구조

```
src/resources/
├── models.py        ← SQLAlchemy ORM 모델
├── schemas.py       ← Pydantic 입/출력 스키마
├── repository.py    ← DB CRUD (ORM만 안다)
├── service.py       ← 비즈니스 로직 (Repository만 안다)
├── router.py        ← HTTP 처리 (Service만 안다)
└── dependencies.py  ← DI 조립
```

---

## models.py

```python
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(nullable=True)
```

---

## schemas.py

```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class ResourceCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None


class ResourceUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None


class ResourceResponse(BaseModel):
    id: UUID
    title: str
    description: str | None
    user_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}
```

---

## repository.py

Repository는 DB CRUD만 담당한다. 비즈니스 규칙(ownership 체크 등) 없음.

```python
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.resources.models import Resource
from app.resources.schemas import ResourceCreate, ResourceUpdate


class ResourceRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_by_id(self, resource_id: UUID) -> Resource | None:
        return await self._db.get(Resource, resource_id)

    async def list_by_owner(
        self, user_id: UUID, page: int, size: int, search: str | None = None
    ) -> list[Resource]:
        q = select(Resource).where(
            Resource.user_id == user_id,
            Resource.deleted_at.is_(None),
        )
        if search:
            q = q.where(Resource.title.ilike(f"%{search}%"))
        result = await self._db.scalars(q.offset((page - 1) * size).limit(size))
        return list(result.all())

    async def count_by_owner(self, user_id: UUID, search: str | None = None) -> int:
        from sqlalchemy import func
        q = select(func.count()).select_from(Resource).where(
            Resource.user_id == user_id,
            Resource.deleted_at.is_(None),
        )
        if search:
            q = q.where(Resource.title.ilike(f"%{search}%"))
        return await self._db.scalar(q) or 0

    async def create(self, user_id: UUID, data: ResourceCreate) -> Resource:
        resource = Resource(**data.model_dump(), user_id=user_id)
        self._db.add(resource)
        await self._db.commit()
        await self._db.refresh(resource)
        return resource

    async def update(self, resource: Resource, data: ResourceUpdate) -> Resource:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(resource, field, value)
        await self._db.commit()
        await self._db.refresh(resource)
        return resource

    async def soft_delete(self, resource: Resource) -> None:
        from datetime import datetime
        resource.deleted_at = datetime.utcnow()
        await self._db.commit()

    async def hard_delete(self, resource: Resource) -> None:
        await self._db.delete(resource)
        await self._db.commit()
```

---

## service.py

Service는 Repository를 통해서만 DB에 접근한다. 비즈니스 규칙(ownership 등)은 여기서 결정.

```python
from dataclasses import dataclass
from uuid import UUID
from fastapi import HTTPException, status

from app.resources.repository import ResourceRepository
from app.resources.schemas import ResourceCreate, ResourceUpdate
from app.resources.models import Resource


@dataclass
class ResourcePage:
    items: list[Resource]
    total: int
    page: int
    size: int


class ResourceService:
    def __init__(self, repository: ResourceRepository) -> None:
        self._repo = repository

    async def get_owned_or_raise(self, resource_id: UUID, owner_id: UUID) -> Resource:
        """소유권 검증 포함 조회. 없으면 404, 타인 소유면 403."""
        resource = await self._repo.get_by_id(resource_id)
        if resource is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
        if resource.user_id != owner_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return resource

    async def list(
        self, user_id: UUID, page: int, size: int, search: str | None = None
    ) -> ResourcePage:
        items = await self._repo.list_by_owner(user_id, page, size, search)
        total = await self._repo.count_by_owner(user_id, search)
        return ResourcePage(items=items, total=total, page=page, size=size)

    async def create(self, user_id: UUID, data: ResourceCreate) -> Resource:
        return await self._repo.create(user_id, data)

    async def update(self, resource_id: UUID, owner_id: UUID, data: ResourceUpdate) -> Resource:
        resource = await self.get_owned_or_raise(resource_id, owner_id)
        return await self._repo.update(resource, data)

    async def delete(self, resource_id: UUID, owner_id: UUID, hard: bool = False) -> None:
        resource = await self.get_owned_or_raise(resource_id, owner_id)
        if hard:
            await self._repo.hard_delete(resource)
        else:
            await self._repo.soft_delete(resource)
```

---

## dependencies.py

```python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.resources.repository import ResourceRepository
from app.resources.service import ResourceService


async def get_resource_service(db: AsyncSession = Depends(get_db)) -> ResourceService:
    repository = ResourceRepository(db)
    return ResourceService(repository)
```

---

## router.py

Router는 HTTP만 담당한다. 비즈니스 로직 없음. Service에 위임.

```python
from fastapi import APIRouter, Depends, Query, status
from typing import Annotated, List
from uuid import UUID

from app.core.deps import get_current_user
from app.users.models import User
from app.resources.schemas import ResourceCreate, ResourceUpdate, ResourceResponse
from app.resources.service import ResourceService
from app.resources.dependencies import get_resource_service

router = APIRouter(prefix="/api/resources", tags=["resources"])

ServiceDep = Annotated[ResourceService, Depends(get_resource_service)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=List[ResourceResponse])
async def list_resources(
    service: ServiceDep,
    current_user: UserDep,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
):
    result = await service.list(current_user.id, page=page, size=size, search=search)
    return result.items  # 필요시 Page 응답 스키마로 감싸기


@router.get("/{resource_id}", response_model=ResourceResponse)
async def get_resource(resource_id: UUID, service: ServiceDep, current_user: UserDep):
    return await service.get_owned_or_raise(resource_id, owner_id=current_user.id)


@router.post("/", response_model=ResourceResponse, status_code=status.HTTP_201_CREATED)
async def create_resource(data: ResourceCreate, service: ServiceDep, current_user: UserDep):
    return await service.create(user_id=current_user.id, data=data)


@router.patch("/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    resource_id: UUID, data: ResourceUpdate, service: ServiceDep, current_user: UserDep
):
    return await service.update(resource_id, owner_id=current_user.id, data=data)


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    resource_id: UUID,
    service: ServiceDep,
    current_user: UserDep,
    hard: bool = Query(False),
):
    await service.delete(resource_id, owner_id=current_user.id, hard=hard)
```
