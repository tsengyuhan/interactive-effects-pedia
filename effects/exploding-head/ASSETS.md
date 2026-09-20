# 素材來源與目前用途

以下來源素材在先前街景版本使用內建 image_gen 工具生成及編輯；v10 沒有生成或改動 `street.png` 與 `hydrant.png`，執行時不連外網。`thumb.png` 已更新為本版瀏覽器截圖，並非新生成素材。

- `street.png`：1536×1024 舊街道底圖，保留檔案但 v10 不再載入或顯示。
- `hydrant.png`：1024×1536 透明消防栓，v10 完整沿用同一檔案與原生 alpha；SHA256 `1886ac015fef72db80401c683db467bbcbc0a801602f62596c4c60d6bc0666c1`。
- 兩面牆與地板由 `room.mjs` 的有限平面、主色配色與 Canvas 光影即時繪製，不使用背景圖片。
- 臉球仍使用原 `balloon.mjs` shader，沒有跟隨場景主色染色；v10 開始時 SHA256 `70a506e66d2bf097888ce330cc1d98be196f1aeafebfb3cc0be9a086f0f32363`，本版未更改。

## 最終生成與編輯提示詞

### 街景生成

Use case: photorealistic-natural. Asset type: clean background plate for a browser face-balloon simulation. Generate a photorealistic quiet roadside photographed with a normal 50mm lens, camera about 1.4 m high looking slightly downward, natural coherent perspective. Wide landscape 1536x1024. Foreground and most of lower two thirds are detailed dry medium-dark asphalt with fine aggregate and subtle wear, a broad unobstructed flat road plane for simulated shadows and falling balloon fragments. A straight low concrete curb recedes gently toward a single vanishing region just above the middle; sidewalk lies along the far BACK edge of the road near y=520, not cutting diagonally through the foreground. Distant understated out-of-focus urban facade and sparse greenery occupy only upper third. Quiet neutral grey warm palette, soft natural sun from upper LEFT front; small environmental shadows go right and away. Camera focus on the road plane at the near curb. Keep central region x=450..1050, y=240..820 clear for an added face balloon and a separate fire hydrant. No fire hydrant in this plate. No people, no balloons, no vehicles, no road text, logos or watermark. Real documentary photographic materials and subtle imperfections; absolutely not an illustration, cartoon, vector or glossy CGI. Practical open ground plane and restrained background, no scenic vista or dramatic sky.

### 街景編輯（最終採用）

Use case: precise-object-edit. Revise this photographic street background plate for an interactive balloon game. Keep its natural photographic textures, normal-lens camera, left-front sunlight and restrained urban style. Move the curb much CLOSER to the camera: the sidewalk should occupy the middle of the image, with its near edge running from approximately (0,610) to (1536,740). This is one continuous, believable straight curb in perspective, with an approximately 20-pixel visible vertical front face. Keep the asphalt road as the lower portion in front of this curb. Flat unobstructed sidewalk on top of curb around x=850,y=670 will receive a separate fire hydrant; leave clear space above it for a balloon. Preserve fully photographic coherent perspective and material detail. NO fire hydrant, NO people, NO balloons, NO added objects or text. Full output1536x1024.

### 消防栓生成

Use case: product-mockup. Asset type: photorealistic transparent PNG fire hydrant cutout for compositing into a real roadside photograph. A single ordinary full-size red painted cast iron fire hydrant, complete from top screw and domed cap to bolted circular foot flange. True photographic object, subtle casting grain, slightly weathered red paint, small scuffs and exposed metal edges, restrained grime near foot, realistic metal fittings and chain. Three-quarter view: see a large forward-facing central outlet cap and two smaller lateral outlets, with top surfaces mildly visible. Normal 50mm lens perspective, camera about 1.4 meters high looking mildly down, NOT orthographic or isometric. Soft natural sunlight from upper LEFT FRONT, highlight on upper-left surface and darker right side. Whole object centered in frame with close but complete bounds and ample transparent padding. Genuinely transparent background alpha, including gaps around small chain; no ground plane, no cast shadow, no backdrop, no checkerboard pattern. No words or logos, no people, no balloons, no rope. The output is a photographic cutout with realistic physical depth, not a stylized 3D render, icon or illustration. Portrait 1024x1536.

### 消防栓去背編輯（最終採用）

Use case: background-extraction. Isolate exactly the same photographed red fire hydrant from this image. Preserve its camera angle, entire top screw, domed cap, three outlets, hanging chains, red paint, lighting, realistic texture and full base flange. Remove ALL brown/black background and any cast shadow. Output a TRUE TRANSPARENT PNG with alpha=0 outside the hydrant silhouette and through holes in the chains. Absolutely no solid black or white background, no gradients, no checkerboard drawn into image. Do not change the object. Maintain original1024x1536 canvas and object position.
