# 字型資源

## Iansui 芫荽

- 用途：`effects/sketch-portrait` 文字模式的本地手寫字型。
- 來源：https://github.com/ButTaiwan/iansui
- 版本：v1.020 release `iansui.zip`
- 授權：SIL Open Font License 1.1，授權文字見 `OFL-Iansui.txt`。

## 子集化

輸出檔：`iansui-common-hant.woff2`

字表來源採 Unicode 官方區段，涵蓋 ASCII、中文標點、注音、CJK Extension A、CJK Unified Ideographs、CJK Compatibility Ideographs、全形符號：

```txt
U+0020-007E,U+3000-303F,U+3100-312F,U+31A0-31BF,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FFEF
```

產生指令：

```powershell
python -m pip install --user fonttools brotli
pyftsubset Iansui-Regular.ttf `
  --output-file=assets/fonts/iansui-common-hant.woff2 `
  --flavor=woff2 `
  --layout-features=* `
  --unicodes=U+0020-007E,U+3000-303F,U+3100-312F,U+31A0-31BF,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FFEF `
  --no-hinting
```
