# Security

Longhand runs a terminal, reads and writes files in the folder you open, and starts an AI model
with access to that folder. Reports about any of these are taken seriously.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on the
[repository page](https://github.com/wastella/longhand/security/advisories/new).

Include what you did, what happened and what you expected. You should get a reply within a week.

## What counts

- The tutor gaining any ability to write files or run commands
- File access from the interface escaping the open folder
- Content in a file or a tutor answer running script in the app window or navigating it
- The app sending data anywhere other than through the user's own `claude` CLI

The tutor writing code despite the Strict policy is a quality problem, not a vulnerability. Please
report it as an ordinary issue with the prompt that caused it.

## Supported versions

Only the latest release receives fixes.
