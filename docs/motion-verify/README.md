# 动效验证产物

由 `npm run verify:motion`、`npm run verify:motion:pages` 与
`npm run verify:motion:geometry` 生成。重新生成会覆盖本目录内容。

## `static/` —— 静止态逐像素回归

每个场景两张图：

- `<场景>.off.png` —— 注入 `animation:none; transition:none` 后的「无动效」基线
- `<场景>.on.png` —— 正常渲染

两者逐像素一致即说明**动效层没有影响静止态外观**。

场景（13 个）：`home` `library` `search` `popmenu` `settings` `cine` `modal`
`reader` `reader-menu` `reader-font-panel` `reader-drawer`
`mobile-home` `mobile-library`

> `reader-font-panel` 有约 0.1% 的亮度差，属浏览器合成 `backdrop-filter`
> 毛玻璃的固有行为（原版代码同样如此，且更大）。详见 [motion.md](../../motion.md) 的「已知例外」。

## `pages/` —— 逐页目视确认

沉浸式页面与交互态的截图，用于人工核对观感与页面完整性（13 张）：

| 截图 | 状态 |
| --- | --- |
| `reader` | 阅读页（目录胶囊折叠） |
| `reader-menu` | 阅读页浮动菜单展开 |
| `reader-drawer` | 章节抽屉滑入 |
| `reader-dark` | 阅读页深色 |
| `music` / `music-dark` | 音乐页（浅色 / 深色） |
| `anime` | 番剧页播放器就绪 |
| `cine` | 情境配乐 |
| `cine-nodes` | 情境配乐节点编辑区展开 |
| `settings` | 设置页 |
| `float-ball` / `float-card` | 悬浮播放器（球 / 迷你卡片） |
| `confirm` | 应用内确认弹窗 |

截图前由 `scripts/lib/fixture.js` 装入固定数据（含 `EXTRA_BOOKS`：`type` 缺省的书
供情境配乐页、`type:'anime'` 的书供番剧页），保证可复现——否则截图内容取决于
浏览器 profile 里残留的数据，且这两个页面在默认数据下会是空态。

## `geometry/` —— 布局几何与动效属性采样

由 `npm run verify:motion:geometry` 生成：

- `layout.json` —— 每页 `chrome` / `main` / `body` / 各页根节点的盒子与
  `scrollWidth` / `scrollHeight`（用于发现布局回归与横向溢出）
- `motion.json` —— 页面切换与按钮按压过程中的计算样式采样
- 同名 PNG —— 每页静态截图（与 `static/` 场景重复，仅作对照）

已知采样值：桌面 `chrome` 56px / `main` 566px / `body` 1258×622，
移动端 `chrome` 58px / `main` 742px；两种尺寸下 `scrollWidth` 都恒等于视口宽度，
未激活页面收缩为 0×0。

## `mobile-reader/` —— 移动端竖屏阅读排版

由 `node scripts/shot-mobile-reader.js` 生成，375 / 390 / 430 三种竖屏各一张，
用长正文拍摄第一屏，用于目视确认「文字落在页宽内、顶栏不与返回键重叠」。

对应的几何回归是 `npm run verify:mobile`（61 项断言，见 [motion.md](../../motion.md) 第六节）。

## 复现

```bash
npm run web:build                    # A/B 服务与阅读菜单脚本都依赖 dist/
npm run start                        # 另开一个终端，服务默认在 127.0.0.1:8761
npm run verify:motion                # 静止态 + 行为 + 补充断言 + 浮层断言
npm run verify:motion:pages          # 目视截图 -> pages/
npm run verify:motion:geometry       # 布局几何 + 动效属性采样 -> geometry/
npm run verify:mobile                # 移动端竖屏阅读排版回归（61 项）
```

`verify:motion` 的断言数：静止态 13 场景、行为 38 项、补充 13 项、浮层 23 项（共 87 项）。

另外两个与本改动直接相关的回归脚本：

```bash
node scripts/verify-music-float.js            # 悬浮播放器行为，18 项
node scripts/ab-serve.js                      # A/B 对比服务（8763）：切换 public/ 与 dist/
node scripts/verify-reader-menu.js            # 阅读菜单 id 交互，9 个 id + 6 步
```

> 阅读菜单脚本必须配 `ab-serve.js`：它靠 `__ab?to=vue` 切到新版 `dist/`。
> 起成 `serve-legacy.js` 时该请求 404，脚本会静默测到旧版页面上；
> 现在它会先校验构建模式并断言 id 齐全，起错服务会直接报错退出。
