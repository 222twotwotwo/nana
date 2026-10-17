# 动效规范（Apple 风格）

nana 的页面切换、浮层与按钮交互动效。目标：**动画只加在状态变化上，静止态与原版逐像素一致。**

实现集中在两个文件：

- [motion.css](../frontend/src/styles/motion.css) —— 全部动效声明与时长/曲线令牌
- [composables/](../frontend/src/composables/) —— 页面切换状态机、滑动指示器、时长换算

## 一、设计令牌

时长与曲线统一收在 `:root`，JS 通过 `cssTimeMs()` 读取，保证两侧永远一致。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--ease` | `cubic-bezier(.32,.72,0,1)` | 主曲线：快速起步、长尾减速 |
| `--ease-out` | `cubic-bezier(.25,.8,.35,1)` | 通用减速 |
| `--ease-in-out` | `cubic-bezier(.45,0,.25,1)` | 双向对称 |
| `--ease-spring` | `cubic-bezier(.34,1.28,.52,1)` | 轻微回弹，用于小控件 |
| `--dur-press` | `140ms` | 按压反馈 |
| `--dur-fast` | `220ms` | 悬停、颜色 |
| `--dur-med` | `340ms` | 浮层、抽屉、指示器 |
| `--dur-slow` | `460ms` | 页面切换、顶栏折叠 |

## 二、页面切换

七个页面常驻渲染、用 `.hidden` 切换（保留滚动位置与已加载数据）。切换动画在**一个渲染周期内**让两页同时可见：

1. `watch` 在重渲染前触发 → 记录 `from` / `to` / 方向
2. 重渲染：离场页去掉 `hidden` 并临时 `position:absolute`（脱离文档流，不影响入场页占位）
3. `rAF` 中切到 `to` 态 → CSS 过渡启动
4. 过渡结束：清标记，离场页重新 `hidden`，入场页回到自然态

方向由页面层级决定（`LEVEL` 表）：`home`/`library` = 0，`settings`/`cine` = 1，`reader`/`music`/`anime` = 2。

| 方向 | 入场 | 离场 |
| --- | --- | --- |
| forward（进入详情） | 右移 64px 淡入 | 左移 26% 淡出 |
| back（返回） | 左移 26% 淡入 | 右移 64px 淡出 |
| lateral（同级） | 下移 12px 微缩淡入 | 上移 8px 淡出 |

前进时入场页左缘带投影，形成 iOS push 的层级感。入场页内的网格子项按 32ms 步进依次浮起（仅作用于 `.book-grid` / `.home-wall` 的直接子项，且只在切换窗口内）。

**降级**：`document.hidden`（后台标签页，rAF 被节流）与 `prefers-reduced-motion` 下直接跳过动画，不会卡在透明中间态。

## 三、滑动指示器

分段控件的高亮不是「给按钮换底色」，而是同一块底滑过去。

关键约束（实测得出）：**把激活底色从按钮挪到另一个元素上绘制，会让 Chrome 放弃次像素（LCD）抗锯齿、改用灰度抗锯齿**，静止态文字渲染随之改变。`position:relative` / `z-index` / `isolation` 都不是原因，「底色由谁绘制」才是。

因此指示器是**瞬时**的：

- 静止态：指示器不存在，底色由按钮自身 `.on` 绘制 → 与原版逐像素一致
- 滑动中：容器挂 `.pill-active`，底色交给指示器，从旧位置滑到新位置
- 结束：移除 `.pill-active`，底色回到按钮身上

交接瞬间指示器与按钮底色同色、同位置、同圆角，因此看不出切换。测量时减掉 `clientLeft`/`clientTop`（绝对定位以**内边距盒**为原点，而 `getBoundingClientRect()` 给的是**边框盒**，容器有 1px 边框）。

## 四、顶栏折叠

沉浸式页面（阅读/音乐/番剧）原本直接 `display:none`，主区会跳一下。现改为 `max-height` 过渡 + 内容淡出：

- 盒高始终是内容自然高度（不设 `height`），因此 `--chrome-h` 即使偏大或过期也**只影响动画节奏、绝不影响布局**
- 测量前临时解除 `max-height` 夹取：被夹住的元素 `scrollHeight` 会返回中间值（实测桌面 56 → 移动端得到 57，真实值是 58），写回变量会越测越小并锁死

## 五、浮层

`#storeModal`、`#appConfirm`、`.pop`、`#rdMenu`、`#muFloat` 采用「保留 `hidden` 类名 + `anim-hidden` 控制可见性」的写法，让退场也有动画：

```css
#storeModal.anim-hidden{
  display:flex !important;          /* 压过 .hidden 的 display:none */
  opacity:0; visibility:hidden; pointer-events:none;
  transition:opacity var(--dur-med) var(--ease), visibility 0s linear var(--dur-med);
}
```

保留 `hidden` 类名是为了不破坏既有校验脚本（它们用 `classList.contains('hidden')` 判断开关状态）。

**注意**：`.pop` 退场后必须真正从 DOM 移除。它是 `position:absolute` 挂在 body 下的，若只做 `visibility:hidden` 保留，会带着上一次的 `left`（如桌面算出的 1059px）继续参与文档溢出计算，窄视口下撑出横向滚动条。

`#rdMenu` 内部的 `#rmFontPanel` 用**纯 opacity 过渡**而非 `animation`：该面板位于 `backdrop-filter` 毛玻璃容器内，动画期间父容器合成层会重新采样，在相邻分隔线上留下亮度渐变；动画被打断时还会停在中间态。

## 六、移动端竖屏阅读排版

阅读页在 `#readerScroll.clientWidth <= 760` 时切到**分页模式**：一屏一列、
横向滚动翻页（`#chapterBody.reader-paged`）。

这里的核心约束只有一条：**正文容器宽度必须正好等于一屏宽**。两种「看起来更聪明」
的写法都会让文字横向溢出、竖屏下右侧被切掉：

| 写法 | 后果 |
| --- | --- |
| `width:max-content` | 多列容器下内联内容先按「不换行的理想宽度」排，段落比列宽还宽（375 视口：列宽 315px，段落排到 324.8px） |
| 容器 = 整数列总宽（列数 × 列步进 − gap） | 浏览器把余量**均摊回每一列**：声明 330px 的列实际变成 345.78px，文字跟着变宽、照样溢出（实测列步进 360 → 375.78） |

所以 `setReaderLayout()` 只做一件事：把容器宽写成一屏宽，列数交给浏览器按内容高度自己算
——此时列步进恰好等于 `列宽 + gap`。测量列边界时要用**实测列步进**（相邻列起点的实际间隔），
不能想当然用「视口 − padding」：窄屏下列宽会被 `Math.max(280, …)` 抬起来，算出来的边界会误判。

同时顶栏要避开悬浮返回键：`.float-back` 是 `position:fixed` 停在 `left:20px`、宽 42px，
而 `#rdHead` 是居中的。窄屏下标题换行后左缘会伸到返回键底下被压住（实测 320/375/390/393/430
全部重叠，标题 left ≈ 20~27 < 返回键 right = 62），因此 ≤760 时给 `#rdHead`
左右各留 66px，并把标题限制在 2 行内。

## 七、无障碍

`prefers-reduced-motion: reduce` 下把四个时长令牌压到 `1ms`（动画等同关闭），并显式取消所有 `transform` 类反馈。

## 八、验证

| 脚本 | 作用 |
| --- | --- |
| `node scripts/verify-motion-static.js` | 同数据下「关动效 vs 开动效」逐像素比对，13 个场景 |
| `node scripts/verify-motion-behavior.js` | 38 项行为断言：方向、中间态、指示器、按压、浮层、降级 |
| `node scripts/verify-motion-extra.js` | 13 项补充断言：主题过渡、视图切换、移动端溢出 |
| `node scripts/verify-motion-overlays.js` | 23 项浮层断言：Toast、章节抽屉、确认框、悬浮球变形、情境配乐节点区、番剧页状态 |
| `npm run verify:motion:pages` | 沉浸式页面与交互态截图（13 张），供目视确认 |
| `npm run verify:motion:geometry` | 逐页截图 + 布局几何采样，产物写到 `docs/motion-verify/geometry/` |
| `npm run verify:mobile` | **移动端竖屏阅读排版 61 项**：5 种竖屏尺寸下的列几何、文字是否溢出列、顶栏与返回键是否重叠、桌面不受影响、旋转后重算 |

`npm run verify:motion` 一次跑完前四个（静止态 + 行为 + 补充 + 浮层，共 87 项断言）；其余 npm 脚本生成目视截图、几何产物与移动端排版回归。产物都在 `docs/motion-verify/`。

外加两个与本改动直接相关的回归脚本：

- `node scripts/verify-music-float.js`（悬浮播放器 18 项）
- `node scripts/verify-reader-menu.js`（阅读菜单 id 交互）

两者都需要先起 `node scripts/ab-serve.js`（**不是** `serve-legacy.js`）：前者要新版 `dist/`，
后者要靠 `__ab?to=vue` 在 `public/` 与 `dist/` 间切换。起错服务的后果是静默跑在旧版成品上——
`verify-reader-menu.js` 现在会先校验构建模式，并断言那 9 个 id 齐全，起错服务直接报错退出，
不再出现「旧版页面上一个 id 都不存在、断言全部落空却仍打印通过」的情况。

移动端排版另有目视截图：`node scripts/shot-mobile-reader.js`，产物在
`docs/motion-verify/mobile-reader/`（375 / 390 / 430 三种竖屏各一张）。

### 已知例外

`#rdMenu`（毛玻璃面板）在「有动画 vs 无动画」两种渲染下，按钮圆角处有约 0.1% 的亮度差。**原版代码同样如此，且更大（0.1597% vs 本改动 0.1025%）**，属浏览器合成毛玻璃的固有行为，非本项目回归。该场景阈值单独放宽到 0.25%。

### 静止态结论

13 个场景（桌面 7 页 + 阅读页 4 态 + 移动端 2 页）在开关动效前后逐像素一致；`chrome` / `main` / `body` / 页面根节点的几何尺寸与原版完全相同。移动端在页面切换与指示器滑动全程无横向溢出（`scrollWidth` 恒等于视口宽度）。

### 行为结论

74 项行为断言全通过（行为 38 + 补充 13 + 浮层 23），断言的是「过渡过程中确实出现了中间态」，
而不是只看终态——只看终态的话，把动画删掉一样能通过。

夹具统一由 `scripts/lib/fixture.js` 安装：同一份书/曲目/设置，并给曲目生成可播放的 WAV blob。
情境配乐页只收 `type` 缺省的书、番剧页要 `type:'anime'`、悬浮球要有选中曲目，
所以浮层与页面套件必须装 `EXTRA_BOOKS`，否则测到的是空态。

## 九、动效清单

| 位置 | 动效 |
| --- | --- |
| 页面切换 | 方向感知滑动 + 淡入淡出，网格子项依次浮起 |
| 顶栏 | 折叠/展开高度连续过渡，内容位移淡出 |
| 分段控件 | 高亮块滑动（位置 + 宽度），回弹曲线 |
| 按钮 | 悬停抬升 1px、按压缩放 0.96、阴影加深 |
| 卡片/封面 | 悬停上浮 5px、按压回落 |
| 弹窗/确认框 | 淡入 + 上移 18px 缩放 0.94 |
| 弹出菜单 | 从右上角缩放展开，退场淡出后移出 DOM |
| Toast | 上移淡入 + 缩放 |
| 章节抽屉 | 左滑入 + 阴影渐显 |
| 阅读浮动菜单 | 右下角缩放弹出，行高亮 |
| 悬浮音乐球 | 球 ⇄ 卡片变形过渡，播放时唱片纹路旋转 |
| 情境配乐 | 节点编辑区展开、行依次淡入 |
| 番剧页 | 播放器状态切换、选集按钮反馈 |
| 主题切换 | 一次性颜色过渡（`body.theme-anim`，520ms 后移除） |
| 表单 | 聚焦光晕（3px 强调色环） |

## 十、踩过的坑

记录几个非直觉、容易改错的地方：

1. **`parseFloat('.34s')` 得到的是 0.34，不是 340。**
   `getComputedStyle().getPropertyValue('--dur-med')` 返回 CSS 时间字面量，
   直接当毫秒用会让定时器提前两个数量级触发（动画被腰斩）。
   统一走 `cssTimeMs()`，显式识别 `s` / `ms` 单位。

2. **绝对定位以内边距盒为原点，`getBoundingClientRect()` 给的是边框盒。**
   滑动指示器测量时漏减 `clientLeft`/`clientTop` 会整体偏移 1px。

3. **`max-height` 夹取会污染 `scrollHeight`。**
   被夹住的元素返回的是「夹取高度与内容高度之间」的中间值，
   测量顶栏时必须先临时解除夹取。

4. **`backdrop-filter` 容器内的元素不要用 `animation` 做展开。**
   父容器合成层会重新采样，在相邻分隔线上留下亮度渐变；
   动画被打断还会停在中间态。改用 `transition`。

5. **绝对定位的浮层退场后必须真正移出 DOM。**
   只做 `visibility:hidden` 会带着旧坐标继续参与文档溢出计算。

6. **给按钮加 `will-change:transform` 会改变文字抗锯齿。**
   Chrome 会从次像素（LCD）切到灰度抗锯齿，静止态像素随之变化。
   只在真正需要时挂，不要全局加。

7. **Vue scoped 样式会赢过渡类名。**
   `MusicFloat.vue` 里 `.mf-ball{position:relative}` 编译后是 `.mf-ball[data-v-x]`，
   特异性 (0,2,0) 高于全局 `.mf-leave-active` 的 (0,1,0)；变形时离场的一方
   因此留在常规流里，把容器撑高（正是要避免的抖动）。写 `#muFloat .mf-leave-active`
   把特异性提到 (1,1,0) 才压得住。

8. **重渲染会把鼠标底下的元素换掉。**
   番剧播放器挂载后走 loading → ready，选集条 DOM 被整体替换，
   鼠标停在同一像素也收不到 `:hover`——「读一次坐标 → 移一次鼠标」的断言会偶发失败
   且与实现无关。悬停类断言要先移开读静止态、再移入、然后轮询确认。

9. **验证脚本自己要能失败。**
   `verify-reader-menu.js` 原来只 `console.log` 出一张状态表，从不判定对错；
   而它依赖的 `__ab?to=vue` 开关属于 `ab-serve.js`，起成 `serve-legacy.js` 时该请求 404，
   脚本便静默地跑在旧版页面上——那 9 个 id 一个都不存在，输出仍是「全绿」。
   两点教训：脚本要断言并 `exit 1`；要显式校验「我真的在测目标产物」（构建模式、关键元素齐全），
   否则失败会伪装成通过。另外 `agent-browser` 的 eval 返回的是结果的 JSON 表示，
   字符串结果外还套一层引号，必须走 `evalJson()`，裸 `JSON.parse(evalJs(...))` 只会得到字符串——
   这会让整张状态表全变成 `undefined`。

10. **多列布局里，容器的 `width` 决定了文字宽度，而不是 `column-width`。**
    竖屏分页的溢出根因就在这里：`width:max-content` 下内联内容先按
    「不换行的理想宽度」排版，`column-width` 只是分列的**建议值**，
    两者冲突时文字按 max-content 溢出列。反过来，把容器撑成「整数列总宽」
    也不对——浏览器会把余量均摊回每列，列被撑宽、文字跟着变宽。
    经验：多列容器要么给**正好一屏**的确定宽度，要么别指望文字会听话。

11. **像素级「与原版一致」证明不了没有问题。**
    上面那个溢出在 `public/`（原版）里一模一样，所以逐像素比对只会报「一致」。
    回归基线能证明「我没改坏」，但证明不了「本来就是对的」——
    涉及可用性的地方，仍要按几何断言（文字是否落在列内、是否与悬浮控件重叠）。

12. **换行 ≠ 溢出，量错了会白改。**
    顶栏标题在窄屏是**换行**（`white-space:normal`）而不是被截断，
    第一版诊断只量「右边界是否超视口」，结论是「标题完整」，
    真正的毛病（换行后左缘伸到悬浮返回键底下）反而没测到。
    要按元素间的**相对关系**去判断（标题 left vs 返回键 right），而不是只看边界。
