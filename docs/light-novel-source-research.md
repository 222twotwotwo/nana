# 轻小说源调研

本次调研重点是中文轻小说，按“可以公开搜索、可以公开读取、无需登录、不执行第三方脚本、能通过当前网络白名单”筛选。

## 已接入

### Wenku8 OPDS

- 维护项目：[WorldObservationLog/wenku8-opds-readme](https://github.com/WorldObservationLog/wenku8-opds-readme)
- 搜索接口：`https://opds.wol.moe/zh_CN/search.opds?q=关键词`
- 正文节点：`https://dl1.wenku8.com/txtutf8/{aid/1000}/{aid}.txt`，`dl2` 作为回退
- 封面节点：`https://img.wenku8.com/image/{aid/1000}/{aid}/{aid}s.jpg`
- 实测：搜索“刀剑神域”返回 4 部作品；作品 471 拆出 234 个卷章，第二卷首章读取约 2.9 万字。
- 目标书验证：`无职转生` 命中作品 1587，解析 490 个卷章，首章约 4987 字；`败犬女主太多了` 以别名 `败北女角太多了！` 命中作品 3057，解析 150 个卷章，首章约 346 字。
- 项目适配：`server/additional-lightnovels.js`

OPDS 只提供作品元数据和整本公开 TXT，适配器在服务端按卷章标题拆分；插图节点会被过滤。TXT 会在内存中短时缓存，单本缓存上限为 8 本，避免反复下载同一整本内容。

## 评估但未接入

- `WorldObservationLog/pywenku8api`：它是 Wenku8 的 Python 客户端，网页源存在登录和 Cloudflare 保护；项目同时说明官方 App relay 需要私有 `appver` 实现。因此使用公开 OPDS/CDN 适配更稳定，也不复制其登录或签名逻辑。
- Z-Library：主要提供电子书文件下载，来源、授权和接口稳定性不适合作为本产品的默认在线章节源；当前项目不接入需要账号、验证码、付费或绕过访问限制的接口。
- 百度/Reddit 等社区帖子：可用于发现站点和规则线索，但帖子本身不是稳定 API，也无法保证转载内容的版权和完整性，因此不直接作为运行时来源。
- 仅有书源 JSON 的 GitHub 仓库：规则文件不能证明目标站点当前可用。当前项目只把规则作为调研依据，重新实现并验证搜索、目录和正文解析，不执行仓库中的任意脚本。

## 网络与代理

Wenku8 OPDS 和 TXT/CDN 节点本次直连验证通过；若当前网络访问受限，项目已支持根目录 `.env` 中的 `MOYIN_PROXY=http://127.0.0.1:7897`。代理只由服务端网络层使用，不会关闭 TLS 校验，也不会绕过登录、验证码或付费限制。
