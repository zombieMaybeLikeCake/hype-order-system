#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每月一個 Excel；每天追加一張工作表（昨天 12:00 → 今天 04:00，台北時間）。
每月第一天，會在「上一個月」的檔案內新增/覆蓋【總和】工作表，統計：
上一月 1 日 12:00 → 本月 1 日 04:00 的所有「已付款」餐點（銷售額、成本、利潤總和）。

依賴：pip install PyMySQL openpyxl pytz python-dotenv
"""

import os, re, sys, pathlib, datetime
import pytz
import pymysql
from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter
from dotenv import load_dotenv

load_dotenv()

# ========= DB 連線設定，與 server.js 讀同一份 .env =========
DB_CONF = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASS", ""),
    "database": os.getenv("DB_NAME", "order_db"),
    "autocommit": True,
    "cursorclass": pymysql.cursors.DictCursor,
}

# ========= 其他設定 =========
OUTPUT_DIR =   './reports'
# 已付款狀態（大小寫不敏感）
PAID_STATUSES = [s.strip().lower() for s in os.getenv("PAID_STATUSES", "paid,completed").split(",") if s.strip()]

TPE = pytz.timezone("Asia/Taipei")

# ========= 時間窗 =========
def daily_window_and_labels():
    """昨天 12:00 → 今天 04:00；回傳 (start_str, end_str, sheet_date, month_label)"""
    now_tpe = datetime.datetime.now(TPE)
    y, m, d = now_tpe.year, now_tpe.month, now_tpe.day
    start = TPE.localize(datetime.datetime(y, m, d, 12, 0, 0)) - datetime.timedelta(days=1)  # 昨天 12:00
    end   = TPE.localize(datetime.datetime(y, m, d, 7, 0, 0))                                # 今天 04:00
    fmt = "%Y-%m-%d %H:%M:%S"
    start_str, end_str = start.strftime(fmt), end.strftime(fmt)
    sheet_date = start.date()  # 工作表名稱＝昨天日期
    month_label = start.strftime("%Y%m")  # 檔名＝昨天所在月份
    return start_str, end_str, sheet_date, month_label


def month_total_window_for_prev_month():
    """月初統計：上一個月 1 日 12:00 → 本月 1 日 04:00；回傳 (start_str, end_str, prev_month_label)"""
    now_tpe = datetime.datetime.now(TPE)
    first_of_this_month = TPE.localize(datetime.datetime(now_tpe.year, now_tpe.month, 1, 0, 0, 0))
    last_day_prev_month = first_of_this_month - datetime.timedelta(days=1)
    first_of_prev_month = TPE.localize(datetime.datetime(last_day_prev_month.year, last_day_prev_month.month, 1, 0, 0, 0))
    start = TPE.localize(datetime.datetime(first_of_prev_month.year, first_of_prev_month.month, 1, 12, 0, 0))
    end   = TPE.localize(datetime.datetime(first_of_this_month.year, first_of_this_month.month, 1, 4, 0, 0))
    fmt = "%Y-%m-%d %H:%M:%S"
    return start.strftime(fmt), end.strftime(fmt), first_of_prev_month.strftime("%Y%m")

# ========= 解析加價 =========
_PAT_PLUS = re.compile(r"[+＋]\s*(\d+(?:\.\d+)?)")
_PAT_TAIL = re.compile(r"(\d+(?:\.\d+)?)\s*$")

def parse_extra_charge(custom_str: str) -> float:
    if not custom_str:
        return 0.0
    total = 0.0
    for part in re.split(r"[，,]+", str(custom_str)):
        s = part.strip()
        if not s:
            continue
        # 含冒號者為標籤（冰塊:正常 / 甜度:正常），不是加價，跳過
        # 否則像 "甜度:正常5" 這種備註尾數字會被誤判成加價
        if re.search(r"[:：]", s):
            continue
        m1 = _PAT_PLUS.search(s)  # 如 (+5)
        if m1:
            total += float(m1.group(1))
            continue
        m2 = _PAT_TAIL.search(s)  # 如 "加麵10"
        if m2:
            total += float(m2.group(1))
    return total

# ========= DB 查詢 =========
SQL_BASE = """
SELECT
  o.created_at,
  o.table_no,
  oi.item_name,
  oi.qty,
  oi.price,   -- 單價（含加價）
  oi.cost,    -- 單位成本
  oi.custom,  -- 自訂內容（解析加價）
  m.profit AS menu_profit
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
JOIN menu_items   m ON m.id        = oi.item_id   -- 若你的主鍵是 m.item_id，請改本行
WHERE LOWER(o.status) IN ({status_placeholders})
  AND o.created_at BETWEEN %s AND %s
ORDER BY o.created_at ASC, o.order_id ASC, oi.item_id ASC
"""

HEAD = ["下單時間", "桌號", "餐點名稱", "售價", "成本", "利潤"]


def fetch_rows(start_str, end_str):
    placeholders = ",".join(["%s"] * len(PAID_STATUSES))
    sql = SQL_BASE.format(status_placeholders=placeholders)
    conn = pymysql.connect(**DB_CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, [*PAID_STATUSES, start_str, end_str])
            return cur.fetchall()
    finally:
        conn.close()


def autosize(ws):
    for col in ws.columns:
        max_len = 10
        letter = get_column_letter(col[0].column)
        for cell in col:
            v = cell.value
            max_len = max(max_len, len(str(v)) if v is not None else 0)
        ws.column_dimensions[letter].width = min(max_len + 2, 40)


def ensure_workbook(month_label: str):
    # OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path =  os.path.join(OUTPUT_DIR,f"PaidItems_{month_label}.xlsx")
    if os.path.exists(path):
        wb = load_workbook(path)    
    else:
        wb = Workbook()
        if wb.active and wb.active.title == 'Sheet':
            wb.remove(wb.active)
    return wb, path


def write_daily_sheet(wb, sheet_name: str, rows: list):
    if sheet_name in wb.sheetnames:
        wb.remove(wb[sheet_name])

    ws = wb.create_sheet(title=sheet_name)
    ws.append(HEAD)

    sum_amount = sum_cost = sum_profit = 0.0

    for r in rows:
        qty         = float(r.get("qty") or 0)
        unit_price  = float(r.get("price") or 0)      # 已含加價
        unit_cost   = float(r.get("cost")  or 0)
        menu_profit = float(r.get("menu_profit") or 0)
        extra       = parse_extra_charge(r.get("custom") or "")
        unit_profit = menu_profit + extra             # 加價 100% 毛利

        line_amount = qty * unit_price
        line_cost   = qty * unit_cost
        line_profit = qty * unit_profit

        ws.append([
            r.get("created_at"),
            r.get("table_no"),
            r.get("item_name"),
            round(line_amount, 2),
            round(line_cost,   2),
            round(line_profit, 2),
        ])

        sum_amount += line_amount
        sum_cost   += line_cost
        sum_profit += line_profit

    ws.append([])
    ws.append(["合計", "", "", round(sum_amount, 2), round(sum_cost, 2), round(sum_profit, 2)])

    ws.freeze_panes = "A2"
    autosize(ws)


def write_month_summary_sheet(wb, sheet_name: str, rows: list, period_label: str):
    if sheet_name in wb.sheetnames:
        wb.remove(wb[sheet_name])

    ws = wb.create_sheet(title=sheet_name)
    ws.append(["期間", "銷售額總和", "成本總和", "利潤總和"])  # 表頭

    sum_amount = sum_cost = sum_profit = 0.0
    for r in rows:
        qty         = float(r.get("qty") or 0)
        unit_price  = float(r.get("price") or 0)
        unit_cost   = float(r.get("cost")  or 0)
        menu_profit = float(r.get("menu_profit") or 0)
        extra       = parse_extra_charge(r.get("custom") or "")
        unit_profit = menu_profit + extra

        sum_amount += qty * unit_price
        sum_cost   += qty * unit_cost
        sum_profit += qty * unit_profit

    ws.append([
        period_label,
        round(sum_amount, 2),
        round(sum_cost,   2),
        round(sum_profit, 2),
    ])

    autosize(ws)


def main():
    # 1) 每日工作表
    start_str, end_str, sheet_date, month_label = daily_window_and_labels()
    rows = fetch_rows(start_str, end_str)
    wb, path = ensure_workbook(month_label)
    write_daily_sheet(wb, sheet_date.strftime("%Y-%m-%d"), rows)

    # 2) 若今天是每月第 1 天，為「上個月」檔案新增/覆蓋【總和】
    now_tpe = datetime.datetime.now(TPE)
    if now_tpe.day == 1:
        m_start_str, m_end_str, prev_month_label = month_total_window_for_prev_month()
        month_rows = fetch_rows(m_start_str, m_end_str)
        wb_prev, prev_path = ensure_workbook(prev_month_label)
        period_label = f"{m_start_str} ~ {m_end_str}"
        write_month_summary_sheet(wb_prev, "總和", month_rows, period_label)
        wb_prev.save(prev_path)
        print(f"月初總表已更新: {prev_path} (期間 {period_label})")

    wb.save(path)
    print(f"OK: {path} -> 新增工作表 {sheet_date.strftime('%Y-%m-%d')}，期間 {start_str} ~ {end_str}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
