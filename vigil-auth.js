(function () {
  const API_BASE = 'https://vigil-production-17ca.up.railway.app';
  const SESSION_KEY = 'vigil_session';
  const EMAIL_KEY = 'vigil_demo_email';
  let pendingSession = null;
  let currentSession = null;

  window.VIGIL_API_BASE = API_BASE;

  function injectStyles() {
    if (document.getElementById('vigil-auth-styles')) return;

    const style = document.createElement('style');
    style.id = 'vigil-auth-styles';
    style.textContent = `
      .vigil-auth-backdrop{position:fixed;inset:0;background:#070B12;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow:auto}
      .vigil-auth-card{box-sizing:border-box;width:min(400px,100%);max-width:100%;max-height:calc(100vh - 40px);overflow:auto;background:#0D121B;border:1px solid #263648;border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:24px;color:#D7E3EE;font-family:'DM Sans',system-ui,sans-serif}
      .vigil-auth-brand{display:flex;align-items:center;gap:9px;margin-bottom:20px}
      .vigil-auth-mark{width:30px;height:30px;border-radius:7px;background:linear-gradient(135deg,#21B8E6,#19C995);display:flex;align-items:center;justify-content:center;font-size:14px}
      .vigil-auth-brand-name{font-family:'Syne',system-ui,sans-serif;font-size:16px;font-weight:800;color:#D7E3EE}
      .vigil-auth-title{font-family:'Syne',system-ui,sans-serif;font-size:22px;font-weight:800;margin-bottom:6px}
      .vigil-auth-copy{font-size:12.5px;line-height:1.55;color:#93A9BC;margin-bottom:18px}
      .vigil-auth-field{display:flex;flex-direction:column;gap:6px;margin-bottom:13px}
      .vigil-auth-field label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#93A9BC;font-weight:700}
      .vigil-auth-field input{box-sizing:border-box;width:100%;min-width:0;height:40px;border-radius:6px;border:1px solid #2A394C;background:#080B12;color:#D7E3EE;padding:0 11px;font:inherit;font-size:13px;outline:none}
      .vigil-auth-field input:focus{border-color:#21B8E6;box-shadow:0 0 0 2px rgba(33,184,230,.1)}
      .vigil-auth-error{display:none;margin:0 0 12px;padding:9px 10px;border:1px solid rgba(239,68,68,.3);border-radius:6px;background:rgba(239,68,68,.08);color:#FCA5A5;font-size:11.5px;line-height:1.45}
      .vigil-auth-error.show{display:block}
      .vigil-auth-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:17px;flex-wrap:wrap}
      .vigil-auth-btn{height:36px;border-radius:6px;border:1px solid #2A394C;background:#111823;color:#D7E3EE;padding:0 14px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
      .vigil-auth-btn.primary{border-color:rgba(33,184,230,.45);background:#21B8E6;color:#061018}
      .vigil-auth-btn:disabled{opacity:.55;cursor:wait}
      .vigil-session-control{display:flex;align-items:center;gap:7px;flex-shrink:0}
      .vigil-session-user{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--text2,#93A9BC)}
      .vigil-logout-btn{height:27px;border-radius:6px;border:1px solid var(--border,#263648);background:var(--s2,#111823);color:var(--text2,#93A9BC);padding:0 9px;font:inherit;font-size:10px;font-weight:700;cursor:pointer}
      .vigil-logout-btn:hover{color:var(--text,#D7E3EE);border-color:var(--b2,#2A394C)}
      @media(max-width:700px){.vigil-session-user{display:none}.vigil-auth-card{padding:20px}}
    `;
    document.head.appendChild(style);
  }

  function readStoredSession() {
    try {
      return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    currentSession = session;
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    document.documentElement.classList.add('vigil-authenticated');
    renderSessionControl(session);
    return session;
  }

  function clearSession() {
    currentSession = null;
    window.sessionStorage.removeItem(SESSION_KEY);
    document.documentElement.classList.remove('vigil-authenticated');
    document.querySelector('.vigil-session-control')?.remove();
  }

  async function validateSession(session) {
    if (!session || !session.token) return null;

    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    }).catch(() => null);

    if (!response || !response.ok) return null;
    const body = await response.json();
    return { token: session.token, ...body };
  }

  function renderSessionControl(session) {
    if (document.querySelector('.vigil-session-control')) return;
    const host = document.querySelector('.hdr-right, .topbar-right');
    if (!host) return;

    const control = document.createElement('div');
    control.className = 'vigil-session-control';
    const email = session.user?.email || 'Signed in';
    const role = session.user?.role ? ` · ${session.user.role}` : '';
    control.innerHTML = `
      <span class="vigil-session-user" title="${email}${role}">${email}</span>
      <button class="vigil-logout-btn" type="button">Log out</button>
    `;
    control.querySelector('button').addEventListener('click', () => window.logoutVigil());
    host.appendChild(control);
  }

  function openLoginDialog(message) {
    injectStyles();

    return new Promise((resolve) => {
      const savedEmail = window.localStorage.getItem(EMAIL_KEY) || '';
      const backdrop = document.createElement('div');
      backdrop.className = 'vigil-auth-backdrop';
      backdrop.innerHTML = `
        <form class="vigil-auth-card">
          <div class="vigil-auth-brand"><div class="vigil-auth-mark">V</div><div class="vigil-auth-brand-name">VIGIL HSE</div></div>
          <div class="vigil-auth-title">Sign in</div>
          <div class="vigil-auth-copy">Use your Vigil account to access the safety operations workspace.</div>
          <div class="vigil-auth-error${message ? ' show' : ''}" role="alert">${message || ''}</div>
          <div class="vigil-auth-field">
            <label for="vigil-auth-email">Email</label>
            <input id="vigil-auth-email" type="email" autocomplete="username" value="${savedEmail.replace(/"/g, '&quot;')}" required>
          </div>
          <div class="vigil-auth-field">
            <label for="vigil-auth-password">Password</label>
            <input id="vigil-auth-password" type="password" autocomplete="current-password" required>
          </div>
          <div class="vigil-auth-actions">
            <button class="vigil-auth-btn primary" type="submit">Sign in</button>
          </div>
        </form>
      `;

      const form = backdrop.querySelector('form');
      const emailInput = backdrop.querySelector('#vigil-auth-email');
      const passwordInput = backdrop.querySelector('#vigil-auth-password');
      const errorBox = backdrop.querySelector('.vigil-auth-error');
      const submitButton = backdrop.querySelector('[type="submit"]');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        submitButton.textContent = 'Signing in...';
        errorBox.classList.remove('show');

        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const response = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }).catch(() => null);

        if (!response || !response.ok) {
          errorBox.textContent = response?.status === 401
            ? 'The email or password is incorrect.'
            : 'Vigil could not connect to the server. Please try again.';
          errorBox.classList.add('show');
          passwordInput.value = '';
          passwordInput.focus();
          submitButton.disabled = false;
          submitButton.textContent = 'Sign in';
          return;
        }

        const body = await response.json();
        window.localStorage.setItem(EMAIL_KEY, email);
        backdrop.remove();
        resolve({
          token: body.token,
          user: body.user,
          companyId: body.companyId,
        });
      });

      document.body.appendChild(backdrop);
      (savedEmail ? passwordInput : emailInput).focus();
    });
  }

  window.getVigilSession = async function getVigilSession() {
    if (currentSession) return currentSession;
    if (pendingSession) return pendingSession;

    pendingSession = (async () => {
      const stored = readStoredSession();
      const validated = await validateSession(stored);
      if (validated) return saveSession(validated);

      clearSession();
      const expired = stored || new URLSearchParams(window.location.search).has('expired');
      const session = await openLoginDialog(expired ? 'Your session expired. Please sign in again.' : '');
      return saveSession(session);
    })().finally(() => {
      pendingSession = null;
    });

    return pendingSession;
  };

  window.getVigilToken = async function getVigilToken() {
    return (await window.getVigilSession()).token;
  };

  window.getVigilUser = async function getVigilUser() {
    return (await window.getVigilSession()).user;
  };

  window.logoutVigil = function logoutVigil() {
    clearSession();
    window.top.location.href = 'index.html';
  };

  window.handleVigilUnauthorized = function handleVigilUnauthorized() {
    clearSession();
    window.top.location.href = 'index.html?expired=1';
  };

  window.addEventListener('DOMContentLoaded', () => {
    window.getVigilSession();
  });
}());
