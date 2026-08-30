-- 코멘트 작성이 400 으로 실패하던 문제 수정
--
--   0A000 cross-database references are not implemented: extensions.net.http_post
--
-- pg_net 을 extensions 스키마에 설치해도 함수는 자체 net 스키마에 생긴다.
-- extensions.net.http_post 는 "데이터베이스.스키마.함수" 로 해석돼 오류가 났고,
-- 트리거가 실패하니 코멘트 INSERT 자체가 롤백됐다.
--
-- 두 가지를 고친다.
--  1) net.http_post 로 올바르게 호출한다.
--  2) 알림 전송이 어떤 이유로 실패하더라도 코멘트 작성은 성공하게 한다.
--     알림은 부가 기능이므로 본 동작을 막아서는 안 된다.

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'notify_hook_secret';

    perform net.http_post(
      url     := 'https://ihimaykbattprsjvvwdw.supabase.co/functions/v1/notify',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-hook-secret', coalesce(v_secret, '')
                 ),
      body    := jsonb_build_object('comment_id', new.id)
    );
  exception when others then
    -- 알림 실패는 삼킨다. 코멘트는 저장돼야 한다.
    raise warning 'notify_on_comment failed: %', sqlerrm;
  end;
  return new;
end $fn$;
