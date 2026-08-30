-- 알림 훅 비밀값을 Vault 로 옮긴다.
--
-- 이 저장소는 공개이므로 비밀값 자체는 여기 적지 않는다.
-- 새 프로젝트에 적용할 때는 아래를 한 번 실행해 값을 넣어라 (SQL Editor 등에서):
--
--   select vault.create_secret('<무작위 문자열>', 'notify_hook_secret');
--
-- 그리고 Edge Function 쪽에도 같은 값을 넣는다:
--
--   supabase secrets set NOTIFY_HOOK_SECRET='<같은 값>'
--
-- 값이 어긋나면 함수가 403 을 돌려주고 알림이 발송되지 않는다.
create extension if not exists supabase_vault with schema vault;

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notify_hook_secret';

  perform extensions.net.http_post(
    url     := 'https://ihimaykbattprsjvvwdw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-hook-secret', coalesce(v_secret, '')
               ),
    body    := jsonb_build_object('comment_id', new.id)
  );
  return new;
end $fn$;
