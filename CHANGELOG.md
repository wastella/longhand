# Changelog

Notable changes to Longhand. The format follows [Keep a Changelog](https://keepachangelog.com),
and versions follow [Semantic Versioning](https://semver.org).

## Unreleased

Nothing has been released yet. This is what the first release will contain.

### Added

- Editor for coursework: Python-first editing, tabs that reopen with the folder, find and replace,
  go to line, and banners instead of silent loss when a save fails or a file changes on disk
- Files: Go to File (⌘P), find in files, and a keyboard-driven tree that updates as files change,
  with new file, new folder, rename and move to Trash
- Up to four terminals, with Run File (⌘R) and clickable `path:line` locations
- Test panel that runs one pytest test, a file, everything or just the failures, with live
  progress and failures that link to the line
- Read-only tutor that runs through the user's own Claude Code login, with Strict and Guided
  policies and support for a course's `AGENTS.md` or `CLAUDE.md`
- Tutor feedback pinned to the work: review notes in the margin, Explain on a selection, and help
  under a failing test
- Quick lookups (⇧⌘K), and a conversation panel with rendered math and a hint ladder
- Code over the policy's limit hidden behind a logged reveal, and a Record view of questions,
  hints, lookups, test runs and reveals, kept locally per folder
- Welcome screen with recent folders, light and dark themes, settings, and a remembered layout
- Setup steps in the tutor panel when Claude Code is missing or logged out
