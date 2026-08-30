-- 누가 무엇을 바꿨는지 남기는 기록.
-- 전체 수정 이력을 되돌릴 수 있게 만들려면 무겁지만, "누가·무엇을·언제"만 쌓는
-- 덧붙이기 전용 표는 가볍다. 트리거로 자동으로 쌓으므로 앱은 신경 쓸 게 없다.

create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  actor      text not null default '누군가',
  action     text not null,          -- item_add | item_edit | item_del | comment
  place_id   text,                   -- 앱이 아는 장소 id (이름은 앱에서 풀어 쓴다)
  label      text,                   -- 직접 입력한 장소명
  at         text,                   -- "HH:MM"
  day        int,
  created_at timestamptz not null default now()
);
create index if not exists activity_trip_idx on public.activity(trip_id, created_at desc);

alter table public.activity enable row level security;

drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity
  for select using (public.is_member(trip_id));
-- 쓰기는 트리거(security definer)만 한다. 클라이언트용 insert 정책은 두지 않는다.

/* 지금 요청을 보낸 사람의 이름. 못 찾으면 '누군가' */
create or replace function public.actor_name(t uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.name from public.members m where m.trip_id = t and m.user_id = auth.uid()),
    '누군가'
  );
$$;

create or replace function public.log_item_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record; act text;
begin
  if tg_op = 'INSERT' then r := new; act := 'item_add';
  elsif tg_op = 'UPDATE' then
    r := new;
    -- 순서만 바뀐 경우까지 남기면 목록이 금방 지저분해진다
    if new.at is not distinct from old.at
       and new.place_id is not distinct from old.place_id
       and new.name is not distinct from old.name
       and new.memo is not distinct from old.memo
       and new.day is not distinct from old.day then
      return new;
    end if;
    act := 'item_edit';
  else r := old; act := 'item_del';
  end if;

  insert into public.activity (trip_id, actor, action, place_id, label, at, day)
    values (r.trip_id, public.actor_name(r.trip_id), act, r.place_id, r.name, r.at, r.day);

  return case when tg_op = 'DELETE' then old else new end;
end $fn$;

drop trigger if exists plan_items_log on public.plan_items;
create trigger plan_items_log after insert or update or delete on public.plan_items
  for each row execute function public.log_item_change();

create or replace function public.log_comment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_item record;
begin
  select place_id, name, at into v_item from public.plan_items where id = new.item_id;
  insert into public.activity (trip_id, actor, action, place_id, label, at)
    values (new.trip_id, new.author, 'comment', v_item.place_id, v_item.name, v_item.at);
  return new;
end $fn$;

drop trigger if exists comments_log on public.comments;
create trigger comments_log after insert on public.comments
  for each row execute function public.log_comment();

alter publication supabase_realtime add table public.activity;
