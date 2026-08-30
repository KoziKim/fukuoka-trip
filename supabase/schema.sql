-- 후쿠오카 수첩 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 실행하세요.
-- 로그인은 익명 인증(anonymous sign-in)을 씁니다. 사용자는 이름 + 초대코드만 입력하고,
-- 그 뒤에서 기기마다 익명 계정이 발급되어 RLS로 본인이 속한 여행만 접근합니다.

create extension if not exists pgcrypto;

-- ─────────── 테이블 ───────────

create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null default '후쿠오카 여행',
  state       jsonb not null default '{}'::jsonb,   -- 숙소·즐겨찾기·꿀팁·체크리스트·경비 등
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (trip_id, user_id)
);
create index if not exists members_trip_idx on public.members(trip_id);

create table if not exists public.plan_items (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  day         int not null default 0,
  at          text,                                  -- "HH:MM"
  place_id    text,                                  -- 내장 장소 id (맛집/명소/공항/숙소)
  name        text,                                  -- 직접 입력한 장소명
  memo        text,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists plan_items_trip_idx on public.plan_items(trip_id, day);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  item_id     uuid not null references public.plan_items(id) on delete cascade,
  member_id   uuid references public.members(id) on delete set null,
  author      text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists comments_item_idx on public.comments(item_id, created_at);

create table if not exists public.push_subs (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  endpoint    text unique not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subs_trip_idx on public.push_subs(trip_id);

-- ─────────── 접근 제어 ───────────
-- 핵심 규칙: "내가 멤버로 등록된 여행의 데이터만 읽고 쓸 수 있다".
-- security definer 함수로 감싸 policy 안에서 members를 조회할 때 무한 재귀가 생기지 않게 한다.

create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.trip_id = t and m.user_id = auth.uid());
$$;

alter table public.trips      enable row level security;
alter table public.members    enable row level security;
alter table public.plan_items enable row level security;
alter table public.comments   enable row level security;
alter table public.push_subs  enable row level security;

drop policy if exists trips_rw on public.trips;
create policy trips_rw on public.trips
  for all using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members
  for select using (public.is_member(trip_id));

drop policy if exists members_own on public.members;
create policy members_own on public.members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists items_rw on public.plan_items;
create policy items_rw on public.plan_items
  for all using (public.is_member(trip_id)) with check (public.is_member(trip_id));

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments
  for select using (public.is_member(trip_id));

drop policy if exists comments_write on public.comments;
create policy comments_write on public.comments
  for insert with check (public.is_member(trip_id));

-- 코멘트는 본인 것만 지울 수 있다
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete using (
    public.is_member(trip_id)
    and member_id in (select id from public.members where user_id = auth.uid())
  );

drop policy if exists push_own on public.push_subs;
create policy push_own on public.push_subs
  for all using (
    member_id in (select id from public.members where user_id = auth.uid())
  ) with check (
    public.is_member(trip_id)
    and member_id in (select id from public.members where user_id = auth.uid())
  );

-- ─────────── 여행 만들기 / 참가하기 ───────────
-- 아직 멤버가 아닌 상태에서 호출하므로 security definer로 RLS를 우회한다.

create or replace function public.create_trip(p_name text, p_member text)
returns table (trip_id uuid, trip_code text, member_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_trip uuid;
  v_member uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 사람이 불러주기 쉬운 6자리 코드 (헷갈리는 0/O/1/I 제외)
  loop
    v_code := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                               1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.trips t where t.code = v_code);
  end loop;

  insert into public.trips (code, name) values (v_code, coalesce(nullif(p_name, ''), '후쿠오카 여행'))
    returning id into v_trip;
  insert into public.members (trip_id, user_id, name) values (v_trip, auth.uid(), p_member)
    returning id into v_member;

  return query select v_trip, v_code, v_member;
end $$;

create or replace function public.join_trip(p_code text, p_member text)
returns table (trip_id uuid, trip_code text, member_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_trip uuid;
  v_member uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select id into v_trip from public.trips where code = upper(trim(p_code));
  if v_trip is null then raise exception 'TRIP_NOT_FOUND'; end if;

  insert into public.members (trip_id, user_id, name)
    values (v_trip, auth.uid(), p_member)
    on conflict (trip_id, user_id) do update set name = excluded.name
    returning id into v_member;

  return query select v_trip, upper(trim(p_code)), v_member;
end $$;

grant execute on function public.create_trip(text, text) to anon, authenticated;
grant execute on function public.join_trip(text, text)  to anon, authenticated;

-- ─────────── 실시간 동기화 ───────────
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.plan_items;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.members;

-- ─────────── 코멘트 → 푸시 알림 ───────────
-- notify Edge Function을 배포한 뒤, 아래 두 값을 본인 프로젝트 것으로 바꾸고 실행하세요.
--   :project_ref  = 프로젝트 참조 id (대시보드 URL에 있는 값)
--   :service_key  = service_role 키
--
-- create extension if not exists pg_net;
--
-- create or replace function public.notify_on_comment()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   perform net.http_post(
--     url     := 'https://:project_ref.supabase.co/functions/v1/notify',
--     headers := jsonb_build_object('Content-Type','application/json',
--                                   'Authorization','Bearer :service_key'),
--     body    := jsonb_build_object('comment_id', new.id)
--   );
--   return new;
-- end $$;
--
-- drop trigger if exists comments_notify on public.comments;
-- create trigger comments_notify after insert on public.comments
--   for each row execute function public.notify_on_comment();
