-- teams table
create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz default now()
);

-- team_members table
create table team_members (
  team_id     uuid references teams(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  display_name text not null,
  joined_at   timestamptz default now(),
  primary key (team_id, user_id)
);

create index idx_team_members_user on team_members(user_id);

-- ledger_events table
create table ledger_events (
  seq             bigserial primary key,
  team_id         uuid not null references teams(id) on delete cascade,
  node_id         text not null,
  user_id         uuid not null references auth.users(id),
  type            text not null check (type in (
    'node.join', 'node.reconnect', 'node.leave',
    'agent.start', 'agent.done', 'agent.failed', 'agent.cancelled'
  )),
  payload         jsonb not null default '{}',
  client_timestamp timestamptz not null,
  created_at      timestamptz default now()
);

create index idx_ledger_team on ledger_events(team_id);
create index idx_ledger_team_seq on ledger_events(team_id, seq);

-- RLS
alter table teams enable row level security;
alter table team_members enable row level security;
alter table ledger_events enable row level security;

-- teams: members can read their own teams
create policy "team_member_read" on teams for select using (
  id in (select team_id from team_members where user_id = auth.uid())
);

-- team_members: members can read their own team's members
create policy "team_members_read" on team_members for select using (
  team_id in (select team_id from team_members where user_id = auth.uid())
);

-- ledger_events: team members can read
create policy "team_read" on ledger_events for select using (
  team_id in (select team_id from team_members where user_id = auth.uid())
);

-- ledger_events: only own events, nodeId must match email prefix
create policy "own_write" on ledger_events for insert with check (
  user_id = auth.uid()
  and team_id in (select team_id from team_members where user_id = auth.uid())
);

-- Enable Realtime for ledger_events
alter publication supabase_realtime add table ledger_events;
