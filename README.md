# StarCraft-AI

人类当指挥官、AI 当将军的网页 RTS（星际风格）。LLM 驱动的对战：AI 读观测、出 JSON 指令、互相打架，人可以看它推理、插话指挥。

- 完整计划见 [PLAN.md](PLAN.md)（可执行清单）与 [PLANLIST.md](PLANLIST.md)（评估/风险/决策记录）。
- 已锁定 MVP 范围见 [MVP_SCOPE.md](MVP_SCOPE.md)。
- 当前实现与外部发布依赖见 [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)。
- 基座：`ahzs645/StarCraft`（gloomyson 的 fork，已含多队伍 + WebSocket 网络 + 命令流回放 + 4 人关卡）。

## 现状（P0 已验收）

- P0.2 跑通 fork ✅
- P0.3 fork 多人验证 ✅（本地 mock 服务器，mainTick 同步推进至 608+，0 错误）
- P0.4 核心假设 spike ✅（1 LLM vs 1 脚本完整对局：llmValidJSON=14/15，双方打到全灭，16.5MB 可看录像，证据在 `tools/spike/evidence/`）
- P0.6 本地 mock 服务器 ✅（`tools/mock-server.js`，:28083）

## 快速开始

```bash
npm install
# 或：make install

# 同时启动游戏与本地房间服务器
make run

# 完整本地回归
make check
```

`make run` 会以前台方式运行；按 `Ctrl-C` 会同时关闭它启动的游戏与房间服务器。

首次启动会询问皮肤/素材地址。填写过的地址会被浏览器记住，后续启动直接作为默认值；同一地址的皮肤素材也会使用浏览器缓存。本地 `img/`、`bgm/` 素材由本项目服务器缓存 30 天；远程皮肤的缓存期限由远程素材服务器决定。留空并确认会切回本地素材并清除已记住的远程地址。

```bash
make kill    # 仅关闭本项目遗留的 :8080 / :28084 服务器
```

也可分别手动启动：

```bash
npm install

# 1) 起本地 mock 服务器（lockstep + roomLag=2 bootstrap）
node tools/mock-server.js          # ws://localhost:28083

# P2 多房间服务器（例如房间 demo，1 名 AI 补位）
npm run rooms                      # ws://localhost:28084
npm run smoke:rooms                # 房间 / AI 席位 / 重连集成回归
npm run ai-gateway                 # P3 服务端模型网关（:28085）
npm run showmatch                  # P5 四人 headless 表演赛 / 负载基线
npm run verify                     # 全部本地回归（约 1 分钟）

# 2) 起静态服务器（游戏本体）
npm run server                      # http://localhost:8080
# 打开 http://localhost:8080/?serverUrl=ws://localhost:28083&level=2&confirm=1

# 3) 跑 P0.4 spike（1 LLM 玩家 vs 1 脚本玩家，headless Chromium，3 分钟，录像）
npm run spike

# 4) 跑 P1 经济回归（矿物/气体往返、命令流、分矿）
npm run smoke:economy
npm run smoke:ai-adapter            # AI 观测 / schema / 命令安全执行
```

> spike 依赖：Playwright 的 Chromium、本地 LLM 端点（`tools/spike/spike.js` 顶部 `LLM` 配置，默认 `http://192.168.50.64:8080`）。
> 素材已本地化（`npm run assets` 下载 77 张图），不依赖 nvhae.com CDN。

## 目录

| 路径 | 说明 |
|---|---|
| `Characters/` `GameRule/` `Utils/` `Controller/` | 游戏本体（fork 原代码，ES5 全局 + eval + jQuery） |
| `tools/server.js` | 静态文件服务器（:8080） |
| `tools/mock-server.js` | 本地 mock WS 服务器（:28083），lockstep + bootstrap |
| `tools/room-server.js` | P2 多房间 WS 服务器（默认 :28084） |
| `tools/spike/spike.js` | P0.4 spike：1 LLM vs 1 脚本完整对局 + 录像 |
| `tools/spike/economy-smoke.js` | P1 经济系统浏览器回归 |
| `tools/spike/ai-adapter-smoke.js` | P3 AI 观测与安全命令回归 |
| `tools/spike/evidence/` | spike 验收证据（录像 + 关键帧截图） |
| `tools/download-imgs.js` | 本地化图片素材 |

## 原 README（fork 说明）

> Classic RTS game at html5 canvas and javascript, only js codes, copyright materials removed

### Getting started (原版)

* Download the latest version from github: https://github.com/gloomyson/SC_Js/archive/master.zip
* Unzip the folder
* Extract original resources from starcraft and add into bgm & img folder
* Double click `index.html` in the folder (this should open the game with your browser)
* You can play without image/audio materials by input available CDN location instead, for example 'www.nvhae.com/starcraft'
* Press the radio button (circle next to the level name) to select a level and play

### Former 2015 version features

* All units/buildings/bullets/maps/magics and animations completed
* Support war fog, zerg creep
* Control panel, different buttons and icons
* Support cheat code
* Mouse and key control complete
* Seven basic levels to test units and buildings
* Three additional levels for playing: Champain, HUNTERXHUNTER and ProtectAthena

### Newly added features in latest version

* One additional level added: Tower Defense
* Support replay your game playing
* Experimental: Basic network play support in level 2, players can chat with each other in multiplayer mode
* Experimental: Android install package for play on mobile devices
* Check svn.log for other detailed changes

### Notice

1. Need extract resource from original starcraft game, and add them into bgm/img folder before play
	* List several useful extract tools: MpqWorkshop, GRPEdit and RetroGRP
2. Need setup server before play in multiplayer mode, follow below steps:
	* Install NodeJs on your machine
	* Install websocket module: input 'npm install websocket' in cmd
	* Start SC_server: input 'node GameRule\SC_server.js' in cmd
3. To play it on mobile device, install Android install package on your device: [SC.apk](http://www.nvhae.com/starcraft/starcraft.apk)
	* Tap once equals mouse click to select/unselect units
	* Tap twice equals mouse double click to select all same typed units
	* Hold pressing on screen equals mouse right click to set moving destination
	* Two fingers press on screen equals mouse dragging to select multiple units inside rectangle
	* Slide finger on screen to pan left/right/up/down

### Try it online

[SC Html5 Online](http://www.nvhae.com/starcraft/)
