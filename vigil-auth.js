(function () {
  const API_BASE = 'https://vigil-production-17ca.up.railway.app';
  const EMAIL_KEY = 'vigil_demo_email';

  window.VIGIL_API_BASE = API_BASE;

  function injectStyles() {
    if (document.getElementById('vigil-auth-styles')) return;

    const style = document.createElement('style');
    style.id = 'vigil-auth-styles';
    style.textContent = `
      .vigil-auth-backdrop{position:fixed;inset:0;background:rgba(2,6,12,.72);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px}
      .vigil-auth-card{width:min(380px,100%);background:#0C1018;border:1px solid #1E2D40;border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:20px;color:#C8DCF0;font-family:'DM Sans',system-ui,sans-serif}
      .vigil-auth-title{font-family:'Syne',system-ui,sans-serif;font-size:19px;font-weight:800;margin-bottom:6px}
      .vigil-auth-copy{font-size:12px;line-height:1.5;color:#8AAAC4;margin-bottom:16px}
      .vigil-auth-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
      .vigil-auth-field label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8AAAC4;font-weight:700}
      .vigil-auth-field input{height:38px;border-radius:6px;border:1px solid #263648;background:#07090F;color:#C8DCF0;padding:0 10px;font:inherit;font-size:13px}
      .vigil-auth-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
      .vigil-auth-btn{height:34px;border-radius:6px;border:1px solid #263648;background:#101520;color:#C8DCF0;padding:0 13px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
      .vigil-auth-btn.primary{border-color:rgba(0,194,255,.4);background:#00C2FF;color:#061018}
    `;
    document.head.appendChild(style);
  }

  window.getVigilCredentials = function getVigilCredentials() {
    injectStyles();

    return new Promise((resolve) => {
      const savedEmail = window.localStorage.getItem(EMAIL_KEY) || '';
      const backdrop = document.createElement('div');
      backdrop.className = 'vigil-auth-backdrop';
      backdrop.innerHTML = `
        <form class="vigil-auth-card">
          <div class="vigil-auth-title">Sign in to Vigil</div>
          <div class="vigil-auth-copy">Enter a valid Vigil account to load live demo data. The password is never stored in this page.</div>
          <div class="vigil-auth-field">
            <label for="vigil-auth-email">Email</label>
            <input id="vigil-auth-email" type="email" autocomplete="username" value="${savedEmail.replace(/"/g, '&quot;')}" required>
          </div>
          <div class="vigil-auth-field">
            <label for="vigil-auth-password">Password</label>
            <input id="vigil-auth-password" type="password" autocomplete="current-password" required>
          </div>
          <div class="vigil-auth-actions">
            <button class="vigil-auth-btn" type="button" data-cancel>Cancel</button>
            <button class="vigil-auth-btn primary" type="submit">Sign in</button>
          </div>
        </form>
      `;

      const form = backdrop.querySelector('form');
      const emailInput = backdrop.querySelector('#vigil-auth-email');
      const passwordInput = backdrop.querySelector('#vigil-auth-password');

      function close(credentials) {
        backdrop.remove();
        resolve(credentials);
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (email) window.localStorage.setItem(EMAIL_KEY, email);
        close({ email, password });
      });

      backdrop.querySelector('[data-cancel]').addEventListener('click', () => {
        close({ email: '', password: '' });
      });

      document.body.appendChild(backdrop);
      emailInput.focus();
      if (savedEmail) passwordInput.focus();
    });
  };
}());
