# DarkKnight Messenger

پیام‌رسان وب فارسی با تم تاریک فیروزه‌ای.

- **سایت:** https://commander1405.github.io/messanger/
- **فرانت:** HTML / CSS / Vanilla JS (ES Modules) + PWA
- **بک‌اند:** Supabase Auth, Postgres, Realtime, Storage

## نصب محلی

1. `config.js` را از `config.example.js` بسازید و مقادیر Supabase را پر کنید.
2. `AUTH_EDGE_URL` را به Edge Function `auth-username` تنظیم کنید.
3. با یک سرور استاتیک (مثلاً `npx serve .`) باز کنید.

## Migrationهای SQL (به‌ترتیب در SQL Editor)

1. `sql/001_schema.sql`
2. `sql/002_rls.sql`
3. `sql/003_storage.sql`
4. `sql/004_phase2.sql`
5. `sql/005_advanced_chat.sql`
6. `sql/006_forward_search_blocks_invites_reports.sql`
7. `sql/007_group_channel_management.sql` — ویرایش گروه/کانال، نقش‌ها، سنجاق

## Edge Function

```bash
supabase functions deploy auth-username --no-verify-jwt
```

## PWA

- `manifest.webmanifest`
- `sw.js` — فقط کش فایل‌های استاتیک؛ API/Auth کش نمی‌شود
- پیشنهاد نصب از رویداد `beforeinstallprompt`

## امنیت

- رمز فقط در Supabase Auth
- RLS فعال
- Service Role فقط در Edge Function
- کلید خصوصی VAPID در فرانت قرار نگیرد

## قابلیت‌های اصلی

ورود با نام کاربری، گفتگوی خصوصی، گروه، کانال، پیام‌های شخصی، پاسخ/ویرایش/حذف/فوروارد، واکنش، جستجو، آرشیو، بی‌صدا، بلاک، لینک دعوت، گزارش، پیام صوتی، تم روشن/تاریک، نصب PWA.
