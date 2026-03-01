# PostRocket — Pre-Deployment Testing Checklist

---

## 1. Environment & Build

| #    | Test                                         | What to verify                                                                                          | How                                                        |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1.1  | **TypeScript compiles**                      | Zero errors                                                                                             | `npx tsc --noEmit`                                         |
| 1.2  | **ESLint passes**                            | Zero errors                                                                                             | `npx eslint .`                                             |
| 1.3  | **Production build succeeds**                | `next build` exits 0, no warnings about missing env vars in build output                                | `npm run build`                                            |
| 1.4  | **All env vars are set in Vercel**           | Every var from `.env.example` has a production value in Vercel → Settings → Environment Variables       | Manually check Vercel dashboard                            |
| 1.5  | **`APP_URL` is production**                  | Must be `https://postrocket.app` (no trailing slash)                                                    | Check Vercel env                                           |
| 1.6  | **Stripe keys are LIVE mode**                | `STRIPE_SECRET_KEY` starts with `sk_live_`, `STRIPE_WEBHOOK_SECRET` is from the **live** endpoint       | Check Vercel env + Stripe dashboard                        |
| 1.7  | **Stripe Price IDs are LIVE**                | `STRIPE_PRO_PRICE_ID` and `STRIPE_ELITE_PRICE_ID` are from LIVE mode products                           | Compare with Stripe dashboard → Products                   |
| 1.8  | **Meta App is in Live Mode**                 | Not "Development" — go to Meta Developer Console → App Review → confirm "Live"                          | [developers.facebook.com](https://developers.facebook.com) |
| 1.9  | **`META_TOKEN_ENCRYPTION_KEY` is permanent** | This key cannot change after launch — changing it makes all stored tokens undecryptable. Write it down. | Confirm you have a backup                                  |
| 1.10 | **Domain configured**                        | `postrocket.app` DNS points to Vercel, SSL cert valid                                                   | `curl -I https://postrocket.app`                           |

---

## 2. Database (Supabase)

| #    | Test                                   | What to verify                                                                                                                                                                                                              | How                                                                                                                                                                                                                     |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | **All tables exist**                   | `profiles`, `social_accounts`, `posts`, `scheduled_posts`, `usage_logs`, `stripe_webhook_events`                                                                                                                            | Supabase → Table Editor                                                                                                                                                                                                 |
| 2.2  | **RLS enabled on all 6 tables**        | Each table shows "RLS Enabled"                                                                                                                                                                                              | Supabase → Authentication → Policies, or `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'`                                                                                                       |
| 2.3  | **RLS policies exist**                 | Every table has SELECT/INSERT/UPDATE/DELETE policies for `authenticated` (and service_role bypasses)                                                                                                                        | Supabase → Policies tab, inspect each table                                                                                                                                                                             |
| 2.4  | **Column-level REVOKE active**         | `REVOKE UPDATE` has been run on `profiles`, `social_accounts`, `posts`, `scheduled_posts`; then `GRANT UPDATE` only on allowed columns                                                                                      | Run: `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges WHERE table_name='profiles' AND grantee='authenticated' AND privilege_type='UPDATE';` — only expected columns should appear |
| 2.5  | **CHECK constraints exist**            | `profiles.plan` only accepts `free/pro/elite`; `profiles.subscription_status` only accepts the 8 valid values; `scheduled_posts.platform` only `instagram/facebook`; `posts.status` only `draft/scheduled/published/failed` | `SELECT * FROM information_schema.check_constraints WHERE constraint_schema='public';`                                                                                                                                  |
| 2.6  | **UNIQUE constraints**                 | `social_accounts(user_id, provider)` is unique; `stripe_webhook_events.event_id` is unique; `profiles.email` is unique                                                                                                      | `\d social_accounts` etc. in SQL editor                                                                                                                                                                                 |
| 2.7  | **DB trigger exists**                  | `enforce_scheduled_post_constraints` is active on `scheduled_posts`                                                                                                                                                         | `SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema='public';`                                                                                                               |
| 2.8  | **`post-media` storage bucket exists** | Bucket is public, has RLS policies allowing only `user_id`-scoped paths                                                                                                                                                     | Supabase → Storage → Buckets                                                                                                                                                                                            |
| 2.9  | **Profile auto-creation**              | New auth user → `profiles` row is created automatically (DB trigger or Supabase hook?)                                                                                                                                      | Sign up with a new test email, check if `profiles` row exists immediately                                                                                                                                               |
| 2.10 | **Cascade deletes work**               | Delete a user → all their `posts`, `scheduled_posts`, `social_accounts`, `usage_logs` are also deleted                                                                                                                      | Test with a throwaway account in Supabase Auth → delete user → verify related rows gone                                                                                                                                 |

---

## 3. Authentication

| #   | Test                                           | What to verify                                                                                             | How                                                  |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 3.1 | **Sign up happy path**                         | New email + password → receives confirmation email → clicks link → ends up logged in on `/dashboard/posts` | Use a real email you control                         |
| 3.2 | **Login happy path**                           | Existing account → login form → lands on `/dashboard/posts`                                                | Standard login                                       |
| 3.3 | **Wrong password**                             | Shows Hungarian error, does NOT reveal whether email exists                                                | Try wrong password                                   |
| 3.4 | **Non-existent email**                         | Same generic error, no info leak                                                                           | Try login with random email                          |
| 3.5 | **Logged-in user visits `/login`**             | Auto-redirects to `/dashboard/posts`                                                                       | Navigate directly to `/login` while logged in        |
| 3.6 | **Unauthenticated user visits `/dashboard/*`** | Redirected to `/login`                                                                                     | Open `/dashboard/posts` in incognito                 |
| 3.7 | **Session expiry**                             | After clearing cookies, next dashboard request → redirect to `/login`                                      | Delete cookies in DevTools, refresh                  |
| 3.8 | **`/auth/callback` works**                     | This is the Supabase email confirmation callback. Confirm email link lands correctly.                      | Sign up → click email link → should end up logged in |
| 3.9 | **Logout works**                               | LogoutButton clears session, redirects to `/login`                                                         | Click logout                                         |

---

## 4. Subscription & Billing (Stripe)

| #    | Test                                                 | What to verify                                                                                                                                                                                                                        | How                                                                                                                                 |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | **Free user sees limits**                            | Dashboard shows "3 / 3 aktív poszt", no AI access                                                                                                                                                                                     | Log in as fresh user                                                                                                                |
| 4.2  | **Pro checkout flow**                                | Click upgrade to Pro → Stripe Checkout → use test card `4242 4242 4242 4242` → redirected back to `/dashboard/account-billing?checkout=success` → profile now shows `plan=pro`, `subscription_status=active`, `monthly_post_limit=20` | Use Stripe **test mode** first, then verify with live mode using a real card and immediately cancel                                 |
| 4.3  | **Elite checkout flow**                              | Same as Pro but for Elite → verify `plan=elite`, `monthly_post_limit=50`                                                                                                                                                              | Same process, select Elite                                                                                                          |
| 4.4  | **`syncStripeCheckoutSession` runs on success page** | After returning from Stripe, the `session_id` query param triggers a sync that writes billing data via admin client. Check Supabase `profiles` table.                                                                                 | Check profile row immediately after checkout redirect                                                                               |
| 4.5  | **Webhook: `checkout.session.completed`**            | Webhook arrives → profile updated → not processed twice (check `stripe_webhook_events` table for the event ID)                                                                                                                        | Stripe dashboard → Webhooks → check recent events delivery status                                                                   |
| 4.6  | **Webhook: `customer.subscription.updated`**         | Changing plan (pro→elite or downgrade) updates `profiles` correctly                                                                                                                                                                   | Use Stripe portal to switch plans                                                                                                   |
| 4.7  | **Webhook: `customer.subscription.deleted`**         | Canceling subscription → profile reverts to `plan=free`, `monthly_post_limit=3`, `subscription_status=inactive`, and all `scheduled` posts are deleted                                                                                | Cancel via Stripe portal, then check DB                                                                                             |
| 4.8  | **Webhook: `invoice.paid`**                          | Recurring payment → status stays `active`                                                                                                                                                                                             | Let a test subscription renew (or replay event via Stripe CLI)                                                                      |
| 4.9  | **Webhook: `invoice.payment_failed`**                | Failed payment → `subscription_status=past_due`                                                                                                                                                                                       | Stripe CLI: `stripe trigger invoice.payment_failed` or set up a card that declines                                                  |
| 4.10 | **Webhook idempotency**                              | Sending the same event twice → second is silently skipped                                                                                                                                                                             | Stripe CLI: replay event, check `stripe_webhook_events` table                                                                       |
| 4.11 | **Stripe portal works**                              | Paid user → "Kezelés" button → opens Stripe Customer Portal → can cancel/change card/switch plan                                                                                                                                      | Click portal button                                                                                                                 |
| 4.12 | **Free user can't access portal**                    | `createStripePortalSession` redirects free users to `/dashboard/account-billing`                                                                                                                                                      | Call the portal action as a free user                                                                                               |
| 4.13 | **Stale customer ID handling**                       | If `stripe_customer_id` in DB is from test mode but keys are now live → system creates a new customer instead of crashing                                                                                                             | Hardest to test: temporarily set a fake `stripe_customer_id` in DB (`cus_test_fake`), then try checkout. Should recover gracefully. |
| 4.14 | **`resolvePlanFromPriceId` fallback**                | Unknown price ID → resolves to `free` (fail closed)                                                                                                                                                                                   | Unit test or inspect code — this is already handled in `lib/subscription.ts`                                                        |

### How to test Stripe webhooks locally

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# In another terminal, trigger test events:
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
```

---

## 5. Meta OAuth (Facebook + Instagram Connections)

| #    | Test                              | What to verify                                                                                                                                                                                                                                        | How                                                                                                                   |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 5.1  | **Connect Facebook**              | Click connect → Facebook OAuth popup → grant permissions → redirected to `/dashboard/account-billing?meta=connected` → `social_accounts` row created with `provider=facebook`, encrypted `access_token`, `meta_page_id`, `account_name`, `expires_at` | Click "Facebook csatlakoztatása" button                                                                               |
| 5.2  | **Connect Instagram**             | Same flow but for Instagram → verifies page has `instagram_business_account` → stores `instagram_account_id`                                                                                                                                          | Click "Instagram csatlakoztatása" button. **Requires** your Facebook Page to have a linked Instagram Business account |
| 5.3  | **No Instagram Business account** | If page has no IG business account → redirects with `meta_error=no_instagram_business`                                                                                                                                                                | Test with a page that has no linked IG                                                                                |
| 5.4  | **No pages found**                | If user has no Facebook pages → redirects with `meta_error=no_pages`                                                                                                                                                                                  | Use a Facebook account with no Pages                                                                                  |
| 5.5  | **OAuth state mismatch**          | Tampering with callback URL `state` param → rejected with `meta_error=oauth_state`                                                                                                                                                                    | Manually alter the `state` query param in the callback URL                                                            |
| 5.6  | **Token encryption**              | Check `social_accounts.access_token` in DB → must start with `enc:v1:`, NOT be a plain Meta token                                                                                                                                                     | Supabase → Table Editor → social_accounts                                                                             |
| 5.7  | **Token decryption round-trip**   | The cron job can decrypt and publish with the stored token                                                                                                                                                                                            | See section 7 (Cron / Publishing)                                                                                     |
| 5.8  | **Disconnect Facebook**           | Click disconnect → `social_accounts` row deleted for `provider=facebook`                                                                                                                                                                              | Click disconnect button, verify DB                                                                                    |
| 5.9  | **Disconnect Instagram**          | Same for Instagram                                                                                                                                                                                                                                    | Click disconnect button                                                                                               |
| 5.10 | **Re-connect replaces old**       | Connecting same provider again → old row deleted, new row inserted (not duplicate)                                                                                                                                                                    | Connect, then connect again, check only 1 row per provider                                                            |
| 5.11 | **`expires_at` is set**           | After connecting, `expires_at` should be ~60 days in the future                                                                                                                                                                                       | Check DB value                                                                                                        |
| 5.12 | **Token expiry warning (red)**    | If `expires_at` is in the past → red banner on `/dashboard/posts` and red badge on `/dashboard/account-billing`                                                                                                                                       | Manually set `expires_at` to a past date in DB, then reload pages                                                     |
| 5.13 | **Token expiry warning (amber)**  | If `expires_at` is within 7 days → amber warning                                                                                                                                                                                                      | Manually set `expires_at` to 5 days from now in DB                                                                    |
| 5.14 | **Rate limit on connect**         | More than 10 connect attempts per minute → redirects with `meta_error=rate_limited`                                                                                                                                                                   | Verify by checking the code logic or inserting 11 `meta_connect_attempt` usage_logs                                   |

### Requirements for testing Meta flow

- A Facebook account with at least one **Facebook Page** you manage
- For Instagram: that Page must have a linked **Instagram Business or Creator account**
- Meta App must have these permissions approved (or you're a test user): `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`
- In Development mode, only app administrators/testers can authorize

---

## 6. Post Scheduling

| #    | Test                                                    | What to verify                                                                                                           | How                                           |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 6.1  | **Schedule Facebook text post**                         | Select Facebook, type text, pick future date/time → 201 → `posts` row (status=scheduled) + `scheduled_posts` row created | Use the PostScheduler UI                      |
| 6.2  | **Schedule Facebook image post**                        | Upload 1 image → schedule → both `posts.image_url` (JSON array) and `scheduled_posts` created                            | Upload via UI, schedule                       |
| 6.3  | **Schedule Facebook multi-image**                       | Upload 2-10 images → schedule → `posts.image_url` array contains all URLs                                                | Upload multiple, schedule                     |
| 6.4  | **Schedule Instagram single image**                     | Requires at least 1 image → schedule                                                                                     | Standard IG post                              |
| 6.5  | **Schedule Instagram carousel**                         | 2+ images → schedule → stored correctly                                                                                  | Upload 2+, schedule for IG                    |
| 6.6  | **Instagram without image fails**                       | Try scheduling IG post with no images → error "legalább egy kép szükséges"                                               | Remove all images, try to schedule IG         |
| 6.7  | **Facebook without text or image fails**                | Empty caption + no images → error                                                                                        | Clear everything, try schedule for FB         |
| 6.8  | **Past time rejected**                                  | Pick a time that already passed today → error "Múltbeli időpontra nem ütemezhetsz"                                       | Set time to 1 hour ago                        |
| 6.9  | **>30 days future rejected**                            | Pick a date >30 days out → error                                                                                         | Pick date 31+ days away                       |
| 6.10 | **Duplicate same-day same-platform blocked**            | Schedule FB for March 5, then try scheduling another FB for March 5 → 409 conflict                                       | Schedule two for same day/platform            |
| 6.11 | **Edit existing post**                                  | Edit an already-scheduled post (change text, images, time) → updates both `posts` and `scheduled_posts` rows             | Click edit on a scheduled post in calendar    |
| 6.12 | **Edit doesn't trigger duplicate check against itself** | Editing a post for the same day/platform it was already on → should succeed (query excludes `editId`)                    | Edit without changing the date                |
| 6.13 | **Delete scheduled post**                               | DELETE `/api/schedule/{id}` → both `scheduled_posts` and parent `posts` rows deleted                                     | Click delete button on a scheduled post       |
| 6.14 | **Delete non-existent/other-user post**                 | Returns 404, no data leak                                                                                                | Hardcode a random UUID in the URL             |
| 6.15 | **Free tier limit (3)**                                 | Schedule 3 posts → 4th is rejected with limit error                                                                      | Schedule 3, try 4th                           |
| 6.16 | **Pro tier limit (20)**                                 | With pro plan, verify limit is 20                                                                                        | Check `getPostLimit()` logic                  |
| 6.17 | **Elite tier limit (50)**                               | With elite plan, verify limit is 50                                                                                      | Check `getPostLimit()` logic                  |
| 6.18 | **Platform not connected**                              | Schedule for Instagram when only Facebook is connected → error "Csatlakoztasd..."                                        | Disconnect IG, try to schedule IG post        |
| 6.19 | **Rate limiting**                                       | >30 schedule attempts per minute → 429                                                                                   | Rapid-fire API calls (use curl/Postman loop)  |
| 6.20 | **Invalid UUID in delete**                              | `DELETE /api/schedule/not-a-uuid` → 404 (not 500)                                                                        | `curl -X DELETE .../api/schedule/hello`       |
| 6.21 | **Malformed JSON body**                                 | POST /api/schedule with invalid JSON → 400                                                                               | `curl -X POST -d "not json" .../api/schedule` |

---

## 7. Cron Job / Auto-Publishing

| #    | Test                                  | What to verify                                                                                                                                                   | How                                                                                                |
| ---- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 7.1  | **Auth works**                        | POST with correct `x-job-key` → 200; wrong key → 401; missing key → 401                                                                                          | `curl -X POST -H "x-job-key: YOUR_SECRET" https://postrocket.app/api/jobs/publish-scheduled`       |
| 7.2  | **Non-POST rejected**                 | GET request → 405 (Next.js default)                                                                                                                              | `curl https://postrocket.app/api/jobs/publish-scheduled`                                           |
| 7.3  | **Facebook text-only publish**        | Schedule FB text post for now → cron fires → post appears on Facebook Page → `scheduled_posts.status=published`, `posts.status=published`                        | Schedule for 1 minute from now, wait for cron                                                      |
| 7.4  | **Facebook single image publish**     | Same with 1 image → appears on FB with photo                                                                                                                     | Schedule, wait                                                                                     |
| 7.5  | **Facebook multi-image publish**      | 2+ images → appears as multi-photo post on FB                                                                                                                    | Schedule, wait                                                                                     |
| 7.6  | **Instagram single publish**          | 1 image + caption → appears on IG                                                                                                                                | Schedule, wait                                                                                     |
| 7.7  | **Instagram carousel publish**        | 2+ images → carousel on IG                                                                                                                                       | Schedule, wait                                                                                     |
| 7.8  | **Image cleanup after publish**       | After successful publish, images deleted from `post-media` bucket                                                                                                | Check Supabase Storage → the `userId/...` files should be gone                                     |
| 7.9  | **Retry on failure**                  | If Meta API returns an error → `retry_count` increments, post stays `scheduled`                                                                                  | Temporarily disconnect account in DB (set fake encrypted token), let cron run, check `retry_count` |
| 7.10 | **Permanent failure after 3 retries** | After 3 failed attempts → `status=failed`, `error_message` filled                                                                                                | Let it fail 3 times                                                                                |
| 7.11 | **Token decryption failure**          | If token is corrupted in DB → error message says "Re-connect the account", fails gracefully                                                                      | Corrupt the `access_token` column manually                                                         |
| 7.12 | **Missing page ID**                   | `meta_page_id` is null and `refresh_token` metadata doesn't have it → clear error                                                                                | Null out `meta_page_id` in DB                                                                      |
| 7.13 | **Usage logs cleanup**                | After cron run, `usage_logs` rows older than 90 days are deleted                                                                                                 | Insert a test row with `created_at = NOW() - INTERVAL '91 days'`, run cron, verify it's gone       |
| 7.14 | **Batch limit (25)**                  | If 30 posts are due → only first 25 processed per cron tick (next tick gets the rest)                                                                            | Schedule 30 posts for the past, trigger cron, verify 25 processed                                  |
| 7.15 | **Instagram container polling**       | Posts with large images take time for Meta to process — verify `waitForInstagramContainer` doesn't time out on normal images                                     | Upload a large (10MB) image, schedule for IG                                                       |
| 7.16 | **cron-job.org is configured**        | Verify on cron-job.org: URL = `https://postrocket.app/api/jobs/publish-scheduled`, Method = POST, Header `x-job-key` = correct secret, Schedule = every 1 minute | Log in to cron-job.org and verify                                                                  |

### How to test publishing end-to-end

1. Connect a real Facebook Page + Instagram Business account
2. Schedule a post for 1-2 minutes in the future
3. Wait for cron to fire (or manually trigger: `curl -X POST -H "x-job-key: YOUR_SECRET" https://postrocket.app/api/jobs/publish-scheduled`)
4. Check the actual Facebook Page / Instagram profile — the post should appear
5. Check Supabase: `scheduled_posts.status = 'published'`, `posts.status = 'published'`
6. Check Storage: images should be deleted from `post-media` bucket

---

## 8. File Uploads

| #    | Test                                | What to verify                                                         | How                                                                        |
| ---- | ----------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 8.1  | **Upload JPEG**                     | Returns public URL, file exists in `post-media/{userId}/...`           | Upload via PostScheduler                                                   |
| 8.2  | **Upload PNG**                      | Same                                                                   | Upload PNG                                                                 |
| 8.3  | **Upload WebP**                     | Same                                                                   | Upload WebP                                                                |
| 8.4  | **Upload GIF**                      | Same                                                                   | Upload GIF                                                                 |
| 8.5  | **Upload HEIC**                     | Same (common on iPhone)                                                | Upload HEIC from iPhone photo                                              |
| 8.6  | **Reject non-image**                | Upload `.pdf`, `.txt`, `.exe` → rejected with unsupported format error | Rename a text file to `.jpg` and upload — magic byte validation catches it |
| 8.7  | **Reject >15MB**                    | Large file → error "túl nagy"                                          | Upload a 20MB image                                                        |
| 8.8  | **Reject >10 files**                | 11+ files in one request → error                                       | Select 11 files                                                            |
| 8.9  | **Magic byte validation**           | Rename a `.txt` to `.jpg` → rejected even though MIME type is faked    | Try it                                                                     |
| 8.10 | **Delete own images**               | DELETE `/api/uploads?url=...` with your own file → 200, file removed   | Delete via UI or curl                                                      |
| 8.11 | **Can't delete other user's files** | Try deleting a file from a different `user_id/` path → 403             | Forge a URL with another user's ID path                                    |
| 8.12 | **Rate limit**                      | >20 upload attempts per minute → 429                                   | Rapid curl loop                                                            |
| 8.13 | **Invalid URL in delete**           | URL that doesn't parse correctly → 400                                 | `curl -X DELETE ".../api/uploads?url=not-a-real-url"`                      |

---

## 9. AI Post Generation

| #   | Test                                       | What to verify                                                           | How                                                      |
| --- | ------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| 9.1 | **Pro/Elite user can generate**            | Submit prompt → returns AI-generated Hungarian text                      | Log in as Pro, open AI generation                        |
| 9.2 | **Free user blocked**                      | Returns 403 "csak Pro csomagban érhető el"                               | Log in as Free, try generate                             |
| 9.3 | **Empty prompt rejected**                  | 400 error                                                                | Submit empty prompt                                      |
| 9.4 | **Prompt truncated at 2000 chars**         | Submitting a 5000-char prompt doesn't crash — gets truncated             | Send very long prompt                                    |
| 9.5 | **`ai_options` business context included** | If user set AI options, the generated text reflects the business context | Set AI options in `/dashboard/ai-options`, then generate |
| 9.6 | **Tone selection works**                   | Different tones produce noticeably different output styles               | Try "Barátságos" vs "Szakmai"                            |
| 9.7 | **Rate limit (10/min)**                    | 11th request in a minute → 429                                           | Rapid-fire API calls                                     |
| 9.8 | **Missing GEMINI_API_KEY**                 | If key is unset → 503 "átmenetileg nem elérhető" (graceful, not 500)     | Only testable by temporarily removing the env var        |

---

## 10. Dashboard Pages & UI

| #    | Test                                             | What to verify                                                           | How                                     |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| 10.1 | **`/dashboard` redirects to `/dashboard/posts`** | No 404                                                                   | Navigate to `/dashboard`                |
| 10.2 | **Calendar renders**                             | Shows current month, scheduled posts appear on correct dates             | Visual inspection                       |
| 10.3 | **Post counter correct**                         | "X / Y aktív poszt" matches actual `scheduled` count and plan limit      | Compare with DB                         |
| 10.4 | **`/dashboard/account-billing`**                 | Shows current plan name, upgrade/manage buttons, connected accounts list | Navigate to page                        |
| 10.5 | **`/dashboard/ai-options`**                      | Can save business context (`ai_options` column updates)                  | Save text, reload, verify persisted     |
| 10.6 | **Token expiry badges**                          | Connected accounts show red/amber badges per token status                | Check with manipulated `expires_at`     |
| 10.7 | **`/dashboard/posts/new` redirects**             | Goes to `/dashboard/posts` (legacy route)                                | Navigate directly                       |
| 10.8 | **Mobile responsive**                            | Sidebar collapses, calendar usable on small screens, buttons accessible  | Chrome DevTools → toggle device toolbar |
| 10.9 | **Sidebar navigation**                           | All links work, active state highlights correctly                        | Click each sidebar link                 |

---

## 11. Security Headers & SEO

| #     | Test                            | What to verify                                                                                 | How                                                                                  |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 11.1  | **CSP header**                  | Content-Security-Policy is present on responses                                                | `curl -I https://postrocket.app`                                                     |
| 11.2  | **HSTS**                        | `Strict-Transport-Security` header present (production only)                                   | Same curl                                                                            |
| 11.3  | **X-Frame-Options**             | `DENY` — prevents clickjacking                                                                 | Same curl                                                                            |
| 11.4  | **X-Content-Type-Options**      | `nosniff`                                                                                      | Same curl                                                                            |
| 11.5  | **Referrer-Policy**             | Present                                                                                        | Same curl                                                                            |
| 11.6  | **`/sitemap.xml` resolves**     | Returns valid XML with `https://postrocket.app` and `https://postrocket.app/login`             | `curl https://postrocket.app/sitemap.xml`                                            |
| 11.7  | **`/robots.txt` resolves**      | Disallows `/api/` and `/dashboard/`, allows rest, lists sitemap URL                            | `curl https://postrocket.app/robots.txt`                                             |
| 11.8  | **OG tags render**              | Share `https://postrocket.app` on Facebook/Twitter → proper image, title, description          | Use [opengraph.xyz](https://www.opengraph.xyz/) or Facebook's Sharing Debugger       |
| 11.9  | **Favicon present**             | No broken icon in browser tab                                                                  | Check browser tab                                                                    |
| 11.10 | **No secrets in client bundle** | `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, etc. are NOT in the JS served to the browser | Open DevTools → Sources → search for `sk_live`, `service_role` in all loaded scripts |

---

## 12. Edge Cases & Failure Modes

| #     | Test                                            | What to verify                                                                                                 | How                                                                                |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 12.1  | **Concurrent scheduling**                       | Two tabs schedule the same day/platform simultaneously → one succeeds, one gets 409 conflict                   | Open two tabs, schedule at exact same time                                         |
| 12.2  | **Network timeout from Meta API**               | Cron doesn't hang forever — 15s timeout on all Meta calls                                                      | Hard to test naturally; `fetchWithTimeout` in `lib/meta.ts` handles this           |
| 12.3  | **Stripe is unavailable**                       | Checkout/portal attempts → graceful error, not 500 with stack trace                                            | Hard to simulate; code uses try/catch                                              |
| 12.4  | **Supabase is unreachable**                     | Pages show error state, not crash                                                                              | Hard to simulate                                                                   |
| 12.5  | **User deletes their account in Supabase Auth** | Cascade should clean up all `profiles`, `posts`, `social_accounts`, etc.                                       | Delete via Supabase dashboard → verify all related tables are clean                |
| 12.6  | **Subscription cancelled mid-cycle**            | Posts already scheduled → on webhook `customer.subscription.deleted`, all scheduled posts deleted, plan → free | Cancel subscription, check that scheduled posts are cleaned                        |
| 12.7  | **Unicode captions**                            | Hungarian special chars (á, é, ő, ű, etc.) and emojis survive round-trip: DB → Meta API → published post       | Schedule a post with `"Árvíztűrő tükörfúrógép 🎉🚀"`, check it publishes correctly |
| 12.8  | **Empty caption**                               | Facebook allows text-only or image-only. Verify blank caption + image works.                                   | Schedule FB post with image, no text                                               |
| 12.9  | **Max caption length**                          | 63,206 chars (Meta FB limit). Verify a huge caption saves and publishes.                                       | Paste a very long text (use a script to generate 60K+ chars)                       |
| 12.10 | **Multiple social accounts**                    | User has both FB and IG connected → can schedule independently for each                                        | Connect both, schedule for each                                                    |

---

## 13. Performance & Production Readiness

| #    | Test                            | What to verify                                                                               | How                                                                          |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 13.1 | **Lighthouse score**            | Performance ≥85, Accessibility ≥90, Best Practices ≥90, SEO ≥95 on landing page              | Chrome DevTools → Lighthouse                                                 |
| 13.2 | **Landing page loads <3s**      | No massive blocking resources                                                                | Network tab, or WebPageTest.org                                              |
| 13.3 | **No console errors**           | No red errors in DevTools console on any page                                                | Browse through all pages with console open                                   |
| 13.4 | **`vercel.json` is clean**      | Empty `{}` — no stale cron config                                                            | Double check after deploy                                                    |
| 13.5 | **Supabase connection pooling** | Verify you're using Supabase's connection pooler URL in production if needed                 | Check `NEXT_PUBLIC_SUPABASE_URL` — if pooling is needed for high concurrency |
| 13.6 | **Error monitoring**            | Set up Vercel's built-in logging or connect Sentry/LogRocket for production error visibility | Vercel → Project → Logs + consider adding error tracking                     |

---

## Tools You Need

| Tool                          | Purpose                                                      | Link                                                                               |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Stripe CLI**                | Test webhooks locally                                        | `brew install stripe/stripe-cli/stripe`                                            |
| **Stripe Dashboard**          | Verify products, prices, webhook endpoints, event deliveries | [dashboard.stripe.com](https://dashboard.stripe.com)                               |
| **Meta Developer Console**    | App status, permissions, test users                          | [developers.facebook.com](https://developers.facebook.com)                         |
| **Supabase Dashboard**        | Tables, RLS policies, SQL editor, storage, auth              | Your project URL                                                                   |
| **cron-job.org**              | Cron job configuration                                       | [cron-job.org](https://cron-job.org)                                               |
| **Facebook Sharing Debugger** | Test OG tags                                                 | [developers.facebook.com/tools/debug](https://developers.facebook.com/tools/debug) |
| **opengraph.xyz**             | Preview OG/meta tags                                         | [opengraph.xyz](https://www.opengraph.xyz/)                                        |

---

## Quick Smoke Test Order (test these first after deploying)

1. ✅ Landing page loads → correct content, no errors
2. ✅ Sign up with real email → confirm email → arrive at dashboard
3. ✅ Connect Facebook page → token stored encrypted
4. ✅ Schedule a Facebook text post for 2 minutes from now
5. ✅ Wait for cron → check post appeared on Facebook
6. ✅ Upgrade to Pro via Stripe → verify profile updated
7. ✅ Generate an AI post → verify it works
8. ✅ Cancel subscription → verify downgrade + scheduled posts cleared
