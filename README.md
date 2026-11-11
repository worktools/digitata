# Digitata

本地 GitHub PR 客户端：看 PR、看 diff、合并。数据全部来自本机已登录的 `gh` CLI，目前只支持 GitHub。

对 Calcit 项目有一个专门的 **program diff** 视图：`.cirru` 快照文件不按文本 diff，而是调用
`calcit analyze program-diff --base <merge-base> <head>`，按 ns → def 列出新增 / 删除 / 修改的定义，
并把修改的定义渲染成 Cirru 缩进树，旧/新子树分别高亮。

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

- `server/host.ts`：`CodeHost` 接口（`listPRs` / `getPR` / `getDiff` / `merge`）。
- `server/gh.ts`：基于 `gh pr list/view --json`、`gh pr diff`、`gh pr merge` 的实现。以后换成直接调 REST/GraphQL 只需另写一个实现。
- `server/calcit.ts`：为每个仓库维护一个 blobless clone，fetch `refs/pull/N/head`，在 merge-base 和 head 之间跑 program diff（同一仓库串行）。
- `server/main.ts`：只监听 `127.0.0.1` 的薄 HTTP 层，拒绝非 localhost 的 Origin。
- `src/diff/FileDiff.tsx`：按文件名分派渲染器；`.cirru`（除 `deps.cirru`）默认走 program diff，失败自动回退文本 diff。

## 合并

合并前弹确认框，显示 CI 状态、mergeable / mergeStateStatus、review 结论；CI 失败、运行中、有冲突或草稿时需要额外勾选确认。
合并请求带上页面看到的 head SHA（`gh pr merge --match-head-commit`），PR 在此之后有新提交会被拒绝。
