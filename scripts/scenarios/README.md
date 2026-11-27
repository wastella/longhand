# Preview scenarios

Each file here is one state of the interface that `npm run preview` can photograph:

```bash
npm run preview -- --out /tmp/shot.png --scenario find-in-files
npm run preview -- --out /tmp/shot.png --scenario find-in-files --theme light
npm run preview -- --list
```

Look at a visual change in both themes: `--theme dark` and `--theme light` set the Appearance
setting for that picture.

The page starts on the mock backend (`tests/mock/`) with the fixture folder open and nothing
else done. A scenario file exports:

- `default`: an async function that takes the Puppeteer `page` and clicks or types its way to
  the state to show
- `description`: one line for `--list`
- `options` (optional): passed to the mock as `window.__MOCK__`, for example
  `{ auth: { installed: false, loggedIn: false } }`

To add a scenario, copy one of these files and give it a new name. Helpers such as
`openFromTree` and `askTutor` are in `scripts/browser.mjs`.
