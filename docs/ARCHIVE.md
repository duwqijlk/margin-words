# Where the old pull requests are

Recorded on 2026-10-04. This repository, `duwqijlk/margin-words`, is the public project. Later work happens here.

The private archive is `duwqijlk/margin-words-archive`. It keeps pull requests #1 through #34. It stays private and should be archived, so nobody can push to it.

Pull requests #1 through #32 on that archive still point at commits that contain copyrighted EPUB files. GitHub does not let the owner delete `refs/pull/*/head`. This public repository was created as a new repository and received only the rewritten `main`. That history has no third-party EPUB. The only EPUB here is the project's own sample, `examples/sample-book/the-lantern-seller.epub`.

The private R2 bucket `margin-words-private` is storage for copyrighted EPUB files. It is not a Git repository.

The live site is not connected to GitHub. Cloudflare Pages project `margin-words` (Git source: none), the D1 database, and the R2 buckets stay where they are. https://inputread.site does not depend on either GitHub repository.

中文说明：[ARCHIVE.zh-CN.md](ARCHIVE.zh-CN.md)
