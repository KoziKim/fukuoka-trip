-- 여행에서 실제로 빠져나갈 수 있게 한다.
--
-- 지금까지 '나가기'는 이 기기의 접속만 끊었고 members 행은 그대로 남아,
-- 참여자 명단에 시험 삼아 들어갔던 이름까지 계속 보였다.
-- members 에 삭제 정책이 아예 없어서 아무도 뺄 수 없는 상태였다.
--
-- 같은 여행의 멤버라면 서로 뺄 수 있게 한다. 몇 명이 함께 쓰는 여행이므로
-- 잘못 들어온 이름을 정리할 수 있는 편이 낫다.
-- 마지막 한 명이 나가도 여행 자체는 남긴다. 초대코드로 다시 들어올 수 있고,
-- join_trip 은 security definer 라 RLS 와 무관하게 코드로 찾아낸다.

drop policy if exists members_leave on public.members;
create policy members_leave on public.members
  for delete using (public.is_member(trip_id));
