# Backend Snippets — Python (FastAPI + SQLAlchemy + Pydantic)

Copy-paste ready patterns. Each snippet shows its correct architectural layer.

---

## Route with Auth

Router는 HTTP만 담당한다. 비즈니스 로직과 DB 접근은 Service/Repository에 위임한다.

```python
# src/resources/router.py
from fastapi import APIRouter, Depends, status
from uuid import UUID

from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.resource import ResourceCreate, ResourceResponse
from app.resources.dependencies import get_resource_service
from app.resources.service import ResourceService

router = APIRouter(prefix="/api/resources", tags=["resources"])


@router.post("/", response_model=ResourceResponse, status_code=status.HTTP_201_CREATED)
async def create_resource(
    data: ResourceCreate,
    service: ResourceService = Depends(get_resource_service),  # DI — Router는 Service만 안다
    current_user: User = Depends(get_current_user),
):
    # Router 역할: 입력 수신 → Service 위임 → 응답 반환. 끝.
    return await service.create(user_id=current_user.id, data=data)


@router.get("/{resource_id}", response_model=ResourceResponse)
async def get_resource(
    resource_id: UUID,
    service: ResourceService = Depends(get_resource_service),
    current_user: User = Depends(get_current_user),
):
    # ownership 체크는 비즈니스 로직 → Service 책임
    return await service.get_owned_or_raise(resource_id, owner_id=current_user.id)
```

```python
# src/resources/dependencies.py  — DI 조립 지점
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.resources.repository import ResourceRepository
from app.resources.service import ResourceService


async def get_resource_service(db: AsyncSession = Depends(get_db)) -> ResourceService:
    repository = ResourceRepository(db)
    return ResourceService(repository)
```

---

## Request/Response Schema

```python
# src/resources/schemas.py
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

## DB Model

```python
# src/resources/models.py
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="resources")
```

---

## Repository (Data Access Layer)

Repository는 DB CRUD만 안다. 비즈니스 규칙 없음.

```python
# src/resources/repository.py
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.resources.models import Resource
from app.resources.schemas import ResourceCreate, ResourceUpdate


class ResourceRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, resource_id: UUID) -> Resource | None:
        return await self.db.get(Resource, resource_id)

    async def list_by_owner(
        self, user_id: UUID, page: int, size: int, search: str | None
    ) -> list[Resource]:
        q = select(Resource).where(Resource.user_id == user_id)
        if search:
            q = q.where(Resource.title.ilike(f"%{search}%"))
        result = await self.db.scalars(q.offset((page - 1) * size).limit(size))
        return list(result.all())

    async def create(self, user_id: UUID, data: ResourceCreate) -> Resource:
        resource = Resource(**data.model_dump(), user_id=user_id)
        self.db.add(resource)
        await self.db.commit()
        await self.db.refresh(resource)
        return resource

    async def update(self, resource: Resource, data: ResourceUpdate) -> Resource:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(resource, field, value)
        await self.db.commit()
        await self.db.refresh(resource)
        return resource

    async def delete(self, resource: Resource) -> None:
        await self.db.delete(resource)
        await self.db.commit()
```

---

## Service (Business Logic Layer)

Service는 Repository를 통해서만 DB에 접근한다. HTTP 개념(HTTPException 등) 없음.

```python
# src/resources/service.py
from uuid import UUID
from fastapi import HTTPException, status

from app.resources.repository import ResourceRepository
from app.resources.schemas import ResourceCreate, ResourceUpdate
from app.resources.models import Resource


class ResourceService:
    def __init__(self, repository: ResourceRepository) -> None:
        self._repo = repository

    async def get_owned_or_raise(self, resource_id: UUID, owner_id: UUID) -> Resource:
        resource = await self._repo.get_by_id(resource_id)
        if resource is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
        if resource.user_id != owner_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return resource

    async def list(self, user_id: UUID, page: int, size: int, search: str | None) -> list[Resource]:
        return await self._repo.list_by_owner(user_id, page, size, search)

    async def create(self, user_id: UUID, data: ResourceCreate) -> Resource:
        return await self._repo.create(user_id, data)

    async def update(self, resource_id: UUID, owner_id: UUID, data: ResourceUpdate) -> Resource:
        resource = await self.get_owned_or_raise(resource_id, owner_id)
        return await self._repo.update(resource, data)

    async def delete(self, resource_id: UUID, owner_id: UUID) -> None:
        resource = await self.get_owned_or_raise(resource_id, owner_id)
        await self._repo.delete(resource)
```

---

## JWT Auth Dependency

```python
# src/core/deps.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.users.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
```

---

## Password Hashing

```python
# src/core/security.py
from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)
```

---

## Paginated Query (Repository 안에서 사용)

```python
# src/core/pagination.py — 공통 유틸, Repository에서 호출
from dataclasses import dataclass
from typing import Generic, TypeVar
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


@dataclass
class Page(Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int


async def paginate(db: AsyncSession, query, page: int, size: int) -> Page:
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    items = list(await db.scalars(query.offset((page - 1) * size).limit(size)))
    return Page(items=items, total=total or 0, page=page, size=size)
```

---

## Migration (Alembic)

```python
# alembic/versions/xxxx_add_resources_table.py
"""add resources table

Revision ID: xxxx
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    op.create_table(
        "resources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_resources_user_id", "resources", ["user_id"])


def downgrade() -> None:
    op.drop_table("resources")
```

---

## Test

Service는 Repository mock으로 단위 테스트. Router는 통합 테스트.

```python
# tests/unit/test_resource_service.py
import pytest
from unittest.mock import AsyncMock
from uuid import uuid4

from app.resources.service import ResourceService
from app.resources.schemas import ResourceCreate


@pytest.fixture
def mock_repo():
    return AsyncMock()


@pytest.fixture
def service(mock_repo):
    return ResourceService(mock_repo)


@pytest.mark.asyncio
async def test_create_delegates_to_repository(service, mock_repo):
    user_id = uuid4()
    data = ResourceCreate(title="Test")
    await service.create(user_id=user_id, data=data)
    mock_repo.create.assert_awaited_once_with(user_id, data)


# tests/integration/test_resource_router.py
@pytest.mark.asyncio
async def test_create_resource(client, auth_headers):
    response = await client.post(
        "/api/resources/",
        json={"title": "Test", "description": "Test desc"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    assert response.json()["title"] == "Test"
```
