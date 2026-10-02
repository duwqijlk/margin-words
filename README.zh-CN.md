# Margin Words（边注词典）

一个英文小说阅读器。读书时点一个词，就能看到简单的英文解释。专为中国初中生设计。没有服务器，也没有 AI，
下载书之后**不用上网**就能读。

- 界面有**中文**和**英文**两种语言。在顶部点“English / 中文”按钮，或者在“设置”里切换。书里的内容（单词解释、段落和句子帮助、短语、书名）一直是英文。
- 应用本身是静态网页：`npm install`，然后 `npm run dev`（开发），或 `npx vite build`（生成 `dist/`，放到任何静态网站上）。`dist/` 里没有书。公有领域的书和版权书的词表在书籍站点上（默认 `https://books.inputread.site`），用 `npm run build:books` 生成要上传的文件。
- 新打开的书架只有《爱丽丝梦游仙境》。其他书在顶部的“发现”里，点封面上的红心才会下载。红心填满表示已经在书架上，再点一次就移出。刚放上去的书可以撤销；已经读过、或已经添加了自己电子书的，会先询问。已经在书架上的书会留着；删掉的书不会自己回来。
- 版权书的 EPUB 不公开。这些书在“发现”里提供词表。有封面文件的书用缩小后的封面；没有封面时，卡片上是生成的封面（书名和作者）。不会从网上抓封面。版权 EPUB 用 `npm run build:private` 生成 `dist-private/`，只上传到不公开的私有桶 `margin-words-private`，应用不会去读它。
- **添加图书**时，普通入口仍然只要图书包：**一个 .zip 文件，里面正好有 `book.epub` 和 `glossary.json`**。书名、作者和封面都从 EPUB 里读取。词表必须是为这本书做的（`glossary.json` 里的 `sha256` 与 EPUB 一致，或者书名和作者一致）。详细规则见 [docs/book-pack-spec.md](docs/book-pack-spec.md) 第 3 节“Required files”。
- 如果在普通入口选了单独的 EPUB，应用会提示“需要处理好的图书包”，并给出做图书包的指南链接（`/kit/`）。图书包有问题时（缺词表、词表不对应这本书、词表格式错误），应用会用简单的话说明哪里不对，并且什么都不会添加。
- 版权书的 EPUB 不会放进公开网站。这些书在“发现”里列出：封面、书名、作者、蓝思、书号、系列。点红心会下载词表，并请你添加这个书号的电子书。应用在浏览器里把电子书和词表配在一起，并显示有多少原文片段能对上。低于 80% 时会说明这看起来像另一个版本。

## 想自己处理一本书？

把 **`book-pack-kit.zip`** 交给 AI 就行。里面有：`book-pack-spec.md`（给 AI 看的完整格式和步骤）、示例书 *The Lantern Seller*（EPUB）、它的示例词表（`glossary.json`），以及可以直接添加的示例图书包 `the-lantern-seller.pack.zip`（里面是 `book.epub` + `glossary.json`）。
在应用里下载：“添加图书”或“设置”里的“怎样做图书包”链接（页面 `/kit/`）。
用自己的文件做图书包：`node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip`。
自己生成：`npm run build:kit`（来源：`docs/book-pack-spec.md` 和 `examples/sample-book/`）。

## 常用命令

```
npm run check:cjk        # 中文只允许出现在 src/lib/i18n-zh.ts、docs/ 和 README.zh-CN.md
npm run check:example    # 检查示例、规格里的例子和工具包
npm test
npx tsc --noEmit
node scripts/validate-glossary.mjs book.epub glossary.json
node scripts/build-packs.mjs --check
```

更多技术说明（英文）：[README.md](README.md)、[docs/GLOSSARY_FORMAT.md](docs/GLOSSARY_FORMAT.md)、[docs/PACKS_FORMAT.md](docs/PACKS_FORMAT.md)。
