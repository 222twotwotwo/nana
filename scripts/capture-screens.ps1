# 截图采集脚本：用 agent-browser 打开本地服务，逐页截图用于与原版比对
# 用法： & .\scripts\capture-screens.ps1 [-Out docs/refactor-screens/verify] [-Base http://127.0.0.1:8761/]
param(
  [string]$Out = 'docs/refactor-screens/verify',
  [string]$Base = 'http://127.0.0.1:8761/',
  [int]$Width = 1258,
  [int]$Height = 622
)

New-Item -ItemType Directory -Force -Path $Out | Out-Null
# agent-browser 走原生 exe，反斜杠会被吞掉，统一用正斜杠
$Out = (Resolve-Path $Out).Path.Replace('\', '/')

$script:fail = 0

function Shot([string]$name) {
  $r = agent-browser batch --bail "screenshot $Out/$name.png" 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Output "  !! $name 截图失败: $r"; $script:fail++; return }
  Write-Output "  -> $name.png"
}

# 带重试的 JS 求值：应用启动是异步的（种子书库/会话恢复），首帧元素可能还没渲染
function Js([string]$js, [int]$retry = 12) {
  for ($i = 0; $i -lt $retry; $i++) {
    $r = agent-browser eval $js 2>&1
    if ($LASTEXITCODE -eq 0) { return $r }
    Start-Sleep -Milliseconds 500
  }
  Write-Output "  !! JS 失败: $js"
  $script:fail++
  return $null
}

function WaitMs([int]$ms) { Start-Sleep -Milliseconds $ms }

function Nav([string]$nav) {
  Js "document.querySelector('#mainSeg button[data-nav=$nav]').click()" | Out-Null
  WaitMs 900
}

# 打开「库墙」指定分类的第 n 张卡片详情，并按按钮进入阅读/播放
function OpenCard([string]$ctype, [int]$n, [string]$btn, [int]$settle = 1800) {
  Nav 'library'
  Js "document.querySelector('#libraryTypeSeg button[data-ctype=$ctype]').click()" | Out-Null
  WaitMs 1200
  Js "document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[$n].click()" | Out-Null
  WaitMs 1600
  Js "document.querySelector('$btn').click()" | Out-Null
  WaitMs $settle
}

Write-Output "打开 $Base"
agent-browser batch --bail "open $Base" "set viewport $Width $Height" | Out-Null
WaitMs 3000

# 等应用启动完成（#chrome 渲染）
Js "document.querySelector('#chrome') ? 1 : (function(){throw new Error('boot')})()" 20 | Out-Null

# ---------- 主页 ----------
Nav 'home'
Shot 'home'

# ---------- 库墙 ----------
Nav 'library'
Shot 'library'

# ---------- 搜索态（主页 + 发现模式） ----------
Js "document.querySelector('#mainSeg button[data-nav=search]').click()" | Out-Null
WaitMs 1000
Shot 'search'

# ---------- ⋯ 弹出菜单 ----------
Js "document.querySelector('#btnMore').click()" | Out-Null
WaitMs 600
Shot 'popmenu'

# ---------- 设置 ----------
Js "[...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置')).click()" | Out-Null
WaitMs 1200
Shot 'settings'

# ---------- 情境配乐 ----------
Js "document.querySelector('#btnMore').click()" | Out-Null
WaitMs 500
Js "[...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('情境配乐')).click()" | Out-Null
WaitMs 1200
Shot 'cine'

# ---------- 音乐页（库墙 → 音乐 → 播放） ----------
OpenCard 'music' 0 '#smRead' 2500
Shot 'music'

# 深色主题
Js "document.querySelector('#mfTheme').click()" | Out-Null
WaitMs 1000
Shot 'music-dark'
Js "document.querySelector('#mfTheme').click()" | Out-Null
WaitMs 700

# ---------- 阅读页（库墙 → 小说 → 阅读） ----------
OpenCard 'novel' 0 '#smRead' 3000
Shot 'reader'

# 悬浮菜单
Js "document.querySelector('#fabBar')?.click()" | Out-Null
WaitMs 800
Shot 'reader-menu'

# 章节抽屉
Js "[...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('章节目录'))?.click()" | Out-Null
WaitMs 900
Shot 'reader-drawer'
Js "document.querySelector('#rdFab')?.click()" | Out-Null
WaitMs 500

# 阅读页深色主题
Js "document.querySelector('#fabBar')?.click()" | Out-Null
WaitMs 700
Js "[...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('主题'))?.click()" | Out-Null
WaitMs 700
Js "[...document.querySelectorAll('#rdMenu .rm-panel button')].find(b=>b.textContent.includes('深色'))?.click()" | Out-Null
WaitMs 1000
Shot 'reader-dark'
Js "[...document.querySelectorAll('#rdMenu .rm-panel button')].find(b=>b.textContent.includes('浅色'))?.click()" | Out-Null
WaitMs 700
Js "document.querySelector('#rdFab')?.click()" | Out-Null
WaitMs 400

# ---------- 详情弹窗 ----------
Nav 'library'
Js "document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0].click()" | Out-Null
WaitMs 1600
Shot 'modal'
Js "document.querySelector('#storeModal .sm-close')?.click()" | Out-Null
WaitMs 600

# ---------- 移动端视图（分页排版） ----------
agent-browser batch --bail "set viewport 420 800" | Out-Null
WaitMs 800
Nav 'home'
Shot 'mobile-home'
Nav 'library'
Shot 'mobile-library'
OpenCard 'music' 0 '#smRead' 2500
Shot 'mobile-music'
OpenCard 'novel' 0 '#smRead' 3000
Shot 'mobile-reader'

if ($script:fail -gt 0) { Write-Output "完成，但有 $script:fail 处失败" } else { Write-Output '完成，全部成功' }
