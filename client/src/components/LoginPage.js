// LoginPage.js — 員工/管理員登入
// POST /api/login → { token }（JWT 內含 role），依 role 導向不同頁面。

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import '../App.css';

const API = ''; // 同源：由服務此頁的 Express（http://<IP>:5000）提供 /api

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!username || !password) {
      setErr('請輸入帳號與密碼');
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || '登入失敗');
      }
      const { token } = await res.json();
      localStorage.setItem('token', token);

      let role = 'employee';
      try { role = jwtDecode(token).role || 'employee'; } catch { /* ignore */ }

      if (role === 'admin') navigate('/admin/xlsx');
      else navigate('/orders');
    } catch (e2) {
      console.error(e2);
      setErr(e2.message || '登入失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app modern" style={{ paddingTop: 48 }}>
      <div
        className="modal-content modern"
        style={{ maxWidth: 360, margin: '0 auto' }}
      >
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>HYPE 後台登入</h2>

        {err && <div className="error-box" style={{ marginBottom: 12 }}>{err}</div>}

        <form onSubmit={submit}>
          <div className="option-group">
            <label>帳號</label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="請輸入帳號"
              style={{ width: '100%', padding: 8, borderRadius: 8, boxSizing: 'border-box' }}
            />
          </div>

          <div className="option-group">
            <label>密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="請輸入密碼"
              style={{ width: '100%', padding: 8, borderRadius: 8, boxSizing: 'border-box' }}
            />
          </div>

          <button
            type="submit"
            className="add-btn"
            disabled={loading}
            style={{ width: '100%', marginTop: 8 }}
          >
            {loading ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
}
