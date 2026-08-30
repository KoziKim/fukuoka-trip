-- 코멘트가 달리면 notify Edge Function 을 호출해 다른 멤버에게 웹 푸시를 보낸다.
-- 함수는 --no-verify-jwt 로 열려 있고, 대신 x-hook-secret 헤더로 호출자를 확인한다.
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform extensions.net.http_post(
    url     := 'https://ihimaykbattprsjvvwdw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-hook-secret', 'VEv4OVZi4KyB-CAdCJWvbQpK8R66hLKz'
               ),
    body    := jsonb_build_object('comment_id', new.id)
  );
  return new;
end $$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_on_comment();
