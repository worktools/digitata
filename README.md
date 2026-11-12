# Digitata

本地 GitHub PR 客户端：看 PR、看 diff、合并。数据全部来自本机已登录的 `gh` CLI，目前只支持 GitHub。

对 Calcit 项目有一个专门的 **program diff** 视图：`.cirru` 快照文件不按文本 diff，而是调用
`calcit analyze program-diff --base <merge-base> <head>`，按 ns → def 列出新增 / 删除 / 修改的定义，
并把修改的定义渲染成 Cirru 缩进树，旧/新子树分别高亮。

## 待合并列表

侧栏默认是跨仓库的“待合并”列表：所有我创建的、请求我 review 或指派给我的 open PR（不含草稿），按创建时间从早到晚排，等得最久的在最上面。
合并成功后该 PR 立即从列表消失，随后列表自动刷新。附加搜索框接受 GitHub 搜索语法（如 `org:calcit-lang`）。
数据来自 `gh api graphql` search，顺带拿到每个 PR 的 CI 计数。也可以在侧栏固定单个仓库查看其 PR 列表。

## 运行

需要 Node 24+（直接运行 `.ts`）、`gh`（已 `gh auth login`）、`calcit`（program diff 用）。

```bash
yarn install
yarn dev     # API :7741 + Vite :5741，打开 http://localhost:5741
yarn start   # 构建后由 API 服务一并托管页面，打开 http://localhost:7741
```

地址格式：`#/<owner>/<repo>/<PR 号>`，例如 `http://localhost:7741/#/calcit-lang/calcit/2685`。

环境变量：`DIGITATA_PORT`（默认 7741）、
`DIGITATA_CALCIT`（calcit 可执行文件，默认 `calcit`）。

## 结构

- `server/host.ts`：`CodeHost` 接口（`inbox` / `listPRs` / `getPR` / `getDiff` / `merge`）。
- `server/gh.ts`：基于 `gh pr list/view --json`、`gh pr diff`、`gh pr merge` 的实现。以后换成直接调 REST/GraphQL 只需另写一个实现。
- `server/calcit.ts`：不 clone 仓库。head 版本用 GitHub API 取；base（merge-base）版本两路竞速取最快的：一路把 PR patch 反向应用到 head 版本上（一次往返），一路先查 merge-base 再取文件（两次往返）。两个版本放进临时两提交仓库跑 `calcit analyze program-diff`。打开 PR 或悬停时就提前开始计算。
- `server/main.ts`：只监听 `127.0.0.1` 的薄 HTTP 层，拒绝非 localhost 的 Origin。
- `src/diff/FileDiff.tsx`：按文件名分派渲染器；`.cirru`（除 `deps.cirru`）默认走 program diff，失败自动回退文本 diff。

## Diff 样式

改动行按“删除段 → 新增段”配对，做 token 级对比：旧行里和新行重复的部分显示为灰色，只标出被删的 token；新行完整显示一次，标出新增 token。
program diff 的 `OLD@` / `NEW@` 子树同样逐行对齐：两边完全相同的行旧侧变灰、新侧不再高亮，相似的行只高亮变化的 token。

类型：定义的 schema（类型签名）变化会单独列出，拆成旧/新两行逐 token 对比，定义列表上标注“类型 changed/widened/narrowed”；
CLI 报告的 schema widening 会在顶部给出警告。代码里的类型标注（`assert-type`、`hint-fn` 等）作为代码树的一部分参与 diff。

类型用 calcit 源码写法显示（如 `Fn String (-> String)`，需要包含 calcit#2711 的 calcit），并做轻量着色：类型名紫色、`->` 蓝色、`:generics` 等子句黄色。每张定义卡片标题旁显示该定义当前的类型签名。

锁文件（yarn.lock、Cargo.lock 等）、`.gitattributes` / `.gitignore`、`.yarn/`、压缩或生成产物（`*.min.js`、`js-out/`、`dist/`）默认折叠，文件列表里变灰。

## 加载与缓存

列表、PR 详情和 program diff 都走 stale-while-revalidate：先显示缓存（列表和详情存在 localStorage，刷新页面也在），后台更新，进度只在右下角提示，失败也只弹角落提示，不清空已有内容。
鼠标悬停列表项约 150ms 会预取详情和 diff。program diff 按 base/head SHA 缓存，不会重复计算。

## 合并

合并前弹确认框，显示 CI 状态、mergeable / mergeStateStatus、review 结论；CI 失败、运行中、有冲突或草稿时需要额外勾选确认。
键盘：PR 页按 `M` 打开确认框；框内 `Enter` 合并、`Esc` 取消、`1`/`2`/`3` 选方式、`D` 切换删除分支、`A` 确认警告。
合并在后台任务里执行：确认后对话框立即关闭，可以马上切到别的 PR；列表上该 PR 显示“合并中 / 已合并 / 合并失败”，结果在右下角提示，完成后列表自动刷新。
测试用：`DIGITATA_DRY_MERGE=1` 启动的服务不会调用 GitHub，合并请求等 5 秒后返回失败；`DIGITATA_DRY_MERGE=ok` 则假装成功。
合并请求带上页面看到的 head SHA（`gh pr merge --match-head-commit`），PR 在此之后有新提交会被拒绝。
