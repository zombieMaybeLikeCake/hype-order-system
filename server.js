// server.js
import dotenv from 'dotenv';
import { createRequire } from 'module'
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
dotenv.config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const path    = require('path');
const app  = express();
const PORT = process.env.PORT || 5000;
const allowedRoles = ['admin', 'employee'];   // 允許這兩種角色更新狀態
const allowedAdmin = ['admin'];

// 沒設 JWT_SECRET 就直接讓服務起不來，避免用可猜測的預設值簽章
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('缺少 JWT_SECRET，請在 .env 設定後再啟動');
  process.exit(1);
}
const toLocal = (d = new Date()) =>
  new Date(d.getTime() + 8*60*60*1000)           // 加 8h
    .toISOString().replace('T', ' ').slice(0,19); // "YYYY-MM-DD HH:mm:ss"

// // 更新人數
// const updateSql = 'UPDATE venue_fees SET people_count=?, updated_at=? WHERE id=?';
// await conn.execute(updateSql, [peopleCount, toLocal(), id]);  
const fs = require('fs');  // ← 往上移，避免先用後宣告

const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).send('無權限');
    req.user = decoded;
    next();
  } catch {
    return res.status(401).send('Token 無效或已過期');
  }
};
app.use(bodyParser.json());

// CORS_ORIGIN 可放多個來源，用逗號分隔；沒設就不開放任何跨網域請求（前端與 API 同源時本來就不需要 CORS）
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins }));
}

/* ---------- MariaDB 連線池 ---------- */
const pool = mysql.createPool({
  host               : process.env.DB_HOST || 'localhost',
  user               : process.env.DB_USER || 'root',
  password           : process.env.DB_PASS || 'password',
  database           : process.env.DB_NAME || 'order_db',
  waitForConnections : true,
  connectionLimit    : 10,
  timezone           : '+08:00',   // 明確鎖定台北時區，避免新 VM（多為 UTC）造成訂單時間整批偏移
});

/* ---------- 員工登入 ---------- */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      'SELECT * FROM employees WHERE username = ?',
      [username]
    );
    if (rows.length === 0) {
      return res.status(400).send('無效的帳號或密碼');
    }

    const employee = rows[0];
    const isMatch  = bcrypt.compareSync(password, employee.password); // bcryptjs 同步比對
    if (!isMatch) {
      return res.status(400).send('無效的帳號或密碼');
    }

    const token = jwt.sign(
      { userId: employee.id, username: employee.username, role: employee.role },
      JWT_SECRET,
      { expiresIn: '180d' }
    );

    res.json({ token });
  } catch (err) {
    console.error('LoginError:', err);
    res.status(500).send('伺服器錯誤');
  } finally {
    conn.release();
  }
});

/* ---------- 查詢訂單 ---------- */
app.get('/api/orders', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');

  try {
    jwt.verify(token, JWT_SECRET);
    const conn = await pool.getConnection();
    const [orders] = await conn.execute('SELECT * FROM orders');
    conn.release();
    res.json(orders);
  } catch (err) {
    res.status(401).send('無效的 Token');
  }
});


/* ---------- 建立訂單 ---------- */
app.post('/api/orders', async (req, res) => {
  const { tableNo, items } = req.body;
  if (!tableNo || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'payload 不完整' });
  }

  // 從 custom 陣列抓出加價（例如 "加奶精(+5)" 或 "加麵10"）
  const parseExtraCharge = (customArr = []) => {
    let sum = 0;
    for (const s of customArr) {
      if (typeof s !== 'string') continue;
      // 含冒號者為「標籤」（冰塊:正常 / 甜度:正常 / 客製化備註:...），非加價，直接略過
      // 可避免顧客在客製化文字框輸入以數字結尾的內容被誤判成加價
      if (/[:：]/.test(s)) continue;
      // 形式1：含 +5 或 ＋5
      const m1 = s.match(/[+＋]\s*(\d+(?:\.\d+)?)/);
      if (m1) { sum += Number(m1[1]); continue; }
      // 形式2：字串結尾是數字，例如 "加麵10"
      const m2 = s.match(/(\d+(?:\.\d+)?)\s*$/);
      if (m2) { sum += Number(m2[1]); }
    }
    return sum;
  };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 依原本邏輯：created_at 寫入台北時間
    const [orderRes] = await conn.execute(
      'INSERT INTO orders (table_no, status, created_at) VALUES (?, ?, NOW())',
      [tableNo, 'pending']
    );
    const orderId = orderRes.insertId;

    const itemSql = `
      INSERT INTO order_items
        (order_id, item_id, item_name, qty, price, cost, size, custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    let totalAmount = 0;
    let totalProfit = 0;

    for (const item of items) {
      const { itemId, qty, size = null, custom = [] } = item;
      if (!itemId || !qty) continue;

      // 取出 name/price/cost/profit（profit 來自 menu_items）
      const [rows] = await conn.execute(
        'SELECT name, price, cost, profit FROM menu_items WHERE id = ?',
        // 若主鍵是 item_id 請改成：
        // 'SELECT name, price, cost, profit FROM menu_items WHERE item_id = ?',
        [itemId]
      );
      if (rows.length === 0) continue;

      const { name, price, cost, profit } = rows[0];
      const customStr = Array.isArray(custom) ? custom.join(', ') : String(custom || '');

      // 加價（單位）
      const extra = parseExtraCharge(custom);

      // 單位售價 = 基礎價 + 加價
      const unitPrice = Number(price) + Number(extra);

      // 單位淨利 = menu_items.profit + 加價（加價視同 100% 毛利）
      const unitProfit = Number(profit) + Number(extra);

      // 落庫（仍只存 price/cost，不存 profit；若要長期鎖利潤可在 order_items 加 profit 欄位）
      await conn.execute(itemSql, [
        orderId,
        itemId,
        name,
        qty,
        unitPrice,
        cost,
        size,
        customStr,
      ]);

      totalAmount += unitPrice * qty;
      totalProfit += unitProfit * qty;
    }

    await conn.execute(
      'UPDATE orders SET total_amount = ? WHERE order_id = ?',
      [totalAmount, orderId]
    );
    // 若有 orders.total_profit 欄位，取消註解一起寫入：
    // await conn.execute('UPDATE orders SET total_profit = ? WHERE order_id = ?', [totalProfit, orderId]);

    await conn.commit();
    res.json({
      message: '訂單建立成功',
      orderId,
      total_amount: totalAmount,
      total_profit: totalProfit
    });
  } catch (err) {
    await conn.rollback();
    console.error('建立訂單失敗:', err);
    res.status(500).json({ message: '伺服器錯誤', error: err.message });
  } finally {
    conn.release();
  }
});

/* ---------- 更新訂單狀態 ---------- */
const updateOrderStatus = (status) => async (req, res) => {
  const { id } = req.params; // 這裡的 id 其實就是 order_id
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).send('無權限');
    }

    const conn = await pool.getConnection();
    // 這行改為 order_id
    await conn.execute(
      'UPDATE orders SET status = ? WHERE order_id = ?',
      [status, id]
    );
    conn.release();

    res.send(`訂單已標記為 ${status}`);
  } catch (err) {
    console.error('UpdateStatusError:', err);
    res.status(401).send('Token 無效或權限不足');
  }
};
/* ---------- 讀取明細 ---------- */
app.get('/api/orders/:id/items', async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      'SELECT item_name, qty, price, size, custom FROM order_items WHERE order_id = ?',
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: '讀取明細錯誤' });
  } finally {
    conn.release();
  }
});
/* ---------- 刪除訂單中特定餐點 ---------- */
app.delete('/api/orders/:id', async (req,res)=>{
  const { id } = req.params;
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).send('Token 無效或已過期');
  }
  // if (!allowedRoles.includes(decoded.role)) return res.status(403).send('無權限');
  if (!allowedAdmin.includes(decoded.role)) return res.status(403).send('無權限');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
    await conn.execute('DELETE FROM orders WHERE order_id = ?', [id]);
    await conn.commit();
    res.send('訂單已刪除');
  } catch(e){
    await conn.rollback();
    res.status(500).send('刪除失敗');
  } finally {
    conn.release();
  }
});
app.delete('/api/orders/:orderId/items/:itemId', async (req, res) => {
  const { orderId, itemId } = req.params;
  console.log('DELETE /api/orders/:orderId/items/:itemId', { orderId, itemId });
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).send('Token 無效');
  }

  if (!allowedAdmin.includes(decoded.role)) {
    return res.status(403).send('無權限');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 刪除該訂單中的特定餐點
    const [result] = await conn.execute(
      'DELETE FROM order_items WHERE order_id = ? AND item_name = ?',
      [orderId, itemId]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).send('找不到該餐點或訂單');
    }

    // 檢查該訂單是否還有其他餐點
    const [rows] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ?',
      [orderId]
    );

    if (rows[0].cnt === 0) {
      // 沒有餐點了 → 刪除整張訂單
      await conn.execute('DELETE FROM orders WHERE order_id = ?', [orderId]);
      await conn.commit();
      return res.send('餐點刪除，訂單已一併刪除');
    }

    await conn.commit();
    res.send('餐點已刪除');
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).send('刪除失敗');
  } finally {
    conn.release();
  }
});
// 依時間窗查詢訂單金額/成本/利潤（admin only）

function parseExtraCharge(customStr = '') {
  if (Array.isArray(customStr)) customStr = customStr.join(', ');
  const parts = String(customStr || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  let sum = 0;
  for (const s of parts) {
    // 含冒號者為「標籤」（冰塊:正常 / 甜度:正常 / 客製化備註:...），非加價，直接略過
    if (/[:：]/.test(s)) continue;
    const m1 = s.match(/[+＋]\s*(\d+(?:\.\d+)?)/);        // 形式1：(+5)
    if (m1) { sum += Number(m1[1]); continue; }
    const m2 = s.match(/(\d+(?:\.\d+)?)\s*$/);            // 形式2：字串尾數字，如「加麵10」
    if (m2) { sum += Number(m2[1]); }
  }
  return sum;
}

// 依時間窗查詢訂單（台北時間字串）
app.get('/api/orders/window', verifyAdmin, async (req, res) => {
  const { start, end, withItems = '1' } = req.query;
  if (!start || !end) {
    return res.status(400).json({ message: 'start/end 必填，格式 YYYY-MM-DD HH:mm:ss' });
  }

  const DETAIL_SQL = `
    SELECT
      o.order_id,
      o.table_no,
      o.created_at,
      oi.item_id,
      oi.item_name,
      oi.qty,
      oi.price,
      oi.cost,
      oi.size,
      oi.custom,
      m.profit AS menu_profit
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    JOIN menu_items   m ON m.id = oi.item_id
    WHERE o.created_at BETWEEN ? AND ?
    ORDER BY o.created_at ASC, o.order_id ASC, oi.item_id ASC
  `;

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(DETAIL_SQL, [start, end]);

    // 組裝訂單：金額/成本由 order_items 累加；淨利 = (menu_profit + 加價) * qty
    const byOrder = new Map();
    for (const r of rows) {
      const key = r.order_id;
      if (!byOrder.has(key)) {
        byOrder.set(key, {
          order_id   : r.order_id,
          table_no   : r.table_no,
          created_at : r.created_at,
          amount     : 0,
          cost       : 0,
          profit     : 0,
          items      : []
        });
      }
      const o = byOrder.get(key);

      const qty          = Number(r.qty || 0);
      const unitPrice    = Number(r.price || 0);
      const unitCost     = Number(r.cost || 0);
      const unitMenuPft  = Number(r.menu_profit || 0);
      const extra        = parseExtraCharge(r.custom);
      const unitProfit   = unitMenuPft + extra;           // 把加價也算入淨利（100% 毛利）
      const lineAmount   = unitPrice  * qty;
      const lineCost     = unitCost   * qty;
      const lineProfit   = unitProfit * qty;

      o.amount += lineAmount;
      o.cost   += lineCost;
      o.profit += lineProfit;

      if (withItems === '1') {
        o.items.push({
          item_id    : r.item_id,
          item_name  : r.item_name,
          qty,
          price      : unitPrice,
          cost       : unitCost,
          size       : r.size,
          custom     : r.custom,
          profit     : unitProfit      // 單份利潤（menu_items.profit + 加價）
        });
      }
    }

    // 彙總
    const orders = Array.from(byOrder.values());
    const summary = orders.reduce((s, o) => ({
      amount: s.amount + o.amount,
      cost  : s.cost   + o.cost,
      profit: s.profit + o.profit
    }), { amount: 0, cost: 0, profit: 0 });

    res.json({ orders, summary });
  } catch (err) {
    console.error('OrderWindowError:', err);
    res.status(500).json({ message: '查詢失敗', error: err.message });
  } finally {
    conn.release();
  }
});
/* ---------- 新增場地費計時 ---------- */
app.post('/api/venue',async (req, res) => {
  const { tableNo, peopleCount, startTime } = req.body;
  if (!tableNo || !peopleCount || !startTime) {
    return res.status(400).json({ message: '缺少必要欄位' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.execute(
      'INSERT INTO venue_fees (table_no, people_count, start_time) VALUES (?, ?, ?)',
      [tableNo, peopleCount, startTime]
    );
    res.json({ message: '場地費已新增' });
  } catch (err) {
    console.error('新增場地費失敗:', err);
    res.status(500).json({ message: '伺服器錯誤' });
  } finally {
    conn.release();
  }
});
/* ---------- 修改場地費人數 ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LEAVE_LOG = path.join(__dirname, 'venue_leave_log.txt');  // 紀錄檔

app.put('/api/venue/:id/people', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');

  const { id }          = req.params;
  const { peopleCount } = req.body;            // 新人數
  if (typeof peopleCount !== 'number')
    return res.status(400).json({ message: '人數格式錯誤' });

  const conn = await pool.getConnection();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!allowedRoles.includes(decoded.role))
      return res.status(403).send('無權限');

    /* 先抓舊人數 & 桌號 */
    const [oldRows] = await conn.execute(
      'SELECT table_no, people_count FROM venue_fees WHERE id = ?',
      [id]
    );
    if (oldRows.length === 0) return res.status(404).send('找不到資料');

    const { table_no, people_count: oldCount } = oldRows[0];

    /* 若有人提前離場（oldCount > newCount）→ 紀錄 */
    const diff = oldCount - peopleCount;
    if (diff > 0) {
      const now = new Date().toLocaleString('zh-TW', { hour12: false })
   .replace(/\//g, '-')                            // 把斜線 "/" 換成 "-"
  .replace(/(\b\d\b)/g, '0$1')                    // 確保單位數的月、日、時、分、秒都是兩位數
      const line = `${now}  Table:${table_no}  EarlyLeave:${diff}\n`;
      fs.appendFile(LEAVE_LOG, line, (e) => {
        if (e) console.error('寫入 leave_log 失敗:', e);
      });
    }

    /* 更新人數 */
    await conn.execute(
      'UPDATE venue_fees SET people_count = ? WHERE id = ?',
      [peopleCount, id]
    );

    res.json({ message: '人數已更新', oldCount, newCount: peopleCount });
  } catch (err) {
    console.error('更新人數失敗:', err);
    res.status(500).json({ message: '伺服器錯誤' });
  } finally {
    conn.release();
  }
});
/* ---------- 更新場地費結束時間 (員工以上) ---------- */
app.put('/api/venue/:id/end', async (req, res) => {
  const { id }   = req.params;
  const { time } = req.body;                 // 前端傳 ISO 字串
  const token    = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!allowedRoles.includes(decoded.role))
      return res.status(403).send('無權限');

    const conn = await pool.getConnection();
    const [rs] = await conn.execute(
      'UPDATE venue_fees SET end_time = ? WHERE id = ?',
      [time, id]
    );
    conn.release();

    if (rs.affectedRows === 0) return res.status(404).send('找不到資料');
    res.json({ message: '已更新結束時間', end_time: time });
  } catch (e) {
    console.error('Update end_time error:', e);
    res.status(500).send('伺服器錯誤');
  }
});
/* ---------- 查詢所有「尚未付款」的場地費訂單 ---------- */
app.get('/api/venue/unpaid', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');
  const conn = await pool.getConnection();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).send('無權限');
    }
    const [rows] = await conn.execute(
      'SELECT * FROM venue_fees WHERE is_paid = FALSE ORDER BY start_time DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('查詢未付款場地費失敗:', err);
    res.status(500).json({ message: '伺服器錯誤' });
  } finally {
    conn.release();
  }
});
app.get('/api/venue/day', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ message: 'start/end 必填，格式 YYYY-MM-DD HH:mm:ss' });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const DETAIL_SQL = `
      SELECT *
      FROM venue_fees
      WHERE start_time BETWEEN ? AND ?
      ORDER BY start_time DESC
    `;

    const [rows] = await conn.execute(DETAIL_SQL, [start, end]);

    res.json(rows);
  } catch (err) {
    console.error('查詢場地費失敗:', err);
    res.status(500).json({ message: '伺服器錯誤', error: err.message });
  } finally {
    if (conn) conn.release();
  }
});
/* ---------- 查詢特定座位的場地費 ---------- */
app.get('/api/venue/unpaid/:table_no', async (req, res) => {
  const { table_no } = req.params;
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      'SELECT * FROM venue_fees WHERE table_no = ? AND is_paid = FALSE ORDER BY start_time DESC',
      [table_no]
    );
    res.json(rows);
  } catch (err) {
    console.error('查詢場地費失敗:', err);
    res.status(500).json({ message: '伺服器錯誤' });
  } finally {
    conn.release();
  }
});
// ---------- 標記場地費為已付款（限員工以上） ----------
app.put('/api/venue/:id/pay', async (req, res) => {
  const { id } = req.params;
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('未授權');
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).send('Token 無效或已過期');
  }
  if (!allowedRoles.includes(decoded.role)) return res.status(403).send('無權限');

  try {
    const [result] = await pool.query(
      'UPDATE venue_fees SET is_paid = true WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到場地費資料' });
    }
    res.json({ message: '已標記為已付款' });
  } catch (e) {
    console.error('更新場地費付款狀態失敗：', e);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});
/* ---------- 刪除場地費（admin 或 employee 可用；已付款需 ?force=1） ---------- */
app.delete('/api/venue/:id', async (req, res) => {
  const { id } = req.params;
  const force = req.query.force === '1';

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).send('未授權');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // 僅允許 admin / employee
    // if (!['admin', 'employee'].includes(decoded.role)) {
    if (!['admin'].includes(decoded.role)) {
      return res.status(403).send('無權限');
    }

    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute(
        'SELECT is_paid FROM venue_fees WHERE id = ?',
        [id]
      );
      if (rows.length === 0) {
        conn.release();
        return res.status(404).send('找不到場地費');
      }

      const paid = !!rows[0].is_paid;

      // 已付款必須明確帶 ?force=1（避免誤刪）
      if (paid && !force) {
        conn.release();
        return res.status(409).json({ message: '已付款，若要刪除請加 ?force=1' });
      }

      // ※ 這裡不再限制只有 admin 可強制刪除，employee 也可
      await conn.execute('DELETE FROM venue_fees WHERE id = ?', [id]);

      conn.release();
      return res.json({
        message: '場地費已刪除',
        id,
        forced: paid && force,
        by: decoded.username || decoded.id,
        role: decoded.role
      });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (err) {
    console.error('Delete venue fee error:', err);
    return res.status(500).send('伺服器錯誤');
  }
});

/* ====== ② 讓 admin 列出 & 下載 /reports 資料夾下所有 .xlsx ====== */
// const fs   = require('fs');
const REPORT_DIR = path.join(__dirname, 'reports'); // 自行決定資料夾

// (1) 取得檔案清單
app.get('/api/xlsx', verifyAdmin, (req, res) => {

  fs.readdir(REPORT_DIR, (err, files) => {
    if (err) return res.status(500).send('讀取目錄失敗');
    const list = files.filter(f => f.toLowerCase().endsWith('.xlsx'));
    res.json(list);
  });
});

// (2) 下載檔案
app.get('/api/xlsx/:name', verifyAdmin, (req, res) => {
  const fileName = req.params.name;
  // 基礎安全檢查：阻擋路徑穿越（只允許單純檔名）
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return res.status(400).send('路徑不合法');
  }
  const filePath = path.join(REPORT_DIR, fileName);
  // 再以 path.relative 確認解析後仍在 REPORT_DIR 內
  const rel = path.relative(REPORT_DIR, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(400).send('路徑不合法');
  if (!fs.existsSync(filePath))         return res.status(404).send('檔案不存在');
  res.download(filePath);
});
/* ======== 取得所有員工 (admin only) ======== */
app.get('/api/employees', verifyAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      'SELECT id, username, role FROM employees ORDER BY id'
    );
    res.json(rows);
  } catch (e) {
    console.error('GET employees error:', e);
    res.status(500).send('讀取員工失敗');
  } finally { conn.release(); }
});

/* ======== 新增員工 (admin only) ======== */
app.post('/api/employees', verifyAdmin, async (req, res) => {
  const { username, password, role = 'employee' } = req.body;
  if (!username || !password) return res.status(400).send('缺少帳號或密碼');

  const hash = bcrypt.hashSync(password, 10);
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      'INSERT INTO employees (username, password, role) VALUES (?,?,?)',
      [username, hash, role]
    );
    res.json({ message: '員工已新增' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).send('帳號已存在');
    console.error('POST employees error:', e);
    res.status(500).send('新增失敗');
  } finally { conn.release(); }
});

/* ======== 批次刪除員工 (admin only) ======== */
app.delete('/api/employees', verifyAdmin, async (req, res) => {
  const { ids } = req.body;                 // 期待 [1,2,3]
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).send('ids 格式錯誤');

  const conn = await pool.getConnection();
  try {
    const qs = ids.map(() => '?').join(',');
    await conn.execute(`DELETE FROM employees WHERE id IN (${qs})`, ids);
    res.json({ message: '已刪除' });
  } catch (e) {
    console.error('DELETE employees error:', e);
    res.status(500).send('刪除失敗');
  } finally { conn.release(); }
});
app.put('/api/orders/:id/cooked', updateOrderStatus('cooked'));
app.put('/api/orders/:id/paid',   updateOrderStatus('paid'));
app.use(express.static(path.join(__dirname,'client','build')));
// SPA fallback：非 /api 的 GET 一律回傳 index.html，交給 React Router 接手
// （用 middleware 形式取代不合法的 app.get('\{*any}')，避免啟動錯誤與 QR 直接進站 404）
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});
/* ---------- 啟動伺服器 ---------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器啟動於 http://0.0.0.0:${PORT}`);
});
