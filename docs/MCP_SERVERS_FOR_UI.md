# MCP Servers للتصميم والواجهات

**التاريخ:** 24 أكتوبر 2026  
**الغرض:** توثيق MCP servers المفيدة لتطوير وتحسين واجهات المستخدم

---

## ما هي MCP Servers؟

**Model Context Protocol (MCP)** - بروتوكول يسمح لـ Claude (أو Loong) بالاتصال بأدوات خارجية وخدمات عبر servers موحدة.

**الفائدة:**
- الوصول لأدوات التصميم (Figma، Storybook)
- تحليل accessibility تلقائياً
- مزامنة design tokens
- integration مع testing tools

---

## الفئات الرئيسية

```ui
{"type":"table","head":["الفئة","الاستخدام","الأولوية"],"rows":[["Design Tools","Figma, Sketch API","عالية"],["Testing","Accessibility audits, visual regression","عالية"],["Analytics","User behavior, heatmaps","متوسطة"],["Documentation","Storybook, design system docs","متوسطة"],["Performance","Lighthouse, Core Web Vitals","منخفضة"]]}
```

---

## 1. Design Tools MCP Servers

### A. Figma MCP Server

**الوظيفة:** قراءة designs من Figma والوصول لـ design tokens (colors، spacing، typography).

#### التثبيت
```bash
# عبر npm
npm install -g @modelcontextprotocol/server-figma

# أو من المصدر
git clone https://github.com/modelcontextprotocol/servers.git
cd servers/figma
npm install
npm run build
```

#### التكوين في `claude_desktop_config.json`
```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": [
        "C:\\path\\to\\servers\\figma\\dist\\index.js"
      ],
      "env": {
        "FIGMA_ACCESS_TOKEN": "figd_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

#### الحصول على Figma Token
1. اذهب إلى https://www.figma.com/developers/api#access-tokens
2. اضغط "Generate new token"
3. انسخ الـ token وضعه في التكوين

#### الأدوات المتاحة
- `figma_get_file` - قراءة ملف Figma كامل
- `figma_get_styles` - استخراج color/text styles
- `figma_get_components` - قراءة components library
- `figma_export_images` - تصدير assets

#### مثال استخدام
```typescript
// استخراج design tokens من Figma
const tokens = await figma_get_styles({
  fileKey: 'ABC123',
  type: 'color'
})

// تحويلها لـ CSS variables
const css = tokens.map(token => 
  `--${token.name}: ${token.value};`
).join('\n')
```

#### الفوائد
- ✅ مزامنة تلقائية للـ design tokens
- ✅ تحديث الألوان من Figma مباشرة
- ✅ استخراج spacing/typography scales
- ✅ export assets بجودة عالية

---

### B. Storybook MCP Server (مخصص)

**الوظيفة:** قراءة وتحديث Storybook stories لتوثيق components.

#### البنية المقترحة
```typescript
// storybook-mcp-server/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new Server({
  name: 'storybook-server',
  version: '1.0.0',
})

// Tool: قراءة story
server.tool('read_story', async ({ component }) => {
  // قراءة ملف .stories.tsx
  const story = await readStoryFile(`src/components/${component}.stories.tsx`)
  return { content: [{ type: 'text', text: story }] }
})

// Tool: تحديث story
server.tool('update_story', async ({ component, story }) => {
  // كتابة story جديد
  await writeStoryFile(`src/components/${component}.stories.tsx`, story)
  return { content: [{ type: 'text', text: 'Story updated' }] }
})
```

#### التكوين
```json
{
  "storybook": {
    "command": "node",
    "args": ["./storybook-mcp-server/dist/index.js"],
    "env": {
      "STORYBOOK_DIR": "C:\\Users\\Hamza\\Desktop\\LOONG\\src\\components"
    }
  }
}
```

---

## 2. Testing MCP Servers

### A. Accessibility Testing Server

**الوظيفة:** فحص accessibility تلقائياً باستخدام axe-core.

#### التثبيت
```bash
npm install -g @modelcontextprotocol/server-axe
```

#### التكوين
```json
{
  "axe": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-axe"]
  }
}
```

#### الأدوات المتاحة
- `axe_scan_url` - فحص URL مباشر
- `axe_scan_html` - فحص HTML snippet
- `axe_get_rules` - قائمة قواعد WCAG

#### مثال
```typescript
const results = await axe_scan_url({
  url: 'http://localhost:3000',
  rules: ['color-contrast', 'aria-labels']
})

// النتيجة:
// {
//   violations: [
//     { rule: 'color-contrast', elements: [...], impact: 'serious' }
//   ],
//   passes: 45,
//   violations: 3
// }
```

---

### B. Visual Regression Server

**الوظيفة:** التقاط screenshots ومقارنتها للكشف عن تغييرات بصرية غير مقصودة.

#### استخدام Percy (SaaS)
```bash
npm install --save-dev @percy/cli @percy/puppeteer
```

#### MCP Server مخصص
```typescript
// visual-regression-server/index.ts
import puppeteer from 'puppeteer'
import { diffImages } from 'pixelmatch'

server.tool('capture_screenshot', async ({ url, name }) => {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto(url)
  await page.screenshot({ path: `screenshots/${name}.png` })
  await browser.close()
  return { content: [{ type: 'text', text: 'Screenshot captured' }] }
})

server.tool('compare_screenshots', async ({ before, after }) => {
  const diff = await diffImages(before, after)
  return {
    content: [{
      type: 'text',
      text: `${diff.pixelsDifferent} pixels changed (${diff.percentDifferent}%)`
    }]
  }
})
```

---

## 3. Analytics MCP Servers

### A. Google Analytics Server

**الوظيفة:** قراءة بيانات استخدام المستخدمين لفهم سلوكهم.

#### التثبيت
```bash
npm install -g googleapis
```

#### التكوين
```json
{
  "google-analytics": {
    "command": "node",
    "args": ["./ga-server/index.js"],
    "env": {
      "GA_PROPERTY_ID": "UA-XXXXX-Y",
      "GA_CREDENTIALS": "./credentials.json"
    }
  }
}
```

#### الأدوات
- `ga_get_pageviews` - عدد المشاهدات لكل صفحة
- `ga_get_user_flow` - كيف ينتقل المستخدمون بين الصفحات
- `ga_get_bounce_rate` - معدل الارتداد

#### الفائدة
- فهم أي صفحات تحتاج تحسين
- اكتشاف pain points في UX
- قياس تأثير التحسينات

---

### B. Hotjar / FullStory Integration

**الوظيفة:** session recordings و heatmaps.

#### مثال API call
```typescript
server.tool('get_heatmap', async ({ page }) => {
  const response = await fetch(
    `https://api.hotjar.com/v1/sites/${siteId}/heatmaps/${page}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  )
  return await response.json()
})
```

---

## 4. Performance MCP Servers

### A. Lighthouse Server

**الوظيفة:** فحص performance, accessibility, SEO, best practices.

#### التثبيت
```bash
npm install -g lighthouse
```

#### MCP Server
```typescript
import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'

server.tool('run_lighthouse', async ({ url }) => {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] })
  const options = { port: chrome.port }
  const runnerResult = await lighthouse(url, options)
  await chrome.kill()
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        performance: runnerResult.lhr.categories.performance.score * 100,
        accessibility: runnerResult.lhr.categories.accessibility.score * 100,
        bestPractices: runnerResult.lhr.categories['best-practices'].score * 100,
        seo: runnerResult.lhr.categories.seo.score * 100,
      })
    }]
  }
})
```

---

### B. Core Web Vitals Server

**الوظيفة:** قياس LCP, FID, CLS.

```typescript
server.tool('measure_web_vitals', async ({ url }) => {
  // استخدام web-vitals library
  const vitals = await measureVitals(url)
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        LCP: vitals.largestContentfulPaint,
        FID: vitals.firstInputDelay,
        CLS: vitals.cumulativeLayoutShift,
      })
    }]
  }
})
```

---

## 5. Color & Design System Servers

### A. Color Contrast Checker

```typescript
server.tool('check_contrast', async ({ foreground, background }) => {
  const ratio = calculateContrastRatio(foreground, background)
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ratio: ratio.toFixed(2),
        AA: ratio >= 4.5,
        AAA: ratio >= 7,
        AALarge: ratio >= 3,
      })
    }]
  }
})
```

---

### B. Design Tokens Sync

**الوظيفة:** مزامنة design tokens بين Figma و CSS.

```typescript
server.tool('sync_tokens', async ({ figmaFileKey }) => {
  // 1. قراءة styles من Figma
  const styles = await figma.getStyles(figmaFileKey)
  
  // 2. تحويلها لـ CSS variables
  const css = stylesToCSS(styles)
  
  // 3. كتابتها في ملف
  await fs.writeFile('src/styles/tokens.css', css)
  
  return { content: [{ type: 'text', text: 'Tokens synced' }] }
})
```

---

## 6. AI-powered Design Servers

### A. Design Feedback Server

**الوظيفة:** استخدام vision AI لتقييم التصميم.

```typescript
import Anthropic from '@anthropic-ai/sdk'

server.tool('critique_design', async ({ screenshotPath }) => {
  const image = await fs.readFile(screenshotPath, { encoding: 'base64' })
  
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: image }
        },
        {
          type: 'text',
          text: 'Critique this UI design. Focus on: hierarchy, spacing, contrast, accessibility.'
        }
      ]
    }]
  })
  
  return { content: [{ type: 'text', text: response.content[0].text }] }
})
```

---

## تكوين Loong لاستخدام MCP Servers

### ملف التكوين: `mcp_config.json`

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["C:\\mcp-servers\\figma\\dist\\index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "figd_..."
      }
    },
    "axe": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-axe"]
    },
    "lighthouse": {
      "command": "node",
      "args": ["C:\\mcp-servers\\lighthouse\\dist\\index.js"]
    },
    "visual-regression": {
      "command": "node",
      "args": ["C:\\mcp-servers\\visual-regression\\dist\\index.js"],
      "env": {
        "SCREENSHOTS_DIR": "C:\\Users\\Hamza\\Desktop\\LOONG\\screenshots"
      }
    },
    "design-critique": {
      "command": "node",
      "args": ["C:\\mcp-servers\\design-critique\\dist\\index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

---

## Workflow مقترح

### 1. Design Phase
```
1. تصميم في Figma
2. Loong يقرأ design tokens عبر Figma MCP
3. Loong يولّد CSS variables تلقائياً
4. Loong ينشئ React components
```

### 2. Development Phase
```
1. كتابة component
2. Loong يفحص accessibility عبر axe MCP
3. Loong يصلح المشاكل تلقائياً
4. Loong ينشئ Storybook story
```

### 3. Testing Phase
```
1. Loong يلتقط screenshot
2. Loong يقارن مع baseline (visual regression)
3. Loong يشغّل Lighthouse audit
4. Loong يعطي تقرير شامل
```

### 4. Deployment Phase
```
1. Loong يفحص production build
2. Loong يقيس Core Web Vitals
3. Loong يرصد analytics بعد deployment
4. Loong يقترح تحسينات based on data
```

---

## الأولويات للتثبيت

```ui
{"type":"steps","items":["Figma MCP - لمزامنة design tokens (أولوية قصوى)","axe MCP - لفحص accessibility تلقائياً (أولوية عالية)","Lighthouse MCP - لقياس performance (أولوية متوسطة)","Visual Regression - للكشف عن تغييرات بصرية (أولوية متوسطة)","Analytics MCP - لفهم سلوك المستخدمين (أولوية منخفضة)"]}
```

---

## Resources

### Official
- **MCP Documentation:** https://modelcontextprotocol.io/
- **MCP SDK:** https://github.com/modelcontextprotocol/typescript-sdk
- **Official Servers:** https://github.com/modelcontextprotocol/servers

### Community
- **MCP Marketplace:** https://mcpmarket.com/
- **Awesome MCP:** https://github.com/punkpeye/awesome-mcp

### APIs
- **Figma API:** https://www.figma.com/developers/api
- **axe-core:** https://github.com/dequelabs/axe-core
- **Lighthouse:** https://github.com/GoogleChrome/lighthouse

---

## الخلاصة

MCP Servers تحوّل Loong من code editor إلى **design-aware development environment**:

- ✅ **Automated accessibility** - لا تشحن بدون a11y
- ✅ **Design-code sync** - tokens محدثة دائماً
- ✅ **Performance monitoring** - lighthouse في كل commit
- ✅ **Visual regression** - لا تكسر UI بدون قصد
- ✅ **Data-driven decisions** - تحسينات based on analytics

**النتيجة:** واجهات أسرع، أكثر accessibility، أكثر consistency.

---

**تم إعداد هذا التوثيق بواسطة:** Loong (龙)  
**لـ:** Professor Hamza Mahmoud Ramadan  
**التاريخ:** 24 أكتوبر 2026
