---
name: micro-interactions
description: تصميم وتطبيق micro-interactions وanimations هادفة تحسّن تجربة المستخدم. يُستخدم عند إضافة تفاعلات دقيقة للواجهة.
triggers: micro-interactions, animations, hover effects, smooth transitions, framer motion
---

# Micro-interactions - التفاعلات الدقيقة

## ما هي Micro-interactions؟

تفاعلات صغيرة تحدث عند:
- Hover على عنصر
- Click على زر
- Focus على input
- Loading أو Success state
- Drag & Drop
- Toggle switch

**الهدف:** إعطاء feedback فوري للمستخدم - "نعم، أنا سمعتك!"

## المبادئ الأساسية

### 1. Purpose over decoration
كل animation يجب أن تخدم غرضاً:
- ✅ **توضيح:** "هذا الزر clickable"
- ✅ **تأكيد:** "تم حفظ البيانات"
- ✅ **توجيه:** "انظر هنا"
- ❌ **زينة فقط:** animations بدون معنى

### 2. Timing is everything
- **Fast:** 100-200ms للـ hover/active states
- **Medium:** 200-300ms للـ transitions
- **Slow:** 300-500ms للـ complex animations
- **Rule:** أسرع من أن تشعر أنها느릴، أبطأ من أن تفوتك

### 3. Easing functions
```css
/* ❌ Linear - يشعر بأنه robotic */
transition: transform 0.3s linear;

/* ✅ Ease - طبيعي وسلس */
transition: transform 0.3s ease;

/* ✅ Ease-out - سريع في البداية، بطيء في النهاية */
transition: transform 0.3s ease-out;

/* ✅ Custom cubic-bezier - للتحكم الكامل */
transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

**متى تستخدم أي واحد:**
- `ease-out`: للأشياء التي تدخل الشاشة
- `ease-in`: للأشياء التي تخرج من الشاشة
- `ease-in-out`: للأشياء التي تتحرك داخل الشاشة

## Patterns شائعة

### 1. Button Hover
```tsx
// Basic hover
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
  transition={{ duration: 0.15 }}
  className="px-[16px] py-[8px] rounded-[6px]"
  style={{ background: 'var(--accent)' }}
>
  Click me
</motion.button>
```

```css
/* CSS only */
button {
  transition: all 0.15s ease;
}

button:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px oklch(0 0 0 / 0.12);
}

button:active {
  transform: scale(0.98);
}
```

### 2. Input Focus
```tsx
<motion.input
  whileFocus={{ scale: 1.01 }}
  transition={{ duration: 0.2 }}
  className="w-full px-[12px] py-[8px] rounded-[6px]"
  style={{
    border: '1px solid var(--line-2)',
    outline: 'none',
  }}
/>
```

```css
input {
  border: 1px solid var(--line-2);
  transition: all 0.2s ease;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px oklch(from var(--accent) l c h / 0.15);
}
```

### 3. Loading Spinner
```tsx
// Rotating icon
<motion.div
  animate={{ rotate: 360 }}
  transition={{
    duration: 1,
    repeat: Infinity,
    ease: 'linear',
  }}
  style={{ display: 'inline-block' }}
>
  ⟳
</motion.div>
```

```css
/* CSS animation */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinner {
  animation: spin 1s linear infinite;
}
```

### 4. Skeleton Loader
```tsx
<motion.div
  animate={{ opacity: [0.5, 1, 0.5] }}
  transition={{
    duration: 1.5,
    repeat: Infinity,
    ease: 'easeInOut',
  }}
  className="h-[16px] w-[200px] rounded-[4px]"
  style={{ background: 'var(--line-1)' }}
/>
```

```css
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.skeleton {
  animation: pulse 1.5s ease-in-out infinite;
}
```

### 5. Toast Notification
```tsx
<motion.div
  initial={{ y: -100, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  exit={{ y: -100, opacity: 0 }}
  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
  className="fixed top-[16px] right-[16px] px-[16px] py-[12px] rounded-[8px]"
  style={{
    background: 'var(--success-bg)',
    border: '1px solid var(--success)',
  }}
>
  ✓ Saved successfully
</motion.div>
```

### 6. Modal Enter/Exit
```tsx
// Backdrop
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.2 }}
  style={{
    position: 'fixed',
    inset: 0,
    background: 'oklch(0 0 0 / 0.5)',
  }}
/>

// Modal
<motion.div
  initial={{ scale: 0.95, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  exit={{ scale: 0.95, opacity: 0 }}
  transition={{ duration: 0.2 }}
  role="dialog"
  aria-modal="true"
>
  {/* content */}
</motion.div>
```

### 7. Toggle Switch
```tsx
<button
  onClick={() => setEnabled(!enabled)}
  className="relative h-[24px] w-[48px] rounded-full"
  style={{
    background: enabled ? 'var(--accent)' : 'var(--line-3)',
    transition: 'background 0.2s ease',
  }}
>
  <motion.div
    layout
    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    className="absolute top-[2px] h-[20px] w-[20px] rounded-full"
    style={{
      left: enabled ? '26px' : '2px',
      background: 'white',
    }}
  />
</button>
```

### 8. Accordion Expand/Collapse
```tsx
<div>
  <button
    onClick={() => setOpen(!open)}
    className="flex items-center gap-[8px]"
  >
    <motion.span
      animate={{ rotate: open ? 90 : 0 }}
      transition={{ duration: 0.2 }}
    >
      ›
    </motion.span>
    {title}
  </button>
  
  <motion.div
    initial={false}
    animate={{
      height: open ? 'auto' : 0,
      opacity: open ? 1 : 0,
    }}
    transition={{ duration: 0.2 }}
    style={{ overflow: 'hidden' }}
  >
    {content}
  </motion.div>
</div>
```

### 9. Drag & Drop
```tsx
<motion.div
  drag
  dragConstraints={{ left: 0, right: 300, top: 0, bottom: 300 }}
  dragElastic={0.1}
  whileDrag={{ scale: 1.05, cursor: 'grabbing' }}
  className="p-[16px] rounded-[8px]"
  style={{ background: 'var(--surface)', cursor: 'grab' }}
>
  Drag me
</motion.div>
```

### 10. Ripple Effect (Material Design)
```tsx
function RippleButton({ children, onClick }: any) {
  const [ripples, setRipples] = useState<any[]>([])

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    const newRipple = { x, y, id: Date.now() }
    setRipples([...ripples, newRipple])
    
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== newRipple.id))
    }, 600)
    
    onClick?.(e)
  }

  return (
    <button
      onClick={handleClick}
      className="relative overflow-hidden"
      style={{ position: 'relative' }}
    >
      {children}
      {ripples.map((ripple) => (
        <motion.span
          key={ripple.id}
          initial={{ scale: 0, opacity: 0.5 }}
          animate={{ scale: 4, opacity: 0 }}
          transition={{ duration: 0.6 }}
          style={{
            position: 'absolute',
            left: ripple.x,
            top: ripple.y,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'currentColor',
            pointerEvents: 'none',
          }}
        />
      ))}
    </button>
  )
}
```

## Advanced Patterns

### 1. Staggered Animation (للقوائم)
```tsx
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const item = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1 },
}

<motion.ul variants={container} initial="hidden" animate="show">
  {items.map((item) => (
    <motion.li key={item.id} variants={item}>
      {item.text}
    </motion.li>
  ))}
</motion.ul>
```

### 2. Shared Layout Animation
```tsx
// عنصر ينتقل بين مكانين
<motion.div layoutId="shared-element">
  {/* content */}
</motion.div>

// في مكان آخر
<motion.div layoutId="shared-element">
  {/* نفس المحتوى */}
</motion.div>

// Framer Motion تتعامل مع الانتقال تلقائياً!
```

### 3. Scroll-triggered Animation
```tsx
import { useScroll, useTransform } from 'framer-motion'

function ParallaxSection() {
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 300], [0, -50])
  
  return (
    <motion.div style={{ y }}>
      {/* content */}
    </motion.div>
  )
}
```

### 4. Gesture-based Animation
```tsx
<motion.div
  drag="x"
  dragConstraints={{ left: -100, right: 100 }}
  onDragEnd={(e, info) => {
    if (info.offset.x > 100) {
      // Swiped right
    } else if (info.offset.x < -100) {
      // Swiped left
    }
  }}
>
  Swipe me
</motion.div>
```

## Performance Tips

### 1. استخدم transform بدلاً من top/left
```css
/* ❌ بطيء - يسبب layout reflow */
.element {
  transition: top 0.3s;
}

/* ✅ سريع - GPU-accelerated */
.element {
  transition: transform 0.3s;
}
```

### 2. استخدم will-change بحذر
```css
/* للعناصر التي ستتحرك قريباً */
.element:hover {
  will-change: transform;
}

/* أزله بعد الانتهاء */
.element {
  will-change: auto;
}
```

### 3. استخدم requestAnimationFrame
```tsx
const animate = () => {
  // animation logic
  requestAnimationFrame(animate)
}

requestAnimationFrame(animate)
```

### 4. Debounce expensive animations
```tsx
const handleScroll = debounce(() => {
  // animation logic
}, 16) // ~60fps
```

## Accessibility

### 1. احترم prefers-reduced-motion
```tsx
import { useReducedMotion } from 'framer-motion'

function Component() {
  const shouldReduceMotion = useReducedMotion()
  
  return (
    <motion.div
      animate={{
        scale: shouldReduceMotion ? 1 : 1.05,
      }}
    />
  )
}
```

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 2. لا تعتمد على animation للمعلومات الحرجة
```tsx
// ❌ خطأ - loading state فقط بـ animation
<motion.div animate={{ rotate: 360 }} />

// ✅ صحيح - نص واضح + animation
<div>
  <motion.div animate={{ rotate: 360 }} />
  <span>Loading...</span>
</div>
```

## Testing

### 1. Visual Regression Testing
```bash
# Chromatic or Percy
npm run chromatic
```

### 2. Animation Testing
```tsx
import { render, waitFor } from '@testing-library/react'

test('button scales on hover', async () => {
  const { container } = render(<Button />)
  const button = container.querySelector('button')
  
  fireEvent.mouseEnter(button)
  
  await waitFor(() => {
    expect(button).toHaveStyle('transform: scale(1.02)')
  })
})
```

## Common Mistakes

### ❌ 1. Too many animations
```tsx
// كل شيء يتحرك - overwhelming!
<motion.div animate={{ scale: 1.1, rotate: 10, x: 20 }} />
```

### ❌ 2. Too slow
```tsx
// 1 ثانية للـ hover - frustrating!
<button style={{ transition: 'all 1s' }} />
```

### ❌ 3. No purpose
```tsx
// لماذا يدور؟ لا يوجد سبب!
<motion.div animate={{ rotate: 360 }} />
```

### ❌ 4. Animating expensive properties
```css
/* يسبب layout reflow */
transition: width 0.3s, height 0.3s, padding 0.3s;
```

### ✅ الحل الصحيح
```css
/* استخدم transform + opacity فقط */
transition: transform 0.3s, opacity 0.3s;
```

## Claude Desktop Patterns

### 1. Message Thread Scroll
```tsx
// Smooth scroll to bottom عند رسالة جديدة
useEffect(() => {
  if (messageRef.current) {
    messageRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    })
  }
}, [messages])
```

### 2. Composer Focus
```tsx
// Subtle scale عند focus
<motion.textarea
  whileFocus={{ scale: 1.005 }}
  transition={{ duration: 0.2 }}
/>
```

### 3. Sidebar Collapse
```tsx
<motion.aside
  animate={{ width: collapsed ? 0 : 280 }}
  transition={{ duration: 0.3, ease: 'easeInOut' }}
/>
```

### 4. Tool Card Expand
```tsx
<motion.div
  layout
  initial={false}
  animate={{ height: expanded ? 'auto' : 60 }}
  transition={{ duration: 0.2 }}
/>
```

## Resources

- **Framer Motion Docs:** https://www.framer.com/motion/
- **Cubic Bezier Generator:** https://cubic-bezier.com/
- **Easing Functions:** https://easings.net/
- **Motion Design Guide:** https://material.io/design/motion/

## الخلاصة

### القواعد الذهبية:

1. **Purposeful, not decorative** - كل animation تخدم غرضاً
2. **Fast but not instant** - 100-300ms للمعظم
3. **Ease over linear** - طبيعي > robotic
4. **Transform over position** - GPU-accelerated
5. **Respect reduced-motion** - accessibility أولاً
6. **Test on real devices** - الأداء يختلف

### متى تستخدم:
- ✅ **Hover states** - feedback فوري
- ✅ **Loading states** - يقلل perceived wait time
- ✅ **Success/error** - تأكيد واضح
- ✅ **Navigation** - توجيه الانتباه
- ❌ **زينة فقط** - لا فائدة
