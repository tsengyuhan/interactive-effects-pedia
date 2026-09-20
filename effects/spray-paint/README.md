# 來噴漆吧

電腦是一整面街頭水泥牆，手機是有金屬光影的噴漆罐。以 **DeviceOrientation 相對旋轉** 控制空中滑鼠：直立握住手機，左右轉向、上下抬低。不是位置或平移追蹤，不使用加速度雙積分，不開啟相機、麥克風。

## 開啟與操作

線上網址：https://tsengyuhan.github.io/interactive-effects-pedia/effects/spray-paint/

正式站需先部署本效果、更新登錄與翻譯，以及本地 MQTT／QR 程式庫，連結才可使用。

1. 電腦開啟牆面，手機掃描 QR（或開啟複製的配對連結）。兩台裝置都要連網，手機可用行動網路，不必在同一個 Wi-Fi。
2. 手機按「啟用方向感測」。iOS 的權限請求由這次點擊觸發；若拒絕，需在瀏覽器／網站設定允許，再按「重試感測」。
3. 將手機直立朝向電腦中央十字，按「確認對位」，十字會變成紅點。
4. 下拉罐子上方噴頭並持續按住，轉動手機即可噴漆。放開、指標取消、視窗失焦或切到背景都會停噴。鍵盤聚焦噴頭後可按住空白鍵或向下鍵。
5. 用色票、色彩選擇器換色；靈敏度調整轉向幅度。「重新置中」以當下方向重設中心。轉換螢幕方向、重連或感測逾時後必須重新對位。
6. 電腦按「清牆」清除畫作；也可在牆上按住滑鼠試噴。滑鼠模式僅供桌面視覺檢查，不能代表手機感測已驗證。

短螢幕的手機控制頁可捲動，Shell 資訊面板預設收起，可從右上角開啟。中英文可從既有語言切換器切換。

## 網路與安全界線

- 全程免付費，靜態 GitHub Pages 即可運作，無需自建伺服器、帳號、信用卡或付費服務。手機建議 iOS Safari 或 Android Chrome。
- 兩端主動連線到 `wss://broker.hivemq.com:8884/mqtt`。這是 **HiveMQ 公開測試 MQTT 中繼，不保證可用性、延遲或服務持續性**；防火牆阻擋 8884 或中繼繁忙可能連不上。可按「重新連線」，或稍後重試。
- 專案已包含 MQTT.js 5.16.0 與 QR Code Generator 2.0.4，放在 `libs/mqtt/`、`libs/qrcode/`，全部本地引用，沒有 CDN；來源與版本記錄見各目錄的 `VERSION.md`。
- 每個牆面隨機建立 128-bit 房號與獨立 256-bit AES-GCM 金鑰。手機 URL 為 `?controller=1#room=…&key=…`，金鑰在 fragment，不放 query、MQTT topic 或明文封包，也不寫入儲存空間。
- MQTT topic：`interactia/spray/v1/<room>/host` 與 `/controller`。每個封包使用獨立隨機 12-byte IV，以 AES-GCM 加密。中繼仍可觀察房號、封包大小及連線時間；持有完整配對連結者可解密或競爭控制權，因此不要分享連結或含 QR 的截圖。
- QoS 0、`retain:false`、`clean:true`、`queueQoSZero:false`。不提供離線繪畫補送。接收時拒絕 retained、超過 4 KB、格式錯誤、非有限／超界 XY、不合法色碼、舊序號或非本輪配對的封包。
- Host 隨機 nonce 決定本輪配對；先 hello，再由 pulse 確認唯一 controller session。每 250 ms 發出隨機 beat；手機狀態必須回送有效 beat，host 以自己的單調時鐘檢查 950 ms 有效期，不需要兩台裝置時間同步。心跳約一秒失聯停噴，3.2 秒釋放控制器並換 nonce。
- 感測資料 650 ms 未更新即停噴並要求重校正；手機也檢查 host pulse 是否過期。斷線、重連、背景與重新對位一律釋放噴頭。頁面離開會清除效果 listener、raf、timer、MQTT 和 Web Audio。

## 本機測試與真手機

下載整份專案，保留 `assets/`、`effects/`、`libs/` 相對路徑。Windows 執行根目錄 `start.bat`，再從其 localhost 網址開啟效果，勿直接雙擊 HTML（模組與感測需要安全來源）。不需要修改 start.bat 或 server.ps1。

本機 QR **不會指向 localhost**，而是正式 HTTPS 站，旁邊清楚標示需先部署。展開「連線說明與本機測試」後，可複製本機雙頁測試連結，在同一電腦另一個瀏覽器視窗開啟控制頁。兩個視窗保持可見；單一視窗切分頁會觸發背景停噴保護。這兩頁仍經實際 WSS 中繼，沒有 BroadcastChannel 捷徑。桌面感測資料可用瀏覽器 Sensors 或注入 DeviceOrientationEvent 模擬。

真手機不能使用電腦的 localhost。請部署後用 HTTPS 網址，或使用可被手機信任的 HTTPS 開發環境。手機在一般區網 HTTP 上會有明確 HTTPS 提示。沒有感測支援、感測權限拒絕、事件未抵達與事件值無效都會顯示提示，可重試。

## 驗證

```text
node --test effects/spray-paint/*.test.mjs
node assets/i18n.test.js
git diff --check
```

自動測試涵蓋直立初始、跨越 beta=90、yaw/pitch 方向、359→0、重新置中、invalid orientation、封包驗證、唯一控制器、retained／重播／過期 beat、disconnect 停噴、加密竄改與翻譯完整性。瀏覽器 UI、實際中繼雙頁連線及真手機感測須另外驗證；自動測試不等同實機驗證。

已用兩個瀏覽器頁面經實際免費 HiveMQ 中繼驗證配對、模擬角度繪線、換色、放手／失焦／感測逾時／斷線停噴、重連需重新對位、權限拒絕提示、首頁篩選與英文介面。桌面加上約 45 ms 的位置平滑減少網路抖動。尚未使用實體 iPhone／Android 或手機行動網路驗證，精細描邊與實際手感仍需實機確認。
