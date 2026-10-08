# Margin Words（边注词典）

[![网站](https://img.shields.io/badge/site-inputread.site-1E4A3A)](https://inputread.site)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **公开仓库。** 以后的开发、推送和 Pull Request 都在这里。所有者已在 2026-10-04 归档私有档案 [duwqijlk/margin-words-archive](https://github.com/duwqijlk/margin-words-archive)。它只读，并保持私有。记录：[docs/ARCHIVE.zh-CN.md](docs/ARCHIVE.zh-CN.md)。

一个英文小说阅读器，给中国初中生用。读书时点一个词，就能看到为这本书写的简单英文解释。按钮和菜单有**简体中文**和**英文**。书里的内容一直是英文。没有 AI。

**[打开阅读器](https://inputread.site)** · [English](README.md)

![发现页：公版书封面，封面上的加号用来把书放进书架](docs/images/discover-zh.png)

## 项目介绍

Margin Words 是一个英文小说阅读器，给正在开始读英文原著的中国初中生用。

在故事里点一个词，卡片上就是为这本书写的简单英文解释。段落笔记、句子笔记和短语留在正文旁边，打开卡片时页面不会挪动。按钮和菜单可以是简体中文或英文，小说本身一直是英文。阅读器里没有 AI。

已经在这台设备上的书，不登录也能读；第一次下载之后，没有网络也能读。新书只能从“发现”添加，这一步需要登录。公版经典从书籍站点下载。仍有版权的小说不会放在这里：“发现”给出词表和书号，读者添加自己合法获得的 EPUB。

可以直接打开 [inputread.site](https://inputread.site)。这个仓库是源代码，使用 [MIT 许可证](LICENSE)。

## 能做什么

- **点词看解释。** 点一个词，卡片上是这本书词表里的简单英文意思。词表里没有的词会直接说明。卡片浮在文字上面，页面不会被挤开。
- **段落旁边的笔记。** 有笔记的段落，边上一直有一盏小灯。句子笔记和短语也从正文里打开。
- **先有书架，再到发现。** 新书架是空的，会带你去“发现”。“发现”是添加图书的唯一入口，而且要先登录。没登录也可以浏览全部书。已经存在这台设备上的书，不登录也能读。
- **公版经典。** 《爱丽丝梦游仙境》《金银岛》和其他免费的书，添加时才会下载。名人演讲在“发现”里单独的一个标签。
- **有版权的书仍由读者自己保存。** 这类书在“发现”里只提供词表和书号，不提供小说文件。你把自己的 EPUB 加到这张卡片上。应用会告诉你有多少原文能对上；低于 80% 时会先说明。
- **生词本。** 存下一个词，以后再复习。每个词一张卡片，并记下它原来的那句话。
- **数据页。** 一页看完“发现”里的全部书：书的数量、标出的单词、段落笔记、句子笔记、短语，还有系列。
- **存在这台设备上。** 书和词表存在浏览器里。打开网站需要网络。
- **账号可有可无。** 添加新书需要登录。同一个账号还可以把书架、阅读位置、生词和设置同步到别的设备。读书本身不需要账号。

用 Vite、React 和 Tailwind 做成。账号功能打开时，用 Cloudflare Pages Functions 和 D1。说明见 [docs/ACCOUNTS.md](docs/ACCOUNTS.md)。

## 在自己的电脑上运行

```bash
npm install
npm run dev
```

打开 <http://localhost:8080>。

`npx vite build` 会把静态网站写到 `dist/`（HTML、JS、CSS 和字体）。这个文件夹里没有书。正式构建从 `https://books.inputread.site` 读取书籍。`npm run build:local` 把书籍地址留在同一站点，测试用这个。

任何静态网站都可以托管 `dist/`。可选的账号接口是放在这些文件旁边的 Pages Function。没有这些函数，阅读器照常可用。

## 做一本图书包

应用不能导入单独的 EPUB，也不能导入 zip。读者只从“发现”添加书。

**图书包**是把一本书准备进目录的格式：一个 `.zip`，里面正好是 `book.epub` 和 `glossary.json`。规则在 [docs/book-pack-spec.md](docs/book-pack-spec.md) 第 3 节。

`book-pack-kit.zip` 给做书的人，或者给 AI。里面有规格说明、示例故事 *The Lantern Seller*、它的词表，以及一个做好的示例包。应用里的“使用说明”和“设置”有“怎样做图书包”的链接（页面 `/kit/`）。

```bash
node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip
npm run build:kit
npm run check:example
```

## 许可证

应用的源代码使用 [MIT 许可证](LICENSE)。

Copyright (c) 2026 XCRUN.

你可以自由使用、复制和修改这个仓库里的阅读器、账号函数和工具。请保留版权声明和许可声明。

小说是另一回事：

| 内容 | 许可 |
| --- | --- |
| 阅读器、Pages Functions 和工具 | [MIT 许可证](LICENSE) |
| 示例故事 *The Lantern Seller* | 本项目原创，[CC0](https://creativecommons.org/publicdomain/zero/1.0/)。见 [docs/book-pack-spec.md](docs/book-pack-spec.md)。 |
| 公版书 | 公有领域。文件不在 Git 里，由书籍站点提供。 |
| 仍有版权的书 | 不在这个仓库里。本项目不托管、不出售、不分享这些书。“发现”只列出词表和书号。读者使用自己合法获得的 EPUB。 |
| 词表（`glossary.json`） | 本应用的学习笔记。笔记里的短引文仍属于原作者和出版社。 |
| [English Read](https://github.com/bitbw/english-read) | 另一个项目，Copyright (c) 2026 English Read contributors，[MIT](https://github.com/bitbw/english-read/blob/main/LICENSE)。Margin Words 受到它的启发，但是独立的应用。 |

如果某段引文不该出现在这里，请到 <https://github.com/duwqijlk/margin-words/issues> 告诉我们。

## 开发和托管

### 书的文件在哪里

克隆这个仓库，会得到词表和示例故事，不会得到小说。有版权的 EPUB 放在私有桶 `margin-words-private`。公版 EPUB 放在 `https://books.inputread.site`。Git 里唯一的 EPUB 是 `examples/sample-book/the-lantern-seller.epub`。

在一台另外存有书文件的电脑上，目录是这样的：

```
packs/catalog.json         有版权书的清单
packs/<id>/glossary.json   这本书的词表
packs/<id>/book.epub       只在本机；Git 会忽略它
public-books/              免费的公版书，同样的方式
```

`npm run build:books` 写出 `dist-books/`：散装的公版文件、散装的词表、有 `packs/<id>/cover.jpg` 时的小封面，以及目录。没有 zip，也没有有版权的 EPUB。没有封面的词表书，在应用里用生成的书名和作者封面。

`npm run build:private` 根据本机的 `packs/<id>/book.epub` 写出 `dist-private/`（EPUB、词表和封面）。这个文件夹只上传到 `margin-words-private`。应用不会去读那个桶。不要把 `dist-private/` 放进 `dist/` 或 `dist-books/`。

词表格式：[docs/GLOSSARY_FORMAT.md](docs/GLOSSARY_FORMAT.md)。图书包目录：[docs/PACKS_FORMAT.md](docs/PACKS_FORMAT.md)。本机目录用 `node scripts/build-packs.mjs` 重新生成。

### 把网站和书放到线上

1. 用 `npx vite build` 构建前端，把 `dist/` 部署到 Cloudflare Pages。正式构建从 `https://books.inputread.site` 取书。换站点时设置 `VITE_BOOKS_BASE`。
2. 用 `npm run build:books` 生成书籍文件，再按路径作为对象键上传：

   ```bash
   cd dist-books && find . -type f | sed 's|^\./||' | while read -r key; do
     npx wrangler r2 object put "$BUCKET/$key" --file "$key" --remote
   done
   ```

   `https://books.inputread.site` 后面的存储桶必须允许这些来源跨域读取：`https://inputread.site`、`https://www.inputread.site`、`https://margin-words.pages.dev`，以及 localhost。页面从这次跨域响应读到书，再存在浏览器里。
3. `packs/`、`site/` 和 `dist-private/` 不要放到公开网站上。`node scripts/build-site.mjs` 会写出 `site/`（`dist/` 加上 `packs/`），给自己的电脑用。

读者也可以在“设置”里填写另一个目录地址。那个站点必须允许跨站读取。`catalog.json` 里的地址是相对于目录文件本身的。

### 一本书怎样进书架

1. 打开应用。新书架是空的，只有一个按钮：到“发现”找书。
2. 登录。在“发现”里点封面上的加号。加号变成对勾（“已在书架”）。再点对勾，选择“移出书架”，书就离开。刚放上去的书可以撤销。已经读过的书，或者已经添加了自己 EPUB 的书，会先询问。
3. 公版书在添加时下载。词表书会下载词表，并请你添加卡片上那个书号的 EPUB。低于 80% 的匹配会在保存前说明。书和词表存在浏览器里（IndexedDB）。
4. 这之后，书和词表留在这台设备上（IndexedDB）。打开网站需要网络。服务工作线程不再代替浏览器打开页面。
5. 词表有新版本（目录里的 `rev` 变了）时，已经在书架上的书仍用原来的词表。书架卡片和“发现”卡片会显示**更新**，并提示有几本书在等。只有点了更新，才会换上新词表。书、阅读位置、生词和设置都保留。自己添加或改过的词表不会被替换。新词表和读者的 EPUB 对不上（低于 80%）时，旧词表留着，卡片上会说明原因。

已经在书架上的书，菜单里仍然可以**添加词表**（一份 `.json`）。

### 检查

```bash
npx tsc --noEmit
npm run check:cjk          # 中文只允许出现在 src/lib/i18n-zh.ts、docs/ 和 README.zh-CN.md
npm run check:example
node scripts/validate-glossary.mjs packs/twits/book.epub packs/twits/glossary.json
node scripts/build-packs.mjs --check
npm test
```

### 界面语言

所有看得见的文字都在两本词典里，键名相同：`src/lib/i18n-en.ts` 和 `src/lib/i18n-zh.ts`。少一个键，`npx tsc --noEmit` 就会失败。第一次打开时跟着浏览器语言（中文用中文，其他用英文），选择会保存下来。书的内容（解释、笔记、短语、书名）不会被翻译。

### 这个公开仓库

以后的开发在这里。更早的 Pull Request 留在私有档案 [duwqijlk/margin-words-archive](https://github.com/duwqijlk/margin-words-archive)。记录：[docs/ARCHIVE.zh-CN.md](docs/ARCHIVE.zh-CN.md)。搬迁说明：[MIGRATION.md](MIGRATION.md)（中文：[docs/MIGRATION.zh-CN.md](docs/MIGRATION.zh-CN.md)）。

更细的英文技术说明：[README.md](README.md)。

## 来源

这个阅读器的想法来自开源项目 [English Read](https://github.com/bitbw/english-read)（Copyright (c) 2026 English Read contributors，[MIT 许可证](https://github.com/bitbw/english-read/blob/main/LICENSE)）。Margin Words 是我们自己的应用。应用里的“使用说明”也写了同样的话。
