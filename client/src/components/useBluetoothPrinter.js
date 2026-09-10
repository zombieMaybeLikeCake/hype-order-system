// useBluetoothPrinter.js
// Web Bluetooth 熱感印表機 hook。對外介面： { bleConn, bleConnect, print }
//
// 中文編碼採 GBK/GB18030（大陸品牌印表機常用）。瀏覽器內建的 TextEncoder 只能輸出
// UTF-8，無法直接編 GBK；但 TextDecoder('gbk') 可以「解碼」，因此我們在執行期用它
// 反向建出「Unicode code point -> GBK 雙位元組」對照表，不需外掛套件、也不必打包大表。

import { useCallback, useRef, useState } from 'react';

/* ------- 常見熱感印表機（58mm/80mm）BLE 服務／特徵值 UUID ------- */
const PRINTER_SERVICES = [
  0x18f0,                                   // 常見 ESC/POS BLE 服務
  0xff00,                                   // 部分機型
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',   // 部分藍牙序列模組
];
const WRITE_CHARACTERISTICS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

/* ---------------- GBK 反向編碼表（惰性建立一次） ---------------- */
let gbkEncodeMap = null;
function buildGbkMap() {
  if (gbkEncodeMap) return gbkEncodeMap;
  const map = new Map();
  const decoder = new TextDecoder('gbk');
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;               // 0x7f 不是合法 trail byte
      const bytes = new Uint8Array([lead, trail]);
      const ch = decoder.decode(bytes);
      // 解不出來的會變成 U+FFFD（replacement），略過
      if (ch.length !== 1) continue;
      const cp = ch.codePointAt(0);
      if (cp === 0xfffd) continue;
      if (!map.has(cp)) map.set(cp, [lead, trail]);
    }
  }
  gbkEncodeMap = map;
  return map;
}

// 把字串轉成 GBK bytes：ASCII 原樣、其餘查表；查不到的字以 '?' 代替。
function encodeGbk(str) {
  const map = buildGbkMap();
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      out.push(cp);                                // ASCII
    } else if (map.has(cp)) {
      const [lead, trail] = map.get(cp);
      out.push(lead, trail);
    } else {
      out.push(0x3f);                              // '?'
    }
  }
  return Uint8Array.from(out);
}

/* -------------------------- ESC/POS -------------------------- */
const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

// 初始化 + 開啟中文（漢字）模式
const INIT = Uint8Array.from([ESC, 0x40, FS, 0x26]); // ESC @ , FS &
// 走紙數行 + 切紙（GS V 66 0）
const CUT = Uint8Array.from([0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function useBluetoothPrinter() {
  const [bleConn, setBleConn] = useState(false);
  const charRef = useRef(null);   // 可寫特徵值
  const deviceRef = useRef(null);

  /* ---------------- 連線 ---------------- */
  const bleConnect = useCallback(async () => {
    if (!navigator.bluetooth) {
      alert('此瀏覽器不支援 Web Bluetooth，請改用 Chrome / Edge。');
      return false;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        // 接受任何裝置，但先宣告可能用到的服務，才能在連線後存取
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES,
      });
      deviceRef.current = device;
      device.addEventListener('gattserverdisconnected', () => {
        setBleConn(false);
        charRef.current = null;
      });

      const server = await device.gatt.connect();

      // 找出第一個「可寫」特徵值
      let writeChar = null;
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            // 優先挑名單內的已知特徵值
            if (WRITE_CHARACTERISTICS.includes(c.uuid)) {
              writeChar = c;
              break;
            }
            if (!writeChar) writeChar = c; // 後備：先記住第一個可寫的
          }
        }
        if (writeChar && WRITE_CHARACTERISTICS.includes(writeChar.uuid)) break;
      }

      if (!writeChar) {
        alert('找不到可寫入的特徵值，請確認這是支援的熱感印表機。');
        return false;
      }

      charRef.current = writeChar;
      setBleConn(true);
      return true;
    } catch (e) {
      console.error('bleConnect error:', e);
      if (e?.name !== 'NotFoundError') alert('連線藍牙印表機失敗');
      return false;
    }
  }, []);

  /* ---------------- 送出資料（分段寫入） ---------------- */
  const writeRaw = useCallback(async (bytes) => {
    const ch = charRef.current;
    if (!ch) throw new Error('尚未連線印表機');
    const CHUNK = 180; // 藍牙 MTU 保守值
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.slice(i, i + CHUNK);
      if (ch.properties.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(slice);
      } else {
        await ch.writeValue(slice);
      }
      await sleep(20); // 段間小延遲，避免緩衝溢位
    }
  }, []);

  /* ---------------- 列印文字 ---------------- */
  const print = useCallback(async (text) => {
    if (!charRef.current) {
      const ok = await bleConnect();
      if (!ok) return;
    }
    const body = encodeGbk(text);
    const payload = new Uint8Array(INIT.length + body.length + CUT.length);
    payload.set(INIT, 0);
    payload.set(body, INIT.length);
    payload.set(CUT, INIT.length + body.length);
    await writeRaw(payload);
  }, [bleConnect, writeRaw]);

  return { bleConn, bleConnect, print };
}

export default useBluetoothPrinter;
