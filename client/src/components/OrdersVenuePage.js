// src/components/CombinedOrdersVenuePage.js
// 將「餐點訂單」與「場地訂單」整合在同一頁，上下以可滾動視窗呈現

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { useBluetoothPrinter } from './useBluetoothPrinter';
import './OrdersPage.css';   // 沿用既有樣式
import '../App.css';


/**
 * 主頁面：上方顯示餐點訂單、下方顯示場地訂單
 * 兩區皆使用 overflow‑y:auto 的固定高度捲動容器
 */
export default function CombinedOrdersVenuePage() {
  /* -------------------- 共用：登入 / 使用者 / Router -------------------- */
  const navigate = useNavigate();
  const token    = localStorage.getItem('token');
  if (!token) navigate('/login');

  const api = axios.create({
    baseURL: process.env.REACT_APP_API_BASE || '',
    headers: { Authorization: `Bearer ${token}` },
  });

  api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // 這裡只提示，不自動登出/導頁
      alert('登入已失效：畫面保留，請點右上角「登出」再登入。');
    }
    return Promise.reject(err);
  }
);

  const [userName, setUserName] = useState('');
  useEffect(() => {
    try { setUserName(jwtDecode(token).username || ''); } catch {/* ignore */}
  }, [token]);

  /* -------------------- 藍牙印表機（共用） -------------------- */
  const { bleConn, bleConnect, print } = useBluetoothPrinter();

  /* -------------------- UI -------------------- */
  return (
    <div className="app modern" style={{ paddingBottom: 24 }}>
      <div className="modal-content modern" style={{ maxWidth: 960, margin: '0 auto', maxHeight: '85vh', overflowY: 'auto' }}>
        {/* 頁首 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>訂單面板</h1>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, marginBottom: 4 }}>👤 {userName}</div>
            <button onClick={() => { localStorage.removeItem('token'); navigate('/login'); }}>登出</button>
          </div>
        </div>

        {/* 連線印表機按鈕（共用） */}
        <button className="connect-btn" onClick={bleConnect} style={{ marginBottom: 24 }}>
          {bleConn ? '已連線印表機' : '連線藍牙印表機'}
        </button>

        {/* -------------------- 餐點訂單區 -------------------- */}
        <section>
          <h2 style={{ marginTop: 0 }}>餐點訂單</h2>
          <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
            <OrdersSection api={api} bleConn={bleConn} bleConnect={bleConnect} print={print} />
          </div>
        </section>

        {/* -------------------- 場地訂單區 -------------------- */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ marginTop: 0 }}>場地訂單</h2>
          <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
            <VenueSection api={api} bleConn={bleConn} bleConnect={bleConnect} print={print} />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ================================================================
 * OrdersSection —— 餐點訂單
 * ================================================================ */
function OrdersSection({ api, bleConn, bleConnect, print }) {
  const navigate = useNavigate();
  const [orders, setOrders]     = useState([]);
  const [itemsMap, setItems]    = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [loading, setLoading]   = useState(true);
  const [errMsg,  setErrMsg]    = useState('');

  /* 音效與「上一輪」資料 */
  const prevOrdersRef = useRef([]);
  const notifyAudio   = useRef(null);
  useEffect(() => { notifyAudio.current = new Audio('/images/new-order.mp3'); }, []);

  /* -------------------- 讀主表 + 偵測新增 -------------------- */
  const fetchOrders = async () => {
    try {
      const { data } = await api.get('/api/orders');
      const list = data.filter(o => o.status !== 'paid');
      setOrders(list);

      /* 新訂單提示音：非首次 & 數量變多 */
      if (prevOrdersRef.current.length && list.length > prevOrdersRef.current.length) {
        try {
          notifyAudio.current.currentTime = 0;
          await notifyAudio.current.play();
        } catch {/* 可能被瀏覽器阻擋 */}
      }
      prevOrdersRef.current = list;

      /* 預設展開只新增的那幾筆，保留原展開狀態 */
      setExpanded(prev => {
        const n = new Set(prev);
        list.forEach(o => { if (!n.has(o.order_id)) n.add(o.order_id); });
        return n;
      });

      await Promise.all(list.map(o => (itemsMap[o.order_id] ? null : fetchItems(o.order_id))));
    } catch (err) {
      if (err.response?.status === 401) return navigate('/login');
      setErrMsg('無法載入訂單');
    } finally { setLoading(false); }
  };

  /* -------------------- 讀明細 -------------------- */
  const fetchItems = async (oid) => {
    try {
      const { data } = await api.get(`/api/orders/${oid}/items`);
      setItems(prev => ({ ...prev, [oid]: data }));
    } catch {/* ignore */}
  };

  /* -------------------- 首次載入 + 每 15 秒輪詢 -------------------- */
  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 15000); // 15 秒
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- 操作 -------------------- */
  const call = (method, url) => api({ method, url });

  const updateStatus = async (oid, status) => {
    const msg = status === 'cooked' ? '確認標記為「已出餐」？' : '確認標記為「已付款」？';
    if (!window.confirm(msg)) return;
    try {
      await call('put', `/api/orders/${oid}/${status}`);
      if (status === 'paid') {
        setOrders(p => p.filter(o => o.order_id !== oid));
        setItems(p => { const n = { ...p }; delete n[oid]; return n; });
        setExpanded(p => { const n = new Set(p); n.delete(oid); return n; });
      } else {
        setOrders(p => p.map(o => o.order_id === oid ? { ...o, status } : o));
      }
    } catch { alert('更新失敗'); }
  };

  const deleteOrder = async (oid) => {
    if (!window.confirm(`確定刪除訂單 ${oid}？`)) return;
    try { await call('delete', `/api/orders/${oid}`); fetchOrders(); }
    catch { alert('刪除失敗'); }
  };

  const deleteItem = async (oid, itemId) => {
    if (!window.confirm('確定刪除此餐點？'+itemId)) return;
    try {
      await call('delete', `/api/orders/${oid}/items/${itemId}`);
      await fetchItems(oid);
      await fetchOrders();
    } catch { alert('刪除餐點失敗'); }
  };

  const toggle = (oid) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(oid)) n.delete(oid);
      else {
        n.add(oid);
        if (!itemsMap[oid]) fetchItems(oid);
      }
      return n;
    });
  };

  const handlePrint = async (order) => {
    if (!bleConn) { const ok = await bleConnect(); if (!ok) return; }
    if (!itemsMap[order.order_id]) await fetchItems(order.order_id);

    const items = itemsMap[order.order_id] || [];
    const stamp = new Date().toLocaleString('zh-TW', { hour12: false });

    const body = items.map(it => `${it.item_name} x${it.qty}` + (it.size ? ` (${it.size})` : '') + (it.custom ? `\n  客製: ${it.custom}` : '')).join('\n');
    const totalProfit = items.reduce((sum, it) => {
    const cost = it.cost || 0;   // 從 API 傳來的原始成本
    return sum + (it.price - cost) * it.qty;
  }, 0);
    const text =
`========= HYPE 酒吧 =========
訂單: ${order.order_id}
桌號: ${order.table_no}
列印: ${stamp}
-----------------------------
${body}
-----------------------------
總金額: $${order.total_amount}
總利潤: $${totalProfit}
=============================\n\n\n`;
    try { await print(text); }
    catch { alert('列印失敗，請重試'); }
  };

  /* -------------------- UI -------------------- */
  if (loading) return <p style={{ padding: 16 }}>載入中...</p>;
  if (errMsg)  return <p style={{ padding: 16 }}>{errMsg}</p>;

  return (
    <table className="orders-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th />
          <th>ID</th><th>桌號</th><th>總金額</th><th>狀態</th><th>時間</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <React.Fragment key={o.order_id}>
            <tr>
              <td><button onClick={() => toggle(o.order_id)}>{expanded.has(o.order_id) ? '-' : '+'}</button></td>
              <td>{o.order_id}</td>
              <td>{o.table_no}</td>
              <td>NT${o.total_amount}</td>
              <td>{o.status}</td>
              <td>{new Date(o.created_at).toLocaleString()}</td>
              <td>
                <button onClick={() => handlePrint(o)}>列印</button>
                <button disabled={o.status === 'cooked'} onClick={() => updateStatus(o.order_id, 'cooked')}>已出餐</button>
                <button onClick={() => updateStatus(o.order_id, 'paid')}>已付帳</button>
                <button className="del-btn" onClick={() => deleteOrder(o.order_id)}>刪除訂單</button>
              </td>
            </tr>
            {expanded.has(o.order_id) && (
              <tr className="detail-row">
                <td colSpan={7}>
                  {itemsMap[o.order_id] ? (
                    <div className="detail-scroll">
                      <table className="detail-table">
                        <thead>
                          <tr>
                            <th>品項</th><th>數量</th><th>單價</th><th>加料</th><th>小計</th><th />
                          </tr>
                        </thead>
                        {/* <tbody>
                          {itemsMap[o.order_id].map(it => {
                            console.log('itemsMap[o.order_id] item:', it);
                            return (
                              <tr key={it.item_id + (it.custom || '')}>
                                <td>{it.item_name}（{it.size || '—'}）</td>
                                <td>{it.qty}</td>
                                <td>{it.price}</td>
                                <td>{it.custom || '—'}</td>
                                <td>{it.price * it.qty}</td>
                                <td>
                                  <button 
                                    onClick={() => deleteItem(o.order_id, it.item_name)} 
                                    className="del-item-btn"
                                  >
                                    刪除
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody> */}
                        <tbody> 
                        {itemsMap[o.order_id].map(it => 
                          ( <tr key={it.item_id + it.custom}> 
                          <td>{it.item_name}（{it.size || '—'}）
                            </td> <td>{it.qty}</td> 
                            <td>{it.price}</td> 
                            <td>{it.custom || '—'}</td> 
                            <td>{it.price * it.qty}</td> 
                            <td><button onClick={() => deleteItem(o.order_id, it.item_id)} className="del-item-btn">刪除</button></td> </tr> ))} 
                        </tbody>
                      </table>
                    </div>
                  ) : '載入明細中…'}
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

/* ================================================================
 * VenueSection —— 場地訂單 (取自 VenueFeePage.js，移除 token / print 重複邏輯)
 * ================================================================ */
function VenueSection({ api, bleConn, bleConnect, print }) {
  const navigate = useNavigate();
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  /* -------------------- 讀取場地費 -------------------- */
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

  /* -------------------- 操作 -------------------- */
  const updatePeople = async (id, delta) => {
    if (!window.confirm(`確定要修改人數？`)) return;
    const f = fees.find(x => x.id === id);
    const cnt = Math.max(1, f.people_count + delta);
    try { await api.put(`/api/venue/${id}/people`, { peopleCount: cnt }); fetchFees(); } catch { alert('更新人數失敗'); }
  };

  const deleteFee = async (fee, force = false) => {
  const forced = force || fee.is_paid === 1 || fee.is_paid === true;
  const tip = forced ? '（已付款，將強制刪除）' : '';
  if (!window.confirm(`確定刪除場地費：桌號 ${fee.table_no}？${tip}`)) return;
  try {
    const qs = forced ? '?force=1' : '';
    await api.delete(`/api/venue/${fee.id}${qs}`);
    await fetchFees();
  } catch (e) {
    alert('刪除失敗');
  }
};
  const markPaid = async (id) => {
    if (!window.confirm(`確定已付款並要消單？`)) return;
    try { await api.put(`/api/venue/${id}/pay`); fetchFees(); } catch { alert('標記失敗'); }
  };

  const settle = async (fee) => {
    const start = new Date(fee.start_time);
    let end     = new Date();

  // 判斷是否小於 10 分鐘
    const diffMs = end - start;
    if (diffMs > 10 * 60 * 1000) {
    // 減去 10 分鐘
      end = new Date(end.getTime() - 10 * 60 * 1000);
    }
  const hours = Math.ceil((end - start) / 3600000);
  const total = hours * fee.people_count * 30;

    if (!window.confirm(`共 ${hours} 小時，需 NT$${total}。\n確定結算並結束計時？`)) return;
    try {
      // const mysqlTime = end.toISOString().slice(0, 19).replace('T', ' ');
      const mysqlTime = end.toLocaleString('zh-TW', { hour12: false }).replace(',', '').replace(/\//g, '-');
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

  /* -------------------- UI -------------------- */
  if (loading) return <p style={{ padding: 16 }}>載入中…</p>;
  if (err)     return <p style={{ padding: 16 }}>{err}</p>;
              // <button onClick={() => updatePeople(f.id, 1)}>+</button>
  return (
    <table className="orders-table" style={{ width: '100%' }}>
      <thead>
        <tr><th>桌號</th><th>人數</th><th>開始時間</th><th>結束時間</th><th>操作</th></tr>
      </thead>
      <tbody>
        {fees.map(f => (
          <tr key={f.id}>
            <td>{f.table_no}</td>
            <td>
              <button onClick={() => updatePeople(f.id, -1)} disabled={f.people_count === 1}>-</button>
              <span style={{ margin: '0 8px' }}>{f.people_count}</span>

            </td>
            <td>{new Date(f.start_time).toLocaleString()}</td>
            <td>{f.end_time ? new Date(f.end_time).toLocaleString() : '—'}</td>
            <td>
              <button onClick={() => settle(f)}>結算</button>
              <button onClick={() => handlePrint(f)}>列印</button>
              <button onClick={() => markPaid(f.id)}>已付款</button>
              <button onClick={() => deleteFee(f)}>刪除</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
