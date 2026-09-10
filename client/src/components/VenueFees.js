// VenueFees.js — 獨立的場地費管理頁（route: /venue-fees）
// 邏輯比照 OrdersVenuePage.js 內的 VenueSection，抽成獨立頁面：
//   GET  /api/venue/unpaid       列出未結清場地費
//   PUT  /api/venue/:id/people   調整人數
//   PUT  /api/venue/:id/end      結算（結束計時）
//   PUT  /api/venue/:id/pay      標記已付款
//   DELETE /api/venue/:id[?force=1]  刪除

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { useBluetoothPrinter } from './useBluetoothPrinter';
import './OrdersPage.css';
import '../App.css';

export default function VenueFees() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  if (!token) navigate('/login');

  const api = axios.create({
    baseURL: process.env.REACT_APP_API_BASE || '',
    headers: { Authorization: `Bearer ${token}` },
  });

  const [userName, setUserName] = useState('');
  useEffect(() => {
    try { setUserName(jwtDecode(token).username || ''); } catch { /* ignore */ }
  }, [token]);

  const { bleConn, bleConnect, print } = useBluetoothPrinter();

  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const fetchFees = async () => {
    try {
      const { data } = await api.get('/api/venue/unpaid');
      setFees(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e.response?.status === 401) return navigate('/login');
      setErr('無法載入場地費資料');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchFees();
    const t = setInterval(fetchFees, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updatePeople = async (id, delta) => {
    if (!window.confirm('確定要修改人數？')) return;
    const f = fees.find((x) => x.id === id);
    const cnt = Math.max(1, f.people_count + delta);
    try { await api.put(`/api/venue/${id}/people`, { peopleCount: cnt }); fetchFees(); }
    catch { alert('更新人數失敗'); }
  };

  const deleteFee = async (fee, force = false) => {
    const forced = force || fee.is_paid === 1 || fee.is_paid === true;
    const tip = forced ? '（已付款，將強制刪除）' : '';
    if (!window.confirm(`確定刪除場地費：桌號 ${fee.table_no}？${tip}`)) return;
    try {
      const qs = forced ? '?force=1' : '';
      await api.delete(`/api/venue/${fee.id}${qs}`);
      await fetchFees();
    } catch { alert('刪除失敗'); }
  };

  const markPaid = async (id) => {
    if (!window.confirm('確定已付款並要消單？')) return;
    try { await api.put(`/api/venue/${id}/pay`); fetchFees(); } catch { alert('標記失敗'); }
  };

  const settle = async (fee) => {
    const start = new Date(fee.start_time);
    let end = new Date();

    const diffMs = end - start;
    if (diffMs > 10 * 60 * 1000) {
      end = new Date(end.getTime() - 10 * 60 * 1000); // 未滿 10 分不扣，其餘扣 10 分寬限
    }
    const hours = Math.ceil((end - start) / 3600000);
    const total = hours * fee.people_count * 30;

    if (!window.confirm(`共 ${hours} 小時，需 NT$${total}。\n確定結算並結束計時？`)) return;
    try {
      const mysqlTime = end
        .toLocaleString('zh-TW', { hour12: false })
        .replace(',', '')
        .replace(/\//g, '-');
      await api.put(`/api/venue/${fee.id}/end`, { time: mysqlTime });
      alert(`已結算：NT$${total}`);
      fetchFees();
    } catch { alert('結算失敗，請重試'); }
  };

  const handlePrint = async (fee) => {
    if (!bleConn) { const ok = await bleConnect(); if (!ok) return; }
    const now = new Date().toLocaleString('zh-TW', { hour12: false });
    const txt =
`========= HYPE 酒吧 =========
場地費單
桌號: ${fee.table_no}
人數: ${fee.people_count}
開始: ${new Date(fee.start_time).toLocaleString()}
列印: ${now}
=============================\n\n\n\n`;
    try { await print(txt); } catch { alert('列印失敗'); }
  };

  return (
    <div className="app modern" style={{ paddingBottom: 24 }}>
      <div
        className="modal-content modern"
        style={{ maxWidth: 960, margin: '0 auto', maxHeight: '85vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>場地費管理</h1>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, marginBottom: 4 }}>👤 {userName}</div>
            <button onClick={() => { localStorage.removeItem('token'); navigate('/login'); }}>登出</button>
          </div>
        </div>

        <button className="connect-btn" onClick={bleConnect} style={{ marginBottom: 24 }}>
          {bleConn ? '已連線印表機' : '連線藍牙印表機'}
        </button>

        <div style={{ maxHeight: 500, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
          {loading ? (
            <p style={{ padding: 16 }}>載入中…</p>
          ) : err ? (
            <p style={{ padding: 16 }}>{err}</p>
          ) : (
            <table className="orders-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>桌號</th><th>人數</th><th>開始時間</th><th>結束時間</th><th>操作</th></tr>
              </thead>
              <tbody>
                {fees.map((f) => (
                  <tr key={f.id}>
                    <td>{f.table_no}</td>
                    <td>
                      <button onClick={() => updatePeople(f.id, -1)} disabled={f.people_count === 1}>-</button>
                      <span style={{ margin: '0 8px' }}>{f.people_count}</span>
                      <button onClick={() => updatePeople(f.id, 1)}>+</button>
                    </td>
                    <td>{new Date(f.start_time).toLocaleString()}</td>
                    <td>{f.end_time ? new Date(f.end_time).toLocaleString() : '—'}</td>
                    <td>
                      <button onClick={() => settle(f)}>結算</button>
                      <button onClick={() => handlePrint(f)}>列印</button>
                      <button onClick={() => markPaid(f.id)}>已付款</button>
                      <button className="del-btn" onClick={() => deleteFee(f)}>刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
