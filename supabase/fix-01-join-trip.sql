-- 수정 01 · join_trip 컬럼 이름 충돌
--
-- 증상: 초대코드로 참가할 때 아래 오류가 나면서 참가가 안 된다.
--   42702 column reference "trip_id" is ambiguous
--
-- 원인: on conflict (trip_id, user_id) 의 trip_id 가 RETURNS TABLE 로 선언한
--   출력 컬럼 trip_id 와 이름이 겹쳐, PostgreSQL이 어느 쪽인지 판단하지 못한다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 실행하세요.
--   (이미 schema.sql 을 실행했더라도 이 파일만 따로 실행하면 됩니다.)

create or replace function public.join_trip(p_code text, p_member text)
returns table (trip_id uuid, trip_code text, member_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_trip uuid;
  v_member uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select t.id into v_trip from public.trips t where t.code = upper(trim(p_code));
  if v_trip is null then raise exception 'TRIP_NOT_FOUND'; end if;

  select m.id into v_member from public.members m
    where m.trip_id = v_trip and m.user_id = auth.uid();

  if v_member is null then
    insert into public.members (trip_id, user_id, name)
      values (v_trip, auth.uid(), p_member)
      returning id into v_member;
  else
    update public.members m set name = p_member where m.id = v_member;
  end if;

  return query select v_trip, upper(trim(p_code)), v_member;
end $$;

grant execute on function public.join_trip(text, text) to anon, authenticated;
