# 这个仓库是私有档案

2026-10-04 记下。这是这份副本上的最后一次改动。

## 做了什么

1. 这个仓库**保持私有**。
2. 仓库从 `duwqijlk/margin-words` **改名**为 `duwqijlk/margin-words-archive`。
3. 仓库**归档**，之后只读。不要再推送，也不要开新的 Pull Request。
4. **新的公开仓库**使用原来的名字 `duwqijlk/margin-words`：
   https://github.com/duwqijlk/margin-words
5. 以后的开发只在那个公开仓库里进行。

私有桶也叫 `margin-words-private`。那个桶用来存放有版权的 EPUB，不是这个 Git 仓库。档案仓库用 `margin-words-archive`，避免和桶的名字混在一起。

## 为什么旧的 Pull Request 留在这里

Pull Request #1 到 #33 留在这份档案里，评审记录还在。

#1 到 #32 仍指向含有版权 EPUB 的提交。GitHub 不允许仓库所有者删除 `refs/pull/*/head`。改写 `main` 清不掉这些文件。把这份仓库改成公开，书就会公开。删掉仓库，这些 Pull Request 会一起消失。

所以这份副本保持私有并归档，只作记录。公开仓库是新建的，里面只有改写之后的 `main`。那段历史没有第三方 EPUB。唯一的 EPUB 是项目自己的示例 `examples/sample-book/the-lantern-seller.epub`。

## 不会跟着搬走的东西

网站不连接 GitHub。Cloudflare Pages 项目 `margin-words`（没有 Git 来源）、D1 数据库和 R2 桶都留在原处。归档这个仓库不会让 https://inputread.site 下线。

装在 `duwqijlk/margin-words` 上的开发 bot 不会自动转到新仓库。以后的会话要在公开仓库上打开。

English: [ARCHIVE.md](ARCHIVE.md)
