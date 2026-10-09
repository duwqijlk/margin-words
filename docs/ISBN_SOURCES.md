# ISBN values in the catalogs

`isbn` is the ISBN-13 of the edition whose text is in that pack's EPUB, when the file itself states one.
Nothing here is taken from a shop page. A book with no row is left unset.

Checked 2026-10-02. ISBN-10 values were converted to ISBN-13 after the checksum matched.

## Confirmed

| Pack | ISBN-13 | Where it was read |
| --- | --- | --- |
| charlie | 9780141960616 | `dc:identifier` `URN:ISBN:978-0-141-96061-6`, same number on the copyright page |
| george | 9780141929859 | `dc:identifier` with `opf:scheme="ISBN"`, same number on the copyright page |
| james | 9780141929873 | `dc:identifier` with `opf:scheme="ISBN"`, same number on the copyright page |
| magicfinger | 9780141957111 | `dc:identifier` with `opf:scheme="ISBN"`, same number on the copyright page |
| matilda | 9780670824397 | Copyright page in the EPUB: `ISBN 0-670-82439-9`. `dc:identifier` is only a uuid. |
| wof2 | 9780545470100 | `dc:identifier` with `opf:scheme="ISBN"`, same number on the copyright page (`978-0-545-47010-0`) |
| wonder | 9781448119141 | `dc:identifier` with `opf:scheme="ISBN"`, same number on the copyright page |
| narnia | 9780062245762 | Copyright page of the HarperCollins EPUB (October 2013), titled "The Chronicles of Narnia Complete 7-Book Collection with Bonus Book". That page reads: "EPUB Edition OCTOBER 2013 ISBN 9780062245762". |
| a-storm-of-swords | 9780553106633 | `dc:identifier` with `opf:scheme="ISBN"` in the EPUB the word list names. That file has no second ISBN. |
| a-feast-for-crows | 9780553900323 | The copyright page of that same EPUB: `eISBN: 978-0-553-90032-3`. No other ISBN is in the file. |
| a-dance-with-dragons | 9780553905656 | `dc:identifier` with `opf:scheme="ISBN"` in that EPUB (`978-0-553-90565-6`). The same number is the file name of the cover page. |

## Left unset

The public-domain classics (alice, treasure-island, anne, peter-pan, tom-sawyer, wind-in-the-willows, little-women, secret-garden, black-beauty, looking-glass, jungle-book, wizard-of-oz) identify the file with a Project Gutenberg or Standard Ebooks URL. None of those EPUBs contain an ISBN.

Two packs name two different valid ISBNs, so neither was stored:

| Pack | `dc:identifier` | Copyright page in the same EPUB |
| --- | --- | --- |
| twits | ISBN-10 `014241039X` (ISBN-13 9780142410394) | `978-0-14-193016-9` |
| wof1 | `9780606319522` | e-ISBN `978-0-545-44317-3` |
