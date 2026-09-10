import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import * as XLSX from 'xlsx'; // 用於一鍵匯出 .xlsx（需先 npm i xlsx）
import './OrdersPage.css';           // 共用樣式（含 modal）
import '../App.css';                 // 全域樣式

/*
 * AdminXlsxPage — 顯示營收結果
 * 改動：淨利一律以「每筆品項的 menu_items.profit」為準（由後端 JOIN 帶在 items[].profit 或 items[].item_profit）
 * 若後端僅回傳彙總 profit，則沿用後端值。
 *
 * 後端需求：GET /api/orders/window?start=YYYY-MM-DD HH:mm:ss&end=YYYY-MM-DD HH:mm:ss
 * 回傳建議格式：
 * {
 *   orders: [{ order_id, table_no, created_at, amount, cost, profit, items:[{qty, price, cost, profit|item_profit}] }],
 *   summary: { amount, cost, profit }
 * }
 */

const API = ''; // 同源：由服務此頁的 Express（http://<IP>:5000）提供 /api

export default function AdminXlsxPage() {
  /* ---------- State ---------- */
  const [files, setFiles]       = useState([]);
  const [emps, setEmps]         = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName]         = useState('');
  const [pw, setPw]             = useState('');
  const [pw2, setPw2]           = useState('');
  const [showModal, setModal]   = useState(false);
  const [err, setErr]           = useState('');

  const [win, setWin]           = useState({ orders: [], summary: { amount: 0, cost: 0, profit: 0 } });
  const [venues,setVenue]    = useState([]);

  const [loadingOrders, setLoadingOrders] = useState(false);

  const nav   = useNavigate();
  const token = localStorage.getItem('token');

  /* ---------- 權限驗證 ---------- */
  useEffect(() => {
    if (!token) return nav('/login');
    try {
      const d = jwtDecode(token);
      if (d.role !== 'admin') { alert('無權訪問'); return nav('/'); }
      if (d.exp * 1000 < Date.now()) { alert('登入過期，請重新登入'); return nav('/login'); }
    } catch {
      return nav('/login');
    }

    fetchFiles();
    fetchEmps();
    refreshWindows();

    const t = setInterval(refreshWindows, 60_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 帶 Bearer 的 fetch ---------- */
  const authFetch = (url, opt = {}) => {
    const tk = localStorage.getItem('token');
    return fetch(`${API}${url}`, { ...opt, headers: { Authorization: `Bearer ${tk}`, ...(opt.headers || {}) } });
  };

  /* ---------- 報表清單 ---------- */
  const fetchFiles = () =>
    authFetch('/api/xlsx')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setFiles)
      .catch(() => setErr('載入報表失敗'));

  const downloadFile = async (fileName) => {
    try {
      const res = await authFetch(`/api/xlsx/${encodeURIComponent(fileName)}`);
      if (!res.ok) throw new Error('下載失敗');
      const blob = await res.blob();
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert('下載失敗'); }
  };

  /* ---------- 員工管理 ---------- */
  const fetchEmps = () =>
    authFetch('/api/employees')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setEmps)
      .catch(() => setErr('載入員工失敗'));

  const register = async () => {
    if (!name || !pw) { alert('請輸入帳號與密碼'); return; }
    if (pw !== pw2)  { alert('兩次密碼不一致'); return; }
    try {
      const res = await authFetch('/api/employees', {
        method : 'POST', headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ username: name, password: pw, role: 'employee' })
      });
      if (res.ok) { setName(''); setPw(''); setPw2(''); setModal(false); fetchEmps(); }
      else { const msg = await res.text(); alert(msg || '新增失敗'); }
    } catch (e) { console.error(e); alert('新增失敗'); }
  };

  const deleteSelected = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`確定刪除 ${selected.length} 位員工？`)) return;
    try {
      const res = await authFetch('/api/employees', {
        method : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selected })
      });
      if (res.ok) { fetchEmps(); setSelected([]); } else alert('刪除失敗');
    } catch (e) { console.error(e); alert('刪除失敗'); }
  };

  /* ---------- 訂單：合併 00:00–04:00 與 12:00–23:59 ---------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt  = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

  const getTodayWindows = () => {
    const now = new Date();
    const y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
    const t0000   = new Date(y, m, d, 0, 0, 0);
    const t0400   = new Date(y, m, d, 7, 0, 0);
    const t1200   = new Date(y, m, d, 12, 0, 0);
    const t235959 = new Date(y, m, d, 23, 59, 59);
    const t11200   = new Date(y, m, d-1, 12, 0, 0);
    const t1235959 = new Date(y, m, d-1, 23, 59, 59);
    return { startA: fmt(t0000), endA: fmt(t0400), startB: fmt(t1200), endB: fmt(t235959), startC: fmt(t11200), endC: fmt(t1235959) };
  };

  const fetchWindow = async (start, end) => {
    // 建議後端支援 withItems=1 以回傳 items[].profit；若無，也能用後端 summary.profit
    const res = await authFetch(`/api/orders/window?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&withItems=1`);
    if (!res.ok) throw new Error('查詢失敗');
    return res.json();
  };
    const fetchVenue = async (start, end) => {
    // 建議後端支援 withItems=1 以回傳 items[].profit；若無，也能用後端 summary.profit
     const res = await authFetch(`/api/venue/day?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    if (!res.ok) throw new Error('查詢失敗');
    return res.json();
  };


  /* ---------- 時區工具：無時區字串 +8 小時（當成 UTC） ---------- */
  const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

  // 解析 'YYYY-MM-DD HH:mm:ss' 為「UTC 時間」的 Date
  const parseNaiveAsUTC = (s) => {
    const m = typeof s === 'string' && s.match(NAIVE_RE);
    if (!m) return null;
    const Y = Number(m[1]);
    const M = Number(m[2]);
    const D = Number(m[3]);
    const h = Number(m[4]);
    const mi= Number(m[5]);
    const se= Number(m[6]);
    return new Date(Date.UTC(Y, M - 1, D, h, mi, se)); // ← 當成 UTC
  };

  // 顯示：無時區字串=>加 8（UTC→台北）；ISO/Z/offset=>照原時區轉台北
  const toTaipei = (input) => {
    if (!input) return '';
    // 無時區
    const naive = parseNaiveAsUTC(input);
    if (naive instanceof Date && !isNaN(naive)) return formatInTz(naive, 'Asia/Taipei');
    // 其他情況
    const d = new Date(input);
    if (isNaN(d)) return String(input);
    return formatInTz(d, 'Asia/Taipei');
  };

  // 排序：與顯示一致，無時區字串以 UTC 解析
  const toDateForSort = (s) => {
    const d = parseNaiveAsUTC(s);
    return d instanceof Date && !isNaN(d) ? d : new Date(s);
  };

  // 格式化為 YYYY-MM-DD HH:mm:ss（指定時區）
  const formatInTz = (dateObj, timeZone = 'Asia/Taipei') => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(dateObj);
    const get = (t) => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  };

  // 依 items[].profit 重新計算淨利（若 items 存在）
  const calcProfitFromItems = (o) => {
    if (!Array.isArray(o?.items)) return null;
    return o.items.reduce((sum, it) => sum + Number(it.qty || 0) * Number((it.profit ?? it.item_profit) || 0), 0);
  };

  const refreshWindows = async () => {
    try {
      setLoadingOrders(true);
      const { startA, endA, startB, endB,startC, endC } = getTodayWindows();
      const [a, b, c] = await Promise.all([ fetchWindow(startA, endA), fetchWindow(startB, endB), fetchWindow(startC, endC) ]);
      const [va, vb, vc] = await Promise.all([ fetchVenue(startA, endA), fetchVenue(startB, endB), fetchVenue(startC, endC) ]);
      
      // 合併 + 依建立時間排序
      let orders = [...(c.orders||[]),...(a.orders||[]), ...(b.orders||[])]
        .sort((x, y) => toDateForSort(x.created_at) - toDateForSort(y.created_at));
      let venues = [...(vc||[]),...(va||[]), ...(vb||[])]
      // 以 items[].profit（menu_items.profit）覆蓋每筆訂單的 o.profit（若可取得）
      orders = orders.map(o => {
        const p = calcProfitFromItems(o);
        return (p == null) ? o : { ...o, profit: p };
      });

      // 合計：金額與成本沿用後端；淨利改以 orders 的 profit 加總（若 orders 含 items）
      const hasItems = orders.some(o => Array.isArray(o.items));
      const summary = {
        amount: Number(a?.summary?.amount || 0) + Number(b?.summary?.amount || 0)+ Number(c?.summary?.amount || 0),
        cost  : Number(a?.summary?.cost   || 0) + Number(b?.summary?.cost   || 0)+Number( c?.summary?.cost   || 0),
        profit: hasItems
          ? orders.reduce((s, o) => s + Number(o.profit || 0), 0)
          : Number(a?.summary?.profit || 0) + Number(b?.summary?.profit || 0)+ Number(c?.summary?.profit || 0),
      };
      setWin({ orders, summary });
      setVenue(venues || []);
    } catch (e) {
      console.error(e); setErr('載入訂單失敗');
    } finally { setLoadingOrders(false); }
  };

  /* ---------- 匯出 .xlsx（以畫面現有 win 為準） ---------- */
  const buildFileName = () => {
    const d = new Date();
    return `Orders_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_0000-0400_1200-2359.xlsx`;
  };

  const exportToXlsx = () => {
    try {
      if (!win || !Array.isArray(win.orders) || win.orders.length === 0) {
        alert('目前沒有可匯出的資料');
        return;
      }
      const header = ['訂單編號', '桌號', '建立時間', '銷售額', '成本', '利潤'];
      const rows = win.orders.map(o => ([
        o.order_id,
        o.table_no,
        toTaipei(o.created_at),
        Number(o.amount || 0),
        Number(o.cost   || 0),
        Number(o.profit || 0),
      ]));
      const summaryRow = ['小計', '', '', Number(win.summary.amount||0), Number(win.summary.cost||0), Number(win.summary.profit||0)];

      const aoa = [header, ...rows, [], summaryRow];
      const ws  = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [ { wch: 10 }, { wch: 8 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 } ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      XLSX.writeFile(wb, buildFileName());
    } catch (e) {
      console.error('Export XLSX error:', e); alert('匯出失敗');
    }
  };
  /* ---------- UI ---------- */
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 16 }}>
      <h2>管理後台</h2>
      {err && <div className="error-box">{err}</div>}

      {/* 報表清單 */}
      <section style={{ marginTop: 16 }}>
        <h3>Excel 報表清單</h3>
        {files.length === 0 ? (
          <p>目前沒有 .xlsx 檔案</p>
        ) : (
          <table className="orders-table">
            <thead>
              <tr><th>檔名</th><th style={{width:120}}>操作</th></tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f}>
                  <td style={{ textAlign:'left' }}>{f}</td>
                  <td>
                    <button className="btn" onClick={() => downloadFile(f)}>下載</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 今日訂單（單一表，合併兩個時間窗） */}
      <section style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            今日訂單（00:00–04:00 + 12:00–23:59）{loadingOrders ? '（更新中…）' : ''}
          </h3>
          <button className="btn" onClick={exportToXlsx} disabled={!win.orders.length}>匯出 .xlsx</button>
        </div>

        {win.orders.length === 0 ? (
          <p style={{ marginTop: 8 }}>無資料</p>
        ) : (
          <table className="orders-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>訂單編號</th>
                <th>桌號</th>
                <th>建立時間</th>
                <th>銷售額</th>
                <th>成本</th>
                <th>利潤</th>
              </tr>
            </thead>
            <tbody>
              {win.orders.map(o => (
                <tr key={o.order_id}>
                  <td>{o.order_id}</td>
                  <td>{o.table_no}</td>
                  <td style={{ textAlign: 'left' }}>{toTaipei(o.created_at)}</td>
                  <td>{Number(o.amount).toFixed(0)}</td>
                  <td>{Number(o.cost).toFixed(0)}</td>
                  <td><b>{Number(o.profit).toFixed(0)}</b></td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ textAlign: 'right' }}><b>小計</b></td>
                <td><b>{Number(win.summary.amount).toFixed(0)}</b></td>
                <td><b>{Number(win.summary.cost).toFixed(0)}</b></td>
                <td><b>{Number(win.summary.profit).toFixed(0)}</b></td>
              </tr>
            </tbody>
          </table>
        )}
      {/* 今日場地費 */}
      </section>
      <section style={{ marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>今日場地費</h3>
        <table className="orders-table" style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th>ID</th>
          <th>桌號</th>
          <th>開始時間</th>
          <th>結束時間</th>
          <th>人數</th>
          <th>狀態</th>
        </tr>
      </thead>
      <tbody>
        {venues.map((r) => (
          <tr key={r.id}>
            <td>{r.id}</td>
            <td>{r.table_no}</td>
            <td>{toTaipei(r.start_time)}</td>
            <td>{toTaipei(r.end_time) || '-'}</td>
            <td>{Number(r.people_count || 0).toFixed(0)}</td>
            <td>{r.paid ? '已付款' : '未付款'}</td>
          </tr>
        ))}
      </tbody>
    </table>
      </section>
      {/* 員工列表 */}
      <section style={{ marginTop: 24 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin: 0 }}>員工列表</h3>
          <button className="btn" onClick={() => setModal(true)}>新增員工</button>
          <button className="btn" onClick={deleteSelected} disabled={selected.length === 0}>刪除選取</button>
        </div>

        {emps.length === 0 ? (
          <p style={{ marginTop: 8 }}>尚無員工</p>
        ) : (
          <table className="orders-table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th></th><th>ID</th><th>帳號</th><th>角色</th></tr>
            </thead>
            <tbody>
              {emps.map(e => (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(e.id)}
                      onChange={ev => {
                        setSelected(prev => ev.target.checked ? [...prev, e.id] : prev.filter(id => id !== e.id));
                      }}
                    />
                  </td>
                  <td>{e.id}</td>
                  <td style={{ textAlign:'left' }}>{e.username}</td>
                  <td>{e.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 新增員工 Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <div className="modal-content modern" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModal(false)}>×</button>
            <h3>新增員工</h3>
            <input placeholder="帳號" value={name} onChange={e => setName(e.target.value)} />
            <input type="password" placeholder="密碼" value={pw} onChange={e => setPw(e.target.value)} />
            <input type="password" placeholder="確認密碼" value={pw2} onChange={e => setPw2(e.target.value)} />
            <button style={{ marginTop: 12 }} onClick={register}>送出</button>
          </div>
        </div>
      )}
    </div>
  );
}
