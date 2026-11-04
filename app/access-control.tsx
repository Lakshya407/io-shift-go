'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Search, ChevronUp, ChevronDown, MessageSquareText, Eye, Pencil, Trash2, Info, Plus, ShieldCheck, Users, KeyRound, Check, X, LoaderCircle, Lock } from 'lucide-react';

type Row = Record<string, any>;
type Call = (path: string, method?: string, body?: unknown) => Promise<Row>;

const ONLINE_MS = 5 * 60_000;

/** "a few seconds ago", "8 minutes ago", "12 days ago" … */
export function fromNow(value?: string | null) {
  if (!value) return 'Never';
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  const m = s / 60, h = m / 60, d = h / 24;
  if (s < 45) return 'a few seconds ago';
  if (s < 90) return 'a minute ago';
  if (m < 45) return `${Math.round(m)} minutes ago`;
  if (m < 90) return 'an hour ago';
  if (h < 22) return `${Math.round(h)} hours ago`;
  if (h < 36) return 'a day ago';
  if (d < 26) return `${Math.round(d)} days ago`;
  if (d < 45) return 'a month ago';
  if (d < 320) return `${Math.round(d / 30)} months ago`;
  return d < 548 ? 'a year ago' : `${Math.round(d / 365)} years ago`;
}
const longDate = (v?: string) => v ? new Date(v).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
const initials = (name = '') => name.split(' ').filter(Boolean).map(v => v[0]).slice(0, 2).join('').toUpperCase() || '?';
const roleTone = (id: string) => id === 'admin' ? 'admin' : id === 'employee' ? 'user' : 'custom';

type SortKey = 'name' | 'role' | 'email' | 'lastActiveAt' | 'createdAt';

export default function AccessControl({ data, me, locations, call, reload, say, onAdd, onEdit }: {
  data: Row | null; me: Row; locations: Row[]; call: Call; reload: () => Promise<unknown>;
  say: (s: string) => void; onAdd: () => void; onEdit: (user: Row) => void;
}) {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'createdAt', dir: 1 });
  const [roleMenu, setRoleMenu] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const roles: Row[] = data?.roles || [];
  const roleName = (id: string) => roles.find(r => r.id === id)?.name || id;
  const officeName = (id: string) => locations.find(l => l.id === id)?.name || '—';

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.users || []).filter((u: Row) => !q || `${u.name} ${u.email} ${u.employeeCode} ${roleName(u.role)} ${officeName(u.location)}`.toLowerCase().includes(q));
    const val = (u: Row) => sort.key === 'role' ? roleName(u.role) : sort.key === 'lastActiveAt' || sort.key === 'createdAt' ? (u[sort.key] ? Date.parse(u[sort.key]) : 0) : String(u[sort.key] || '').toLowerCase();
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, sort, roles, locations]);

  async function changeRole(u: Row, role: string) {
    setRoleMenu(null);
    if (role === u.role) return;
    setBusy(u.id);
    try { await call(`/api/admin/employees/${u.id}`, 'PATCH', { role }); await reload(); say(`${u.name} is now ${roleName(role)}.`); }
    catch (e: any) { say(e.message); } finally { setBusy(''); }
  }
  async function remove(u: Row) {
    if (!window.confirm(`Delete ${u.name}? They will lose access immediately. Journey and SOS history is kept for reports.`)) return;
    setBusy(u.id);
    try { const r = await call(`/api/admin/employees/${u.id}`, 'DELETE'); await reload(); say(r.removed === 'archived' ? `${u.name} was removed. Their journey history is kept.` : `${u.name} was deleted.`); }
    catch (e: any) { say(e.message); } finally { setBusy(''); }
  }
  const head = (key: SortKey, label: string) => (
    <th><button className={`rbac-sort ${sort.key === key ? 'on' : ''}`} onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
      {label}{sort.key === key && (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
    </button></th>
  );

  return <>
    <div className="page-heading"><div><div className="eyebrow">WHO CAN DO WHAT</div><h1>Access control</h1><p>Grant permissions with roles and manage your user base. Company SSO (Azure AD) can be connected later.</p></div>
      <div className="segmented rbac-tabs"><button className={tab === 'users' ? 'selected' : ''} onClick={() => setTab('users')}><Users size={14} /> Users</button><button className={tab === 'roles' ? 'selected' : ''} onClick={() => setTab('roles')}><KeyRound size={14} /> Roles & permissions</button></div></div>
    {!data ? <section className="card rbac-loading"><LoaderCircle className="spin" size={18} /> Loading access control…</section> : tab === 'users' ?
      <section className="rbac-panel">
        <div className="rbac-toolbar">
          <label className="rbac-search"><Search size={17} /><input aria-label="Search users" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <button className="rbac-add" onClick={onAdd}><Plus size={15} /> Add User</button>
        </div>
        <div className="rbac-table-wrap"><table className="rbac-table">
          <thead><tr>{head('name', 'Name')}{head('role', 'Role')}{head('email', 'Email')}<th>Office</th>{head('lastActiveAt', 'Last Active')}{head('createdAt', 'Created at')}<th aria-label="Actions" /></tr></thead>
          <tbody>{users.map((u: Row, i: number) => {
            const online = u.active && u.lastActiveAt && now - Date.parse(u.lastActiveAt) < ONLINE_MS;
            const isAdminRow = u.role === 'admin';
            return <tr key={u.id} className={u.active ? '' : 'inactive'}>
              <td><div className="rbac-name"><span className={`rbac-avatar tone-${i % 6}`}>{initials(u.name)}</span><span>{u.name}</span>{online && <i className="rbac-online" title="Active now" />}{!u.active && <em className="rbac-flag">Inactive</em>}{u.id === me.id && <em className="rbac-flag you">You</em>}</div></td>
              <td className="rbac-role-cell">
                <button className={`rbac-role ${roleTone(u.role)}`} disabled={busy === u.id || u.id === me.id} title={u.id === me.id ? 'You cannot change your own role' : 'Change role'} onClick={() => setRoleMenu(roleMenu === u.id ? null : u.id)}>{busy === u.id ? <LoaderCircle className="spin" size={13} /> : roleName(u.role)}</button>
                {roleMenu === u.id && <RoleMenu roles={roles} current={u.role} onPick={r => changeRole(u, r)} onClose={() => setRoleMenu(null)} />}
              </td>
              <td className="rbac-muted">{u.email}</td>
              <td className="rbac-muted">{officeName(u.location)}</td>
              <td className="rbac-muted">{fromNow(u.lastActiveAt)}</td>
              <td className="rbac-muted">{longDate(u.createdAt)}</td>
              <td><div className="rbac-actions">
                {!isAdminRow && <a className="rbac-icon" href={`mailto:${u.email}`} title={`Email ${u.name}`} aria-label={`Email ${u.name}`}><MessageSquareText size={17} /></a>}
                {!isAdminRow && <button className="rbac-icon" title="View details" aria-label={`View ${u.name}`} onClick={() => setViewing(u)}><Eye size={17} /></button>}
                <button className="rbac-icon" title="Edit user" aria-label={`Edit ${u.name}`} onClick={() => onEdit(u)}><Pencil size={16} /></button>
                {!isAdminRow && <button className="rbac-icon danger" title="Delete user" aria-label={`Delete ${u.name}`} disabled={busy === u.id} onClick={() => remove(u)}><Trash2 size={16} /></button>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>{!users.length && <p className="rbac-empty">No users match “{query}”.</p>}</div>
        <div className="rbac-hint"><Info size={13} /> Click on the user role button to change a user&apos;s role.</div>
      </section>
      : <RolesEditor data={data} call={call} reload={reload} say={say} />}
    {viewing && <UserDetails user={viewing} role={roles.find(r => r.id === viewing.role)} permissions={data?.permissions || []} office={officeName(viewing.location)} onClose={() => setViewing(null)} />}
  </>;
}

function RoleMenu({ roles, current, onPick, onClose }: { roles: Row[]; current: string; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', out), 0); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return <div className="rbac-menu" ref={ref} role="menu">{roles.map(r => <button key={r.id} role="menuitemradio" aria-checked={r.id === current} className={r.id === current ? 'on' : ''} onClick={() => onPick(r.id)}>
    <span className={`rbac-dot ${roleTone(r.id)}`} /><span><strong>{r.name}</strong><small>{r.description || `${r.permissions.length} permissions`}</small></span>{r.id === current && <Check size={14} />}
  </button>)}</div>;
}

function UserDetails({ user, role, permissions, office, onClose }: { user: Row; role?: Row; permissions: Row[]; office: string; onClose: () => void }) {
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);
  const granted: string[] = role?.permissions || [];
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-label="User details" onClick={e => e.stopPropagation()}>
    <header><h2>User details</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
    <div className="rbac-detail">
      <div className="rbac-detail-head"><span className="rbac-avatar big tone-1">{initials(user.name)}</span><div><h3>{user.name}</h3><p>{user.email}</p></div></div>
      <dl>
        <dt>Employee ID</dt><dd>{user.employeeCode}</dd>
        <dt>Role</dt><dd><span className={`rbac-role static ${roleTone(user.role)}`}>{role?.name || user.role}</span></dd>
        <dt>Office</dt><dd>{office}</dd>
        <dt>Department</dt><dd>{user.department || '—'}</dd>
        <dt>Phone</dt><dd>{user.phone ? <a href={`tel:${user.phone}`}>{user.phone}</a> : '—'}</dd>
        <dt>Status</dt><dd>{user.active ? 'Active' : 'Inactive'}{user.mustChangePassword ? ' · temporary password' : ''}</dd>
        <dt>Sign-in</dt><dd>{user.sso ? 'Company SSO' : 'Password'}</dd>
        <dt>Last active</dt><dd>{fromNow(user.lastActiveAt)}</dd>
        <dt>Created</dt><dd>{longDate(user.createdAt)}</dd>
      </dl>
      <h4>Permissions</h4>
      {granted.length ? <ul className="rbac-perm-list">{permissions.filter(p => granted.includes(p.key)).map(p => <li key={p.key}><Check size={14} />{p.label}</li>)}</ul> : <p className="rbac-muted">Employee app only (check-in, arrival, SOS).</p>}
    </div>
  </div></div>;
}

function RolesEditor({ data, call, reload, say }: { data: Row; call: Call; reload: () => Promise<unknown>; say: (s: string) => void }) {
  const catalog: Row[] = data.permissions || [];
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState('');
  const [newRole, setNewRole] = useState<{ name: string; description: string; permissions: string[] } | null>(null);
  const toggle = (list: string[], key: string) => list.includes(key) ? list.filter(k => k !== key) : [...list, key];

  async function save(r: Row) {
    setSaving(r.id);
    try { await call(`/api/admin/roles/${r.id}`, 'PATCH', { permissions: drafts[r.id] }); setDrafts(d => { const n = { ...d }; delete n[r.id]; return n; }); await reload(); say(`Permissions for ${r.name} saved.`); }
    catch (e: any) { say(e.message); } finally { setSaving(''); }
  }
  async function remove(r: Row) {
    if (!window.confirm(`Delete the role “${r.name}”?`)) return;
    setSaving(r.id);
    try { await call(`/api/admin/roles/${r.id}`, 'DELETE'); await reload(); say(`Role ${r.name} deleted.`); }
    catch (e: any) { say(e.message); } finally { setSaving(''); }
  }
  async function create() {
    if (!newRole?.name.trim()) return say('Give the role a name.');
    setSaving('new');
    try { await call('/api/admin/roles', 'POST', newRole); setNewRole(null); await reload(); say('Role created. Assign it from the Users list.'); }
    catch (e: any) { say(e.message); } finally { setSaving(''); }
  }

  return <section className="rbac-roles">
    <div className="rbac-roles-head"><p className="rbac-muted">Built-in roles are locked. Create custom roles to grant only what each team needs; changes apply on the user&apos;s next request.</p>
      {!newRole && <button className="rbac-add" onClick={() => setNewRole({ name: '', description: '', permissions: ['dashboard.view'] })}><Plus size={15} /> New role</button>}</div>
    {newRole && <div className="rbac-role-card editing">
      <div className="rbac-role-title"><input aria-label="Role name" placeholder="Role name, e.g. Night supervisor" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} maxLength={60} /></div>
      <input aria-label="Role description" className="rbac-desc-input" placeholder="What is this role for? (optional)" value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })} maxLength={200} />
      <PermissionGrid catalog={catalog} granted={newRole.permissions} onToggle={k => setNewRole({ ...newRole, permissions: toggle(newRole.permissions, k) })} />
      <div className="rbac-role-actions"><button className="btn secondary" onClick={() => setNewRole(null)}>Cancel</button><button className="btn primary" disabled={saving === 'new'} onClick={create}>{saving === 'new' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Create role</button></div>
    </div>}
    {(data.roles || []).map((r: Row) => {
      const granted = drafts[r.id] || r.permissions; const dirty = !!drafts[r.id];
      return <div className="rbac-role-card" key={r.id}>
        <div className="rbac-role-title"><span className={`rbac-role static ${roleTone(r.id)}`}>{r.name}</span>{r.builtin && <span className="rbac-lock"><Lock size={12} /> Built-in</span>}<span className="rbac-count">{r.userCount} user{r.userCount === 1 ? '' : 's'}</span>
          {!r.builtin && <button className="rbac-icon danger" title="Delete role" aria-label={`Delete role ${r.name}`} disabled={saving === r.id} onClick={() => remove(r)}><Trash2 size={15} /></button>}</div>
        {r.description && <p className="rbac-muted rbac-desc">{r.description}</p>}
        <PermissionGrid catalog={catalog} granted={granted} disabled={r.builtin} onToggle={k => setDrafts(d => ({ ...d, [r.id]: toggle(granted, k) }))} />
        {dirty && <div className="rbac-role-actions"><button className="btn secondary" onClick={() => setDrafts(d => { const n = { ...d }; delete n[r.id]; return n; })}>Discard</button><button className="btn primary" disabled={saving === r.id} onClick={() => save(r)}>{saving === r.id ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Save permissions</button></div>}
      </div>;
    })}
  </section>;
}

function PermissionGrid({ catalog, granted, disabled = false, onToggle }: { catalog: Row[]; granted: string[]; disabled?: boolean; onToggle: (key: string) => void }) {
  return <div className="rbac-perms">{catalog.map(p => <label key={p.key} className={`rbac-perm ${granted.includes(p.key) ? 'on' : ''} ${disabled ? 'locked' : ''}`}>
    <input type="checkbox" checked={granted.includes(p.key)} disabled={disabled} onChange={() => onToggle(p.key)} />
    <span><strong>{p.label}</strong><small>{p.description}</small></span>
  </label>)}</div>;
}
