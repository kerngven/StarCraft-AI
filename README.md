# StarCraft-AI

人类当指挥官、AI 当将军的网页 RTS（星际风格）。LLM 驱动的对战：AI 读观测、出 JSON 指令、互相打架，人可以看它推理、插话指挥。

- 完整计划见 [PLAN.md](PLAN.md)（可执行清单）与 [PLANLIST.md](PLANLIST.md)（评估/风险/决策记录）。
- 基座：`ahzs645/StarCraft`（gloomyson 的 fork，已含多队伍 + WebSocket 网络 + 命令流回放 + 4 人关卡）。

## 现状（P0 已验收）

- P0.2 跑通 fork ✅
- P0.3 fork 多人验证 ✅（本地 mock 服务器，mainTick 同步推进至 608+，0 错误）
- P0.4 核心假设 spike ✅（1 LLM vs 1 脚本完整对局：llmValidJSON=14/15，双方打到全灭，16.5MB 可看录像，证据在 `tools/spike/evidence/`）
- P0.6 本地 mock 服务器 ✅（`tools/mock-server.js`，:28083）

## 快速开始

```bash
npm install

# 1) 起本地 mock 服务器（lockstep + roomLag=2 bootstrap）
node tools/mock-server.js          # ws://localhost:28083

# 2) 起静态服务器（游戏本体）
npm run server                      # http://localhost:8080
# 打开 http://localhost:8080/?serverUrl=ws://localhost:28083&level=2&confirm=1

# 3) 跑 P0.4 spike（1 LLM 玩家 vs 1 脚本玩家，headless Chromium，3 分钟，录像）
npm run spike
```

> spike 依赖：Playwright 的 Chromium、本地 LLM 端点（`tools/spike/spike.js` 顶部 `LLM` 配置，默认 `http://192.168.50.64:8080`）。
> 素材已本地化（`npm run assets` 下载 77 张图），不依赖 nvhae.com CDN。

## 目录

| 路径 | 说明 |
|---|---|
| `Characters/` `GameRule/` `Utils/` `Controller/` | 游戏本体（fork 原代码，ES5 全局 + eval + jQuery） |
| `tools/server.js` | 静态文件服务器（:8080） |
| `tools/mock-server.js` | 本地 mock WS 服务器（:28083），lockstep + bootstrap |
| `tools/spike/spike.js` | P0.4 spike：1 LLM vs 1 脚本完整对局 + 录像 |
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
