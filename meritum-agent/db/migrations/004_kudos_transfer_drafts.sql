create table if not exists kudos_transfer_drafts (
  team_id text not null,
  channel_id text not null,
  thread_ts text not null,
  sender_slack_user_id text not null,
  request_ts text not null,
  recipient_slack_user_id text,
  amount integer check (amount is null or amount > 0),
  reason text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  updated_at timestamptz not null default now(),
  primary key (team_id, channel_id, thread_ts, sender_slack_user_id)
);

create index if not exists kudos_transfer_drafts_expires_at_idx
  on kudos_transfer_drafts (expires_at);
