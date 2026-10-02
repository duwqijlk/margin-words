# Lexile measures used in the catalogs

`lexile` on a pack (`info.json`, then `catalog.json` and `pack.json`) is a published Lexile measure for an
**unabridged** edition of that book, when one could be checked. It is not a guess. Several classics are
measured differently per edition; the row says which edition was used. A book with no row here has no
`lexile` field.

Checked 2026-10-02. Measures are copied as printed (`880` on a publisher page is stored as `880L`).

## Public-domain classics (`public-books/`)

| Pack | Measure | Edition used | Source |
| --- | --- | --- | --- |
| alice | 880L | Aladdin Classics, Lewis Carroll (ISBN 9780689833755, 176 pages; also ISBN 9781442458000, 192 pages). The publisher says the measure is certified by MetaMetrics. The page does not use the word “unabridged”; the length matches the full novel, not a retold edition. | https://www.simonandschuster.net/books/Alices-Adventures-in-Wonderland/Lewis-Carroll/Aladdin-Classics/9780689833755 |
| treasure-island | 980L | Lerner First Avenue Classics, unabridged, illustrations by Louis Rhead (1915), ebook ISBN 9781467787659. Oxford Children’s Classics also lists 980 for a “complete unabridged” text (ISBN 9780192789426). An unabridged audiobook is sometimes listed at 1070L; that measure was not used. | https://lernerbooks.com/shop/show/14145 |
| anne | 970L | Lerner First Avenue Classics, “unabridged version” of the 1908 novel, ebook ISBN 9781467797597. | https://lernerbooks.com/shop/show/14393 |
| peter-pan | 900L | Lerner First Avenue Classics, *Peter Pan (Peter and Wendy)*, “unabridged version” of the 1911 text, ebook ISBN 9781467798167. A library record of another unabridged printing lists 920L; the Lerner edition of this title was used. | https://lernerbooks.com/shop/show/14513 |
| tom-sawyer | 930L | Lerner First Avenue Classics, unabridged, from the 1884 copyright edition, ebook ISBN 9781467768443. | https://lernerbooks.com/shop/show/13522 |
| wind-in-the-willows | 1060L | Lerner First Avenue Classics, “unabridged version of the 1913 edition”, ebook ISBN 9781467776226. Some unabridged audiobooks are listed AD1140L; that code was not used. | https://lernerbooks.com/shop/show/14028 |
| little-women | 1090L | Lerner First Avenue Classics, “unabridged version” of the 1880 copyright edition (710 pages), ebook ISBN 9781467768368. Simon & Schuster Enriched Classics lists 1300L for a different printing (ISBN 9781416599715, 672 pages). The Lerner unabridged 1880 text was used. | https://lernerbooks.com/shop/show/13583 |
| secret-garden | 970L | Simon & Schuster Aladdin, ISBN 9781442457508, 432 pages. Lerner’s First Avenue Classics table lists the same 970 for *The Secret Garden*. | https://www.simonandschuster.com/books/The-Secret-Garden/Frances-Hodgson-Burnett/9781442457508 and https://lernerbooks.com/shop/show/25694 |
| black-beauty | 1020L | Lerner First Avenue Classics, unabridged, from the 1911 American copyright edition, ebook ISBN 9781512405309. | https://lernerbooks.com/shop/show/14586 |
| looking-glass | 840L | Lerner First Avenue Classics, “unabridged version” of the 1871 text, ebook ISBN 9781467776257. | https://lernerbooks.com/shop/show/13979 |
| jungle-book | 1100L | Lerner First Avenue Classics, the 1910 edition (Mowgli stories, “Rikki-Tikki-Tavi”, “Toomai of the Elephants”), ebook ISBN 9781467786942. The page does not say “abridged”. | https://lernerbooks.com/shop/show/13911 |
| wizard-of-oz | 1030L | Lerner First Avenue Classics, “unabridged version” of the 1900 text, ebook ISBN 9781467768542. | https://lernerbooks.com/shop/show/13518 |

## Other packs (`packs/`)

These are the trade editions, not retellings. Penguin Random House / Brightly pages are the publisher’s
reading-level line. Narnia rows that are not a single library record are the Lexile figure printed next to
the Accelerated Reader quiz for that novel.

| Pack | Measure | Edition used | Source |
| --- | --- | --- | --- |
| charlie | 810L | Puffin paperback, ISBN 9780142410318 | https://www.readbrightly.com/books/9780142410318/charlie-and-the-chocolate-factory-by-roald-dahl-illustrated-by-quentin-blake/ |
| george | 640L | Puffin paperback, ISBN 9780142410356 | https://www.readbrightly.com/books/9780142410356/georges-marvelous-medicine-by-roald-dahl-illustrated-by-quentin-blake/ |
| james | 790L | Puffin paperback, ISBN 9780142410363 | https://www.readbrightly.com/books/9780142410363/james-and-the-giant-peach-by-roald-dahl-illustrated-by-quentin-blake/ |
| matilda | 840L | Puffin paperback, ISBN 9780142410370. Penguin also lists 840L for ISBN 9780593527498. | https://www.readbrightly.com/books/9780142410370/matilda-by-roald-dahl-illustrated-by-quentin-blake/ |
| magicfinger | 560L | Puffin paperback, ISBN 9780142413852. The Penguin Readers graded retelling (540L) was not used. | https://www.penguinrandomhouse.com/books/328790/the-magic-finger-by-roald-dahl-illustrated-by-quentin-blake/ |
| twits | 750L | Puffin, ISBN 9780425290095 and ISBN 9780593349670 | https://www.readbrightly.com/books/9780425290095/the-twits-by-roald-dahl-illustrated-by-quentin-blake/ |
| wof1 | 740L | Scholastic, *The Dragonet Prophecy* (2012 prose, not the graphic novel). Wake County catalog MARC 521 is 740L. TeachingBooks lists 740L. | https://catalog.wake.gov/Record/668223 and https://school.teachingbooks.net/tb.cgi?tid=32735 |
| wof2 | 750L | Scholastic, *The Lost Heir* (prose, not the graphic novel, which is GN310L). Marmot catalog lists 750L. TeachingBooks lists 750L. | https://opac.marmot.org/Record/.b67390948 and https://school.teachingbooks.net/tb.cgi?tid=38212 |
| narnia1-magicians-nephew | 790L | HarperTrophy / HarperCollins print and ebook. Wake County catalog: Lexile 790L, AR 5.4. | https://catalog.wake.gov/Record/274053 |
| narnia2-lion-witch-wardrobe | 940L | HarperCollins. Durham Public Library and Marmot catalogs: Lexile 940L. HarperCollins unabridged audiobook (ISBN 9780060854461) is also 940L. | https://du.catalog.lionlibraries.org/Record/.b2168442x |
| narnia3-horse-and-his-boy | 970L | HarperCollins. Listed as Lexile 970L with AR 5.8, quiz 612. | https://www.kidsbookseries.com/chronicles-of-narnia/the-horse-and-his-boy/ |
| narnia4-prince-caspian | 870L | HarperCollins paperback ISBN 9780064405003. Listed as Lexile 870L with AR 5.7, quiz 634. | https://www.kidsbookseries.com/chronicles-of-narnia/prince-caspian/ |
| narnia5-dawn-treader | 970L | HarperCollins. Listed as Lexile 970L with AR 5.9, quiz 649. | https://www.kidsbookseries.com/chronicles-of-narnia/the-voyage-of-the-dawn-treader/ |
| narnia6-silver-chair | 840L | HarperCollins paperback ISBN 9780064405041. Listed as Lexile 840 with AR 5.7, quiz 639. Box-set catalog records that reuse another book’s measure were not used. | https://www.kidsbookseries.com/chronicles-of-narnia/the-silver-chair/ |
| narnia7-last-battle | 890L | The novel (chapter titles such as “Ape in its glory”), AR 5.6. Wyoming Libraries grouped work lists 890L. | https://wyld.wyldcatalog.org/GroupedWork/11e85edd-f27c-78c4-bbb9-2ffbc2545065-eng/Home |
| wonder | 790L | Knopf, ISBN 9780375869020. Penguin Random House lists Lexile 790L. | https://www.penguinrandomhouse.com/books/208913/wonder-by-r-j-palacio/ |

## Left unset

None of the 12 classics or the 16 packs were left unset. Edited or abridged measures (Townsend Press
*Treasure Island* 760L, Penguin Readers *The Magic Finger* 540L, Wings of Fire graphic novels) were not used.
