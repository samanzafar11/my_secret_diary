# My Secret Diary

A private journal that translates as you write. Choose the language you write
in and the language you want to keep. Finish a sentence, and it changes on the
page — in place, cursor untouched.

Plain HTML, CSS and JavaScript. No framework, no build step.

The interface avoids jargon deliberately — a diary has *pages*, not "entries".

---

## Features

**Writing**
- A finished sentence is replaced where it sits; the caret does not move
- Formatting toolbar: bold, italic, underline, highlight, headings, quotes,
  bulleted and numbered lists, tables, dividers
- Four page faces — Book, Plain, Handwritten, Typewriter
- Formatting elsewhere on the page survives a translation untouched
- Separate "writing in" and "turn it into" languages, with a swap button
- Twelve languages; Urdu, Punjabi, Arabic and Persian switch the page to
  right-to-left with the correct typeface and line spacing
- The page direction follows the language you *write* in, not the output
- Urdu `۔` and Hindi `।` trigger a change just like a full stop
- Undo the last change, and a full history of your original wording
- Autosave, word count, plain-text export

**Entries**
- Grouped by Today / Yesterday / date
- Search covers titles, current text, and your original wording
- Per-entry lock, plus a PIN for the whole diary

**Appearance**
- Twenty preset colours plus a hue slider — any shade on the wheel
- Light and dark
- Everything derives from one CSS variable, `--hue`

**Accounts (optional)**
- Email and password sign-in through Supabase
- Offline-first: writes land locally first, then sync in the background
- Row Level Security means the database will not return another person's rows

---

## Running it

Do not open `index.html` by double-clicking. `crypto.subtle` (used to hash the
PIN) and `history.replaceState` both need a real HTTP origin.

In VS Code: install **Live Server**, right-click `index.html`, *Open with Live
Server*. Or from a terminal here:

```bash
python3 -m http.server 5500
```

---

## Turning translation on

Sidebar → **Translation service**. Paste a key from
[openrouter.ai/keys](https://openrouter.ai/keys).

The key lives in this browser only and is never written into the source, so the
project is safe to publish publicly.

### Speed

The same dialog has a **Model** field, and this is what determines how long a
sentence takes.

| Model | Typical wait | Cost |
|---|---|---|
| `openai/gpt-4o-mini` (default) | about a second | roughly $0.02 per 1,000 sentences |
| `openrouter/free` | five to ten seconds | free |

Free models are shared and queued, which is where the wait comes from. For a
diary the paid path costs cents per year, so it is usually the better trade.

Writing works with no key at all — sentences simply stay in your own words.

---

## Accounts and sync

Fill in `config.js`:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

Both come from **Settings → API** in the Supabase dashboard. The anon key is
meant to be public; what protects the data is the RLS policy, not secrecy.
Never put the `service_role` key here.

Leave the file untouched and the diary runs offline, exactly as before.

### Schema

```sql
create table entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  title      text default '',
  content    text default '',
  language   text default 'en',
  locked     boolean default false,
  history    jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table entries enable row level security;

create policy "read own"   on entries for select using (auth.uid() = user_id);
create policy "insert own" on entries for insert with check (auth.uid() = user_id);
create policy "update own" on entries for update using (auth.uid() = user_id);
create policy "delete own" on entries for delete using (auth.uid() = user_id);

create index entries_user_created on entries (user_id, created_at desc);
```

---

## Publishing

GitHub Pages serves public repositories on the free plan. That is fine here:
the code is public, the diary is not — entries live in the browser or in a
row-level-secured table.

1. Push these files to a public repository, `index.html` at the root
2. **Settings → Pages** → deploy from `main` / root
3. Open the URL on a phone and use *Add to Home Screen*

---

## Files

```
index.html   Landing page with a live demo
auth.html    Sign in and sign up
home.html    Entry list, search, settings
diary.html   The writing page
style.css    Design tokens, themes, layout
app.js       All logic, routed by <body data-page="...">
cloud.js     Supabase auth and background sync
config.js    Your two Supabase values
```

### How an entry is stored

```js
{
  id: "…",
  createdAt: 1753000000000,
  updatedAt: 1753000000000,
  title: "A good day",
  text:  "<p>Today was a really good day.</p>",   // HTML, sanitised on read
  face:  "serif",
  from:  "urr",          // language written in
  into:  "en",           // language kept
  locked: false,
  history: [
    { at: 1753000000000, original: "aaj din acha tha", result: "Today was a really good day." }
  ]
}
```

---

## Known limits

- The PIN keeps a casual snooper out. Anyone with developer tools and an
  unlocked device can read local storage.
- A full stop after an abbreviation (`Dr.`) will trigger a change. Decimals and
  ellipses are already skipped.
- Without an account, clearing browser data deletes your writing. Use
  **Save a backup** in the sidebar.
- The editor uses `document.execCommand`. It is deprecated but is still the only
  formatting API every browser implements for `contenteditable`, and it gives
  native undo for free.
- Pasted content is stripped to plain text on purpose, so foreign styling never
  enters the page.
