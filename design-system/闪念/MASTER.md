# 闪念 Design System (Master)

> 来源：grill 决策 + Cubox 阅读库对标 + frontend-design 约束  
> 气质：**Cubox 式阅读收件箱 · 纸感浅色 · 柔和 indigo-blue · 摘要优先的分流台**

## 1. Product

- **Name:** 闪念  
- **Job:** 跨平台灵感「快捕获 → 好找回 → 能内化」  
- **Audience:** 单人自托管  
- **Signature:** 侧栏左缘 **2px indigo 指示条** + 顶栏极细 **capture hairline 输入**（像命令行而非表单）

## 2. Color tokens

| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| background | `#F4F5F7` | `#0C0D10` | 纸感页面底 |
| foreground | `#1A1D26` | `#E8EAED` | 主文字 |
| card | `#FFFFFF` | `#14161C` | 表面（轻 elevation） |
| muted | `#EEF0F4` | `#1C1F28` | 弱底 |
| muted-foreground | `#6B7280` | `#9CA3AF` | 摘要/次要字 |
| border | `#E6E8EE` | `#23262F` | 分割线 |
| primary | `#4C6EF5` | `#748FFC` | 柔和 indigo-blue |
| primary-foreground | `#FFFFFF` | `#0B1020` | 主按钮字 |
| accent | `#EEF2FF` | `#1A1F3A` | 选中导航底 |
| accent-foreground | `#364FC7` | `#C7D2FE` | 选中导航字 |
| warning | `#B45309` / bg `#FEF3C7` | amber-200 / amber-950 | 收件箱 |
| success | `#047857` / bg `#D1FAE5` | emerald | 已沉淀 |
| destructive | `#E11D48` | `#FB7185` | 删除 |
| ring | `#6366F1` | `#818CF8` | 焦点环 |

**规则：** 组件只用语义 token，禁止业务代码写 `bg-blue-500`。平台色仅小点，不抢 primary。

## 3. Typography

- **UI 字体:** `Inter` + 中文系统栈（`PingFang SC` / `Noto Sans SC`）  
- **可选展示:** 侧栏品牌字可用稍紧 `tracking-tight`  
- **Scale (dense):**  
  - caption 11px / 12px muted  
  - body 13px  
  - title 14–15px medium  
  - page 18px semibold  
- **行高:** 标题 1.25，正文 1.5

## 4. Layout

- **Shell:** 左栏 240px 固定 · 主区 **全宽**（无 max-w 钳制列表）  
- **密度:** 默认 comfortable 行高 ~48px；compact ~40px  
- **列表默认行式**；网格为可选  
- **圆角:** control 8px · card 12px · 大面板 12–16px  
- **阴影:** 几乎不用；靠 1px border  
- **间距:** 8 基线（gap-2/3/4）

## 5. Motion

- 过渡 150–200ms `ease-out`  
- `prefers-reduced-motion: reduce` 时取消位移动画  
- 不做大范围 scroll-reveal

## 6. Interaction / a11y

- 所有可点元素 `cursor-pointer`  
- **可见 focus-visible ring**（2px ring + offset）  
- 主区提供 **Skip to content**  
- 按钮文案动作一致：保存 / 已保存  
- 空状态：说明 + 一个主 CTA  
- 触控目标 ≥ 36px（桌面），关键操作 ≥ 40px  

## 7. Components (shadcn-aligned)

| 场景 | 组件 |
|------|------|
| 主操作 | Button default |
| 次操作 | outline / ghost |
| 输入 | Input / Textarea + 语义 token |
| 状态 | Badge (warning / indigo / success) |
| 反馈 | sonner toast |
| 快速添加 | Dialog (⌘K) + 顶栏 InputGroup 感 |
| 侧栏导航 | 自定义 nav + accent 选中态 |
| 空列表 | Empty 模式（图标 + 标题 + CTA） |

## 8. Anti-patterns

- 厚投影、玻璃拟态大雾  
- Emoji 当唯一图标（列表缩略图兜底可用，UI chrome 用 Lucide）  
- 中间内容被 max-w-5xl 勒死  
- 无焦点环的 `outline-none`  
- 默认深色 cinema 风（与「默认浅色」冲突）
