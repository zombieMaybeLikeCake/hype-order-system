-- schema.sql — HYPE 點餐系統資料庫結構
-- 依 server.js 與三支 Python 匯出腳本裡的 SQL 語句反推而成（非官方 dump）。
-- 用途：本機/新機從零建立一套「能跑起來」的資料庫。
-- 若你手上有正式主機的 mysqldump，請以那份為準。
--
-- 建立方式：
--   mysql -uroot -p order_db < schema.sql
-- 或先建庫再匯入：
--   CREATE DATABASE order_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 若尚未建庫可取消下面兩行註解：
-- CREATE DATABASE IF NOT EXISTS order_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE order_db;

SET NAMES utf8mb4;

-- =====================================================================
-- employees — 員工/管理員帳號（server.js: /api/login, /api/employees）
--   role: 'admin' | 'employee'；password 為 bcrypt 雜湊
-- =====================================================================
CREATE TABLE IF NOT EXISTS employees (
  id       INT           NOT NULL AUTO_INCREMENT,
  username VARCHAR(64)   NOT NULL,
  password VARCHAR(255)  NOT NULL,           -- bcryptjs 雜湊（約 60 字元）
  role     VARCHAR(16)   NOT NULL DEFAULT 'employee',
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- menu_items — 菜單品項的價格/成本/利潤主檔
--   server.js 以 WHERE id=? 取 name/price/cost/profit；報表以 m.id = oi.item_id JOIN
--   前端 data.js 的品項 id（如 '0001'）需對應到本表的 id
-- =====================================================================
CREATE TABLE IF NOT EXISTS menu_items (
  id     INT            NOT NULL AUTO_INCREMENT,
  name   VARCHAR(128)   NOT NULL,
  price  DECIMAL(10,2)  NOT NULL DEFAULT 0,   -- 基礎售價
  cost   DECIMAL(10,2)  NOT NULL DEFAULT 0,   -- 單位成本
  profit DECIMAL(10,2)  NOT NULL DEFAULT 0,   -- 單位淨利（利潤計算以此為準）
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- orders — 訂單主表（server.js: /api/orders）
--   status: 'pending' | 'cooked' | 'paid'
--   created_at 以台北時間寫入（連線池 timezone=+08:00）
--   total_amount 於品項寫入後回填
-- =====================================================================
CREATE TABLE IF NOT EXISTS orders (
  order_id     INT            NOT NULL AUTO_INCREMENT,
  table_no     VARCHAR(16)    NOT NULL,
  status       VARCHAR(16)    NOT NULL DEFAULT 'pending',
  total_amount DECIMAL(10,2)  NOT NULL DEFAULT 0,
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  KEY idx_orders_created_at (created_at),
  KEY idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- order_items — 訂單明細（server.js: INSERT (order_id,item_id,item_name,qty,price,cost,size,custom)）
--   price 為「含加價」的單位售價；custom 為客製化備註合併字串
-- =====================================================================
CREATE TABLE IF NOT EXISTS order_items (
  id        INT            NOT NULL AUTO_INCREMENT,
  order_id  INT            NOT NULL,
  item_id   INT            NOT NULL,
  item_name VARCHAR(128)   NOT NULL,
  qty       INT            NOT NULL DEFAULT 1,
  price     DECIMAL(10,2)  NOT NULL DEFAULT 0,   -- 單位售價（含加價）
  cost      DECIMAL(10,2)  NOT NULL DEFAULT 0,   -- 單位成本
  size      VARCHAR(32)    DEFAULT NULL,
  custom    TEXT           DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_order_items_order_id (order_id),
  KEY idx_order_items_item_id (item_id),
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_menu
    FOREIGN KEY (item_id) REFERENCES menu_items (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- venue_fees — 場地費（每人每小時 30 元）計時
--   server.js: /api/venue*；is_paid 預設未付款；end_time 未結束為 NULL
-- =====================================================================
CREATE TABLE IF NOT EXISTS venue_fees (
  id           INT        NOT NULL AUTO_INCREMENT,
  table_no     VARCHAR(16) NOT NULL,
  people_count INT        NOT NULL DEFAULT 1,
  start_time   DATETIME   NOT NULL,
  end_time     DATETIME   DEFAULT NULL,
  is_paid      TINYINT(1) NOT NULL DEFAULT 0,
  updated_at   DATETIME   DEFAULT NULL,          -- 部分更新路徑會寫入
  PRIMARY KEY (id),
  KEY idx_venue_fees_start_time (start_time),
  KEY idx_venue_fees_is_paid (is_paid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 種子資料：第一個管理員帳號（首個 admin 必須直接寫入 DB，
--   因為 /api/employees 新增帳號本身需要既有 admin 權杖）
--   帳號 admin / 密碼 admin123（bcrypt 雜湊）— 登入後請立刻改掉！
-- =====================================================================
INSERT INTO employees (username, password, role)
VALUES ('admin', '$2a$10$jQ592AJaoWd/KEFBvxZyz.UNJPu8Xodn.R3D30k8DLJiLsPvbOSAq', 'admin')
ON DUPLICATE KEY UPDATE username = username;
