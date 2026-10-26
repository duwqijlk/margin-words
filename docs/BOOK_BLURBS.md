# 书籍简介（“发现”详情弹窗）

“发现”页点开一本书，弹窗里的“故事简介”来自书籍站点（R2 桶 `margin-words-books`），每本书一个文件：

| 书的类型 | 文件位置 |
| --- | --- |
| 词表书 | `word-lists/<书 id>/blurb.json` |
| 公版书 | `public-books/<书 id>/blurb.json` |

```json
{ "format": 1, "zh": "中文简介", "en": "Simple English summary" }
```

- 界面是中文就显示 `zh`，是英文就显示 `en`。某种语言没有简介时，弹窗不显示简介区块，不会改用另一种语言。
- 纯文本，最长 600 个字符，换行会保留。
- 简介**不在代码仓库里**，也**不在数据库（D1）里**。改简介不需要重新构建或部署网站，也不改词表和书目（`catalog.json`）。上传后重新打开弹窗就能看到。

## 写入方式

只有 Cloudflare 登录、没有仓库的 agent，直接用 wrangler 写这个文件：见 `docs/BOOK_UPLOAD.md` 第 8 节（网站上 `/kit/book-upload.md`）。下面两种方式写的是同一个文件，检查规则也相同。


### 1. 后台界面（人工改一两本）

`/admin/` → “简介”标签：搜书名、作者或 id，填中文和英文简介，点“保存简介”。只有管理员账号能保存。

### 2. 上传脚本（agent 批量写）

```bash
node scripts/publish-blurbs.mjs --list
```

列出线上书目里的全部书（包括只在 R2、不在仓库里的书），以及每本书已有哪些语言的简介。

写好的草稿放在 `local-exports/` 下（git 不会提交这个目录），格式：

```json
{
 "format": 1,
 "books": {
  "a-game-of-thrones": { "zh": "中文简介", "en": "Simple English summary" }
 }
}
```

先检查，不上传：

```bash
node scripts/publish-blurbs.mjs local-exports/blurbs.json
```

检查无误后上传：

```bash
node scripts/publish-blurbs.mjs local-exports/blurbs.json --upload
```

- 每本书的简介**整体替换**：草稿里某本书只写了 `zh`，上传后这本书的 `en` 会被删掉。只想改一种语言时，另一种也要照抄进去。
- 有任何一本书没通过检查，**整批都不上传**。
- 上传用的是这台电脑上已登录的 Cloudflare 账号（`npx wrangler login`），不需要管理员密码。

## 检查规则

后台和脚本用同一套规则（`src/lib/book-blurb-file.ts`）：

- 书的 id 必须在线上书目里，写错的 id 会被拒绝。
- 中文简介里必须有中文；英文简介里不能有中文。
- 不超过 600 个字符。
- 不能有 HTML 或 Markdown 符号。

## 写简介的要求

- 中文给初中生看；英文用简单英语，和书里英文释义的难度一致（CEFR A2–B1）。
- 用自己的话写，不要照抄出版社、网店的文案或书评，那些有版权。
- 讲清楚主角是谁、故事从哪里开始、主要矛盾是什么，2–4 句为宜。
- 不剧透结局和关键反转。
- 不评价好坏，不写“经典”“必读”之类的宣传词。
- 情节要准确。拿不准的细节宁可不写，也不要编。
