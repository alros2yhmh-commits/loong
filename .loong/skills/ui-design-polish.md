---
name: ui-design-polish
description: تصميم وتلميع واجهات المستخدم بمستوى احترافي مستوحى من Claude Desktop وأفضل الممارسات. يُستخدم عند تصميم أو تحسين UI components.
triggers: ui design, polish ui, improve interface, claude desktop style, modern ui
---

# UI Design Polish - مبادئ التصميم الاحترافي

## المبادئ الأساسية (مستوحاة من Claude Desktop)

### 1. Spacing & Layout
- استخدم **8px grid system** للتباعد المتناسق
- Padding داخلي: 8px, 12px, 16px, 24px, 32px
- Margins خارجي: 8px, 16px, 24px
- Gap بين العناصر: 4px, 8px, 12px
- **قاعدة:** لا تستخدم أرقام عشوائية مثل 7px أو 13px

### 2. Typography Hierarchy
- **Display:** font-size: 24-32px, font-weight: 600
- **Heading:** font-size: 16-20px, font-weight: 500-600
- **Body:** font-size: 13-14px, font-weight: 400
- **Caption:** font-size: 11-12px, font-weight: 400
- **Code:** font-family: monospace, font-size: 12px

### 3. Color System (OKLCH)
- استخدم **CSS custom properties** فقط - لا ألوان hardcoded
- Text: `var(--text-1)` للأساسي، `var(--text-2)` للثانوي، `var(--text-4)` للـ muted
- Backgrounds: `var(--surface)`, `var(--surface-sunken)`
- Borders: `var(--line-1)` رفيع، `var(--line-2)` متوسط، `var(--line-4)` قوي
- **قاعدة:** كل لون يجب أن يأتي من design tokens

### 4. Border Radius
- **Small elements** (buttons, inputs): 4-6px
- **Medium elements** (cards, modals): 8-12px
- **Large elements** (panels, sheets): 12-16px
- **Icons/avatars:** 50% للدوائر الكاملة

### 5. Shadows & Elevation
- **Subtle:** `box-shadow: 0 1px 3px oklch(0 0 0 / 0.08)`
- **Medium:** `box-shadow: 0 4px 12px oklch(0 0 0 / 0.12)`
- **Heavy:** `box-shadow: 0 8px 24px oklch(0 0 0 / 0.16)`
- استخدم shadows بحذر - Claude Desktop يفضل borders على shadows

## Micro-interactions (أساسية لـ Claude-like feel)

### 1. Hover States
```css
/* الأزرار */
button:hover {
  background: var(--surface-hover); /* تغيير خفيف */
  transition: background 0.15s ease;
}

/* الروابط */
a:hover {
  color: var(--text-1);
  text-decoration: underline;
  transition: color 0.12s ease;
}
```

### 2. Focus States (Accessibility)
```css
/* كل عنصر تفاعلي */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

### 3. Active States
```css
button:active {
  transform: scale(0.98);
  transition: transform 0.08s ease;
}
```

### 4. Loading States
- استخدم skeleton loaders بدلاً من spinners للمحتوى
- أضف `aria-busy="true"` و `aria-live="polite"`
- استخدم animations خفيفة: `pulse` أو `shimmer`

### 5. Transitions
```css
/* القاعدة الذهبية */
transition: [property] 0.15s ease;

/* للحركات السريعة */
transition: transform 0.08s ease;

/* للحركات البطيئة */
transition: opacity 0.3s ease;
```

**احترم reduced-motion:**
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Animations (Framer Motion patterns)

### 1. Enter/Exit Animations
```tsx
// Fade in
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}
/>

// Slide up
<motion.div
  initial={{ y: 20, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
/>
```

### 2. Layout Animations
```tsx
<motion.div layout transition={{ duration: 0.2 }} />
```

### 3. Gesture Animations
```tsx
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
/>
```

## Accessibility Checklist

### ✅ كل عنصر تفاعلي يجب أن يحتوي على:
- [ ] `aria-label` أو نص مرئي واضح
- [ ] `role` المناسب (button, link, checkbox, etc)
- [ ] `:focus-visible` outline واضح
- [ ] keyboard navigation support (Tab, Enter, Space)
- [ ] `aria-pressed` للأزرار toggle
- [ ] `aria-expanded` للعناصر القابلة للطي
- [ ] `aria-live` للتحديثات الديناميكية

### ✅ الألوان:
- [ ] تباين WCAG AA على الأقل (4.5:1 للنص العادي)
- [ ] تباين WCAG AAA مفضل (7:1)
- [ ] لا تعتمد على اللون وحده لنقل المعلومات

### ✅ النصوص:
- [ ] حجم خط لا يقل عن 12px
- [ ] line-height: 1.5 على الأقل للقراءة
- [ ] دعم `dir="auto"` للنصوص ثنائية الاتجاه

## Empty States (UX excellence)

### القاعدة الذهبية:
كل empty state يجب أن يحتوي على:
1. **Icon** - أيقونة توضيحية
2. **Heading** - عنوان واضح
3. **Description** - شرح قصير (1-2 جملة)
4. **Call-to-action** - زر أو رابط واضح للخطوة التالية

```tsx
<div className="flex flex-col items-center gap-[16px] py-[48px]">
  <IconEmpty size={48} style={{ color: 'var(--text-4)' }} />
  <div className="text-center">
    <h3 style={{ color: 'var(--text-2)' }}>No items yet</h3>
    <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>
      Get started by creating your first item
    </p>
  </div>
  <button className="ctl">Create item</button>
</div>
```

## Error States

```tsx
<div className="rounded-[8px] border border-[var(--error)] bg-[var(--error-bg)] p-[12px]">
  <div className="flex gap-[8px]">
    <IconError style={{ color: 'var(--error)' }} />
    <div>
      <p className="font-medium" style={{ color: 'var(--error)' }}>
        Something went wrong
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: '13px' }}>
        {errorMessage}
      </p>
      <button className="ctl mt-[8px]" onClick={retry}>
        Try again
      </button>
    </div>
  </div>
</div>
```

## Loading States

### Skeleton Loader (للمحتوى)
```tsx
<div className="animate-pulse">
  <div className="h-[16px] w-[120px] rounded-[4px] bg-[var(--line-1)]" />
  <div className="mt-[8px] h-[12px] w-[200px] rounded-[4px] bg-[var(--line-1)]" />
</div>
```

### Spinner (للأزرار)
```tsx
<button disabled aria-busy="true">
  <motion.div
    animate={{ rotate: 360 }}
    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
  >
    ⟳
  </motion.div>
  Loading...
</button>
```

## Responsive Design

### Breakpoints
- **Mobile:** < 640px
- **Tablet:** 640px - 1024px
- **Desktop:** > 1024px

### القواعد:
- استخدم `max-w-[94vw]` لتجنب overflow على الشاشات الصغيرة
- استخدم `flex-wrap` للعناصر المتعددة
- اختبر على 3 أحجام: 375px (mobile), 768px (tablet), 1440px (desktop)

## Testing Checklist

### قبل الـ commit:
- [ ] اختبر keyboard navigation (Tab, Enter, Escape)
- [ ] اختبر screen reader (NVDA/JAWS على Windows)
- [ ] اختبر dark mode (إذا كان مدعوماً)
- [ ] اختبر responsive على 3 أحجام
- [ ] اختبر مع `prefers-reduced-motion`
- [ ] تأكد من عدم وجود console errors/warnings

## أدوات مفيدة

### Chrome DevTools
- **Lighthouse** - accessibility audit
- **Color Contrast** - WCAG compliance
- **Device toolbar** - responsive testing

### Extensions
- **axe DevTools** - accessibility scanning
- **WAVE** - accessibility evaluation
- **ColorZilla** - color picker

### Online Tools
- **WebAIM Contrast Checker** - https://webaim.org/resources/contrastchecker/
- **Can I use** - browser compatibility
- **Accessible Colors** - OKLCH palette generator

## Claude Desktop Specific Patterns

### 1. Sidebar Pattern
- عرض ثابت ~240-280px
- border-right رفيع `var(--line-1)`
- background `var(--surface-sunken)`
- sticky header مع scroll body

### 2. Message Thread Pattern
- max-width: 680-720px للقراءة المريحة
- padding horizontal: 24-32px
- gap بين الرسائل: 16-24px
- alternating backgrounds للتمييز بين user/assistant

### 3. Composer Pattern
- sticky bottom مع backdrop blur
- border-top واضح
- auto-resize textarea
- shortcuts واضحة (Cmd+Enter)

### 4. Command Palette Pattern
- modal centered
- fuzzy search
- keyboard shortcuts (⌘K)
- recent items highlighted

## الخلاصة

### القواعد الذهبية:
1. **Consistency أولاً** - نظام موحد > تصميم فاخر
2. **Accessibility ليست optional** - كل عنصر يجب أن يكون accessible
3. **Performance matters** - 60fps أو لا شيء
4. **Test على أجهزة حقيقية** - لا تثق في DevTools فقط
5. **احترم تفضيلات المستخدم** - dark mode, reduced motion, font size

### عند الشك:
- **أبسط** أفضل من أكثر تعقيداً
- **أبطأ** أفضل من أسرع (للـ animations)
- **أوضح** أفضل من أجمل (للـ labels)
- **أكثر تباعداً** أفضل من متراص (للـ spacing)
