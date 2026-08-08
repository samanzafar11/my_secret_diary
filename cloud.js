/* ===========================================================================
   Cloud — accounts and sync, layered on top of the offline diary
   ---------------------------------------------------------------------------
   The diary stays offline-first. Every write lands in localStorage straight
   away, so writing never waits for the network. Sync happens afterwards, in
   the background, and catches up whenever the connection comes back.

   If Supabase is not configured, or the person chooses to stay signed out,
   every method here quietly no-ops and the app behaves exactly as it did
   before accounts existed.
   =========================================================================== */
'use strict';

const Cloud = {
  client: null,
  user: null,
  status: 'offline',          // offline | syncing | synced | error
  _listeners: [],
  _queue: new Set(),          // ids waiting to be pushed
  _flushing: false,

  /* ---- setup --------------------------------------------------------- */

  get configured() {
    return typeof SUPABASE_URL === 'string'
      && typeof SUPABASE_ANON_KEY === 'string'
      && SUPABASE_URL.startsWith('https://')
      && SUPABASE_ANON_KEY.length > 40
      && !SUPABASE_ANON_KEY.includes('PASTE');
  },

  async init() {
    if (!this.configured) return null;
    if (!window.supabase?.createClient) {
      console.warn('Supabase library did not load; staying offline.');
      return null;
    }

    this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    const { data } = await this.client.auth.getSession();
    this.user = data?.session?.user || null;

    this.client.auth.onAuthStateChange((event, session) => {
      this.user = session?.user || null;
      if (event === 'SIGNED_OUT') this.setStatus('offline');
    });

    // Anything that failed while offline gets another go once we're back.
    window.addEventListener('online', () => this.flush());

    return this.user;
  },

  /* ---- status ---------------------------------------------------------- */

  onStatus(fn) { this._listeners.push(fn); fn(this.status); },

  setStatus(next) {
    if (this.status === next) return;
    this.status = next;
    this._listeners.forEach(fn => fn(next));
  },

  /* ---- auth ------------------------------------------------------------ */

  async signUp(email, password, name) {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } }
    });
    if (error) throw error;

    // With email confirmation on, there is a user but no session yet.
    return { user: data.user, needsConfirmation: !data.session };
  },

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    return data.user;
  },

  async signOut() {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.user = null;
  },

  async resetPassword(email) {
    const redirectTo = new URL('auth.html', window.location.href).href;
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },

  displayName() {
    return this.user?.user_metadata?.display_name
        || this.user?.email?.split('@')[0]
        || 'friend';
  },

  /* ---- shape conversion -------------------------------------------------
     The database uses snake_case columns and ISO timestamps; the app uses
     camelCase and epoch milliseconds. Translate at the boundary only.
     -------------------------------------------------------------------- */

  toLocal(row) {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      title: row.title || '',
      text: row.content || '',
      language: row.language || 'en',
      locked: row.locked === true,
      history: Array.isArray(row.history) ? row.history : []
    };
  },

  toRow(entry) {
    return {
      id: entry.id,
      user_id: this.user.id,
      title: entry.title || '',
      content: entry.text || '',
      language: entry.language || 'en',
      locked: entry.locked === true,
      history: entry.history || [],
      created_at: new Date(entry.createdAt).toISOString(),
      updated_at: new Date(entry.updatedAt).toISOString()
    };
  },

  /* ---- pulling --------------------------------------------------------- */

  async pull() {
    if (!this.user) return [];
    const { data, error } = await this.client
      .from('entries')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(row => this.toLocal(row));
  },

  /* ---- pushing ----------------------------------------------------------
     Queued rather than sent immediately, so a burst of keystrokes results in
     one request instead of twenty.
     -------------------------------------------------------------------- */

  queue(entry) {
    if (!this.user) return;
    this._queue.add(entry.id);
    this.setStatus('syncing');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 1200);
  },

  async flush() {
    if (!this.user || this._flushing || this._queue.size === 0) return;
    if (!navigator.onLine) { this.setStatus('offline'); return; }

    this._flushing = true;
    const ids = [...this._queue];
    this._queue.clear();

    try {
      const rows = ids
        .map(id => Entries.get(id))
        .filter(Boolean)
        .map(entry => this.toRow(entry));

      if (rows.length) {
        const { error } = await this.client.from('entries').upsert(rows);
        if (error) throw error;
      }
      this.setStatus('synced');
    } catch (err) {
      console.warn('Sync failed, will retry:', err.message);
      ids.forEach(id => this._queue.add(id));   // put them back
      this.setStatus('error');
    } finally {
      this._flushing = false;
    }
  },

  async remove(id) {
    if (!this.user) return;
    this._queue.delete(id);
    try {
      const { error } = await this.client.from('entries').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.warn('Could not delete on the server:', err.message);
    }
  },

  /* ---- merging ----------------------------------------------------------
     Called once at startup. Whichever copy of an entry was edited last wins;
     anything that exists on only one side is kept. Nothing is ever dropped.
     -------------------------------------------------------------------- */

  async merge() {
    if (!this.user) return { pulled: 0, pushed: 0 };

    this.setStatus('syncing');

    let remote;
    try {
      remote = await this.pull();
    } catch (err) {
      this.setStatus('error');
      throw err;
    }

    const local = Entries.all();
    const byId = new Map();

    remote.forEach(entry => byId.set(entry.id, entry));

    let pushed = 0;
    local.forEach(entry => {
      const match = byId.get(entry.id);
      if (!match) {
        byId.set(entry.id, entry);            // only local — upload it
        this._queue.add(entry.id);
        pushed++;
      } else if (entry.updatedAt > match.updatedAt) {
        byId.set(entry.id, entry);            // local is newer — upload it
        this._queue.add(entry.id);
        pushed++;
      }
    });

    const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    Entries.replaceAll(merged);

    const pulled = remote.filter(entry =>
      !local.some(item => item.id === entry.id)).length;

    if (this._queue.size) await this.flush();
    else this.setStatus('synced');

    return { pulled, pushed };
  }
};
