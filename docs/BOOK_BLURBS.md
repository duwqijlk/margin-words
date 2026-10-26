# 书籍简介（“发现”详情弹窗）

本页是简介的**格式、双语替换和写作规则的唯一说明**，托管于
[book-blurbs.md](https://inputread.site/kit/book-blurbs.md)。共享的存储、发布安全、缓存和恢复规则见
[维护地图](https://inputread.site/kit/maintenance.md)。

“发现”页点开一本书，弹窗里的“故事简介”来自书籍站点（R2 桶 `margin-words-books`），每本书一个文件：

| 书的类型 | 文件位置 |
| --- | --- |
| 词表书 | `word-lists/<书 id>/blurb.json` |
| 公版书 | `public-books/<书 id>/blurb.json` |

```json
{ "format": 1, "zh": "中文简介", "en": "Simple English summary" }
```

- 界面是中文就显示 `zh`，是英文就显示 `en`。某种语言没有简介时，弹窗不显示简介区块，不会改用另一种语言。
- 写 `zh` 和 `en` 两种语言；每种都是纯文本，最长 600 个字符，换行会保留。
- 每本书的文件**整体替换**。只改一种语言也必须带上要保留的另一种；省略或清空一种语言就会删除它。
- 简介**不在代码仓库里**，也**不在数据库（D1）里**。改简介不需要重新构建或部署网站，也不改词表和书目（`catalog.json`）。
- 不是每次重新打开弹窗都会重取：已读取的简介（包括 404）会在本页生命周期内 memoize。
  普通读者可能需要**完整刷新页面**；后台保存会清除管理员当前页面里该书的 memo，不会清除别人的。
  共享缓存说明见[版本与缓存](https://inputread.site/kit/maintenance.md#versions)。

## 写入方式

只有 Cloudflare 登录、没有仓库的 agent，见[上传任务第 11 节](https://inputread.site/kit/book-upload.md#11-the-story-summary)的 wrangler 命令。
它不自动运行检查规则，写入前必须按本页检查。后台和脚本使用下方同一套校验规则。

直接 R2 / wrangler / 上传脚本都不能当成带锁事务；遵守[发布检查点](https://inputread.site/kit/maintenance.md#publishing)：
协调**所有写入者的独占窗口**，保留待改对象的精确原始字节及元数据（不存在也记录），
写前重读，发现变化就中止并基于新快照重做，写后用 R2 重读核对字节及元数据。
失败按[恢复规则](https://inputread.site/kit/maintenance.md#recovery)处理。
不要用上传成功提示或旧页面里的简介代替核验。


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

- 每本书按本页的整体替换规则处理，保留另一种语言时把它一起放进草稿。
- 有任何一本书没通过预检查，**整批都不上传**；但上传阶段是逐个写文件，后一本失败不会自动撤回前一本。
- 上传用的是这台电脑上已登录的 Cloudflare 账号（`npx wrangler login`），不需要管理员密码。
- 脚本不代办独占窗口、快照、冲突重读和写后验证；按上面的发布检查点逐本核验。

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
- 演讲写清谁在何时向谁讲话，以及一个主要观点；不把演讲编成故事情节。
