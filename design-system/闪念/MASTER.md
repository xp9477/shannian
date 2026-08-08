# 闪念 Design System (Master)

> 来源：grill 决策 + Cubox 阅读库对标 + frontend-design / U1–U2  
> 气质：**Cubox 式阅读收件箱 · 暖纸浅色 · 柔和 indigo · 摘要优先的分流台**

## 1. Product

- **Name:** 闪念  
- **Job:** 跨平台灵感「快捕获 → 好找回 → 能内化」  
- **Audience:** 单人自托管  
- **Signature:** 侧栏左缘 **2px indigo 指示条** + 主区 **capture hairline**（底边输入，像命令行）  
- **导航:** 收件箱 / 沉淀 / 想法（无「全部」；主题靠分类，无标签）

## 2. Color tokens

| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| background | `#F6F5F2` | `#0C0D10` | 暖纸页面底 |
| foreground | `#1A1D26` | `#E8EAED` | 主文字 |
| card | `#FFFEFC` | `#14161C` | 纸白表面 |
| muted | `#EEECE7` | `#1C1F28` | 弱底 |
| muted-foreground | `#6B7280` | `#9CA3AF` | 次要字 |
| border | `#E5E2DB` | `#23262F` | 分割线 |
| primary | `#4C6EF5` | `#748FFC` | 柔和 indigo |
| primary-foreground | `#FFFFFF` | `#0B1020` | 主按钮字 |
| accent | `#EEF2FF` | `#1A1F3A` | 选中导航底 |
| accent-foreground | `#364FC7` | `#C7D2FE` | 选中导航字 |
| warning | `#B45309` | amber | 收件箱计数等 |
| success | `#047857` | emerald | 沉淀相关 |
| destructive | `#E11D48` | `#FB7185` | 删除 |
| ring | `#748FFC` | `#818CF8` | 焦点环 |
| sidebar | `#FAF9F6` | `#0E1014` | 侧栏 |

**规则：** 组件只用语义 token。平台色仅小点。

## 3. Typography

- **UI:** `Inter` + 中文系统栈  
- **Scale:** caption 12 · body 14 · list title 15–16 medium · page h1 17–18 semibold  
- **行高:** 标题 ~1.35，列表标题可稍紧；正文 1.55–1.65  
- **字重:** 标题 600，UI 控件 500，说明 400  

## 4. Layout

- **Shell:** 左栏 ~248px · 主区 **列表全宽**（仅 padding）；**详情**正文 ~40rem  
- **密度:** 单一舒适密度（已砍 compact 切换）  
- **列表默认行式**；网格固定比例（如 4:3），非瀑布流  
- **圆角:** control 8px · card 12–14px · 面板 16px  
- **阴影:** 极轻或无；靠 1px border  
- **间距:** 8 基线  

## 5. Motion

- 过渡 150–200ms `ease-out`  
- `prefers-reduced-motion: reduce` 时取消位移动画  

## 6. Interaction / a11y

- `cursor-pointer`；**focus-visible ring**  
- Skip to content  
- 批量：仅选中后出现条；checkbox 桌面 hover 显现  
- 触控目标默认 **≥40px**（按钮 default/icon）；列表勾选常显可键盘操作  

## 7. Components

| 场景 | 组件 |
|------|------|
| 主操作 | Button default / secondary「沉淀」 |
| 次操作 | outline / ghost（移回弱样式） |
| 捕获 | 主区 hairline；侧栏「快速添加」focus 首页输入 |
| 筛选 | 折叠「筛选」+ 活跃角标 |
| 导航 | 侧栏 nav-active + 2px 指示条 |
| 空列表 | Empty + 一个 CTA |

## 8. Anti-patterns

- 厚投影、大玻璃拟态  
- 列表状态角标（与侧栏重复）  
- 标签体系、⌘K 双入口  
- 列表 max-w 勒死主栏  
- 瀑布流不等高封面
