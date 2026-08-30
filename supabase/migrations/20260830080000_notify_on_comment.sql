-- 코멘트가 달리면 notify Edge Function 을 호출해 다른 멤버에게 웹 푸시를 보낸다.
-- 함수는 --no-verify-jwt 로 열려 있고, 대신 x-hook-secret 헤더로 호출자를 확인한다.
--
-- 주의: 이 저장소는 공개다. 비밀값은 여기 적지 않고 Vault 에 둔다.
--       실제 헤더 값을 읽어오는 최종 정의는 20260830090000_notify_secret_vault.sql 에 있다.
create extension if not exists pg_net with schema extensions;

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

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_on_comment();
