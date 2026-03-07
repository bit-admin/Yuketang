# Yuketang (雨课堂)

Electron desktop app that embeds `https://www.yuketang.cn/web`, detects `lesson_id` from lesson report URLs, and exports lesson slides as `PDF` or `JPG`.

## Features

- Embedded Yuketang web app in a `webview`.
- Auto-detect `lesson_id` from URLs like:
  - `https://www.yuketang.cn/v2/web/student-lesson-report/.../.../...`
- Uses browser cookies from the embedded login session.
- Class mode auto-capture: on `https://www.yuketang.cn/lesson/fullscreen/v3/.../ppt/...`, the app automatically captures `presentation_id` and `authorization` from in-app requests and exports.
- Configurable output directory (default: `<Downloads>/Yuketang`).
- Configurable output format (`PDF` or `JPG`).

## Run

```bash
npm install
npm start
```

## Usage

1. Sign in through the embedded Yuketang page.
2. For report mode, open a lesson report page; the app auto-fills `lesson_id`.
3. For class mode, open a fullscreen PPT page; the app auto-captures request info.
4. Set output directory and format in the top control bar.
5. Click `Export`.

## CI Packaging

GitHub Actions workflow: `.github/workflows/package.yml`

- Triggers:
  - `workflow_dispatch`
  - push to `main`
- Outputs:
  - macOS: `dmg`
  - Windows: `nsis` installer (`.exe`)
  - Linux: `AppImage` and `deb` (with maintainer `Yuketang Maintainer <packager@yuketang.app>`)
- Release:
  - Reads version from `package.json`
  - Publishes/updates GitHub Release with tag `v<version>`
  - Uploads packaged files to that release
