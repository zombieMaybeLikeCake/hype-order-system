import pymysql
import pandas as pd
from datetime import datetime, timedelta, timezone
import os
from dotenv import load_dotenv

load_dotenv()

# 明確鎖定台北時區，避免新 VM（多為 UTC）造成日報表查詢時間整批偏移
TZ = timezone(timedelta(hours=8))

# 資料庫連線設定，與 server.js 讀同一份 .env
DB_CONF = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASS", ""),
    "database": os.getenv("DB_NAME", "order_db"),
    "autocommit": True,
    "cursorclass": pymysql.cursors.DictCursor,
}

now = datetime.now(TZ)
start_time = (now - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
end_time = now.replace(hour=7, minute=30, second=0, microsecond=0)

print(f"查詢時間範圍: {start_time} ~ {end_time}")

# Excel 檔案路徑
report_dir = './reports'
if not os.path.exists(report_dir):
    os.makedirs(report_dir)

# 構建檔案名 (年-月.xlsx)
file_name = f'{now.year}-{now.month:02}_complete_orders.xlsx'
file_path = os.path.join(report_dir, file_name)

# 連接資料庫
conn = pymysql.connect(**DB_CONF)
cursor = conn.cursor()

# 查詢指定時間範圍內的訂單資料
query = """
    SELECT o.order_id, o.table_no, o.created_at, i.item_name, i.qty, i.price, i.cost
    FROM orders o
    JOIN order_items i ON o.order_id = i.order_id
    WHERE o.created_at BETWEEN %s AND %s
"""
cursor.execute(query, (start_time, end_time))
orders_data = cursor.fetchall()

# 關閉資料庫連線
cursor.close()
conn.close()

# 如果沒有資料，直接跳過
if not orders_data:
    print("No orders found in the given time range.")
    exit()

# 整理資料成 DataFrame
df = pd.DataFrame(orders_data)

# 計算每個餐點的利潤 (price - cost) * qty
df['profit'] = (df['price'] - df['cost']) * df['qty']

# 計算每個訂單的總利潤
order_profit = df.groupby('order_id')['profit'].sum().reset_index()

# 計算所有訂單的總利潤
total_profit = order_profit['profit'].sum()

# 標記時間為「昨天」
df['created_at'] = pd.to_datetime(df['created_at']).dt.strftime('%Y-%m-%d %H:%M:%S')

# 檢查檔案是否存在，若存在則讀取並附加資料
if os.path.exists(file_path):
    with pd.ExcelWriter(file_path, engine='openpyxl', mode='a', if_sheet_exists='overlay') as writer:
        sheet_name = f'{(now - timedelta(days=1)).strftime("%Y-%m-%d")}'
        df.to_excel(writer, sheet_name=sheet_name, index=False)
        # 寫入總利潤
        summary = pd.DataFrame({'total_profit': [total_profit]})
        summary.to_excel(writer, sheet_name=sheet_name, startrow=df.shape[0] + 2, index=False)
else:
    # 若檔案不存在，創建新檔案
    with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
        sheet_name = f'{(now - timedelta(days=1)).strftime("%Y-%m-%d")}'
        df.to_excel(writer, sheet_name=sheet_name, index=False)
        # 寫入總利潤
        summary = pd.DataFrame({'total_profit': [total_profit]})
        summary.to_excel(writer, sheet_name=sheet_name, startrow=df.shape[0] + 2, index=False)

print(f"Data written to {file_path} successfully.")
print(f"Total Profit for the day: NT${total_profit:.2f}")