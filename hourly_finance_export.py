#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每小時統計利潤：
  1. 未付款訂單利潤
  2. 仍在計時場地費
  3. 本小時提前離場場地費
結果寫入 ./reports/YYYY-MM.xlsx（每日一工作表），僅在「每日 12:00 ~ 次日 07:00」（UTC+8）才執行。
"""

from datetime import datetime, timedelta, timezone
from math import ceil
import os, pathlib, pandas as pd
import pymysql
import pymysql.cursors
from dotenv import load_dotenv

load_dotenv()

# === 時區設定 ===
TZ = timezone(timedelta(hours=8))           # Asia/Taipei  (UTC+8)
NOW = datetime.now(TZ)                      # 取本地時間

# 僅在 12:00 ~ 06:59 執行
if not (NOW.hour >= 12 or NOW.hour < 7):
    print(f"{NOW:%F %T} 不在結算時段，程式結束")
    exit(0)

HOUR_START = NOW.replace(minute=0, second=0, microsecond=0)
HOUR_END   = HOUR_START + timedelta(hours=1)

# === MySQL 連線設定，與 server.js 讀同一份 .env ===
DB_CONF = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASS", ""),
    "database": os.getenv("DB_NAME", "order_db"),
    "autocommit": True,
    "cursorclass": pymysql.cursors.DictCursor,
}

LEAVE_LOG  = pathlib.Path(__file__).with_name("venue_leave_log.txt")
REPORT_DIR = pathlib.Path(__file__).with_name("reports")
REPORT_DIR.mkdir(exist_ok=True)

xlsx_path  = REPORT_DIR / f"{NOW:%Y-%m}.xlsx"
sheet_name = f"{NOW:%Y-%m-%d}"

# === 資料庫查詢 ===
conn = pymysql.connect(**DB_CONF)
cur  = conn.cursor()

# 1) 當小時未付款訂單 --------------------------------------------------------
cur.execute(
    """
    SELECT o.order_id, o.table_no, i.qty, i.price, i.cost
    FROM   orders o
    JOIN   order_items i ON i.order_id = o.order_id
    WHERE  o.status <> 'paid'
      AND  o.created_at >= %s AND o.created_at < %s
    """,
    (HOUR_START, HOUR_END),
)

df_orders = pd.DataFrame(cur.fetchall())
if df_orders.empty:
    orders_rev = orders_cost = orders_profit = 0
else:
    df_orders["revenue"] = df_orders.qty * df_orders.price
    df_orders["cost"]    = df_orders.qty * df_orders.cost
    df_grp = (
        df_orders.groupby("order_id")
        .agg(revenue=("revenue", "sum"), cost=("cost", "sum"))
        .reset_index()
    )
    df_grp["profit"] = df_grp.revenue - df_grp.cost
    orders_rev    = df_grp.revenue.sum()
    orders_cost   = df_grp.cost.sum()
    orders_profit = df_grp.profit.sum()

# 2) 仍在計時場地費 -----------------------------------------------------------
cur.execute(
    """
    SELECT id, table_no, people_count, start_time
    FROM   venue_fees
    WHERE  is_paid = 0 AND end_time IS NULL
    """
)

df_venue = pd.DataFrame(cur.fetchall())

def fee_to_hour_end(row):
    start = row["start_time"]
    # 將資料庫取出的 naive datetime 加上時區
    if start.tzinfo is None:
        start = start.replace(tzinfo=TZ)

    if start > HOUR_END:
        return 0  # 本小時尚未開始

    begin   = max(start, HOUR_START)
    minutes = (HOUR_END - begin).total_seconds() / 60
    hours   = ceil(minutes / 60)  # 進位計時
    return hours * row["people_count"] * 30

venue_running = 0 if df_venue.empty else df_venue.apply(fee_to_hour_end, axis=1).sum()

# 3) 提前離場費 --------------------------------------------------------------
early_fee = 0
if LEAVE_LOG.exists():
    with LEAVE_LOG.open("r", encoding="utf-8") as f:
        for line in f:
            # 格式：2025-07-29 15:45:00  Table:A1  EarlyLeave:2
            try:
                ts_str, _, rest = line.partition("  ")
                ts = datetime.strptime(ts_str.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
                if HOUR_START <= ts < HOUR_END:
                    diff = int(rest.split("EarlyLeave:")[1])
                    early_fee += diff * 30
            except Exception:
                continue

# 4) 匯總 ------------------------------------------------------------
summary = pd.DataFrame([
    {
        "時間區段": f"{HOUR_START:%Y-%m-%d %H:%M}-{HOUR_END:%H:%M}",
        "訂單營收": orders_rev,
        "訂單成本": orders_cost,
        "訂單利潤": orders_profit,
        "場地費(進行中)": venue_running,
        "場地費(提前離)": early_fee,
        "總利潤(估)": orders_profit + venue_running + early_fee,
    }
])

# 5) 寫入 Excel ------------------------------------------------------
if xlsx_path.exists():
    try:
        prev = pd.read_excel(xlsx_path, sheet_name=sheet_name)
    except ValueError:
        prev = pd.DataFrame()
    df_out = pd.concat([prev, summary], ignore_index=True)
    mode, if_sheet = "a", "replace"
else:
    df_out = summary
    mode, if_sheet = "w", None

with pd.ExcelWriter(
    xlsx_path,
    engine="openpyxl",
    mode=mode,
    if_sheet_exists=if_sheet,
) as writer:
    df_out.to_excel(writer, sheet_name=sheet_name, index=False)

print(f"{NOW:%F %T} 已寫入 {xlsx_path.name} -> {sheet_name}")

cur.close()
conn.close()
