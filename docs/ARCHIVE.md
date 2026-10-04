# This repository is the private archive

Recorded on 2026-10-04. This is the last change on this copy of the project.

## What happened

1. This repository stays **private**.
2. It is **renamed** from `duwqijlk/margin-words` to `duwqijlk/margin-words-archive`.
3. It is **archived** (read-only). Do not push, and do not open new pull requests.
4. A **new public repository** takes the name `duwqijlk/margin-words`:
   https://github.com/duwqijlk/margin-words
5. Later work happens only in that public repository.

The private R2 bucket is also named `margin-words-private`. That bucket is storage for copyrighted EPUB files. It is not this Git repository. The archive repository is `margin-words-archive` so the two names stay different.

## Why the old pull requests stay

Pull requests #1 through #33 stay in this archive so the review history is kept.

Pull requests #1 through #32 still point at commits that contain copyrighted EPUB files. GitHub does not let the repository owner delete `refs/pull/*/head`. Rewriting `main` does not remove those files. Making this repository public would publish the books. Deleting the repository would delete the pull requests.

So this copy remains a private, archived record. The public repository is a new repository. Its history is the rewritten `main` only. That history has no third-party EPUB. The only EPUB in it is the project's own sample, `examples/sample-book/the-lantern-seller.epub`.

## What does not move

The live site is not connected to GitHub. Cloudflare Pages project `margin-words` (Git source: none), the D1 database, and the R2 buckets stay where they are. Archiving this repository does not take down https://inputread.site.

The coding bot that was installed on `duwqijlk/margin-words` does not follow the new repository by itself. Future sessions have to be opened on the public repository.

中文说明：[ARCHIVE.zh-CN.md](ARCHIVE.zh-CN.md)
