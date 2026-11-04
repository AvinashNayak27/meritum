create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  slack_user_id text not null,
  role text not null check (role in ('EMPLOYEE', 'MANAGER', 'ADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  unique (organization_id, slack_user_id)
);

create table if not exists kudos_wallets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id uuid not null unique references users(id),
  available_points integer not null default 0 check (available_points >= 0),
  reserved_points integer not null default 0 check (reserved_points >= 0),
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists kudos_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references kudos_wallets(id),
  type text not null check (type in ('GRANT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESERVE', 'RELEASE', 'REDEEM')),
  amount integer not null check (amount > 0),
  reference_id text not null,
  description text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (wallet_id, type, reference_id)
);

create table if not exists kudos_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sender_user_id uuid not null references users(id),
  recipient_user_id uuid not null references users(id),
  amount integer not null check (amount > 0),
  reason text not null,
  source_event_id text not null unique,
  created_at timestamptz not null default now(),
  check (sender_user_id <> recipient_user_id)
);

create table if not exists recognitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  issuer_user_id uuid not null references users(id),
  recipient_user_id uuid not null references users(id),
  kudos_amount integer not null check (kudos_amount > 0),
  reason text not null check (char_length(reason) between 3 and 500),
  source_event_id text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, source_event_id)
);
