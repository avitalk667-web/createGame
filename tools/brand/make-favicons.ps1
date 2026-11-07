# Builds the site's favicons from the PX logo (tools/brand/px-icon.webp).
#   powershell -File tools\brand\make-favicons.ps1 -Src tools\brand\px-icon.webp -Out client\public
# After regenerating, raise the ?v= number in client/src/index.html and manifest.webmanifest.
param([string]$Src, [string]$Out, [string]$Preview)
Add-Type -AssemblyName PresentationCore, System.Drawing

# decode the WebP with Windows imaging, hand it to System.Drawing as PNG
$dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create([Uri]$Src, 'None', 'OnLoad')
$enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
$enc.Frames.Add($dec.Frames[0])
$ms = New-Object System.IO.MemoryStream
$enc.Save($ms); $ms.Position = 0
$master = [System.Drawing.Bitmap]::FromStream($ms)

function Render([int]$size, [int]$cx, [int]$cy, [int]$side) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.SmoothingMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode('TileFlipXY')
  $srcRect = New-Object System.Drawing.Rectangle ([int]($cx - $side/2)), ([int]($cy - $side/2)), $side, $side
  $g.DrawImage($master, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), $srcRect.X, $srcRect.Y, $srcRect.Width, $srcRect.Height, 'Pixel', $attr)
  $g.Dispose(); return $bmp
}
function PngBytes($bmp) { $m = New-Object System.IO.MemoryStream; $bmp.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); return ,$m.ToArray() }

# full logo for large icons; tighter crops for tab sizes so "PX" stays readable
$full  = @{ cx = 627; cy = 627; side = 1254 }
$mid   = @{ cx = 627; cy = 600; side = 1000 }   # 48px: the arch around the letters
$tight = @{ cx = 620; cy = 650; side = 800 }    # 16/32px: the letters fill the square

New-Item -ItemType Directory -Force $Out | Out-Null
foreach ($p in @(@{n='icon-512.png';s=512;c=$full}, @{n='icon-192.png';s=192;c=$full}, @{n='apple-touch-icon.png';s=180;c=$full}, @{n='favicon-32.png';s=32;c=$tight})) {
  $b = Render $p.s $p.c.cx $p.c.cy $p.c.side
  [IO.File]::WriteAllBytes((Join-Path $Out $p.n), (PngBytes $b)); $b.Dispose()
}

# favicon.ico: 16, 32, 48 as embedded PNGs
$imgs = @()
foreach ($s in 16, 32, 48) {
  $c = if ($s -le 32) { $tight } else { $mid }
  $b = Render $s $c.cx $c.cy $c.side; $imgs += ,@($s, (PngBytes $b))
  if ($Preview) { $big = New-Object System.Drawing.Bitmap 256, 256; $g=[System.Drawing.Graphics]::FromImage($big); $g.InterpolationMode='NearestNeighbor'; $g.PixelOffsetMode='Half'; $g.DrawImage($b, 0, 0, 256, 256); $g.Dispose(); $big.Save((Join-Path $Preview "preview-$s.png")); $big.Dispose() }
  $b.Dispose()
}
$ico = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$imgs.Count)
$offset = 6 + 16 * $imgs.Count
foreach ($i in $imgs) { $s=$i[0]; $d=$i[1]; $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$d.Length); $w.Write([uint32]$offset); $offset += $d.Length }
foreach ($i in $imgs) { $w.Write([byte[]]$i[1]) }
$w.Flush(); [IO.File]::WriteAllBytes((Join-Path $Out 'favicon.ico'), $ico.ToArray())
Get-ChildItem $Out | Select-Object Name, Length
