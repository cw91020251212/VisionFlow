# 工具栏横向操作改进（2026-10-14）

## 改动

- 顶部工具栏内容溢出时，在工具栏正下方显示专用可见滑块；拖动滑块可水平滚动工具栏，点击轨道可快速定位；顶部滚动位置也会反向同步至滑块。
- 顶部工具栏空白处使用抓取手形光标；按住鼠标左键左右拖动可滚动。按钮、链接、输入控件不触发拖动，仍可正常点击。
- 自定义滚动条支持方向键、Shift+方向键、PageUp、PageDown、Home、End；无溢出时隐藏滑块。小屏触控横向滑动保留。
- 同步更新Service Worker缓存资源清单与应用版本 `toolbar-scroll-v1`，并让缓存回归按现行资源清单动态计数。

## 验证

- `npm run check`：通过。
- `tests/toolbar-scroll.spec.cjs`：3项窄屏桌面、宽屏及窄屏布局回归通过。
- 完整 Chromium 回归：**167项通过，0失败、0跳过、0 flaky**；包含既有维护、缓存、贴图、导入／导出功能。
- `git diff --check`：通过。

## 正式发布

- PR [#7](https://github.com/cw91020251212/VisionFlow/pull/7) 已按使用者确认合并到公开仓库 `main`；GitHub Pages workflow run `38570689709` 成功，main 提交为 `0dd8532ac29dfdc442cb2f1171616ac1ec491316`。
- 正式网站：[VisionFlow](https://cw91020251212.github.io/VisionFlow/)。使用不带旧 Service Worker 的全新 Chromium 上下文实测：横条可拖动并带动工具栏（滚动位置增加87 px）、空白处抓取可滚动45 px、工具栏按钮正常触发点击事件，控制台无页面错误。
