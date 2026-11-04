alter table kudos_transactions drop constraint if exists kudos_transactions_type_check;
alter table kudos_transactions add constraint kudos_transactions_type_check
  check (type in ('GRANT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESERVE', 'RELEASE', 'REDEEM'));

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
