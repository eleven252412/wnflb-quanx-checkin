# wnflb-quanx-checkin

福利吧论坛自动签到的 **Quantumult X 专用版**。

这个版本已经优化成：
- **脚本里不写死明文 cookie**
- **网页登录 / 打开页面时，QuanX 自动抓取 cookie**
- cookie 只保存在 **QuanX 本地存档**
- 定时签到脚本只读取本地 cookie
- 保留 **可选账号密码兜底登录**（默认留空）
- 支持多域名兜底：`wnflb2023.com` / `wnflb00.com` / `wnflb99.com`

## 文件
- `wnflb-checkin-quanx.js`

## 工作方式
这个脚本有两种模式：

### 1）抓 cookie
当你在 QuanX 里打开福利吧网页，并命中重写规则时：
- 脚本会从请求头抓取 cookie
- 自动提取福利吧登录态相关 cookie
- 保存到 QuanX 本地：`wnflb_cookie`
- **只有 cookie 真变化时才提示**
- 如果 cookie 没变化，也会 **每天最多提示一次“仍有效”**
- 自带 **15 秒防抖**，避免重复弹窗

### 2）定时签到
定时任务运行时：
1. 先读 QuanX 本地保存的 `wnflb_cookie`
2. 打开论坛 PC 页 `forum.php?mobile=no`
3. 提取签到入口
4. 自动签到
5. 如果 cookie 失效，并且你填了账号密码 + 安全问题答案，就自动登录后再签到

## 一键导入
### QuanX 真正一键导入（推荐）
- 福利吧：`quantumult-x:///add-resource?remote-resource=https%3A%2F%2Fraw.githubusercontent.com%2Feleven252412%2Fwnflb-quanx-checkin%2Fmain%2Fquanx-import.conf,tag=%E7%A6%8F%E5%88%A9%E5%90%A7%E7%AD%BE%E5%88%B0&img-url=https%3A%2F%2Fraw.githubusercontent.com%2Fgithub%2Fexplore%2Fmain%2Ftopics%2Fquantumult-x%2Fquantumult-x.png`
- 福利吧 + 6SQ：`quantumult-x:///add-resource?remote-resource=https%3A%2F%2Fraw.githubusercontent.com%2Feleven252412%2Fwnflb-quanx-checkin%2Fmain%2Fquanx-import-all.conf,tag=%E7%A6%8F%E5%88%A9%E5%90%A7%2B6SQ%E7%AD%BE%E5%88%B0&img-url=https%3A%2F%2Fraw.githubusercontent.com%2Fgithub%2Fexplore%2Fmain%2Ftopics%2Fquantumult-x%2Fquantumult-x.png`

### 原始配置文件链接
- 福利吧：`https://raw.githubusercontent.com/eleven252412/wnflb-quanx-checkin/main/quanx-import.conf`
- 福利吧 + 6SQ：`https://raw.githubusercontent.com/eleven252412/wnflb-quanx-checkin/main/quanx-import-all.conf`

## QuanX 配置
下面已经直接写成可用 raw 链接。

### rewrite_local
```ini
[rewrite_local]
^https?:\/\/www\.wnflb(2023|00|99)\.com\/(forum\.php.*|member\.php.*|plugin\.php.*|$) url script-request-header https://raw.githubusercontent.com/eleven252412/wnflb-quanx-checkin/main/wnflb-checkin-quanx.js
```

### task_local
```ini
[task_local]
0 5 * * * https://raw.githubusercontent.com/eleven252412/wnflb-quanx-checkin/main/wnflb-checkin-quanx.js, tag=福利吧签到, enabled=true
```

## 首次使用步骤
1. 在 QuanX 里加入上面的 `rewrite_local`
2. 手动登录福利吧
3. 打开以下任一页面：
   - `https://www.wnflb2023.com/forum.php?mobile=no`
   - 或你当前可用域名对应页面
4. 看到通知：
   - `福利吧 Cookie 抓取 / 成功 / 已保存到 QuanX 本地存档`
5. 再启用 `task_local` 定时任务

## 可选：账号密码兜底登录
如果你希望 cookie 失效后尽量自动恢复，可以在脚本顶部填写：

```javascript
login: {
  username: '你的用户名',
  password: '你的密码',
  questionid: '4',
  answer: '你的安全问题答案'
}
```

如果不填：
- cookie 有效时，照样能用
- cookie 失效后，会提示你重新打开网页抓取新 cookie

## 通知说明
常见通知：
- 成功：`签到成功：用户名`
- 已签：`今天已签：用户名`
- 抓取：`福利吧 Cookie 抓取 / 成功 / 已保存到 QuanX 本地存档`
- 保活：`福利吧 Cookie 状态 / 仍有效 / 本地 cookie 未变化，今天已确认仍可读取`
- 失败：登录态失效 / 入口变化 / 运行异常

同时会尽量附带：
- 连续签到信息
- 当前积分
- 当前生效域名

## 返回结果
脚本日志里会输出：
- `RESULT: SUCCESS`
- `RESULT: ALREADY`
- `RESULT: SIGN_URL_NOT_FOUND`
- `RESULT: ERROR`

## 注意事项
1. 这是 **QuanX 专用任务脚本**，不是 Python 脚本。
2. 公开版本里 **不包含明文 cookie、账号、密码、密保答案**。
3. 如果本地没有 cookie，会提示：
   - `当前没有本地 cookie，请先在 QuanX 打开福利吧网页并抓取 cookie`
4. 如果 cookie 失效且没填登录信息，会提示你重新抓 cookie。
5. 如果站点改版，最容易失效的是：
   - 登录页字段
   - `fx_checkin` 签到入口正则

## 更新记录
### 2026-04-24
- 改为 QuanX 自动抓 cookie + 本地存档模式。
- 去掉脚本内明文 cookie 与账号密码默认值。
- 新增 `script-request-header` 抓取模式。
- 增加只在相关页面抓取、cookie 变化才提示、15 秒防抖，避免反复弹窗。
- 当 cookie 未变化时，新增“每天最多提示一次仍有效”提醒，避免误以为没抓到。
- 保留多域名兜底、自动签到、可选账号密码兜底登录逻辑。
