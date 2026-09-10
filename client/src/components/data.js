// data.js — 前端菜單目錄
// 這裡是範例資料，不是店家真實菜單／價格；正式環境請自行替換內容與圖片
// Menu.js 以 categories 決定分區顯示順序

export const categories = [
  '場地',
  '推薦特調',
  '特製調酒',
  '傳統調酒',
  '客製化調酒',
  '啤酒',
  'Shot',
  '茶類飲料',
  '茶類加購品',
  '無酒精飲料',
  '手工甜點',
  '炸物',
  '其他'
];

export const products = {
  /* 場地：以每人次計算的計時座位費 -------------------------- */
  '場地': [
    {
      id: '0000',
      name: '聚會空間',
      price: 30,
      image: '/images/venue.jpg',
      describe: '以每人次計算，每小時每人 30 元。若同訂單有人需提早離開，該位需先支付個人時數費用。'
    }
  ],

  /* 推薦特調 -------------------------------------------------- */
  '推薦特調': [
    { id: '0001', name: '特調 A', price: 200, image: '/images/placeholder.jpg', describe: '範例品項' },
    { id: '0002', name: '特調 B', price: 200, image: '/images/placeholder.jpg', describe: '範例品項' },
    { id: '0003', name: '特調 C', price: 250, image: '/images/placeholder.jpg', describe: '範例品項' },
    { id: '0004', name: '特調 D', price: 250, image: '/images/placeholder.jpg', describe: '範例品項' }
  ],

  /* 特製調酒 -------------------------------------------------- */
  '特製調酒': [
    { id: '0005', name: '調酒 E', price: 150, image: '/images/placeholder.jpg', describe: '範例品項' },
    { id: '0006', name: '調酒 F', price: 150, image: '/images/placeholder.jpg', describe: '範例品項' },
    { id: '0007', name: '調酒 G', price: 180, image: '/images/placeholder.jpg', describe: '範例品項' },
    { id: '0008', name: '調酒 H', price: 180, image: '/images/placeholder.jpg', describe: '範例品項' }
  ],

  /* 傳統調酒 -------------------------------------------------- */
  '傳統調酒': [
    { id: '0013', name: '螺絲起子', price: 150, image: '/images/placeholder.jpg', describe: '伏特加、柳橙' },
    { id: '0014', name: '琴通尼', price: 150, image: '/images/placeholder.jpg', describe: '琴酒、通寧水' },
    { id: '0015', name: '自由古巴', price: 150, image: '/images/placeholder.jpg', describe: '蘭姆酒、可樂、檸檬' }
  ],

  /* 客製化調酒 ------------------------------------------------ */
  '客製化調酒': [
    {
      id: '0021',
      name: '客製化調酒',
      price: 200,
      image: '/images/placeholder.jpg',
      describe: '請詢問店員並告知調酒要求'
    }
  ],

  '啤酒': [
    { id: '0067', name: '生啤酒', price: 100, image: '/images/placeholder.jpg', describe: '範例品項' }
  ],

  /* Shot -------------------------------------------------------- */
  'Shot': [
    { id: '0023', name: 'Shot 1杯', price: 50,  image: '/images/placeholder.jpg', describe: '' },
    { id: '0024', name: 'Shot 6杯', price: 250, image: '/images/placeholder.jpg', describe: '' }
  ],

  /* 茶類飲料 ------------------------------------------------------- */
  '茶類飲料': [
    { id: '0038', name: '紅茶', price: 35, image: '/images/placeholder.jpg', describe: '' },
    { id: '0039', name: '奶茶', price: 40, image: '/images/placeholder.jpg', describe: '' }
  ],
  '茶類加購品': [
    { id: '0069', name: '+檸檬', price: 5,  image: '/images/placeholder.jpg', describe: '額外加購' },
    { id: '0070', name: '+奶精', price: 5,  image: '/images/placeholder.jpg', describe: '額外加購' },
    { id: '0068', name: '+蜂蜜', price: 10, image: '/images/placeholder.jpg', describe: '額外加購' }
  ],

  /* 無酒精飲料 ------------------------------------------------- */
  '無酒精飲料': [
    { id: '0046', name: '可樂', price: 45, image: '/images/placeholder.jpg', describe: '' },
    { id: '0047', name: '汽水', price: 45, image: '/images/placeholder.jpg', describe: '' }
  ],

  /* 手工甜點 --------------------------------------------------- */
  '手工甜點': [
    { id: '0054', name: '甜點 1', price: 30, image: '/images/placeholder.jpg', describe: '' },
    { id: '0055', name: '甜點 2', price: 45, image: '/images/placeholder.jpg', describe: '' }
  ],

  /* 炸物 ------------------------------------------------------- */
  '炸物': [
    { id: '0060', name: '炸物 1', price: 25, image: '/images/placeholder.jpg', describe: '' },
    { id: '0061', name: '炸物 2', price: 45, image: '/images/placeholder.jpg', describe: '' }
  ],

  /* 其他（清潔／損壞費用） ------------------------------------- */
  '其他': [
    { id: '9001', name: '外食清潔費', price: 100,  image: '/images/placeholder.jpg', describe: '1桌/100' },
    { id: '9002', name: '摔杯',       price: 200,  image: '/images/placeholder.jpg', describe: '1杯/200' },
    { id: '9003', name: '嘔吐',       price: 1000, image: '/images/placeholder.jpg', describe: '1次/1000' }
  ]
};
