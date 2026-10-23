# 书籍简介（“发现”详情弹窗）

“发现”页点开一本书，弹窗里的“故事简介”来自这里的两个文件，界面是中文就显示 `zh.json`，英文就显示 `en.json`。某本书在当前语言下没有简介时，弹窗不显示简介区块，也不会改用另一种语言。

| 文件 | 界面语言 | 写法 |
| --- | --- | --- |
| `zh.json` | 中文 | 简体中文，给初中生看 |
| `en.json` | English | 简单英语，和书里的英文释义同样的难度（CEFR A2–B1） |

中文只能放在 `docs/` 里（见 `npm run check:cjk`），所以两份文件都在这里，构建时作为带哈希的静态文件发布，打开弹窗时才下载。

## 格式

```json
{
 "format": 1,
 "books": {
  "alice": "简介正文"
 }
}
```

- 键是书的 id，就是 `packs/<id>/` 或 `public-books/<id>/` 的文件夹名。下表列出全部 id。
- 值是纯文本，不能用 HTML 或 Markdown。最长 600 个字符；换行会保留。
- 两个文件互不依赖，可以分开写、分开提交。

## 写简介的要求

- 用自己的话写，不要照抄出版社或网店的文案、书评，那些有版权。
- 讲清楚主角是谁、故事从哪里开始、主要矛盾是什么，2–4 句为宜。
- 不剧透结局和关键反转。
- 不评价好坏，不写“经典”“必读”之类的宣传词。
- 情节要准确。拿不准的细节宁可不写，也不要编。

## 检查

```bash
npm run check:blurbs
```

它会检查：id 是否真的存在、中文简介里有中文、英文简介里没有中文、没有空文本、没有超长、没有标记符号；并分别列出每种语言还有多少本书没有简介。`npm test` 也会跑同样的检查。

不需要改数据库，也不需要改词表（`glossary.json`）或书目（`catalog.json`）。合并、部署网站后即生效，不用重新上传书籍文件。

## 全部书籍

| id | 书名 | 作者 | 类型 |
| --- | --- | --- | --- |
| `alice` | Alice's Adventures in Wonderland | Lewis Carroll | 公版 |
| `anne` | Anne of Green Gables | L. M. Montgomery | 公版 |
| `back-to-school` | Back to School | Barack Obama | 公版 |
| `ballad-of-songbirds-and-snakes` | The Ballad of Songbirds and Snakes | Suzanne Collins | 词表 |
| `black-beauty` | Black Beauty | Anna Sewell | 公版 |
| `catching-fire` | Catching Fire | Suzanne Collins | 词表 |
| `cb01` | Midnight for Charlie Bone | Jenny Nimmo | 词表 |
| `cb02` | Charlie Bone and the Time Twister | Jenny Nimmo | 词表 |
| `cb03` | Charlie Bone and the Invisible Boy | Jenny Nimmo | 词表 |
| `cb04` | Charlie Bone and the Castle of Mirrors | Jenny Nimmo | 词表 |
| `cb05` | Charlie Bone and the Hidden King | Jenny Nimmo | 词表 |
| `cb06` | Charlie Bone and the Beast | Jenny Nimmo | 词表 |
| `cb07` | Charlie Bone and the Shadow | Jenny Nimmo | 词表 |
| `cb08` | Charlie Bone and the Red Knight | Jenny Nimmo | 词表 |
| `charlie` | Charlie and the Chocolate Factory | Roald Dahl | 词表 |
| `charlottes-web` | Charlotte's Web | E. B. White | 词表 |
| `flipped` | Flipped | Wendelin Van Draanen | 词表 |
| `george` | George’s Marvellous Medicine | Roald Dahl | 词表 |
| `hunger-games` | The Hunger Games | Suzanne Collins | 词表 |
| `james` | James and the Giant Peach | Roald Dahl | 词表 |
| `joint-session` | Address to a Joint Session | George W. Bush | 公版 |
| `jungle-book` | The Jungle Book | Rudyard Kipling | 公版 |
| `let-the-great-world-spin` | Let the Great World Spin | Colum McCann | 词表 |
| `little-women` | Little Women | Louisa May Alcott | 公版 |
| `lkoe01` | The Last Kids on Earth | Max Brallier | 词表 |
| `lkoe02` | The Last Kids on Earth and the Zombie Parade | Max Brallier | 词表 |
| `lkoe03` | The Last Kids on Earth and the Nightmare King | Max Brallier | 词表 |
| `looking-glass` | Through the Looking-Glass | Lewis Carroll | 公版 |
| `magicfinger` | The Magic Finger | Roald Dahl | 词表 |
| `matilda` | Matilda | Roald Dahl | 词表 |
| `mockingjay` | Mockingjay | Suzanne Collins | 词表 |
| `mth01-04` | Magic Tree House Books 1-4 Collection | Mary Pope Osborne | 词表 |
| `mth05` | Magic Tree House 5: Night of the Ninjas | Mary Pope Osborne | 词表 |
| `mth06` | Magic Tree House 6: Afternoon on the Amazon | Mary Pope Osborne | 词表 |
| `mth07` | Magic Tree House 7: Sunset of the Sabertooth | Mary Pope Osborne | 词表 |
| `mth08` | Magic Tree House 8: Midnight on the Moon | Mary Pope Osborne | 词表 |
| `mth09` | Magic Tree House 9: Dolphins at Daybreak | Mary Pope Osborne | 词表 |
| `mth10` | Magic Tree House 10: Ghost Town at Sundown | Mary Pope Osborne | 词表 |
| `mth11` | Magic Tree House 11: Lions at Lunchtime | Mary Pope Osborne | 词表 |
| `mth12` | Magic Tree House 12: Polar Bears Past Bedtime | Mary Pope Osborne | 词表 |
| `mth13` | Magic Tree House 13: Vacation Under the Volcano | Mary Pope Osborne | 词表 |
| `mth14` | Magic Tree House 14: Day of the Dragon King | Mary Pope Osborne | 词表 |
| `mth15` | Magic Tree House 15: Viking Ships at Sunrise | Mary Pope Osborne | 词表 |
| `mth16` | Magic Tree House 16: Hour of the Olympics | Mary Pope Osborne | 词表 |
| `mth17` | Magic Tree House 17: Tonight on the Titanic | Mary Pope Osborne | 词表 |
| `mth18` | Magic Tree House 18: Buffalo Before Breakfast | Mary Pope Osborne | 词表 |
| `mth19` | Magic Tree House 19: Tigers at Twilight | Mary Pope Osborne | 词表 |
| `mth20` | Magic Tree House 20: Dingoes at Dinnertime | Mary Pope Osborne | 词表 |
| `mth21` | Magic Tree House 21: Civil War on Sunday | Mary Pope Osborne | 词表 |
| `mth22` | Magic Tree House 22: Revolutionary War on Wednesday | Mary Pope Osborne | 词表 |
| `mth24` | Magic Tree House 24: Earthquake in the Early Morning | Mary Pope Osborne | 词表 |
| `mth25` | Magic Tree House 25: Stage Fright on a Summer Night | Mary Pope Osborne | 词表 |
| `mth26` | Magic Tree House 26: Good Morning, Gorillas | Mary Pope Osborne | 词表 |
| `mth27` | Magic Tree House 27: Thanksgiving on Thursday | Mary Pope Osborne | 词表 |
| `mth28` | Magic Tree House 28: High Tide in Hawaii | Mary Pope Osborne | 词表 |
| `mth29` | Magic Tree House 29: Christmas in Camelot | Mary Pope Osborne | 词表 |
| `mth30` | Magic Tree House 30: Haunted Castle on Hallows Eve | Mary Pope Osborne | 词表 |
| `mth31` | Magic Tree House 31: Summer of the Sea Serpent | Mary Pope Osborne | 词表 |
| `mth32` | Magic Tree House 32: Winter of the Ice Wizard | Mary Pope Osborne | 词表 |
| `mth33` | Magic Tree House 33: Carnival at Candlelight | Mary Pope Osborne | 词表 |
| `mth34` | Magic Tree House 34: Season of the Sandstorms | Mary Pope Osborne | 词表 |
| `mth35` | Magic Tree House 35: Night of the New Magicians | Mary Pope Osborne | 词表 |
| `mth36` | Magic Tree House 36: Blizzard of the Blue Moon | Mary Pope Osborne | 词表 |
| `mth37` | Magic Tree House 37: Dragon of the Red Dawn | Mary Pope Osborne | 词表 |
| `mth38` | Magic Tree House 38: Monday with a Mad Genius | Mary Pope Osborne | 词表 |
| `mth39` | Magic Tree House 39: Dark Day in the Deep Sea | Mary Pope Osborne | 词表 |
| `mth40` | Magic Tree House 40: Eve of the Emperor Penguin | Mary Pope Osborne | 词表 |
| `mth41` | Magic Tree House 41: Moonlight on the Magic Flute | Mary Pope Osborne | 词表 |
| `mth42` | Magic Tree House 42: A Good Night for Ghosts | Mary Pope Osborne | 词表 |
| `mth43` | Magic Tree House 43: Leprechaun in Late Winter | Mary Pope Osborne | 词表 |
| `mth44` | Magic Tree House 44: A Ghost Tale for Christmas Time | Mary Pope Osborne | 词表 |
| `mth45` | Magic Tree House 45: A Crazy Day with Cobras | Mary Pope Osborne | 词表 |
| `mth46` | Magic Tree House 46: Dogs in the Dead of Night | Mary Pope Osborne | 词表 |
| `mth47` | Magic Tree House 47: Abe Lincoln at Last! | Mary Pope Osborne | 词表 |
| `mth48` | Magic Tree House 48: A Perfect Time for Pandas | Mary Pope Osborne | 词表 |
| `mth49` | Magic Tree House 49: Stallion by Starlight | Mary Pope Osborne | 词表 |
| `mth50` | Magic Tree House 50: Hurry Up, Houdini! | Mary Pope Osborne | 词表 |
| `mth51` | Magic Tree House 51: High Time for Heroes | Mary Pope Osborne | 词表 |
| `mth52` | Magic Tree House 52: Soccer on Sunday | Mary Pope Osborne | 词表 |
| `mth53` | Magic Tree House 53: Shadow of the Shark | Mary Pope Osborne | 词表 |
| `mth54` | Magic Tree House 54: Balto of the Blue Dawn | Mary Pope Osborne | 词表 |
| `mth55` | Magic Tree House 55: Night of the Ninth Dragon | Mary Pope Osborne | 词表 |
| `narnia` | The Chronicles of Narnia (Complete 7-Book Collection) | C. S. Lewis | 词表 |
| `number-the-stars` | Number the Stars | Lois Lowry | 词表 |
| `obama-inaugural-2009` | Inaugural Address | Barack Obama | 公版 |
| `one-and-only-ivan` | The One and Only Ivan | Katherine Applegate | 词表 |
| `out-of-my-mind` | Out of My Mind | Sharon M. Draper | 词表 |
| `peter-pan` | Peter and Wendy | J. M. Barrie | 公版 |
| `sarah-plain-tall` | Sarah, Plain and Tall | Patricia MacLachlan | 词表 |
| `secret-garden` | The Secret Garden | Frances Hodgson Burnett | 公版 |
| `shiloh` | Shiloh | Phyllis Reynolds Naylor | 词表 |
| `spacex-allhands-2026` | SpaceX Company Talk | Elon Musk | 词表 |
| `sunrise-on-the-reaping` | Sunrise on the Reaping | Suzanne Collins | 词表 |
| `the_book_thief` | The Book Thief | Markus Zusak | 词表 |
| `tom-sawyer` | The Adventures of Tom Sawyer | Mark Twain | 公版 |
| `treasure-island` | Treasure Island | Robert Louis Stevenson | 公版 |
| `twits` | The Twits | Roald Dahl | 词表 |
| `wind-in-the-willows` | The Wind in the Willows | Kenneth Grahame | 公版 |
| `winn-dixie` | Because of Winn-Dixie | Kate DiCamillo | 词表 |
| `wizard-of-oz` | The Wonderful Wizard of Oz | L. Frank Baum | 公版 |
| `wof03` | Wings of Fire 3: The Hidden Kingdom | Tui T. Sutherland | 词表 |
| `wof04` | Wings of Fire 4: The Dark Secret | Tui T. Sutherland | 词表 |
| `wof05` | Wings of Fire 5: The Brightest Night | Tui T. Sutherland | 词表 |
| `wof06` | Wings of Fire 6: Moon Rising | Tui T. Sutherland | 词表 |
| `wof07` | Wings of Fire 7: Winter Turning | Tui T. Sutherland | 词表 |
| `wof08` | Wings of Fire 8: Escaping Peril | Tui T. Sutherland | 词表 |
| `wof09` | Wings of Fire 9: Talons of Power | Tui T. Sutherland | 词表 |
| `wof1` | Wings of Fire 1: The Dragonet Prophecy | Tui T. Sutherland | 词表 |
| `wof2` | Wings of Fire 2: The Lost Heir | Tui T. Sutherland | 词表 |
| `wonder` | Wonder | R J Palacio | 词表 |
