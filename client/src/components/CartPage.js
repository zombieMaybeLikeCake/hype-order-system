import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './CartPage.css';

const API = ''; // 同源：由服務此頁的 Express（http://<IP>:5000）提供 /api

export default function CartPage() {
  const location   = useLocation();
  const navigate   = useNavigate();
  const tableNo    = new URLSearchParams(location.search).get('tableNo') || '未知桌號';
  const storageKey = `cartItems_${tableNo}`;

  /* ---------- 取得 JWT ---------- */
  // const token = localStorage.getItem('token');
  // if (!token) navigate('/login');

  /* ---------- localStorage ----------
     items 內若 category === '場地費' 代表人頭計費 */
  const [items, setItems] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : [];
  });
  useEffect(() => localStorage.setItem(storageKey, JSON.stringify(items)), [items, storageKey]);

  /* ---------- 分流 ---------- */
  const venueItems = items.filter(i => i.category === '場地');
  const orderItems = items.filter(i => i.category !== '場地');

  const peopleCount = venueItems.reduce((n, i) => n + i.qty, 0);
  const menuTotal   = orderItems.reduce((s, i) => s + i.price * i.qty, 0);

  /* ---------- 數量/刪除 ---------- */
  const updateQty = (idx, d) =>
    setItems(c => {
      const n = [...c];
      n[idx].qty = Math.max(1, n[idx].qty + d);
      return n;
    });

  const removeItem = (idx) =>
    setItems(c => {
      const n = [...c];
      n.splice(idx, 1);
      return n;
    });

  /* ---------- 送出 ---------- */
  const submit = async () => {
    try {
      /* 1) 餐點訂單 */
      if (orderItems.length) {
        const r = await fetch(`${API}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tableNo,
            items: orderItems.map(i => ({
              itemId:   i.itemId || i.id,
              itemName: i.name,
              qty:      i.qty,
              price:    i.price,
              cost:     i.cost || 0,
              size:     i.size,
              custom:   i.custom || []
            }))
          })
        });
        if (r.status === 401) return navigate('/login');
        if (!r.ok) throw new Error('餐點訂單送出失敗');
      }

      /* 2) 場地費 */
      const now = new Date();
      const startTime = now.toLocaleString('zh-TW', { hour12: false }).replace(',', ''); // YYYY-MM-DD HH:mm:ss
      if (peopleCount > 0) {
        const r = await fetch(`${API}/api/venue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tableNo, peopleCount, startTime })
        });
        if (r.status === 401) return navigate('/login');
        if (!r.ok) throw new Error('場地費送出失敗');
      }
      
      alert('已送出！開始時間為 ' + startTime);
      localStorage.removeItem(storageKey);
      navigate(`/menu/?tableNo=${tableNo}`, { state: { tableNo } });
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  };

  const back = () => navigate(`/menu/?tableNo=${tableNo}`, { state: { cartItems: items } });

  return (
    <div className="cart-page">
      <div className="cart-header">
        <button className="back-btn" onClick={back}>⬅ 返回點餐</button>
        <h2>購物車</h2>
      </div>

      <div className="cart-list">
        {items.length === 0 && <p className="empty">目前購物車是空的</p>}

        {/* 場地費 */}
        {venueItems.length > 0 && (
          <>
            <h3 className="cart-subtitle">場地費</h3>
            {venueItems.map((i, idx) => (
              <Row
                key={`v-${idx}`}
                item={i}
                idx={idx}
                updateQty={updateQty}
                removeItem={removeItem}
                showPrice={false}
              />
            ))}
          </>
        )}

        {/* 餐點 */}
        {orderItems.length > 0 && (
          <>
            <h3 className="cart-subtitle">餐點</h3>
            {orderItems.map((i, idx) => (
              <Row
                key={`m-${idx}`}
                item={i}
                idx={idx}
                updateQty={updateQty}
                removeItem={removeItem}
                showPrice
              />
            ))}
          </>
        )}
      </div>

      {items.length > 0 && (
        <div className="cart-footer">
          <p className="total">餐點金額：NT${menuTotal}</p>
          <button className="checkout-btn submit-btn" onClick={submit}>送出</button>
        </div>
      )}
    </div>
  );
}

/* ------------ 列渲染元件 ------------ */
function Row({ item, idx, updateQty, removeItem, showPrice }) {
  return (
    <div className="cart-item">
      <div>
        <h3>{item.name}</h3>
        {item.size && <p>份量：{item.size}</p>}
        {item.custom?.length > 0 && <p>備註：{item.custom.join(', ')}</p>}
      </div>
      <div className="qty-row">
        <button onClick={() => updateQty(idx, -1)}>-</button>
        <span>{item.qty}</span>
        <button onClick={() => updateQty(idx, 1)}>+</button>
        <button className="remove" onClick={() => removeItem(idx)}>🗑</button>
      </div>
      {showPrice && <p className="item-price">NT${item.price * item.qty}</p>}
    </div>
  );
}
