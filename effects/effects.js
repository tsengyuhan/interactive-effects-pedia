// 中央登錄檔——首頁與效果頁的唯一資料來源
// 用 .js 而非 .json：file:// 直接開啟時 fetch JSON 會被瀏覽器擋下，JS 檔不受限
//
// 欄位契約：
// {
//   id: "ink-brush",            // 資料夾名稱（slug，小寫連字號）
//   title: "水墨筆觸",           // 效果名稱
//   category: "網頁互動",        // 網頁互動｜身體動作｜聲音互動（可新增）
//   description: "一句話描述",
//   instructions: "操作說明，一兩句",
//   tech: ["Canvas 2D"],        // 主要使用技術標籤
//   principle: ["條列1", "條列2"], // 白話原理，總計 200 字內
//   requirements: ["滑鼠或觸控", "任何現代瀏覽器"], // 軟硬體規格
//   offline: true,              // false 時必填 offlineNote
//   offlineNote: "",
//   hasParams: true             // 是否有可調參數面板
// }
window.EFFECTS = [];
