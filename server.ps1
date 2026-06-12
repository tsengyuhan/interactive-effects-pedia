# 簡易靜態檔案伺服器——展場離線環境用，零外部相依
# 為什麼需要：攝影機/麥克風權限在 file:// 下不可靠，localhost 是安全環境
$port = 8080
$root = $PSScriptRoot
$mime = @{
  ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8";
  ".mjs"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".png"="image/png"; ".jpg"="image/jpeg"; ".svg"="image/svg+xml";
  ".json"="application/json"; ".wasm"="application/wasm";
  ".task"="application/octet-stream"; ".md"="text/plain; charset=utf-8"
}
$listener = New-Object System.Net.HttpListener
$url = "http://localhost:" + $port + "/"
$listener.Prefixes.Add($url)
$listener.Start()
Start-Process $url
Write-Host "伺服器運行中 $url （關閉此視窗即停止）"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.EndsWith("/")) { $path += "index.html" }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart("/") -replace "/", "\")))
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $ct
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
  } catch { $ctx.Response.StatusCode = 500 }
  $ctx.Response.Close()
}
