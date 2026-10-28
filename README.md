# DarkKnight Messenger

پیام‌رسان مدرن با رابط تاریک، راست‌چین و پشتیبانی فارسی.

- **فرانت‌اند:** HTML / CSS / Vanilla JS (ES Modules)
- **بک‌اند:** Supabase (Auth, Postgres, Realtime, Storage)
- **دیپلوی:** GitHub Pages

## آدرس‌ها

- مخزن: https://github.com/commander1405/messanger
- GitHub Pages (پس از فعال‌سازی Actions): https://commander1405.github.io/messanger/

## راه‌اندازی

### 1) Supabase

1. پروژه در supabase.com بسازید.
2. در SQL Editor به ترتیب اجرا کنید:
   - `sql/001_schema.sql`
   - `sql/002_rls.sql`
   - `sql/003_storage.sql`
3. Authentication → Providers: Phone (با SMS Provider) و در صورت نیاز Email برای توسعه
4. Authentication → URL Configuration:
   - Site URL: `https://commander1405.github.io/messanger/`
   - Redirect: همان آدرس
5. Database → Replication: جداول `messages` و `typing_status` برای Realtime
6. Settings → API: Project URL و anon key

### 2) config.js

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
BASE_PATH: "/messanger",
```

**هرگز service_role را در فرانت یا گیت قرار ندهید.**

### 3) GitHub Pages

Settings → Pages → Source: **GitHub Actions**  
بعد از push روی `main`، workflow دیپلوی اجرا می‌شود.

## قابلیت‌ها

| قابلیت | وضعیت |
|--------|--------|
| تلفن + OTP | پیاده — نیاز SMS Provider |
| ایمیل توسعه | پیاده — فقط تست |
| پروفایل / username یکتا | پیاده + UNIQUE در DB |
| چت خصوصی Realtime | پیاده |
| گروه و کانال | پیاده با نقش و RLS |
| پیوست | پیاده + Storage RLS |
| تایپینگ | پیاده |
| تماس صوتی/تصویری | خاموش تا WebRTC/TURN |

## امنیت

RLS روی جداول اصلی، Storage محدود، رندر پیام با textContent، RPC امن برای ساخت گفتگو.

## تماس

برای تماس واقعی: سیگنالینگ + STUN/TURN لازم است. تا آن زمان فلگ‌ها در config خاموش‌اند.
