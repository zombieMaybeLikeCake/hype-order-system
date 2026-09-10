// BluetoothPrinter.js — 藍牙熱感印表機測試頁（route: /bluetooth-printer）
// 連線印表機、輸入測試文字、送出列印，用來驗證 useBluetoothPrinter 是否正常。

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBluetoothPrinter } from './useBluetoothPrinter';
import '../App.css';

const SAMPLE =
`========= HYPE 酒吧 =========
藍牙印表機測試
中文列印測試：調酒、炸物、場地費
English & numbers 12345
=============================\n\n\n`;

export default function BluetoothPrinter() {
  const navigate = useNavigate();
  const { bleConn, bleConnect, print } = useBluetoothPrinter();
  const [text, setText] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);

  const doPrint = async () => {
    setBusy(true);
    try {
      await print(text);
    } catch (e) {
      console.error(e);
      alert('列印失敗，請重試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app modern" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 24 }}>
      <div className="modal-content modern">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>藍牙印表機測試</h2>
          <button onClick={() => navigate(-1)}>返回</button>
        </div>

        <p style={{ color: bleConn ? '#0a0' : '#888', marginTop: 8 }}>
          狀態：{bleConn ? '● 已連線' : '○ 未連線'}
        </p>

        <button className="connect-btn" onClick={bleConnect} style={{ marginBottom: 16 }}>
          {bleConn ? '重新連線印表機' : '連線藍牙印表機'}
        </button>

        <div className="option-group">
          <label>列印內容</label>
          <textarea
            rows="8"
            style={{ width: '100%', borderRadius: 8, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace' }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <button className="add-btn" onClick={doPrint} disabled={busy} style={{ width: '100%' }}>
          {busy ? '列印中…' : '送出列印'}
        </button>

        <p style={{ color: '#888', fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>
          需使用支援 Web Bluetooth 的瀏覽器（Chrome / Edge），且網頁需在 HTTPS 或 localhost 下開啟。
        </p>
      </div>
    </div>
  );
}
