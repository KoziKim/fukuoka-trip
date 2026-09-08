-- 일정뿐 아니라 맛집·명소(장소)에도 코멘트를 달 수 있게 한다.
-- 장소는 앱 안의 고정 목록이라 서버에 행이 없으므로, item_id 대신 place_id(앱의 장소 id)와
-- 알림·이력에 쓸 이름(target_label)을 함께 저장한다.

alter table public.comments alter column item_id drop not null;
alter table public.comments add column if not exists place_id     text;
alter table public.comments add column if not exists target_label text;

-- 둘 중 하나는 반드시 가리켜야 한다
alter table public.comments drop constraint if exists comments_target_chk;
alter table public.comments add constraint comments_target_chk
  check (item_id is not null or place_id is not null);

create index if not exists comments_place_idx on public.comments(trip_id, place_id, created_at);

-- 이력: 장소 코멘트는 place_comment 로 남긴다
create or replace function public.log_comment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_item record;
begin
  if new.item_id is null then
    insert into public.activity (trip_id, actor, action, place_id, label)
      values (new.trip_id, new.author, 'place_comment', new.place_id, new.target_label);
    return new;
  end if;
  select place_id, name, at into v_item from public.plan_items where id = new.item_id;
  insert into public.activity (trip_id, actor, action, place_id, label, at)
    values (new.trip_id, new.author, 'comment', v_item.place_id, v_item.name, v_item.at);
  return new;
end $fn$;
