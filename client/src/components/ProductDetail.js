// ProductDetail.js — 單一品項詳細頁（route: /product/:cat/:id）
// 從 data.js 依「分類 + id」查出品項，顯示詳情並可加入購物車（localStorage）。
// 是 Menu.js 內建 modal 的獨立頁精簡版。

import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { products } from './data';
import '../App.css';
import './Menu.css';

export default function ProductDetail() {
  const { cat, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const tableNo = new URLSearchParams(location.search).get('tableNo') || '未知桌號';
  const storageKey = `cartItems_${tableNo}`;

  const catName = decodeURIComponent(cat || '');
  const item = (products[catName] || []).find((p) => String(p.id) === String(id));

  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  if (!item) {
    return (
      <div className="app modern" style={{ padding: 24, textAlign: 'center' }}>
        <p>找不到此品項（分類：{catName || '—'}，編號：{id}）</p>
        <button className="add-btn" onClick={() => navigate(`/menu?tableNo=${tableNo}`)}>
          返回菜單
        </button>
      </div>
    );
  }

  const isVenue = catName === '場地';

  const addToCart = () => {
    const stored = localStorage.getItem(storageKey);
    const cart = stored ? JSON.parse(stored) : [];
    const custom = note ? [`客製化備註:${note}`] : [];
    cart.push({ ...item, category: catName, qty, price: item.price, custom });
    localStorage.setItem(storageKey, JSON.stringify(cart));
    navigate(`/menu?tableNo=${tableNo}`);
  };

  return (
    <div className="app modern" style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="modal-content modern">
        <button className="close-btn" onClick={() => navigate(`/menu?tableNo=${tableNo}`)}>
          ✕
        </button>

        <img src={item.image} alt={item.name} className="modal-img" />
        <h2>{item.name}</h2>
        {item.describe && (
          <p className="desc" style={{ color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
            {item.describe}
          </p>
        )}
        <p className="price">NT$ {item.price}</p>

        <div className="option-group">
          <label>{isVenue ? '人數' : '份數'}</label>
          <div className="counter">
            <button onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
            <span>{qty}</span>
            <button onClick={() => setQty(qty + 1)}>+</button>
          </div>
        </div>

        <div className="option-group">
          <label>客製化</label>
          <textarea
            rows="3"
            style={{ width: '100%', borderRadius: 8, padding: 8, boxSizing: 'border-box' }}
            placeholder="請輸入客製化需求（可留空）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <button className="add-btn" onClick={addToCart}>
          加入購物車
        </button>
      </div>
    </div>
  );
}
