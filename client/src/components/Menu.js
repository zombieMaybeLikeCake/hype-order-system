// src/components/Menu.js — 更新：
// 1) 卡片/彈窗顯示 item.describe
// 2) 茶類飲料：保留「冰塊／甜度／加購(奶精/檸檬/蜂蜜)」並計入價格
// 3) 【本次】在「推薦特調、特製調酒、傳統調酒、Shot、無酒精飲料」加入【冰塊選項＋客製化備註框】（不加價）
// 4) 【本次】在「炸物」加入【客製化備註框】

import React, { useRef, useState, useEffect } from 'react';
import { categories, products } from './data';
import { useNavigate, useLocation } from 'react-router-dom';
import '../App.css';
import './Menu.css';

export default function Menu() {
  const sectionRefs = useRef({});
  const [modalItem, setModalItem] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [viewMode, setViewMode] = useState('grid');
  const navigate = useNavigate();
  const location = useLocation();

  const tableNo   = new URLSearchParams(location.search).get('tableNo') || '未知桌號';
  const storageKey= `cartItems_${tableNo}`;

  /* ----------------------- localStorage ----------------------- */
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) setCartItems(JSON.parse(stored));
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(cartItems));
  }, [cartItems, storageKey]);

  /* ----------------------- 跳轉來源帶購物車 ----------------------- */
  useEffect(() => {
    if (location.state?.cartItems) setCartItems(location.state.cartItems);
  }, [location.state]);

  /* ----------------------- 捲動 ----------------------- */
  const scrollTo = (cat) => {
    sectionRefs.current[cat]?.scrollIntoView({ behavior: 'smooth' });
  };

  /* ----------------------- 加入購物車 ----------------------- */
  const addToCart = (payload) => setCartItems([...cartItems, payload]);

  // 排除場地費
  const getCartTotal = () => cartItems
    .filter(it => it.category !== '場地')
    .reduce((t, it) => t + it.price * it.qty, 0);

  /* ----------------------- UI ----------------------- */
  return (
    <div className="app modern">
      <header className="header">
        <img src="/images/banner.jpg" alt="banner" className="banner" />
        <h1 className="shop-name">HYPE點單</h1>
        <p className="table-info">桌號 {tableNo}</p>
      </header>

      <div className="category-header">
        <h2 className="section-title">餐點分類</h2>
        <div className="view-toggle">
          <button
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
          >🔳 網格</button>
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >☰ 列表</button>
        </div>
      </div>

      <nav className="category-nav">
        {categories.map(cat => (
          <button key={cat} onClick={() => scrollTo(cat)}>{cat}</button>
        ))}
      </nav>

      <main>
        {categories.map(cat => (
          <section
            key={cat}
            ref={el => (sectionRefs.current[cat] = el)}
            className="menu-section"
          >
            <h2>{cat}</h2>
            <div className={viewMode === 'grid' ? 'product-grid' : 'product-list-vertical'}>
              {(products[cat] || []).map(item => (
                <div
                  key={item.id}
                  className={`product-card modern ${viewMode}`}
                  onClick={() => setModalItem({ ...item, category: cat })}
                >
                  <img src={item.image} alt={item.name} className="product-img" />
                  <div className="product-info">
                    <h3>{item.name}</h3>
                    {item.describe && (
                      <p className="desc" style={{color:'#6b7280', fontSize: '0.9rem', lineHeight:1.4}}>
                        {item.describe}
                      </p>
                    )}
                    <p className="price">NT$ {item.price}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>

      {cartItems.length > 0 && (
        <div className="cart-fixed-button">
          <button
            className="cart-button-bar"
            onClick={() => navigate(`/cart?tableNo=${tableNo}`, { state: { cartItems } })}
          >
            購物車・NT${getCartTotal()}
          </button>
        </div>
      )}

      <ProductModal
        item={modalItem}
        onClose={() => setModalItem(null)}
        onAddToCart={addToCart}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                              Modal                                 */
/* ------------------------------------------------------------------ */
function ProductModal({ item, onClose, onAddToCart }) {
  const [qty,       setQty]   = useState(1);
  /* 冰塊／甜度 */
  const [ice,       setIce]   = useState('正常');
  const [sweet,     setSweet] = useState('正常');

  /* 茶類飲料加購（只影響茶類飲料價格） */
  const drinkExtraItems = [
    { key: 'creamer', label: '加奶精',  price: 5 },
    { key: 'lemon',   label: '加檸檬',  price: 5 },
    { key: 'honey',   label: '加蜂蜜',  price: 10 },
  ];
  const [drinkExtras, setDrinkExtras] = useState({ creamer: false, lemon: false, honey: false });

  /* 炒泡麵 */
  const [addOn,     setAddOn] = useState({ '加麵10': false, '加蛋10': false, '加起司15': false });
  /* 客製化通用文字框 */
  const [otherNote, setNote]  = useState('');

  /* 判斷品項類型（同時兼容舊資料鍵名） */
  const isVenue           = item?.category === '場地';
  const isTea             = ['茶類飲料', '各式茶飲'].includes(item?.category);
  const isShot            = ['Shot', 'shot'].includes(item?.category);
  const isCocktailCat     = ['推薦特調','特製調酒','傳統調酒'].includes(item?.category);
  const isNonAlcoholic    = item?.category === '無酒精飲料';
  const isFriedCategory   = item?.category === '炸物';
  const isCustomCocktail  = item?.category === '客製化調酒';
  const isFriedNoodle     = item?.name === '炒泡麵';
  const isOther           = item?.category === '其他' && !isFriedNoodle;
  const isTeaadd          = item?.category === '茶類加購品'
  // 顯示條件
  const showIce           = isTea || isNonAlcoholic;
  const showSweet         = isTea;                 // 甜度只給茶類飲料
  // const showTeaExtras     = isTea;                 // 加奶精/檸檬/蜂蜜只給茶類飲料
  const showCustomTextarea= isCustomCocktail || isOther || isFriedCategory || isCocktailCat || isShot || isNonAlcoholic || isTeaadd;

  if (!item) return null;

  // 計算茶飲加購小計
  const drinkExtrasCost = drinkExtraItems.reduce(
    (sum, it) => sum + (drinkExtras[it.key] ? it.price : 0),
    0
  );

  // 顯示單份總價（含加購；僅茶類飲料會變動）
  const unitTotal = (item.price || 0) + (isTea ? drinkExtrasCost : 0);

  /* ------------------- 加入購物車 ------------------- */
  const handleAdd = () => {
    const customs = [];

    if (isVenue) {
      customs.push('場地費說明');
    }
    if (showIce) {
      customs.push(`冰塊:${ice}`);
    }
    if (showSweet) {
      customs.push(`甜度:${sweet}`);
    }
    // if (showTeaExtras) {
    //   drinkExtraItems.forEach(ex => {
    //     if (drinkExtras[ex.key]) customs.push(`${ex.label}(+${ex.price})`);
    //   });
    // }
    if (isFriedNoodle) {
      Object.keys(addOn).forEach(k => addOn[k] && customs.push(k));
    }
    if (showCustomTextarea && otherNote) {
      customs.push(`客製化備註:${otherNote}`);
    }

    const payload = {
      ...item,
      qty,
      price: unitTotal,  // 僅茶類飲料含加購
      custom: customs,
    };
    onAddToCart(payload);
    onClose();
  };

  /* ------------------- UI ------------------- */
  return (
    <div className="modal-backdrop">
      <div className="modal-content modern">
        <button className="close-btn" onClick={onClose}>✕</button>
        <img src={item.image} alt={item.name} className="modal-img" />
        <h2>{item.name}</h2>
        {item.describe && (
          <p className="desc" style={{color:'#6b7280', marginTop:4, lineHeight:1.5}}>{item.describe}</p>
        )}
        <p className="price">NT$ {unitTotal}{isTea && drinkExtrasCost>0 && (
          <span style={{marginLeft:8, color:'#6b7280', fontSize:'0.9rem'}}>（含加購）</span>
        )}</p>

        {/* 通用：份數 */}
        <div className="option-group">
          <label>{isVenue ? '人數' : '份數'}</label>
          <div className="counter">
            <button onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
            <span>{qty}</span>
            <button onClick={() => setQty(qty + 1)}>+</button>
          </div>
        </div>

        {/* 場地費說明 ----------------------------------------------------- */}
        {isVenue && (
          <div className="option-group">
            <p style={{ lineHeight:1.6, color:'#555' }}>
              按小時人頭計費，一人每小時收 30 元。<br/>
              有人需要提早離開，需先收該位費用。
            </p>
          </div>
        )}

        {/* 飲品：冰塊（茶類/調酒/Shot/無酒精）＋ 甜度/加購（茶類） -------- */}
        {showIce && (
          <div className="option-group">
            <label>冰塊</label>
            <div className="option-row">
              {['正常','少冰','去冰'].map(i => (
                <label key={i} className={`pill ${ice === i ? 'selected' : ''}`}>
                  <input type="radio" checked={ice === i} onChange={() => setIce(i)} />
                  {i}
                </label>
              ))}
            </div>
          </div>
        )}

        {showSweet && (
          <div className="option-group">
            <label>甜度</label>
            <div className="option-row">
              {['正常','少糖','無糖'].map(s => (
                <label key={s} className={`pill ${sweet === s ? 'selected' : ''}`}>
                  <input type="radio" checked={sweet === s} onChange={() => setSweet(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* {showTeaExtras && (
          <div className="option-group">
            <label>加購</label>
            <div className="option-row">
              {drinkExtraItems.map(ex => (
                <label key={ex.key} className="checkbox-pill">
                  <input
                    type="checkbox"
                    checked={drinkExtras[ex.key]}
                    onChange={() => setDrinkExtras({ ...drinkExtras, [ex.key]: !drinkExtras[ex.key] })}
                  />
                  {ex.label}+{ex.price}
                </label>
              ))}
            </div>
            {drinkExtrasCost > 0 && (
              <div style={{marginTop:6, color:'#6b7280'}}>加購小計：+NT$ {drinkExtrasCost}</div>
            )}
          </div>
        )} */}

        {/* 炒泡麵加料 ----------------------------------------------------- */}
        {isFriedNoodle && (
          <div className="option-group">
            <label>加料</label>
            <div className="option-row">
              {Object.keys(addOn).map(k => (
                <label key={k} className="checkbox-pill">
                  <input
                    type="checkbox"
                    checked={addOn[k]}
                    onChange={() => setAddOn({ ...addOn, [k]: !addOn[k] })}
                  />
                  {k}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 客製化（客製化調酒／其他／炸物／調酒三類／Shot／無酒精） ---------- */}
        {showCustomTextarea && (
          <div className="option-group">
            <label>客製化</label>
            <textarea
              rows="3"
              style={{ width:'100%', borderRadius:8, padding:8 }}
              placeholder="請輸入客製化需求"
              value={otherNote}
              onChange={e => setNote(e.target.value)}
            />
          </div>
        )}

        <button className="add-btn" onClick={handleAdd}>加入購物車</button>
      </div>
    </div>
  );
}
