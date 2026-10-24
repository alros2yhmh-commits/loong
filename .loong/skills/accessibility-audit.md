---
name: accessibility-audit
description: فحص شامل لإمكانية الوصول (accessibility) في واجهات المستخدم. يُستخدم عند مراجعة أو اختبار UI components للتأكد من WCAG compliance.
triggers: accessibility audit, a11y check, wcag compliance, screen reader test
---

# Accessibility Audit - دليل الفحص الشامل

## متى تستخدم هذا الـ Skill
- قبل shipping أي feature جديد
- عند مراجعة pull request
- عند استلام bug report عن accessibility
- كجزء من CI/CD pipeline

## الأدوات المطلوبة

### 1. Browser DevTools
- **Chrome Lighthouse** (built-in)
- **Firefox Accessibility Inspector**
- **Edge Accessibility Insights**

### 2. Extensions
- **axe DevTools** - https://www.deque.com/axe/devtools/
- **WAVE** - https://wave.webaim.org/extension/
- **Accessibility Insights** - Microsoft

### 3. Screen Readers
- **NVDA** (Windows) - free, most popular
- **JAWS** (Windows) - commercial standard
- **VoiceOver** (macOS) - built-in
- **TalkBack** (Android) - built-in

### 4. Command Line Tools
```bash
# axe-core CLI
npm install -g @axe-core/cli
axe http://localhost:3000

# pa11y
npm install -g pa11y
pa11y http://localhost:3000

# lighthouse CLI
npm install -g lighthouse
lighthouse http://localhost:3000 --only-categories=accessibility
```

## الفحص الشامل - Checklist

### ✅ القسم 1: Semantic HTML

```tsx
// ❌ خطأ - divs في كل مكان
<div onClick={handleClick}>Click me</div>
<div class="heading">Title</div>

// ✅ صحيح - semantic elements
<button onClick={handleClick}>Click me</button>
<h2>Title</h2>
```

**ما تفحصه:**
- [ ] الأزرار الفعلية `<button>` وليس `<div role="button">`
- [ ] الروابط `<a>` للتنقل، `<button>` للأفعال
- [ ] Headings بترتيب منطقي (h1 → h2 → h3)
- [ ] Lists فعلية `<ul>/<ol>` للقوائم
- [ ] Forms باستخدام `<form>` + `<label>` + `<input>`
- [ ] `<main>`, `<nav>`, `<aside>`, `<footer>` للبنية

### ✅ القسم 2: ARIA Labels & Roles

```tsx
// ❌ خطأ - بدون label
<button><IconTrash /></button>

// ✅ صحيح - aria-label واضح
<button aria-label="Delete item"><IconTrash /></button>

// أو مع tooltip
<button title="Delete item" aria-label="Delete item">
  <IconTrash />
</button>
```

**ما تفحصه:**
- [ ] كل icon button لديه `aria-label`
- [ ] Toggle buttons لديها `aria-pressed`
- [ ] Expandable elements لديها `aria-expanded`
- [ ] Modal dialogs لديها `role="dialog"` + `aria-modal="true"`
- [ ] Live regions لديها `aria-live="polite"` أو `"assertive"`
- [ ] Form inputs لديها `<label>` أو `aria-label`
- [ ] Error messages مربوطة بـ `aria-describedby`

### ✅ القسم 3: Keyboard Navigation

**الاختبار اليدوي:**
1. أغلق الماوس تماماً
2. اضغط Tab للتنقل بين العناصر
3. اضغط Shift+Tab للرجوع
4. اضغط Enter/Space لتفعيل الأزرار
5. اضغط Escape لإغلاق Modals
6. اضغط Arrow keys في القوائم/Tabs

**ما تفحصه:**
- [ ] كل عنصر تفاعلي يمكن الوصول إليه بـ Tab
- [ ] ترتيب Tab منطقي (يتبع visual order)
- [ ] Focus visible بوضوح (outline/ring)
- [ ] لا يوجد keyboard trap (يمكنك الخروج من أي modal)
- [ ] Skip links للتنقل السريع
- [ ] Shortcuts موثقة ومعلنة للـ screen readers

```tsx
// Focus ring واضح
.ctl:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

// Skip link
<a href="#main-content" className="sr-only focus:not-sr-only">
  Skip to main content
</a>
```

### ✅ القسم 4: Color Contrast

**WCAG Standards:**
- **Level AA** (minimum): 4.5:1 للنص العادي، 3:1 للنص الكبير
- **Level AAA** (enhanced): 7:1 للنص العادي، 4.5:1 للنص الكبير

**أدوات الفحص:**
```bash
# Chrome DevTools → Inspect → Accessibility
# يعرض contrast ratio مباشرة
```

**ما تفحصه:**
- [ ] نص body على background (4.5:1 minimum)
- [ ] نص secondary/muted (3:1 minimum على الأقل)
- [ ] أزرار وroابط (4.5:1)
- [ ] Icons وأيقونات (3:1)
- [ ] Borders للـ inputs (3:1)
- [ ] Disabled states (يُسمح بتباين أقل)

```tsx
// استخدم أداة WebAIM
// https://webaim.org/resources/contrastchecker/

// مثال:
// Background: oklch(1 0 0) (white)
// Text: oklch(0.3 0 0) (dark gray)
// Contrast: ~13:1 ✅ AAA
```

### ✅ القسم 5: Images & Media

```tsx
// ❌ خطأ
<img src="logo.png" />

// ✅ صحيح - decorative
<img src="logo.png" alt="" role="presentation" />

// ✅ صحيح - meaningful
<img src="chart.png" alt="Sales increased by 30% in Q4" />

// ✅ صحيح - complex image
<figure>
  <img src="chart.png" alt="Sales chart" aria-describedby="chart-desc" />
  <figcaption id="chart-desc">
    Detailed description of the sales data...
  </figcaption>
</figure>
```

**ما تفحصه:**
- [ ] كل `<img>` لديها `alt` (حتى لو فارغ)
- [ ] alt text وصفي (ليس "image" أو "photo")
- [ ] decorative images: `alt=""` + `role="presentation"`
- [ ] Complex images لديها `aria-describedby`
- [ ] Videos لديها captions/subtitles
- [ ] Audio لديها transcripts

### ✅ القسم 6: Forms

```tsx
// ❌ خطأ
<div>
  Email:
  <input type="text" />
</div>

// ✅ صحيح
<div>
  <label htmlFor="email">Email address</label>
  <input
    id="email"
    type="email"
    aria-required="true"
    aria-invalid={hasError}
    aria-describedby={hasError ? 'email-error' : undefined}
  />
  {hasError && (
    <p id="email-error" role="alert">
      Please enter a valid email
    </p>
  )}
</div>
```

**ما تفحصه:**
- [ ] كل input لديه `<label>` مرتبط بـ `htmlFor`/`id`
- [ ] Required fields معلّمة بـ `aria-required="true"`
- [ ] Error messages مرتبطة بـ `aria-describedby`
- [ ] Error messages لديها `role="alert"`
- [ ] Invalid inputs معلّمة بـ `aria-invalid="true"`
- [ ] Fieldsets لـ radio buttons/checkboxes
- [ ] `autocomplete` attributes للبيانات الشخصية

### ✅ القسم 7: Dynamic Content

```tsx
// Loading state
<div aria-live="polite" aria-busy="true">
  Loading...
</div>

// Success message
<div role="status" aria-live="polite">
  Item saved successfully
</div>

// Error (urgent)
<div role="alert" aria-live="assertive">
  Failed to save item
</div>
```

**ما تفحصه:**
- [ ] Loading states لديها `aria-busy="true"`
- [ ] Success messages لديها `aria-live="polite"`
- [ ] Error messages لديها `role="alert"`
- [ ] Updates معلنة للـ screen readers
- [ ] Focus management عند فتح/إغلاق modals

### ✅ القسم 8: Tables

```tsx
// ✅ صحيح
<table>
  <caption>Monthly sales report</caption>
  <thead>
    <tr>
      <th scope="col">Month</th>
      <th scope="col">Sales</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">January</th>
      <td>$10,000</td>
    </tr>
  </tbody>
</table>
```

**ما تفحصه:**
- [ ] `<caption>` موجود
- [ ] `<th>` مع `scope="col"` أو `scope="row"`
- [ ] `<thead>`, `<tbody>`, `<tfoot>` مستخدمة
- [ ] للجداول المعقدة: `headers` attribute

### ✅ القسم 9: Modals & Dialogs

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-desc"
>
  <h2 id="dialog-title">Confirm deletion</h2>
  <p id="dialog-desc">Are you sure you want to delete this item?</p>
  <button onClick={handleCancel}>Cancel</button>
  <button onClick={handleConfirm}>Delete</button>
</div>
```

**ما تفحصه:**
- [ ] `role="dialog"` + `aria-modal="true"`
- [ ] `aria-labelledby` يشير إلى العنوان
- [ ] Focus trap (لا يمكن Tab خارج الـ modal)
- [ ] Focus يذهب للـ modal عند الفتح
- [ ] Focus يرجع للعنصر الذي فتح الـ modal عند الإغلاق
- [ ] Escape يغلق الـ modal
- [ ] Click خارج الـ modal يغلقه (optional)

### ✅ القسم 10: Motion & Animation

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**ما تفحصه:**
- [ ] احترام `prefers-reduced-motion`
- [ ] لا توجد animations ضرورية للفهم
- [ ] لا توجد flashing content (خطر الصرع)
- [ ] Auto-playing media قابلة للإيقاف

## الفحص الآلي - Commands

### 1. Lighthouse (Chrome DevTools)
```bash
# في DevTools
# 1. افتح DevTools (F12)
# 2. اذهب لـ Lighthouse tab
# 3. اختر "Accessibility" فقط
# 4. اضغط "Analyze page load"

# أو من CLI
lighthouse http://localhost:3000 \
  --only-categories=accessibility \
  --output=html \
  --output-path=./audit-report.html
```

### 2. axe DevTools
```bash
# تثبيت extension في Chrome
# ثم في DevTools → axe DevTools tab
# اضغط "Scan ALL of my page"

# أو CLI
axe http://localhost:3000 --save audit.json
```

### 3. pa11y
```bash
# فحص صفحة واحدة
pa11y http://localhost:3000

# فحص عدة صفحات
pa11y-ci --sitemap http://localhost:3000/sitemap.xml

# مع threshold
pa11y http://localhost:3000 --threshold 10
```

### 4. Jest + jest-axe
```tsx
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

test('should not have accessibility violations', async () => {
  const { container } = render(<MyComponent />)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
})
```

## الاختبار اليدوي - Workflow

### 1. Screen Reader Test (15 دقيقة)
```
1. شغّل NVDA (Windows) أو VoiceOver (Mac)
2. اضغط Tab للتنقل
3. استمع للإعلانات - هل واضحة؟
4. جرّب Submit form
5. جرّب فتح Modal وإغلاقه
6. جرّب عرض Error message
7. أوقف الـ screen reader
```

### 2. Keyboard-Only Test (10 دقائق)
```
1. افصل الماوس فعلياً (أو ضعه بعيداً)
2. تنقل في كل الصفحة بـ Tab
3. جرّب كل الأزرار بـ Enter/Space
4. افتح Modals واغلقها بـ Escape
5. جرّب Navigation بـ Arrow keys
6. تأكد أن Focus visible دائماً
```

### 3. Color Contrast Test (5 دقائق)
```
1. افتح Chrome DevTools
2. Inspect أي نص
3. اذهب لـ Accessibility panel
4. اقرأ Contrast ratio
5. تأكد أنه 4.5:1 على الأقل
```

### 4. Zoom Test (5 دقائق)
```
1. اضغط Ctrl/Cmd + (zoom in)
2. زود الـ zoom لـ 200%
3. تأكد أن المحتوى مقروء
4. لا يوجد horizontal scroll
5. لا يوجد overlapping text
```

## Common Issues & Fixes

### Issue 1: Missing aria-label
```tsx
// ❌ Before
<button onClick={handleDelete}>
  <IconTrash />
</button>

// ✅ After
<button onClick={handleDelete} aria-label="Delete item">
  <IconTrash />
</button>
```

### Issue 2: Poor focus visible
```css
/* ❌ Before */
:focus {
  outline: none;
}

/* ✅ After */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

### Issue 3: Form without labels
```tsx
// ❌ Before
<input placeholder="Email" />

// ✅ After
<label htmlFor="email">Email</label>
<input id="email" type="email" />
```

### Issue 4: Modal keyboard trap
```tsx
// ✅ استخدم مكتبة مثل react-focus-lock
import FocusLock from 'react-focus-lock'

<FocusLock>
  <div role="dialog" aria-modal="true">
    {/* modal content */}
  </div>
</FocusLock>
```

### Issue 5: No live regions
```tsx
// ❌ Before
{loading && <p>Loading...</p>}

// ✅ After
{loading && (
  <p role="status" aria-live="polite">
    Loading...
  </p>
)}
```

## تقرير الفحص - Template

```markdown
# Accessibility Audit Report
**Date:** [التاريخ]
**Component/Page:** [الاسم]
**Auditor:** [اسمك]

## Summary
- Total issues: X
- Critical: X
- Serious: X
- Moderate: X
- Minor: X

## Issues Found

### 1. [Issue title]
**Severity:** Critical/Serious/Moderate/Minor
**WCAG Criterion:** [e.g., 1.4.3 Contrast]
**Location:** [file:line]

**Description:**
[وصف المشكلة]

**Current code:**
```tsx
[الكود الحالي]
```

**Recommended fix:**
```tsx
[الكود المقترح]
```

**Impact:**
[تأثير المشكلة على المستخدمين]

---

## Tools Used
- [ ] Lighthouse
- [ ] axe DevTools
- [ ] NVDA screen reader
- [ ] Keyboard navigation
- [ ] Color contrast checker

## Next Steps
1. Fix critical issues
2. Fix serious issues
3. Re-audit after fixes
4. Add automated tests
```

## CI/CD Integration

### GitHub Actions
```yaml
name: Accessibility Audit

on: [push, pull_request]

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - run: npm start & npx wait-on http://localhost:3000
      - run: npx pa11y-ci http://localhost:3000
```

## Resources

### Standards
- **WCAG 2.1:** https://www.w3.org/WAI/WCAG21/quickref/
- **ARIA:** https://www.w3.org/WAI/ARIA/apg/

### Tools
- **axe DevTools:** https://www.deque.com/axe/devtools/
- **WAVE:** https://wave.webaim.org/
- **Color Contrast:** https://webaim.org/resources/contrastchecker/

### Learning
- **WebAIM:** https://webaim.org/
- **A11y Project:** https://www.a11yproject.com/
- **MDN Accessibility:** https://developer.mozilla.org/en-US/docs/Web/Accessibility

## الخلاصة

**قاعدة واحدة:**  
إذا لم تستطع استخدام موقعك بـ **keyboard only** أو **screen reader**، فهو غير accessible.

**اختبر دائماً مع:**
1. ✅ Keyboard navigation
2. ✅ Screen reader (NVDA)
3. ✅ Color contrast tool
4. ✅ Lighthouse audit

**كل PR يجب أن يمر من:**
- [ ] Lighthouse score > 90
- [ ] لا توجد axe violations
- [ ] Keyboard navigation يعمل
- [ ] Focus visible واضح
