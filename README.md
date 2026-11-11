# Digitata

本地 GitHub PR 客户端：看 PR、看 diff、合并。数据全部来自本机已登录的 `gh` CLI，目前只支持 GitHub。

对 Calcit 项目有一个专门的 **program diff** 视图：`.cirru` 快照文件不按文本 diff，而是调用
`calcit analyze program-diff --base <merge-base> <head>`，按 ns → def 列出新增 / 删除 / 修改的定义，
并把修改的定义渲染成 Cirru 缩进树，旧/新子树分别高亮。

## 收件箱

默认打开的是跨仓库收件箱（类似 https://github.com/pulls ），列出所有和你有关的 open PR：我创建的、请求我 review、指派给我、提到我；“全部”是前三者合并去重。
勾选“可合并”只显示非草稿、CI 未失败/未在运行、没有被要求修改的 PR。附加搜索框接受 GitHub 搜索语法（如 `org:calcit-lang`）。
数据来自一次 `gh api graphql` search，顺带拿到每个 PR 的 CI 计数。也可以在侧栏固定单个仓库查看其 PR 列表。

## 运行

需要 Node 24+（直接运行 `.ts`）、`gh`（已 `gh auth login`）、`calcit`（program diff 用）。

```bash
yarn install
yarn dev     # API :7741 + Vite :5741，打开 http://localhost:5741
yarn start   # 构建后由 API 服务一并托管页面，打开 http://localhost:7741
```

地址格式：`#/<owner>/<repo>/<PR 号>`，例如 `http://localhost:7741/#/calcit-lang/calcit/2685`。

环境变量：`DIGITATA_PORT`（默认 7741）、`DIGITATA_CACHE`（仓库缓存，默认 `~/.cache/digitata/repos`）、
`DIGITATA_CALCIT`（calcit 可执行文件，默认 `calcit`）。

## 结构

- `server/host.ts`：`CodeHost` 接口（`inbox` / `listPRs` / `getPR` / `getDiff` / `merge`）。
- `server/gh.ts`：基于 `gh pr list/view --json`、`gh pr diff`、`gh pr merge` 的实现。以后换成直接调 REST/GraphQL 只需另写一个实现。
- `server/calcit.ts`：为每个仓库维护一个 blobless clone，fetch `refs/pull/N/head`，在 merge-base 和 head 之间跑 program diff（同一仓库串行）。
- `server/main.ts`：只监听 `127.0.0.1` 的薄 HTTP 层，拒绝非 localhost 的 Origin。
- `src/diff/FileDiff.tsx`：按文件名分派渲染器；`.cirru`（除 `deps.cirru`）默认走 program diff，失败自动回退文本 diff。

## 加载与缓存

列表、PR 详情和 program diff 都走 stale-while-revalidate：先显示缓存（列表和详情存在 localStorage，刷新页面也在），后台更新，进度只在右下角提示，失败也只弹角落提示，不清空已有内容。
鼠标悬停列表项约 150ms 会预取详情和 diff。program diff 按 base/head SHA 缓存，不会重复计算。

## 合并

合并前弹确认框，显示 CI 状态、mergeable / mergeStateStatus、review 结论；CI 失败、运行中、有冲突或草稿时需要额外勾选确认。
键盘：PR 页按 `M` 打开确认框；框内 `Enter` 合并、`Esc` 取消、`1`/`2`/`3` 选方式、`D` 切换删除分支、`A` 确认警告。
合并请求带上页面看到的 head SHA（`gh pr merge --match-head-commit`），PR 在此之后有新提交会被拒绝。
