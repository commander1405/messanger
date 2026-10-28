# DarkKnight Messenger

پیام‌رسان مدرن فارسی با تم تاریک.

- **فرانت‌اند:** HTML / CSS / Vanilla JS (ES Modules)
- **بک‌اند:** Supabase (Auth, Postgres, Realtime, Storage)
- **دیپلوی:** GitHub Pages → https://commander1405.github.io/messanger/

## احراز هویت (فقط نام کاربری + رمز)

تنها روش ورود/ثبت‌نام: **نام کاربری و رمز عبور**.

- رمز فقط در **Supabase Auth** ذخیره می‌شود (هش‌شده).
- نام کاربری در جدول `profiles` با قید UNIQUE.
- مسیر اصلی: Edge Function `auth-username` تا ایمیل تأیید ارسال نشود و rate-limit ایمیل پیش نیاید.

### تنظیمات ضروری

1. در SQL Editor به ترتیب:
   - `sql/001_schema.sql`
   - `sql/002_rls.sql`
   - `sql/003_storage.sql`
   - `sql/004_phase2.sql`
2. Deploy Edge Function:
   ```bash
   supabase functions deploy auth-username --no-verify-jwt
   ```
3. در `config.js`:
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "your-anon-or-publishable-key",
   AUTH_EDGE_URL: "https://xxxx.supabase.co/functions/v1/auth-username",
   BASE_PATH: "/messanger",
   ```
4. Realtime: جداول `messages` و `typing_status`
5. Auth → Confirm email می‌تواند روشن بماند چون ساخت کاربر از Admin API با `email_confirm: true` انجام می‌شود.

### محدودیت بازیابی رمز

چون کاربر ایمیل واقعی وارد نمی‌کند، **بازیابی رمز از طریق ایمیل در UI وجود ندارد**. برای بازیابی باید از پنل Supabase Auth یا جریان سفارشی آینده استفاده شود.

## امنیت

- RLS روی جداول اصلی
- رمز در profiles ذخیره نمی‌شود
- service_role فقط داخل Edge Function
- پیوست‌ها از طریق Signed URL

## ساختار

```
index.html  config.js  css/  js/  sql/  supabase/functions/auth-username/
```
