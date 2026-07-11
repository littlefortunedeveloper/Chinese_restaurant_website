# 🐉 Chinese Restaurant Website Template · 中餐馆网站模板

A professional, graphic-rich restaurant website that runs 100% on **GitHub Pages** (free hosting).
**Everything updates by editing simple .txt files — no coding needed.**

专业中餐馆网站模板，免费托管在 GitHub Pages。**改 txt 文件即可更新网站，完全不用碰代码。**

---

## 📁 What's Inside 文件结构

```
├── index.html              首页
├── menu.html               菜单页
├── css/style.css           样式（中式深红金配色）
├── js/site.js              读取配置和公告
├── js/menu.js              读取并渲染菜单
├── data/
│   ├── menu_data.txt       ★ 菜单数据（改这个更新菜单）
│   ├── announcements.txt   ★ 公告条（改这个发布通知）
│   ├── popup.txt           ★ 弹窗（开关+内容）
│   └── site_config.txt     ★ 餐厅信息（名称/电话/营业时间）
└── images/                 照片文件夹（可选）
```

---

## 🚀 Setup 部署到 GitHub Pages（一次性，5分钟）

1. **注册/登录 [github.com](https://github.com)**

2. **创建仓库** → 点右上角 **+** → **New repository**
   - 仓库名随意，例如 `restaurant-website`
   - 选 **Public**
   - 点 **Create repository**

3. **上传文件** → 在仓库页面点 **uploading an existing file**
   - 把本模板**所有文件和文件夹**拖进去
   - 点 **Commit changes**

4. **开启 GitHub Pages** → 仓库页面 → **Settings** → 左边栏 **Pages**
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，文件夹选 **/ (root)**
   - 点 **Save**

5. **完成！** 1-2分钟后你的网站上线：
   `https://你的用户名.github.io/restaurant-website/`

---

## ✏️ 日常更新（核心功能）

**所有更新都是同一个流程：在 GitHub 网页上编辑 txt → Commit → 等约1分钟 → 网站自动更新**

在仓库里点开文件 → 点右上角**铅笔图标 ✏️** → 修改 → 点 **Commit changes**

### 1. 更新菜单 → 编辑 `data/menu_data.txt`

格式（和菜单PDF生成器**完全相同**，一份数据两处用）：

```
=== Appetizers / 开胃菜 / Aperitivos ===
SUBTITLE: NONE

1.  Roast Pork Egg Roll | 春卷 | Rollo de Cerdo Asado | 2.60
16. Hot & Sour Soup [SPICY] | 酸辣汤 | Sopa Agripicante [SPICY] | SM:4.95/LG:7.95
```

| 想做什么 | 怎么做 |
|---------|--------|
| 改价格 | 直接改最后一列数字 |
| 加新菜 | 在对应分类下加一行 |
| 删菜 | 删掉整行 |
| 标记辣菜 | 英文和西班牙文名后面加 `[SPICY]` |
| 大小份价格 | 写成 `SM:4.75/LG:7.25` |
| 分类限时供应（如午餐特价只卖到下午3:30） | 在该分类下加一行 `AVAILABLE: Until 3:30 PM`，网页过点自动隐藏整个分类、次日自动恢复；也可写时段 `AVAILABLE: 11:00 AM - 3:30 PM`。只影响网页，打印PDF不受影响 |
| 全店涨价10% | 把文件顶部 `PRICE_ADJUST: 0` 改成 `PRICE_ADJUST: +10%` |
| 全店每道菜涨$1 | 改成 `PRICE_ADJUST: +1.00` |

### 2. 发布公告 → 编辑 `data/announcements.txt`

一行一条，格式：`日期 | 标题 | 内容`

```
2026-07-01 | Holiday Hours 节日营业 | Closed July 4th. 7月4日休息一天。
```

- 新公告写最上面
- 删掉整行 = 撤下公告
- 公告会同时显示在首页和菜单页

### 3. 开/关弹窗公告 → 编辑 `data/popup.txt`

访客打开网站会看到弹窗（适合放节日休息、重要通知）：

```
ENABLED: ON          ← 改成 OFF 就关闭弹窗
TITLE: 📢 重要通知
BUTTON: 知道了 Got it

正文第一行（想写几行写几行）
正文第二行，可以用 {PHONE} {NAME_ZH} 等自动带入店里信息
```

弹窗**每位访客一次浏览只弹一次**（首页弹过，翻菜单页不再弹）；
你更新内容后访客会重新看到一次新弹窗。想每页都弹：加 `SHOW_ONCE: OFF`。

### 4. 在线订餐平台链接 → 编辑 `data/site_config.txt`

支持6个平台：**自家订餐系统（金色主按钮）· DoorDash · Uber Eats · Grubhub · Menufy · EatStreet**

```
ORDER_ONLINE: https://order.example.com          ← 你自己的订餐系统
ORDER_DOORDASH: https://www.doordash.com/store/xxx
ORDER_UBEREATS: https://www.ubereats.com/store/xxx
...
```

- 换成你店铺在各平台的真实链接
- **不用某平台？链接留空或删掉整行，按钮自动消失**
- 全部留空 → 整个订餐区块自动隐藏
- 按钮显示在：首页"Order Online"专区 + 菜单页顶部订餐条

### 5. 改餐厅信息 → 编辑 `data/site_config.txt`

电话、地址、营业时间、简介……都在这里，`KEY: 值` 格式，改完即生效。

### 6. 加照片（可选）→ 上传到 `images/` 文件夹

网站没有照片也很漂亮（自带中式花纹设计）。想放真实照片：
上传 `images/about.jpg`，然后编辑 `index.html`，
把 `<span class="glyph">福</span>` 换成 `<img src="images/about.jpg" alt="">`。

---

## ❓ 常见问题

**改了 txt 网站没变？**
等 1-2 分钟（GitHub Pages 部署需要时间），然后强制刷新浏览器（Ctrl+Shift+R / Cmd+Shift+R）。

**手机上能看吗？**
能，全站响应式设计，手机/平板/电脑都自动适配。

**这个 menu_data.txt 和菜单PDF生成器是同一个文件吗？**
是同一个格式！同一份 txt 既能生成打印PDF菜单，又能驱动网站菜单，改一次两边都更新。

**网站是免费的吗？**
GitHub Pages 完全免费，自定义域名功能也免费（域名本身需要向域名商购买）。

---

## 🌐 使用自己的域名 Custom Domain / External Site

想用 `www.goldendragon.com` 代替 `xxx.github.io/repo/`？

**完整图文步骤见 `CUSTOM_DOMAIN_SETUP.txt`**，核心三步：

1. **GitHub绑定**：仓库 → Settings → Pages → Custom domain → 填入你的域名 → Save（GitHub会自动创建CNAME文件）
2. **DNS解析**：到你的域名商添加记录：
   - `CNAME` 记录：`www` → `你的用户名.github.io`（**不带仓库名**）
   - 4条 `A` 记录（裸域名用）：`@` → `185.199.108.153` / `.109.153` / `.110.153` / `.111.153`
3. **开HTTPS**：DNS生效后（通常1小时内），回到 Settings → Pages 勾选 **Enforce HTTPS**

绑定域名后一切照旧：**改txt → Commit → 网站自动更新**。本模板全部使用相对路径，github.io子目录和自定义域名根目录下都无需改任何代码。

---

## 🧪 本地预览（可选，开发者用）

```bash
cd restaurant-website
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 注意：必须通过 http 服务器打开（不能直接双击 html 文件），
> 因为浏览器安全策略不允许 file:// 协议下 fetch 本地文件。


