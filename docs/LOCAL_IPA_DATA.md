# 本地 IPA 清洗原型

这是一份**仅本地研究/预览**的数据，不是可发布词典。来源授权没有因此变成适合再分发；不要把下载、生成分片或原始审计放进公开仓库、正式构建、部署包。运行时显示实现由应用层负责，本文只说明清洗器及其产物。

## 运行

从仓库根目录运行，所有输入/输出参数必须是绝对路径。Python 必须使用隔离模式 `-I`。

```sh
python -I scripts/build-local-ipa.py --self-test
node --test scripts/local-ipa-cleaner.test.mjs
python -I scripts/build-local-ipa.py --source-root 'C:/Users/Administrator/Desktop/apyx套利/margin-words-audit/local-exports/dual-ipa-source-evaluation-105c81ac' --out 'C:/Users/Administrator/Desktop/apyx套利/margin-words-audit/local-exports/ipa-word-card/data'
python -I scripts/build-local-ipa.py --source-root 'C:/Users/Administrator/Desktop/apyx套利/margin-words-audit/local-exports/dual-ipa-source-evaluation-105c81ac' --out 'C:/Users/Administrator/Desktop/apyx套利/margin-words-audit/local-exports/ipa-word-card/data' --check
```

`--check` 重新读取原始输入、重新生成全部预期字节，比较数据分片、manifest 和审计/统计；不修改文件。没有时间戳、随机排序、绝对路径等不稳定字段。来源 ZIP 成员、单词和字母分片都按稳定顺序处理。

清洗器只读取数据，不导入、执行或解压下载的代码。ZIP 只在内存中读取选中的数据成员；限制文件总大小、成员数量、单个成员/嵌套书包/JSON 行大小及累计解压字节，并拒绝加密成员和危险路径。BNC 仅读取 `data/*.json`，kajweb 仅读取 `book/*.zip` 中唯一的 JSONL 数据成员，DictionaryData 按 `>` 分隔的 CSV 读取。

## 固定原始输入

来源根目录为 `local-exports/dual-ipa-source-evaluation-105c81ac`。已有 adapter/index 只用于了解格式；生成时重新读取下面的原始文件并验证 SHA-256。

| 来源 | 根目录下的文件 | SHA-256 |
| --- | --- | --- |
| BNC/COCA | `downloads/bnc-coca/repository-data.zip` | `86a66f3dc74b724c89b333e281f2346b599bd41e174f3144e4f2f88212674b2e` |
| DictionaryData | `downloads/dictionarydata/word.csv` | `29183117768c8c5bbdd13545c4482f62aa7980852ae6848a27a95d68b1ab3d60` |
| kajweb 全部书包 | `downloads/kajweb-all-books/repository-data.zip` | `ebfcfe6450e21784b5be8b195dde5e79ff01ac13832ef0bd17e2b6b498e19e6e` |

来源版本和下载地址见旧研究的 `results/source-manifest.json`；这里不再下载，不联网，也不执行旧 adapter。

## 运行时数据契约

`data/manifest.json`：

```json
{
  "schemaVersion": 1,
  "version": "local-ipa-primary-v2-<content-policy-hash>",
  "shards": {
    "a": { "file": "a.json", "sha256": "<64 lowercase hex characters>" }
  }
}
```

实际生成全部 `a` 至 `z` 的 26 个分片。每个分片：

```json
{
  "schemaVersion": 1,
  "version": "<same version as manifest>",
  "words": {
    "ExactWord": {
      "UK": [{ "ipa": "phonemes", "pos": "n." }],
      "US": []
    }
  }
}
```

`ipa` 不带外层斜线/方括号；`pos` 可省略。单词保留来源原始大小写，只接受 ASCII 字母以及单词内部的 ASCII 连字符、撇号，不接受短语、空格、数字、前后连字符、重音字母或弯撇号。首字母的小写决定所属分片。UK 与 US **独立数组**，可以一边为空，不按序号配对，不从另一口音复制。每个可用口音**只输出一个主读音**，缺少时数组为空；不输出备选。每条最长 160 字符。运行时不包含来源证据 ID，完整证据单独保存。主读音按通过清洗的来源优先级选择，不代表独立语言学验证过的唯一标准答案。

## 合并及清洗政策

1. 候选审计按每个精确单词、每个口音以 BNC 为主，保持可解析读音及来源顺序。最终运行时选择每口音**第一个被接受的候选**，其余仅审计，不再提供展开、多读音或异读选择。
2. DictionaryData 只补 BNC 缺少的口音。候选审计保留已人工核对的显式额外读音 `use` UK `juːs`、US `jus`（原始 `[ju:s]` / `[jus]`）；由于 BNC 已有主候选，这两个额外读音不会进入运行时。保留来源原貌，不把 US `jus` 擅自改成 `juːs`。其他未采用的新读音也进入审计。
3. kajweb 的可解析且非字面重复候选进入审计；仅在更高优先级没有候选时成为运行时主读音。它不是权威完整的异读表，不猜缺失读音或词性。
4. 候选去重只比较**字面规范化后的 IPA**；不同长度标记、可选音、重音及不同符号不会被全局等价化。相同 IPA 的后到词性不会生成重复候选；其原始注释仍在审计里。
5. 去掉平衡的整字段 `/.../` 或 `[...]` 包装，冒号改为 `ː`，来源的直/弯撇号作为重音号转为 `ˈ`，分号及全角分号拆分独立候选。保留 `(r)`、`(ə)` 等来源可选音，不删除可选音来凑一致。
6. 小语法解析来源中已观察到的 `(for v.)`、`(for n.)`、`(for n. adj.)`、`(for v.,)` 等词性注释，以及 `(read, read)` 的过去式/过去分词注释。不能识别的括注不当成 IPA。`(canadian)`、`(occas.)`、未知说明文字、HTML、CJK、数字、无元音片段等拒绝；逗号或斜线分隔的缩略变体不展开、不推断。一个分号候选拒绝，不妨碍同字段其他明确完整候选。

### BNC 的词形复制检测

BNC 某些记录的 `word` 与 `headword` 不同，而发音可能仍是词元发音。例如 `aardvarks → aardvark` 的 UK 字段仍是 `ˈɑːdvɑːk`，不能把这种字段存在当成复数发音正确。

采用有限的同口音字面比较启发式：

- `word == headword`：通常处理。
- 不同且显式词元记录可解析：与词元相同的候选隔离；与词元不同的候选允许进入。
- 没有可解析的词元记录：隔离待查。
- 小规模核对过的拼写变体例外：`color/colour`、`gray/grey`、`true/TRUE`、`false/FALSE`。

不是把所有词形差异一律丢弃。已查原始字段：`does dʌz`、`was wɒz; wəz`、`having ˈhævɪŋ`、`filled fɪld`、`asked ɑ:skt`、`books bʊks` 等与对应词元不同的显式读音仍保留。此检测只拦截已展示的复制风险，**不能证明所有不同读音在语言学上正确**，也可能隔离合理同音词；没有做词形生成或大规模语言学裁决。

### kajweb 显式隔离名单

名单精确到来源、单词、口音、规范化候选，不自动造替代音：

| 单词/口音 | 候选 | 原因 |
| --- | --- | --- |
| `book` UK | `buk` | 已知元音异常 |
| `us` UK/US | `juːɛs` | 把代词污染成缩写读音 |
| `a` UK | `æn` | 混入 `an` |
| `Polish` UK | `ˈpɒlɪʃ` | 大小写词条污染 |
| `Polish` US | `ˈpɑlɪʃ` | 大小写词条污染 |
| `polish` UK | `ˈpoulɪʃ` | 大小写词条污染 |
| `wound` UK | `wʊːnd` | 元音异常 |
| `gym` UK | `dʒɪmˈneɪziəm` | 混入 `gymnasium`；当前原始异常含数字 `3`，更早被符号检查拒绝 |

原始的 `æb's3nt` 等含数字异常直接拒绝，不把 `3` 猜成某个元音。来源中仍有未能自动识别的可能异读、地域写法或错误；本表不是完整准确率审计。已额外拒绝两个含空可选组的确定格式异常：`hypertherm` US `ˈhaɪpə()θɜm`、`pertaining` US `pə()ˈtenɪŋ`，并加入回归测试。来源的 `(ː)` 可选长度记法仍保留，未擅自改写。

## 追溯产物

与 `data/` 同级的 `audit/`，全部仅本地：

- `provenance.jsonl`：每个原始口音字段/拆分候选的来源、原始 member 路径、行号/来源行 ID、原词形、原始字段名和字段值、规范化动作、接受/重复/排除/拒绝/隔离原因。`accepted` 表示通过候选审计，**不保证进入运行时**；其 `runtimeRole` 为 `primary` 或 `audit-only-alternative`。未入运行时的数据也保留。当前约 223 MB（223,374,438 字节）。
- `policy.json`：固定来源哈希、政策名、显式允许/隔离清单。
- `coverage.json`：基准输入哈希、三种查找策略的完整缺项和计数。
- `stats.json`：版本、词条/读音数、按来源和原因的决策统计、产品策略覆盖摘要。

决策数是字段/候选事件数，不是互斥单词数。当前 612,589 个事件；BNC 隔离同词元候选 9,206 个，缺少可核对词元的候选 721 个。kajweb 显式异常隔离 21 个事件，其余不可解析字段另记拒绝。没有把异常修成“正确读音”。

## 实测结果

最终版本：`local-ipa-primary-v2-3cdd54963a163a84fb2ff1b1`。

- 精确单词键：63,297。
- 有 UK：59,978；有 US：59,898；两边都有：56,579。
- 运行时 UK 读音：59,978；US 读音：59,898，每个可用口音恰好一个。
- 审计通过的 UK 候选：83,373；US 候选：74,517，其中 38,014 个额外候选仅留审计。
- 26 分片及 manifest 合计：6,618,382 字节；逐文件 gzip（level 9）合计 799,449 字节，Brotli 合计 684,428 字节（独立测量见 `audit/compressed-size.json`）。这是 JSON 分片测量，不是每次点词传输量；实际只请求需要的字母分片。
- 全量生成、全量 `--check`、隔离 Python synthetic self-test、Node 包装测试 3/3 均通过。

基准重新读取旧研究的冻结输入：NGSL 1.2 官方 CSV（2,809 条，哈希 `2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44`）、旧 EASY 620 词、旧示例故事的 278 类型/593 tokens。它们不是重新分词后的全库/真实使用总体；完整输入哈希在 `coverage.json`。

**产品策略**为精确键优先；仅 `^[A-Z][a-z]+(?:[-'][a-z]+)*$` 可在没有精确词条时回退到全小写。已有单口音精确词条不再从其他大小写键补音。`US` 不回退 `us`，`Polish` 不合并 `polish`，全大写和混合大小写不回退。旧 casefold 策略则合并同 casefold 键的多个词条，只为比较，不能等同产品行为。

| 基准 | 产品 UK/US/双命中 | 产品双命中比例 | 精确双命中 | 旧 casefold 双命中 |
| --- | --- | --- | --- | --- |
| NGSL 前 100 | 100/100/100 | 100% | 100/100 | 100/100 |
| NGSL 前 500 | 500/500/500 | 100% | 500/500 | 500/500 |
| NGSL 前 1000 | 1000/1000/1000 | 100% | 1000/1000 | 1000/1000 |
| NGSL 全部 | 2809/2809/2809 | 100% | 2809/2809 | 2809/2809 |
| EASY | 620/620/620 | 100% | 620/620 | 620/620 |
| 示例故事类型 | 274/274/274 | 98.56% | 247/278（88.85%） | 274/278（98.56%） |
| 示例故事 tokens | 579/579/579 | 97.64% | 535/593（90.22%） | 579/593（97.64%） |

故事未双命中 `Tobias`、`Mira`、`glowed`、`moonwick`；不为其造音。当前基准上的产品/旧 casefold 数值相同只是这批输入的实际结果，不能推断所有专名、缩写或查询都一样。旧三源原字段 union 在相同输入也曾达到 NGSL/EASY 100%、故事 97.64% tokens；清洗后仍达到该字段覆盖，不意味着修复前后准确率相同。旧全量 union 有 119,722 个键（其中 86,101 个符合当时单词正则），不是今天的 63,297 个清洗键。任何“97.3%”或类似旧覆盖数字都不能改称发音正确率。

主读音样例：运行时 `read` UK/US 均为 `riːd`，`wind` 均为 `wɪnd`，`record` UK 为 BNC 先到的 `ˈrekɔːd`、US 为 `ˈrekərd`，`use` UK/US 均为 `juːz`。`red`、`waɪnd`、`record` 的动词候选、`use` 的 /s/ 候选等仍可在原始审计中追溯，**不会展示在词卡**。不保证这个固定首选适合每个上下文含义，也不保证经独立验证的金标准准确率。选择首个显式候选只是收敛展示策略，不是新造音、全局音系替换或语言学纠错。

## 本地词卡接入

- `WordIpa` 位于词卡可滚动 body 中，词性之后、主释义／上下文之前，独立于保留的非交互下滑区域；分别显示一个英音主读音、一个美音主读音，并为有音标的口音各提供一个播放按钮（44×44px）。无展开、无备选列表。短音标按自然宽度并排，空间不足时按口音整体换行，单个很长的音标仍可在所属口音内折行；不用固定字符数判断，也不依赖旧引擎缺少的 flex gap。不把数组位置当成英美对应义项，不自动选择书中当前含义。
- 短语标题与书中匹配词形相同时不重复显示“书中写的是”；实际词形不同仍保留。高度不超过 600px 的手机沿用短横屏的 92vh/92dvh 上限和 8px body 上下间距，保留可滚动释义空间；双列 footer 和较小 primary 留白仍仅用于高度不超过 450px 的横屏。不缩小发音、保存或关闭按钮。
- 查询词卡当前显示的 `state.key`，不从原始词形另猜词干。首字母大写回退遵循上文规则。短语模式及短语识别等待期间不显示组成词音标。
- 与词表释义解耦：基础词、无释义词也可以命中；缺少某一口音明确显示不可用。快速换词或关闭后不显示过期结果。
- 使用 Vite 的静态 `?url&no-inline` 导入生成内容哈希 JSON 资源，运行时才 `fetch` 所需字母；不是动态导入 JS 数据模块。这样音标资源失败不会触发应用代码块的自动刷新恢复，失败 promise 会移除，重新打开可请求重试；不会改变全站代码块恢复机制。
- 录音参数已对照[有道自身bath页面](https://www.youdao.com/w/eng/bath/)的原始HTML核对：`dict.basic.ec.uk.voice`对应`bath&type=1`，`dict.basic.ec.us.voice`对应`bath&type=2`。此前代码与测试同时把参数映射写反；仅检查请求与代码一致不能证明真实口音正确。
- 显式英音按钮仅尝试原录音服务的 `type=1`，再尝试设备确实提供的 `en-GB` 声音；美音对应 `type=2`／`en-US`，不静默换另一口音。两者都没有时给出可见、可读屏的失败提示，可点同一按钮重试。缺少该口音音标时不提供其播放按钮；数据存在不保证录音存在。
- 收藏按钮与关闭按钮并排放在标题右侧。启用音标的单词卡移除顶部通用播放，只保留音标旁的英音／美音按钮；小喇叭与音标同字号，无大圆形底色，同时保留44×44px透明点击范围。短语卡及未启用音标的普通构建仍使用原通用按钮。原自动朗读保持原有录音参数顺序 `type=2`→`type=1`→通用系统语音（即美音→英音；此前将参数口音说明写反）；所有播放共用单一所有权，快速点击替换旧请求。显式请求的录音／合成启动有界等待；取消不会作为失败展示。不把 IPA 传给语音引擎，不声称录音已与多音词的显示首选逐一对齐，也不增加语音供应商或音频下载包。
- 分片是本站构建出的静态资源，按首字母懒加载并在页面会话内复用；不承诺首次无网络可用或已持久离线安装。系统语音是否具备目标口音、能否离线取决于设备，录音仍需要网络。

只有同时指定 `local-ipa` 模式及绝对 `LOCAL_IPA_DATA_DIR` 才会打入数据。例如从 Git Bash 运行：

```bash
LOCAL_IPA_DATA_DIR='C:/Users/Administrator/Desktop/apyx套利/margin-words-audit/local-exports/ipa-word-card/data' VITE_BOOKS_BASE= node node_modules/vite/bin/vite.js build --mode local-ipa
```

输出固定为忽略的 `local-exports/ipa-word-card/preview/`，不会覆盖其他任务的 `dist/`。插件校验分片哈希、输入边界、输入不在输出内，并限制本地模式服务器绑定 `127.0.0.1`。普通构建导出空数据、隐藏 IPA 区，也不包含下面的本地合成预览入口；在其他模式误带该变量会拒绝构建。

合成预览入口 `/scripts/fixtures/ipa-preview.html` 只属于本地构建，使用实际 WordCard，不写书籍、账号或收藏存储。真实 Reader 的独立浏览器回归见 `scripts/word-ipa-e2e.mjs`；它只用全新非持久浏览器上下文、合成书籍与真实生成分片，拦截外网和真实账号请求。

```bash
node scripts/word-ipa-e2e.mjs http://127.0.0.1:8109/
```

默认 30 个尺寸/语言/主题/轮换字号组合，加 8 个真实数据的短音标并排／长音标换行几何测试、6 个加载竞态／短语／错误测试，以及 4 个口音播放／可信触摸按钮排除案例，共 48 项。长音标样例使用 `university`，宽度测量包含实际字体塑形后的音标、标签、44px播放按钮及间距，不按字符数猜测。`IPA_FULL_MATRIX=1` 将基础组合扩成 90 个；`IPA_SCREENSHOTS=1` 保存截图。`scripts/verify-local-ipa-build.mjs <outDir> [--enabled]` 检查默认/本地构建的数据隔离。legacy 回归可用 `BUILD_DIR` 指定隔离产物，不必覆盖共享 `dist/`。
