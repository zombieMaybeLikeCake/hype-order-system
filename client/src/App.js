import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Menu from './components/Menu';
import CartPage from './components/CartPage';
import LoginPage from './components/LoginPage';
import OrdersVenuePage from './components/OrdersVenuePage';
import ProductDetail from './components/ProductDetail';
import BluetoothPrinter from './components/BluetoothPrinter';
import VenueFees from './components/VenueFees';
import AdminXlsxPage from './components/AdminXlsxPage';
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/menu" element={<Menu />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/orders" element={<OrdersVenuePage />} />
      <Route path="/product/:cat/:id" element={<ProductDetail />} />
      <Route path="/bluetooth-printer" element={<BluetoothPrinter />} />
      <Route path="/venue-fees" element={<VenueFees />} />
      <Route path="/admin/xlsx" element={<AdminXlsxPage />} />
      <Route
        path="*"
        element={<h2 style={{ textAlign: 'center', color: '#555' }}>頁面不存在</h2>}
      />
    </Routes>
  );
}
