# MediaPipe Tasks Vision

- 版本：0.10.14
- 函式庫來源：https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14
  - `vision_bundle.mjs`
  - `wasm/vision_wasm_internal.js` / `.wasm`
  - `wasm/vision_wasm_nosimd_internal.js` / `.wasm`
- 手部模型來源：https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
  - 下載日期：2026-06-13
  - 用途：手指取景框（effects/finger-frame）、玩弄文字於指尖（effects/text-ropes）的手部關節點偵測
- 人像分割模型來源：https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
  - 檔名：`selfie_segmenter.tflite`
  - 下載日期：2026-06-14
  - 用途：草稿紙人像效果（effects/sketch-portrait）的人像去背，離線執行
- 人臉偵測模型來源：https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite
  - 檔名：`blaze_face_short_range.tflite`
  - 下載日期：2026-06-18
  - 用途：文字繩連連看（effects/text-rope-link）偵測畫面中多個人的頭部位置，離線執行
- 全部離線執行，不使用 CDN
