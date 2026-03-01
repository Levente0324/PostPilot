-- PostRocket Production Schema (Supabase)
-- Safe to run in a fresh database. For existing DBs, apply as migration chunks.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core user profile table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  stripe_customer_id TEXT UNIQUE,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  plan TEXT NOT NULL DEFAULT 'free',
  monthly_post_limit INTEGER NOT NULL DEFAULT 3,
  ai_options TEXT,
  CONSTRAINT profiles_subscription_status_check
    CHECK (subscription_status IN ('inactive','active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired')),
  CONSTRAINT profiles_plan_check
    CHECK (plan IN ('free','pro','elite')),
  CONSTRAINT profiles_monthly_post_limit_check
    CHECK (monthly_post_limit >= 0)
);

-- Connected social accounts for each user
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  meta_user_id TEXT,
  meta_page_id TEXT,
  instagram_account_id TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  account_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT social_accounts_provider_check CHECK (provider IN ('instagram','facebook')),
  CONSTRAINT social_accounts_unique_provider_per_user UNIQUE (user_id, provider)
);

-- Post data (caption + media references)
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  caption TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT posts_status_check CHECK (status IN ('draft','scheduled','published','failed'))
);

-- Scheduling table for post automation
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  platform TEXT NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'scheduled',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT scheduled_posts_platform_check CHECK (platform IN ('instagram','facebook')),
  CONSTRAINT scheduled_posts_status_check CHECK (status IN ('scheduled','published','failed'))
);

-- Internal audit log for app usage/debugging
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Stripe webhook idempotency + audit
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Migration-safe ALTERs for existing databases
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS monthly_post_limit INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_options TEXT;
ALTER TABLE profiles ALTER COLUMN subscription_status SET DEFAULT 'inactive';
ALTER TABLE profiles ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE profiles ALTER COLUMN monthly_post_limit SET DEFAULT 3;
UPDATE profiles SET subscription_status = COALESCE(subscription_status, 'inactive');
UPDATE profiles SET plan = COALESCE(plan, 'free');
UPDATE profiles SET monthly_post_limit = COALESCE(monthly_post_limit, 3);
ALTER TABLE profiles ALTER COLUMN subscription_status SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN plan SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN monthly_post_limit SET NOT NULL;

ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS meta_user_id TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS meta_page_id TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS instagram_account_id TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE posts ALTER COLUMN status SET DEFAULT 'draft';
UPDATE posts SET status = COALESCE(status, 'draft');
ALTER TABLE posts ALTER COLUMN status SET NOT NULL;

ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS retry_count INTEGER;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE scheduled_posts ALTER COLUMN status SET DEFAULT 'scheduled';
ALTER TABLE scheduled_posts ALTER COLUMN retry_count SET DEFAULT 0;
ALTER TABLE scheduled_posts ALTER COLUMN created_at SET DEFAULT NOW();
UPDATE scheduled_posts SET status = COALESCE(status, 'scheduled');
UPDATE scheduled_posts SET retry_count = COALESCE(retry_count, 0);
UPDATE scheduled_posts SET created_at = COALESCE(created_at, NOW());
ALTER TABLE scheduled_posts ALTER COLUMN status SET NOT NULL;
ALTER TABLE scheduled_posts ALTER COLUMN retry_count SET NOT NULL;
ALTER TABLE scheduled_posts ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_subscription_status_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_subscription_status_check
      CHECK (subscription_status IN ('inactive','active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired'));
  END IF;
END $$;

DO $$
BEGIN
  -- Drop old constraint (only allows free/pro) and recreate with elite
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
  ALTER TABLE profiles
    ADD CONSTRAINT profiles_plan_check
    CHECK (plan IN ('free','pro','elite'));
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_monthly_post_limit_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_monthly_post_limit_check
      CHECK (monthly_post_limit >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_provider_check'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_provider_check
      CHECK (provider IN ('instagram','facebook'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_access_token_encrypted_check'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_access_token_encrypted_check
      CHECK (access_token LIKE 'enc:v1:%')
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_check'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_status_check
      CHECK (status IN ('draft','scheduled','published','failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_posts_platform_check'
  ) THEN
    ALTER TABLE scheduled_posts
      ADD CONSTRAINT scheduled_posts_platform_check
      CHECK (platform IN ('instagram','facebook'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_posts_status_check'
  ) THEN
    ALTER TABLE scheduled_posts
      ADD CONSTRAINT scheduled_posts_status_check
      CHECK (status IN ('scheduled','published','failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_posts_retry_count_check'
  ) THEN
    ALTER TABLE scheduled_posts
      ADD CONSTRAINT scheduled_posts_retry_count_check
      CHECK (retry_count >= 0);
  END IF;
END $$;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_post_id ON scheduled_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_scheduled_for ON scheduled_posts(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_action_created ON usage_logs(user_id, action, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id_unique ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_user_provider_unique ON social_accounts(user_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_webhook_event_id_unique ON stripe_webhook_events(event_id);
-- Used by the cron job to delete usage_logs older than 90 days
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);

-- DB-level guardrails for scheduling safety
CREATE OR REPLACE FUNCTION public.enforce_scheduled_post_constraints()
RETURNS trigger AS $$
DECLARE
  owner_id UUID;
  owner_plan TEXT;
  owner_subscription_status TEXT;
  active_limit INTEGER;
  active_count INTEGER;
  day_start TIMESTAMP WITH TIME ZONE;
  day_end TIMESTAMP WITH TIME ZONE;
BEGIN
  -- only enforce strict rules when resulting row is scheduled
  IF NEW.status IS DISTINCT FROM 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO owner_id FROM posts WHERE id = NEW.post_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Post owner not found for scheduled post.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM social_accounts sa
    WHERE sa.user_id = owner_id
      AND sa.provider = NEW.platform
  ) THEN
    RAISE EXCEPTION 'Cannot schedule % post without connected % account.', NEW.platform, NEW.platform;
  END IF;

  -- prevent scheduling in past and beyond +30 days
  IF NEW.scheduled_for < date_trunc('day', NOW()) THEN
    RAISE EXCEPTION 'Cannot schedule posts in the past.';
  END IF;

  IF NEW.scheduled_for > (date_trunc('day', NOW()) + interval '31 days' - interval '1 second') THEN
    RAISE EXCEPTION 'Cannot schedule posts beyond 30 days.';
  END IF;

  -- enforce max one scheduled post per day per platform per user
  day_start := date_trunc('day', NEW.scheduled_for);
  day_end := day_start + interval '1 day';

  IF EXISTS (
    SELECT 1
    FROM scheduled_posts sp
    JOIN posts p ON p.id = sp.post_id
    WHERE p.user_id = owner_id
      AND sp.status = 'scheduled'
      AND sp.platform = NEW.platform
      AND sp.scheduled_for >= day_start
      AND sp.scheduled_for < day_end
      AND sp.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Only one % post can be scheduled per day.', NEW.platform;
  END IF;

  -- enforce active scheduled limit by plan
  SELECT plan, subscription_status INTO owner_plan, owner_subscription_status
  FROM profiles
  WHERE id = owner_id;

  IF owner_plan = 'elite' AND owner_subscription_status IN ('active','trialing') THEN
    active_limit := 50;
  ELSIF owner_plan = 'pro' AND owner_subscription_status IN ('active','trialing') THEN
    active_limit := 20;
  ELSE
    active_limit := 3;
  END IF;

  SELECT COUNT(*) INTO active_count
  FROM scheduled_posts sp
  JOIN posts p ON p.id = sp.post_id
  WHERE p.user_id = owner_id
    AND sp.status = 'scheduled'
    AND sp.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF active_count + 1 > active_limit THEN
    RAISE EXCEPTION 'Active scheduled post limit reached (%).', active_limit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scheduled_posts_require_connected_platform ON scheduled_posts;
DROP TRIGGER IF EXISTS scheduled_posts_constraints ON scheduled_posts;
CREATE TRIGGER scheduled_posts_constraints
  BEFORE INSERT OR UPDATE OF platform, post_id, scheduled_for, status
  ON scheduled_posts
  FOR EACH ROW
  EXECUTE PROCEDURE public.enforce_scheduled_post_constraints();

-- Row-level security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
-- SECURITY: WITH CHECK prevents privilege escalation even if USING passes.
-- Column-level REVOKE below further blocks writes to billing/plan columns.
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Deny-by-default: revoke ALL update access, then allow only safe columns.
-- Billing/plan columns must only be mutated by the service_role (Stripe webhooks, admin).
-- This column-level restriction applies even when the row-level UPDATE policy succeeds.
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (full_name, ai_options) ON profiles TO authenticated;

-- Social accounts policies
DROP POLICY IF EXISTS "Users can view own social accounts" ON social_accounts;
DROP POLICY IF EXISTS "Users can insert own social accounts" ON social_accounts;
DROP POLICY IF EXISTS "Users can update own social accounts" ON social_accounts;
DROP POLICY IF EXISTS "Users can delete own social accounts" ON social_accounts;
CREATE POLICY "Users can view own social accounts" ON social_accounts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own social accounts" ON social_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own social accounts" ON social_accounts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own social accounts" ON social_accounts
  FOR DELETE USING (auth.uid() = user_id);

-- Deny-by-default: revoke ALL update access on social_accounts.
-- Only account_name is safe for the client to update.
-- access_token, provider, meta_page_id, refresh_token, etc. must only be mutated by service_role.
REVOKE UPDATE ON social_accounts FROM authenticated;
GRANT UPDATE (account_name) ON social_accounts TO authenticated;

-- Posts policies
DROP POLICY IF EXISTS "Users can view own posts" ON posts;
DROP POLICY IF EXISTS "Users can insert own posts" ON posts;
DROP POLICY IF EXISTS "Users can update own posts" ON posts;
DROP POLICY IF EXISTS "Users can delete own posts" ON posts;
CREATE POLICY "Users can view own posts" ON posts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own posts" ON posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON posts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON posts
  FOR DELETE USING (auth.uid() = user_id);

-- Deny-by-default: only caption and image_url are editable by the client (schedule edit path).
-- status and other columns must only be mutated by the service_role (publish job, webhooks).
REVOKE UPDATE ON posts FROM authenticated;
GRANT UPDATE (caption, image_url) ON posts TO authenticated;

-- Scheduled posts policies via parent posts ownership
DROP POLICY IF EXISTS "Users can view own scheduled posts" ON scheduled_posts;
DROP POLICY IF EXISTS "Users can insert own scheduled posts" ON scheduled_posts;
DROP POLICY IF EXISTS "Users can update own scheduled posts" ON scheduled_posts;
DROP POLICY IF EXISTS "Users can delete own scheduled posts" ON scheduled_posts;
CREATE POLICY "Users can view own scheduled posts" ON scheduled_posts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts WHERE posts.id = scheduled_posts.post_id AND posts.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own scheduled posts" ON scheduled_posts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts WHERE posts.id = scheduled_posts.post_id AND posts.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own scheduled posts" ON scheduled_posts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM posts WHERE posts.id = scheduled_posts.post_id AND posts.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own scheduled posts" ON scheduled_posts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM posts WHERE posts.id = scheduled_posts.post_id AND posts.user_id = auth.uid()
    )
  );

-- Deny-by-default: only platform and scheduled_for are editable by the client (schedule edit path).
-- status, retry_count, error_message, published_at must only be mutated by the service_role (cron job).
REVOKE UPDATE ON scheduled_posts FROM authenticated;
GRANT UPDATE (platform, scheduled_for) ON scheduled_posts TO authenticated;

-- Usage logs policies
DROP POLICY IF EXISTS "Users can view own usage logs" ON usage_logs;
DROP POLICY IF EXISTS "Users can insert own usage logs" ON usage_logs;
CREATE POLICY "Users can view own usage logs" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own usage logs" ON usage_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Stripe webhook events should only be writable/readable by service role (deny regular users)
DROP POLICY IF EXISTS "No direct access to stripe_webhook_events" ON stripe_webhook_events;
CREATE POLICY "No direct access to stripe_webhook_events" ON stripe_webhook_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Storage policies for uploaded media in bucket: post-media
-- Requires a bucket named post-media.
-- Users can upload/delete/select only inside post-media/<auth.uid()>/...

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'post-media' );

DROP POLICY IF EXISTS "Authenticated users can upload media" ON storage.objects;
CREATE POLICY "Authenticated users can upload media"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'post-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Authenticated users can view media" ON storage.objects;
CREATE POLICY "Authenticated users can view media"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'post-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
CREATE POLICY "Users can delete their own media"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'post-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
