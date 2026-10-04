# 旧的 Pull Request 在哪里

2026-10-04 记下。这个仓库 `duwqijlk/margin-words` 是公开项目。以后的开发在这里。

私有档案是 `duwqijlk/margin-words-archive`。Pull Request #1 到 #34 留在那里。它保持私有，并应归档，这样就不能再往那里推送。

那份档案里的 #1 到 #32 仍指向含有版权 EPUB 的提交。GitHub 不允许仓库所有者删除 `refs/pull/*/head`。这个公开仓库是新建的，只接收了改写之后的 `main`。这段历史没有第三方 EPUB。唯一的 EPUB 是项目自己的示例 `examples/sample-book/the-lantern-seller.epub`。

私有桶 `margin-words-private` 用来存放有版权的 EPUB，不是 Git 仓库。

网站不连接 GitHub。Cloudflare Pages 项目 `margin-words`（没有 Git 来源）、D1 数据库和 R2 桶都留在原处。https://inputread.site 不依赖这两个 GitHub 仓库。

English: [ARCHIVE.md](ARCHIVE.md)
