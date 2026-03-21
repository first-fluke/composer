# Globe CRM - Design Document

> Personal CRM on a 3D globe. Register friends, visualize where they're from, explore relationships.

**Status**: Approved (Brainstorm Phase Complete)
**Date**: 2026-03-21

---

## 1. Product Overview

A multi-user Personal CRM where contacts are pinned on a 3D interactive globe by their origin. Users can rotate the globe to discover friends, search/filter by region or tags, and explore relationship networks through a separate graph view.

### Core Value Proposition
- Visual-first contact management on a 3D globe
- Automatic relationship discovery through shared companies, schools, tags, regions, meetings
- Cross-platform: Web + Mobile with consistent UX

---

## 2. System Architecture

```
Clients
├── Next.js 16 (Web)
│   ├── react-globe.gl (next/dynamic ssr:false)
│   ├── react-force-graph-2d
│   ├── TanStack Query + nuqs + Jotai
│   ├── shadcn/ui + TailwindCSS v4
│   └── TanStack Form
│
└── Flutter 3 (Mobile)
    ├── flutter_inappwebview + Globe.gl (asset bundle)
    ├── Riverpod 3 + go_router
    ├── Forui (shadcn/ui consistency)
    └── Drift (offline cache)

API: FastAPI (Python/uv)
├── SQLAlchemy async + Alembic
├── PostgreSQL 16 + PostGIS
├── Redis 7 (cache + sessions + refresh tokens)
└── MinIO (avatars) → Cloud Storage (prod)

Infra: GCP (Cloud Run + Cloud SQL + Cloud Storage)
       Terraform + GitHub Actions (OIDC)
DX:    mise (.mise.toml) + Biome + uv
```

---

## 3. Data Model

```
User
├── id (PK), email, name, avatar_url, created_at, updated_at

UserAuth (1:N from User)
├── id (PK), user_id (FK), provider, provider_id, created_at

Contact (soft-delete)
├── id (PK), user_id (FK)
├── name, avatar_url, phone, email, birthday, memo
├── linkedin_url, instagram_id, github_id
├── location (PostGIS geography POINT 4326)
├── country, city (cached geocode)
├── created_at, updated_at, deleted_at

Organization
├── id (PK), name, type (company|school), domain (nullable), created_at

Experience
├── id (PK), contact_id (FK), organization_id (FK)
├── role (nullable), major (nullable)
├── start_date, end_date, is_current
├── created_at, updated_at

Tag
├── id (PK), user_id (FK), name, color
├── UNIQUE(user_id, name)

contact_tags (junction, composite PK)
├── contact_id (FK), tag_id (FK)

Meeting
├── id (PK), user_id (FK), title, date, place, memo
├── location (PostGIS POINT), created_at, updated_at

meeting_contacts (junction, composite PK)
├── meeting_id (FK), contact_id (FK)

ContactRelationship
├── id (PK), user_id (FK)
├── contact_a_id (FK), contact_b_id (FK)
├── strength, updated_at
├── CHECK(contact_a_id < contact_b_id)
├── UNIQUE(user_id, contact_a_id, contact_b_id)
```

### Integrity Rules
- Cross-user isolation: junction tables enforce same user_id ownership
- Relationship self-reference prevented via CHECK constraint
- Organization normalized for graph clustering accuracy
- Relationship.strength recomputed on meeting CRUD (application-level trigger)

---

## 4. API Design

### Response Envelope (global)
```json
{ "data": {...}, "meta": {"cursor":"...", "has_more":true}, "errors": null }
```

### Error Format
```json
{ "error": {"code":"CONTACT_NOT_FOUND", "message":"...", "details":null} }
```

### Endpoints

```
Auth
  GET    /auth/callback              OAuth redirect receiver
  POST   /auth/token                 Code → JWT exchange
  POST   /auth/refresh               Refresh token (Redis-stored)
  DELETE /auth/logout
  GET    /auth/me                    Current user profile

Contacts
  GET    /contacts                   Cursor pagination + filters (tag, country, city, q)
  POST   /contacts
  GET    /contacts/:id
  PUT    /contacts/:id               Full update
  PATCH  /contacts/:id               Partial update
  DELETE /contacts/:id               Soft delete
  POST   /contacts/:id/tags/:tag_id  Attach tag
  DELETE /contacts/:id/tags/:tag_id  Detach tag
  GET    /contacts/:id/experiences
  POST   /contacts/:id/experiences
  GET    /contacts/:id/meetings      Meetings involving this contact
  GET    /contacts/:id/relationships Relationships for this contact

Tags
  GET    /tags
  POST   /tags
  PUT    /tags/:id
  DELETE /tags/:id

Organizations
  GET    /organizations              Autocomplete search (?q=)
  POST   /organizations

Experiences
  PUT    /contacts/:contact_id/experiences/:id
  DELETE /contacts/:contact_id/experiences/:id

Meetings
  GET    /meetings                   Cursor pagination + filters (date_from, date_to, contact_id)
  POST   /meetings                   Create with attendee contact_ids
  GET    /meetings/:id
  PUT    /meetings/:id
  DELETE /meetings/:id

Globe (optimized aggregate)
  GET    /globe/data?bbox=sw_lat,sw_lng,ne_lat,ne_lng
         Returns: contacts[], relationships[], clusters[]
         Redis cached, ETag header, bbox spatial filter via PostGIS

Graph
  GET    /graph/edges?type=company|school|tag|region|meeting
  GET    /graph/clusters?type=...

Upload
  POST   /upload/avatar              Returns MinIO presigned URL (5MB, image/* only)
```

### Security
- User-scoping enforced at repository layer (WHERE user_id = :current_user)
- Refresh tokens stored in Redis with TTL
- Rate limiting: /auth/* (10/min/IP), /upload/* (5/min/user)
- Presigned URL: 5MB size limit + image/* content-type restriction

---

## 5. Screen Design

### Navigation
- Desktop: Side Nav (Server Component)
- Mobile Web: Bottom Nav
- Flutter: Bottom Nav (platform-adaptive FAB)
- Tabs: Globe | Graph | Contacts | Settings

### Globe (Main Screen)
- Search: CommandInput (shadcn) / SearchAnchor (MD3 Flutter)
- Filters: ToggleGroup tag chips with collapse toggle
- Globe: react-globe.gl (Web) / WebView + bundled Globe.gl (Flutter)
  - Wrapped in ErrorBoundary + Suspense
  - Pins: profile pic + name (48dp touch target)
  - Arcs: thickness = frequency, dash pattern = type (WCAG 1.4.1)
  - Clusters: badge(N), tap → scrollable ListView bottom sheet
- Pin tap → Drawer (mobile) / Sheet side="right" (desktop)
  - Card: name, location, company, tags
  - Actions: [Detail] [View Relationships → /graph?focus=contactId]
- State: nuqs (filters, search, selected contact) / Jotai (camera, globeMode) / TanStack Query (globe-data with bbox)
- Accessibility: screen reader mode → Contacts list view fallback
- Offline (Flutter): Drift cache → stale-data banner

### Graph (Relationship Network)
- Filters: company / school / tag / region / meeting
- Library: react-force-graph-2d (Web) / WebView (Flutter)
  - Wrapped in ErrorBoundary + Suspense
  - Nodes: profile pic + name
  - Edges: color = type + dash pattern (WCAG)
  - Cluster labels = group name
- Node tap → same profile card
- Cluster tap → member list Sheet
- Actions: [View on Globe → fly-to]
- URL: /graph?type=company&focus=contactId (nuqs)
- Layout cache: node x,y stored locally (500+ node recompute prevention)
- Empty state: "Add more contacts to see relationships"

### Contacts (List)
- Search + Sort (Select) + Tag filter
- FAB: Android bottom-right / iOS top-right
- List: @tanstack/react-virtual / ListView.builder (Flutter)
  - Avatar, name, city, company
  - Infinite scroll (cursor pagination)
- Detail screen: profile, SNS links, experience timeline (Separator+Card), meeting history (Table), tag management (Badge+Popover)
- Actions: [View on Globe] [View Relationships]

### Add Contact (3-Step Wizard)
- Step 1: Basic info (name, phone, email, SNS, birthday, memo)
- Step 2: Location (globe pin placement → reverse geocode → country/city auto-fill)
  - Globe mode: globeModeAtom = "placingPin", crosshair cursor, disable pin clicks
- Step 3: Tags + Experience (Organization autocomplete)

### Onboarding (First Launch)
- OAuth login → Location permission (Flutter) → Empty globe + "Add your first contact" CTA

### Settings (Route Groups)
- /settings/profile/ — Profile edit, OAuth account linking
- /settings/tags/ — Tag management with color picker (Popover)
- /settings/export/ — CSV export (DropdownMenu)
- /settings/account/ — Logout, Account deletion (AlertDialog with typed confirmation)

### Error/Loading States (Global)
- WebGL crash → ErrorBoundary + retry + list-view fallback
- Network failure → retry overlay + Sonner toast
- Save failure → form retained + inline error
- Globe init → skeleton PNG overlay (1-3 sec)
- WebView process kill (iOS) → fallback UI + limit initial 50 contacts

### JS Bridge Contract (Flutter ↔ Globe.gl)
```
Flutter → Globe:
  FLY_TO           { lat, lng, contactId }
  HIGHLIGHT_CONTACT { contactId }
  SET_THEME        { isDark }
  SET_MODE         { mode: "view" | "placingPin" }

Globe → Flutter:
  PIN_TAPPED       { contactId }
  CLUSTER_TAPPED   { contactIds }
  LOCATION_SELECTED { lat, lng }
  READY            {}
```

### Cross-Tab Navigation
- Globe "View Relationships" → /graph?focus=contactId (nuqs / go_router query)
- Graph "View on Globe" → Globe fly-to (Jotai atom / Riverpod StateProvider)
- Flutter: StatefulShellRoute.goBranch()
- Web: nuqs URL params persist across tab switches

---

## 6. Tech Stack Summary

| Layer | Web | Mobile | Shared |
|---|---|---|---|
| Globe | react-globe.gl (dynamic ssr:false) | flutter_inappwebview + Globe.gl asset | Globe.gl (Three.js) |
| Graph | react-force-graph-2d | WebView (same lib) | vasturiano libs |
| State (URL) | nuqs | go_router query params | filters/search/focus |
| State (UI) | Jotai | Riverpod 3 | camera, mode, panel |
| Server data | TanStack Query | Riverpod + Dio | cursor pagination |
| Forms | TanStack Form | Flutter Form | 3-step wizard |
| UI Kit | shadcn/ui + TailwindCSS v4 | Forui | design consistency |
| Offline | - | Drift (SQLite) | |
| Backend | FastAPI + SQLAlchemy async + Alembic | | |
| DB | PostgreSQL 16 + PostGIS | | |
| Cache | Redis 7 | | |
| Storage | MinIO → Cloud Storage | | |
| Infra | GCP Cloud Run + Terraform | | |
| DX | Biome + uv + mise | | |

---

## 7. Project Structure (deepinit)

```
globe-crm/
├── AGENTS.md                          # Root: project overview, install, architecture
├── CLAUDE.md                          # Claude Code instructions
│
├── apps/
│   ├── web/                           # Next.js 16 app
│   │   ├── AGENTS.md                  # Web-specific conventions
│   │   ├── src/
│   │   │   ├── app/                   # App Router
│   │   │   │   ├── (auth)/            # Auth routes
│   │   │   │   ├── (main)/            # Main layout (Globe/Graph/Contacts)
│   │   │   │   │   ├── globe/
│   │   │   │   │   ├── graph/
│   │   │   │   │   ├── contacts/
│   │   │   │   │   │   └── [id]/
│   │   │   │   │   └── settings/
│   │   │   │   │       ├── profile/
│   │   │   │   │       ├── tags/
│   │   │   │   │       ├── export/
│   │   │   │   │       └── account/
│   │   │   │   └── layout.tsx
│   │   │   ├── features/
│   │   │   │   ├── globe/             # Globe.gl integration
│   │   │   │   │   ├── AGENTS.md      # Globe feature: WebGL, dynamic import, error boundary
│   │   │   │   │   ├── components/
│   │   │   │   │   ├── hooks/
│   │   │   │   │   └── atoms/
│   │   │   │   ├── graph/             # Force graph integration
│   │   │   │   │   ├── AGENTS.md      # Graph feature: react-force-graph, clustering
│   │   │   │   │   ├── components/
│   │   │   │   │   └── hooks/
│   │   │   │   ├── contacts/          # Contact CRUD + list
│   │   │   │   │   ├── components/
│   │   │   │   │   ├── hooks/
│   │   │   │   │   └── schemas/
│   │   │   │   ├── meetings/
│   │   │   │   ├── tags/
│   │   │   │   ├── organizations/
│   │   │   │   └── auth/
│   │   │   ├── shared/
│   │   │   │   ├── components/        # Shared UI (profile-card, nav)
│   │   │   │   ├── hooks/
│   │   │   │   ├── lib/               # API client, utils
│   │   │   │   └── types/
│   │   │   └── styles/
│   │   ├── public/
│   │   │   └── globe/                 # Globe.gl static assets (for Flutter WebView reuse)
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── biome.json
│   │   └── package.json
│   │
│   └── mobile/                        # Flutter app
│       ├── AGENTS.md                  # Mobile-specific conventions
│       ├── lib/
│       │   ├── app/                   # App setup, routing, theme
│       │   ├── features/
│       │   │   ├── globe/
│       │   │   │   ├── AGENTS.md      # Globe: WebView, JS bridge, gesture handling
│       │   │   │   ├── presentation/
│       │   │   │   ├── providers/
│       │   │   │   └── bridge/        # JS bridge typed message schema
│       │   │   ├── graph/
│       │   │   │   └── AGENTS.md      # Graph: WebView, layout cache
│       │   │   ├── contacts/
│       │   │   ├── meetings/
│       │   │   ├── tags/
│       │   │   └── auth/
│       │   ├── shared/
│       │   │   ├── widgets/
│       │   │   ├── providers/
│       │   │   ├── models/            # Shared domain models
│       │   │   └── services/          # API client (Dio)
│       │   └── core/
│       │       ├── db/                # Drift (offline cache)
│       │       ├── router/            # go_router config
│       │       └── theme/
│       ├── assets/
│       │   └── globe/                 # Bundled Globe.gl HTML/JS/CSS
│       ├── pubspec.yaml
│       └── analysis_options.yaml
│
├── api/                               # FastAPI backend
│   ├── AGENTS.md                      # Backend conventions: Router→Service→Repository
│   ├── src/
│   │   ├── auth/
│   │   │   ├── router.py
│   │   │   ├── service.py
│   │   │   ├── repository.py
│   │   │   ├── schemas.py
│   │   │   └── dependencies.py
│   │   ├── contacts/
│   │   │   ├── AGENTS.md              # Contact domain: soft-delete, user-scoping
│   │   │   ├── router.py
│   │   │   ├── service.py
│   │   │   ├── repository.py
│   │   │   ├── schemas.py
│   │   │   └── dependencies.py
│   │   ├── tags/
│   │   ├── organizations/
│   │   ├── experiences/
│   │   ├── meetings/
│   │   ├── globe/
│   │   │   ├── AGENTS.md              # Globe API: bbox query, Redis caching, ETag
│   │   │   ├── router.py
│   │   │   ├── service.py             # Aggregates Contact+Relationship+Cluster repos
│   │   │   └── schemas.py
│   │   ├── graph/
│   │   │   ├── AGENTS.md              # Graph API: edge computation, cluster grouping
│   │   │   ├── router.py
│   │   │   ├── service.py
│   │   │   └── schemas.py
│   │   ├── upload/
│   │   ├── lib/
│   │   │   ├── database.py            # Async SQLAlchemy engine + session
│   │   │   ├── redis.py               # Redis connection
│   │   │   ├── storage.py             # MinIO client
│   │   │   ├── auth.py                # JWT + OAuth helpers
│   │   │   ├── exceptions.py          # Custom exception hierarchy
│   │   │   └── pagination.py          # Cursor pagination helpers
│   │   ├── models/                    # SQLAlchemy models
│   │   │   ├── user.py
│   │   │   ├── contact.py
│   │   │   ├── organization.py
│   │   │   ├── tag.py
│   │   │   ├── experience.py
│   │   │   ├── meeting.py
│   │   │   └── relationship.py
│   │   └── main.py                    # FastAPI app entry
│   ├── alembic/                       # DB migrations
│   │   └── versions/
│   ├── alembic.ini
│   ├── pyproject.toml
│   └── uv.lock
│
├── infra/                             # Terraform
│   ├── AGENTS.md                      # Infra conventions: GCP, OIDC, state management
│   ├── modules/
│   │   ├── cloud-run/
│   │   ├── cloud-sql/
│   │   ├── cloud-storage/
│   │   ├── redis/
│   │   └── iam/
│   ├── environments/
│   │   ├── dev/
│   │   └── prod/
│   └── main.tf
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                     # Lint + test + type-check
│   │   └── deploy.yml                 # Terraform + Cloud Run deploy (OIDC)
│   └── PULL_REQUEST_TEMPLATE.md
│
├── .mise.toml                         # Node, Python, Flutter, Terraform versions
├── biome.json                         # Root Biome config
└── docker-compose.yml                 # Local: PostgreSQL + PostGIS + Redis + MinIO
```

---

## 8. AGENTS.md Hierarchy

### Root AGENTS.md
- Project overview, install, architecture diagram
- Polyglot monorepo conventions (mise, bounded contexts)
- Security rules, git workflow, PR checklist
- Links to all sub-AGENTS.md

### apps/web/AGENTS.md
- Next.js 16 + React 19 conventions
- Server vs Client Component boundary rules
- WebGL components: always next/dynamic ssr:false + ErrorBoundary + Suspense
- State split: nuqs (URL-persisted) vs Jotai (ephemeral)
- shadcn/ui component mapping table
- Avatar CORS proxy via next/image
- Biome lint rules

### apps/web/src/features/globe/AGENTS.md
- react-globe.gl integration: dynamic import, skeleton loader
- Globe mode state machine (view | placingPin)
- Pin rendering: 48dp touch target, avatar texture CORS
- Arc encoding: thickness = frequency, dash = type
- Cluster interaction: tap → list sheet, not zoom
- Dark mode: JS theme swap (not Tailwind dark:)
- Performance: bbox filtering, max initial 50 contacts on mobile

### apps/web/src/features/graph/AGENTS.md
- react-force-graph-2d: dynamic import, ErrorBoundary
- Edge types: color + dash pattern (WCAG 1.4.1)
- Layout caching: node positions in localStorage
- URL state: ?type= and ?focus=contactId via nuqs
- Empty state handling

### apps/mobile/AGENTS.md
- Flutter 3 + Riverpod 3 + go_router conventions
- Clean Architecture: domain → data → presentation
- Platform-adaptive patterns (FAB, navigation)
- Forui component usage
- Offline-first: Drift cache + stale-data banner
- 60fps target (accept 30fps for WebView globe)

### apps/mobile/lib/features/globe/AGENTS.md
- WebView integration: flutter_inappwebview + hardwareAcceleration
- JS Bridge contract (typed message schema)
- Gesture conflict resolution: popGestureDismissable, PopScope
- iOS memory limit: max 50 initial contacts
- Accessibility: screen reader → list view fallback
- Asset bundling: Globe.gl HTML/JS/CSS in assets/globe/

### apps/mobile/lib/features/graph/AGENTS.md
- WebView + react-force-graph-2d (bundled)
- Node position cache (SharedPreferences)
- Cross-tab navigation: StatefulShellRoute.goBranch

### api/AGENTS.md
- FastAPI + SQLAlchemy async conventions
- Router → Service → Repository pattern
- Dependency injection via FastAPI Depends
- User-scoping: repository layer enforces WHERE user_id = :current_user
- Custom exceptions (not raw HTTPException)
- Async/await consistently, type hints on all signatures
- Pydantic schema validation
- Ruff lint rules

### api/src/contacts/AGENTS.md
- Soft-delete: deleted_at filter on all queries
- Eager loading strategy: selectinload for tags, organization
- Tag association: dedicated attach/detach endpoints

### api/src/globe/AGENTS.md
- GlobeService aggregates: ContactRepo + RelationshipRepo
- bbox filtering: PostGIS ST_Within
- Redis caching: per-user, invalidated on any contact/relationship mutation
- ETag header support
- Response: minimal contact data (id, lat, lng, avatar_url, name)

### api/src/graph/AGENTS.md
- GraphService: edge computation from shared org, tags, meetings, region
- Cluster grouping: GROUP BY organization/tag/city
- Redis caching: same invalidation as globe
- Edge types: company, school, tag, region, meeting

### infra/AGENTS.md
- GCP resources: Cloud Run, Cloud SQL (PostgreSQL + PostGIS), Cloud Storage, Memorystore (Redis)
- Terraform modules, state in GCS backend
- GitHub Actions OIDC (no service account keys)
- Environment separation: dev/prod
